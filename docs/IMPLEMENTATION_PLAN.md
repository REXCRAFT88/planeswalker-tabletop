# Planeswalker Tabletop — Repair & AI Player Implementation Plan

This document is an implementation plan produced from a full code audit of the repository
(commit `b4ef406`). It is written to be executed top-to-bottom by an implementing agent.
Part 1 summarizes the current state, Part 2 is the bug-fix / feature-completion plan,
Part 3 is the design and implementation plan for AI opponents powered by the Claude API.

---

## Part 1 — Current-state assessment

**What the app is:** a React 19 + Vite SPA (`App.tsx`, `components/`) with a small
Express + Socket.IO relay server (`server/index.ts`, ~500 lines). The server keeps no
game state beyond room membership and opaque per-seat state blobs; all game logic lives
in the clients. `components/Tabletop.tsx` (5,611 lines) contains virtually all gameplay:
board objects, zones, mana engine integration, socket sync, hot-seat local play, mobile
relaying, undo, stats.

**Play modes:**
1. **Online room** — each player is a socket client; actions are broadcast via a single
   `game_action` relay event. Mostly works.
2. **Local game (hot-seat)** — one device, `localOpponents` seats, view switches per
   turn. Works. Opponents typed `'ai'` exist in the data model but there is **zero AI
   logic** — they are just seats the human plays manually.
3. **Local Table + Mobile Controller** — main device is the board, phones join to hold
   hands. **Completely broken end-to-end** (see P0-2).

**Verified:** `npx tsc --noEmit` passes; `npm run build` succeeds (single 523 kB chunk).

**Biggest problems found (details + fixes in Part 2):**
- The DeckBuilder's import function was gutted (leftover AI-editing comments in its
  place) — the primary "Load Deck" button does nothing.
- Three socket events used by the mobile flow have **no server-side handler**, so Local
  Table mode dead-ends at "Connecting to Table…".
- Every game action is emitted **twice** (copy-paste duplicate), causing duplicate log
  entries and double-counted damage/healing stats on remote clients.
- Dev-mode multiplayer is broken out of the box: the server's CORS allowlist is
  `http://localhost:5173` but Vite is configured for port 3000.
- Deck mana rules are silently dropped when loading a deck from the library.
- Assorted leftover cruft: a full duplicate old copy of the project checked into the
  repo (`planeswalker-tabletop old/`), duplicated UI buttons, dead code comments from a
  previous AI edit session, a CDN importmap that conflicts with the bundled build.

---

## Part 2 — Bug fix & feature-completion plan

Work is ordered by priority: **P0** = broken user-facing functionality, **P1** =
correctness bugs and traps, **P2** = hygiene/robustness/refactoring. Each item states
file, location, problem, and the fix to implement.

### P0-1. Restore deck import in `DeckBuilder.tsx`

- **Where:** `components/DeckBuilder.tsx:70-79` (`handleImport`).
- **Problem:** The function body was replaced with editing-session comments and a bare
  `setLoading(true)`. Clicking **Load Deck** spins forever and never imports. This is
  the app's primary deck-building entry point.
- **Fix:** Reimplement `handleImport` (a working reference exists in
  `components/LocalSetup.tsx:47-97` `handleImportDeck`):
  1. `parseDeckList(deckText)`; error out if empty.
  2. `fetchBatch(names, (cur, total) => setProgress({current: cur, total}))`.
  3. Expand counts into card instances (`crypto.randomUUID()` ids), route `isToken`
     cards into `stagedTokens`, the rest into the deck.
  4. Auto-generate default mana rules for mana sources via
     `generateDefaultManaRule(card)` (already imported) keyed by `scryfallId`, merged
     into `manaRules` state without overwriting user-edited rules.
  5. Report cards that could not be resolved (collect misses from the returned map) in
     `setError` rather than failing silently.
  6. `finally { setLoading(false); setProgress(null); }`.
- Also delete the dead comment block at lines 33-35, 53-54, 71-78 and the leftover
  "I can't go back" comments in `components/Lobby.tsx:228-231`.

### P0-2. Make Local Table / Mobile Controller actually work (server relays missing)

- **Where:** `server/index.ts` (no handlers), `components/MobileController.tsx:58-77`,
  `components/Tabletop.tsx:912-1015, 1531-1550`.
- **Problem:** Three events are emitted but never relayed by the server, so they go
  nowhere:
  - `get_slots` — mobile emits it; the *host client* listens for it
    (`Tabletop.tsx:922`), but the server never forwards it. Mobile is stuck on
    "Connecting to Table…" forever.
  - `slots_update` — host emits it (`Tabletop.tsx:937`) with **no room argument**;
    server has no handler; mobile never receives the slot list.
  - `send_stats_update` — host emits it (`Tabletop.tsx:1547`); server has no handler;
    the mobile life/poison view never syncs from the host.
- **Fix (server):** add three relay handlers mirroring the existing
  `send_hand_update` pattern (room-membership check + targeted emit):
  ```ts
  socket.on('get_slots', ({ room }) => {
      room = normalize(room); if (!isInRoom(socket.id, room)) return;
      const hostId = roomMeta[room]?.hostId;
      if (hostId) io.to(hostId).emit('get_slots', { requesterId: socket.id });
  });
  socket.on('slots_update', ({ room, slots, targetId }) => {
      room = normalize(room); if (!isHost(socket.id, room)) return;
      if (targetId) io.to(targetId).emit('slots_update', slots);
      else socket.to(room).emit('slots_update', slots);
  });
  socket.on('send_stats_update', ({ roomId, targetId, life, poison, commanderDamage }) => {
      const r = normalize(roomId); if (!isInRoom(socket.id, r)) return;
      io.to(targetId).emit('send_stats_update', { life, poison, commanderDamage });
  });
  ```
- **Fix (host, `Tabletop.tsx`):**
  - In the `get_slots` handler (line 922), accept `{ requesterId }` and emit
    `slots_update` back with `{ room: roomId, targetId: requesterId, slots }`.
  - After a slot claim is confirmed, re-broadcast `slots_update` to the room so other
    phones see the seat marked taken (the TODO at line 982 notes this was never done).
  - **Stats targeting bug** (line 1531-1550): the effect sends stats to
    `targetId: myId` where `myId` is the host's *currently viewed seat id* — not the
    mobile controller's socket. Rework: when a mobile player claims a slot, record
    `slotId → applicantSocketId` in a ref (the `mobileControllers` set already exists at
    line 1000 — extend it to a map). Push `send_stats_update` to the mapped socket id
    whenever that seat's `localPlayerStates` life/poison/commanderDamage changes (do it
    inside `handleMobileUpdateLife` / `handleMobileUpdateCounter`, plus on hand sync).
- **Fix (mobile, `MobileController.tsx`):**
  - The status effect (lines 51-78) re-runs on every `status` change and re-emits
    `get_slots`; scope it to run once on mount + a manual "refresh slots" button.
  - Implement the disabled "Cmdr" tab (line 283-289) or hide it; the
    "Commander Damage coming soon" placeholder (line 260) should become a real grid once
    `send_stats_update` flows (data is already in the payload).

### P0-3. Remove the duplicated `game_action` emit

- **Where:** `components/Tabletop.tsx:1676-1677` (`emitAction`).
- **Problem:** `socket.emit('game_action', ...)` appears twice back-to-back. Every
  action is broadcast twice. Idempotent handlers (`ADD_OBJECT` dedupes by id,
  `UPDATE_OBJECT` overwrites) hide it, but non-idempotent ones corrupt state on all
  remote clients:
  - `LOG` → every log line appears twice for opponents.
  - `TRACK_DAMAGE_DEALT` (line 2067) → damage stats **double-counted**.
  - `TRACK_HEALING_GIVEN` (line 2078) → healing stats double-counted.
  - `PASS_TURN` → duplicate "ended their turn" log entries.
- **Fix:** delete one of the two lines. Then grep for any other doubled emits
  (`update_player_order` is intentionally sent both as relay + server-state update at
  lines 2474-2476 — leave that, but add a comment explaining it).

### P0-4. Fix dev-mode CORS / port mismatch

- **Where:** `vite.config.ts:8` (port 3000), `server/index.ts:19` (CORS origin
  `http://localhost:5173`), `services/socket.ts:5` (dev URL `localhost:3001`).
- **Problem:** In `npm run dev`, the page is served at `localhost:3000` but the
  Socket.IO server only accepts origin `localhost:5173` → all connections rejected;
  multiplayer cannot be developed or tested locally.
- **Fix:** set `server.port: 5173` in `vite.config.ts` (Vite's default, matches CORS),
  or better, make the server's CORS origin configurable:
  `origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:5173', 'http://localhost:3000']`.
  Add a line to the README describing the dev setup (`npm run dev` starts both).

### P0-5. Stop losing mana rules (and deck identity) when loading decks

- **Where:** `components/Lobby.tsx:223-226` (`handleLoadDeck`), `Lobby.tsx:207-210`
  (`handleLocalGame`), `App.tsx:194-211` (`handleSaveDeck`), `App.tsx:245-248`
  (`initialId` lookup).
- **Problems:**
  1. `handleLoadDeck` calls `onLoadDeck(deck.deck, deck.tokens, false, deck.name)` —
     omitting `deck.manaRules` and `deck.id`. Loading a deck from the library silently
     discards its custom mana rules (the auto-tap engine then falls back to defaults).
  2. `handleLocalGame` auto-loads the most recent deck the same way.
  3. Deck identity is tracked **by name**: `App.handleSaveDeck` syncs active state via
     `deck.name === activeDeckName`, and `App.tsx:245` finds `initialId` by name.
     Renaming a deck in the editor breaks the linkage and can create duplicates.
- **Fix:**
  - Thread `manaRules` and `id` through every `onLoadDeck` call:
    `onLoadDeck([...deck.deck], [...deck.tokens], false, deck.name, deck.manaRules, deck.id)`.
  - Add `activeDeckId: string | null` state in `App.tsx`; set it in `handleDeckReady`
    and `handleDeckSelected`; use it (not name) for the save-sync check and for
    `DeckBuilder`'s `initialId`.
  - Also persist `activeManaRules` + `activeDeckName`/`activeDeckId` in the settings
    `useEffect` (`App.tsx:96-105`) so a reload restores the active deck's rules rather
    than re-deriving from "most recent saved deck".

### P1-1. Stats/stale-closure bugs in the socket handler

- **Where:** `components/Tabletop.tsx:1739-2205` (socket effect, registered with `[]`
  deps).
- **Problems:**
  - `TRACK_HEALING_GIVEN` (line 2078-2083) computes from `gameStats[getMyId()]` captured
    at mount — stale; healing totals are wrong after the first update.
  - `nextTurn` (lines 2840-2846) adds `durationMs` to `totalTurnTime` twice: once via
    `setGameStats` and again via `updateMyStats(... + durationMs)` reading stale
    `gameStats`.
- **Fix:** route *all* stat mutations through one updater that uses the functional
  `setGameStats(prev => ...)` form and emits `UPDATE_STATS` from inside it (the
  `TRACK_DAMAGE_DEALT` handler at 2068-2076 already does this correctly — copy that
  pattern). Remove the double add in `nextTurn`.

### P1-2. Server deletes room state the moment everyone disconnects

- **Where:** `server/index.ts:471-475` (disconnect handler) — and the same pattern in
  `leave_room` at 310-313 is fine (explicit leave), but the disconnect path is not.
- **Problem:** when the last connected player drops (single-player games, or a shared
  network blip), `rooms/roomMeta/roomStates` are deleted immediately, defeating the
  advertised 5-minute reconnect window and the `backup_state`/`load_state` restore path.
  (Local-storage backup papers over it for the host only.)
- **Fix:** remove the immediate delete in the `disconnect` handler; let the existing
  60-second cleanup interval (lines 484-503, 10-minute threshold) collect fully
  disconnected rooms. Keep the immediate delete in `leave_room` (explicit exit).

### P1-3. Validate `update_player_order`

- **Where:** `server/index.ts:253-258`.
- **Problem:** the server replaces `rooms[room]` wholesale with a client-supplied array
  — a malformed or malicious payload can corrupt the roster (inject fake players, drop
  userIds, break reconnect matching).
- **Fix:** treat the payload as an *ordering* only: map incoming ids onto the existing
  `rooms[room]` entries, keep server-side fields authoritative, ignore unknown ids,
  append any missing existing players at the end.

### P1-4. Guard crashes when `mySeatIndex === -1`

- **Where:** `Tabletop.tsx:1607` (`getMyId`), `1687` (`addLog` reads
  `playersList[mySeatIndex].name`), `2382`, `2521`.
- **Problem:** before the roster arrives (or after a kick), `mySeatIndex` is `-1` and
  these throw `Cannot read properties of undefined`, white-screening the table.
- **Fix:** add null-safe fallbacks (`playersList[mySeatIndex]?.name ?? playerName`,
  `?.id ?? socket.id ?? 'local-player'`) at each site.

### P1-5. Mulligan flow blocks when Local Table has unclaimed/AI seats

- **Where:** `Tabletop.tsx:2541, 2638, 2757` (`allKept = playersList.every(...)`).
- **Problem:** seats of type `open_slot` that were never claimed (and, once AI exists,
  AI seats) never set `hasKeptHand`, so the game can never leave the MULLIGAN phase
  unless the host manually cycles through every seat.
- **Fix:** compute `allKept` over *active* seats only: claimed mobile seats + the host +
  hot-seat humans. Auto-mark unclaimed `open_slot` seats as kept when the game starts
  (or remove them from `playersList` at start). This also becomes the AI hook point
  (Part 3): AI seats resolve their mulligan via the AI service.

### P1-6. `restoreGameFromBackup` wipes multiplayer turn order

- **Where:** `Tabletop.tsx:1226-1238` — the restore sync emits
  `turnOrder: [myNewId]` and `currentTurnPlayerId: myNewId` unconditionally.
- **Problem:** intended for solo-rejoin, but the function is also reachable from the
  Player Manager button in multiplayer games; syncing it clobbers everyone's turn order.
- **Fix:** when `data.turnOrder` exists in the backup, remap old ids → current ids
  (reuse the `reconnectedPlayerMap` logic at 1789-1816) instead of `[myNewId]`; only
  fall back to `[myNewId]` when the backup has a single player.

### P1-7. UI/markup duplication & dead controls

- `components/LocalSetup.tsx:146-152` — the **Back** button is rendered twice; delete
  one.
- `components/MobileController.tsx:283-289` — disabled "Cmdr" tab (see P0-2).
- `App.tsx:107-113` — the keep-alive ping is fine, but do it only in production
  (`if (import.meta.env.PROD)`).

### P2-1. index.html cleanup (Tailwind + importmap)

- **Where:** `index.html:7` (Tailwind Play CDN) and `index.html:51-60` (esm.sh
  importmap for react/react-dom/lucide-react).
- **Problem:** the Tailwind CDN script is the dev-only Play build — every production
  page load downloads and JIT-compiles Tailwind in the browser (slow first paint, flash
  of unstyled content, no purging). The importmap points bare specifiers at esm.sh while
  Vite simultaneously bundles the same packages — currently inert (Vite rewrites the
  imports) but a footgun that can load **two React copies** if any module slips through
  unbundled.
- **Fix:** remove the importmap entirely. Install Tailwind properly
  (`tailwindcss` + `@tailwindcss/vite` plugin, a real `tailwind.css` entry, content
  globs over `./components/**/*.tsx`, `App.tsx`, `index.tsx`) and delete the CDN
  script. Verify all utility classes used (including `animate-in`, `fade-in`,
  `zoom-in`, `spin-in` — these come from `tailwindcss-animate` / `tw-animate-css`;
  add that plugin) still render identically before/after by visual spot-check.

### P2-2. Repo hygiene

- Delete `planeswalker-tabletop old/` (a full stale copy of the app committed to the
  repo) and the root-level `Mana colors/` directory (duplicates `public/mana/`); update
  any references (grep first — none found in current source).
- Ensure `.gitignore` covers `node_modules/`, `dist/`.
- Remove `MOCK_CARDS` from `constants.ts` if unused (grep confirms only defined).
- Remove the misleading "AI-powered Rules Judge" claim from `metadata.json`
  (the Gemini judge was removed; see `services/gemini.ts`) — or re-add the feature as
  part of Part 3.

### P2-3. Break up `Tabletop.tsx` (prerequisite for AI work)

5,611 lines with ~60 `useState` hooks + parallel refs is the main source of the
stale-closure bug class above, and the AI driver (Part 3) needs clean entry points.
Extract, without behavior changes, in this order:

1. `hooks/useGameSync.ts` — the socket effect (room updates, `game_action` dispatch,
   reconnection mapping, state backup/restore). Expose an imperative `applyAction`
   +`emitAction` pair so both remote events **and the future AI driver** mutate game
   state through one function.
2. `hooks/useLocalSeats.ts` — `localPlayerStates`, save/load seat, hot-seat switching,
   mobile handlers.
3. `state/gameReducer.ts` — move board-object/zone mutations
   (`ADD_OBJECT`/`UPDATE_OBJECT`/`REMOVE_OBJECT`/zone moves/draw/shuffle) into a
   reducer over a single `GameState` object. This is the single most valuable change:
   it gives the AI a serializable snapshot and a validated mutation interface for free.
4. Presentational extraction (Playmat, HandCard, modals) — lowest priority.

Keep each step compiling (`npx tsc --noEmit`) and verify with a two-tab smoke test.

### P2-4. Nice-to-haves (do only after everything above)

- Code-split the 523 kB bundle (lazy-load `DeckBuilder`, `LocalSetup`,
  `MobileController`).
- Server: add basic rate limiting on `join_room`/`game_action` (e.g. token bucket per
  socket) and cap rooms per process.
- `nextTurn` in remote mode passes to "the player after **me**" (`Tabletop.tsx:2828`),
  not "after the current turn player" — harmless when only the active player clicks End
  Turn, wrong if someone else does. Gate the End Turn button on
  `currentTurnPlayerId === socket.id` (host override allowed).

### Verification checklist (run after each phase)

1. `npx tsc --noEmit` and `npm run build` stay green.
2. `npm run dev`, two browser profiles → create room, join, start game, play/tap/move
   cards, pass turns, check the log shows **single** entries on both clients.
3. Kill one tab mid-game, rejoin within 5 min → state restores (tests P1-2).
4. Local Table: host on desktop, phone (or second tab with mobile emulation) joins via
   room code → slot list appears, claim seat, mulligan, play a card from the phone,
   change life on the phone, verify board + host log update (tests P0-2).
5. DeckBuilder: paste a 100-card list with 1 misspelled name → deck imports, miss is
   reported, mana rules auto-generated (tests P0-1).
6. Save a deck with custom mana rules, reload page, load deck from library → rules
   still apply in-game (tests P0-5).

---

## Part 3 — AI opponents via the Claude API

### 3.0 Goals & non-goals

- **Goal:** the `'ai'` opponent type in Local Game (and later online rooms) plays its
  own turns credibly: mulligans, plays lands, casts spells using the existing mana
  engine, attacks, and narrates what it is doing in the game log so humans can resolve
  anything the sandbox can't (triggers, targeting minutiae).
- **Non-goal (v1):** a full MTG rules engine. This app is an *honor-system sandbox* —
  humans move cards manually and the app never enforces rules. The AI plays at the same
  level: it proposes actions from a fixed vocabulary; the host applies them with
  lightweight legality checks (card actually in hand, mana available via
  `services/mana.ts`, one land per turn). Anything deeper is adjudicated socially, like
  a human player — the AI announces its intent in chat.
- **Non-goal (v1):** instant-speed interaction on opponents' turns. v1 AI acts only on
  its own turn (plus mulligan decisions). v2 adds a "priority ping".

### 3.1 Architecture

```
┌────────────────────────── Host browser (Tabletop.tsx) ─────────────────────────┐
│  useAiTurn() driver                                                            │
│   • detects currentTurnPlayerId is an AI seat                                  │
│   • serializes GameStateView (AI hand/board/opponents, from localPlayerStates  │
│     + boardObjects + mana.ts availability)                                     │
│   • POST /api/ai/turn  ──────────────┐                                         │
│   • applies returned tool calls via  │                                         │
│     the same applyAction/emitAction  │                                         │
│     path as human input; validates   │                                         │
│     each one; POSTs tool_results back│ (loop until end_turn)                   │
└──────────────────────────────────────┼─────────────────────────────────────────┘
                                       ▼
┌────────────────────────── Express server (server/) ────────────────────────────┐
│  server/ai/router.ts   POST /api/ai/turn, /api/ai/mulligan, /api/ai/continue   │
│   • holds ANTHROPIC_API_KEY (env var — NEVER shipped to the client; the old    │
│     Gemini integration was removed for exactly this leak, see services/gemini.ts)│
│   • @anthropic-ai/sdk, model "claude-opus-4-8", thinking {type:"adaptive"}     │
│   • per-(gameId, aiSeatId) conversation kept in memory (Map + TTL), so the     │
│     tool-use loop spans multiple HTTP round-trips                              │
│   • prompt caching: system prompt + decklist cached; per-turn state appended   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Why host-driven with a server proxy:** all game state already lives on the host
client (that is how local games work today — `localPlayerStates` in `Tabletop.tsx`
holds every AI seat's hand/library), and the existing `emitAction` broadcast makes AI
moves visible to mobile/table clients for free. The server's only new job is holding
the API key and running the Claude conversation. This avoids teaching the relay server
any game logic.

**Key handling:** `ANTHROPIC_API_KEY` read from `process.env` on the server only. Add
`.env` to `.gitignore`, document it in the README, and return a clear 503 from
`/api/ai/*` when unset (client shows "AI unavailable — server has no API key"). Never
expose the key via Vite env (`VITE_*`) — that is the mistake that killed the Gemini
judge.

### 3.2 Server implementation (`server/ai/`)

New files:

- **`server/ai/router.ts`** — Express router mounted at `/api/ai` in
  `server/index.ts` (add `app.use(express.json({ limit: '1mb' }))` for these routes).
  Endpoints:
  - `POST /api/ai/mulligan` — body `{ gameId, seatId, persona, deckSummary, hand }`;
    single non-loop call; responds `{ keep: boolean, bottomCards?: string[], comment }`.
  - `POST /api/ai/turn` — body `{ gameId, seatId, persona, stateView }`; starts (or
    resets) the seat's conversation, calls Claude with the tool set, returns the first
    batch of `tool_use` blocks `{ conversationId, toolCalls: [...] }`.
  - `POST /api/ai/continue` — body `{ conversationId, toolResults: [...] }`; appends
    results, calls Claude again, returns next `toolCalls` or `{ done: true, summary }`.
  - Guard every endpoint: validate body shape, cap `stateView` size (~100 KB), cap
    turns per conversation (12 tool rounds), 60 s idle TTL on conversations.
- **`server/ai/client.ts`** — SDK wrapper:
  ```ts
  import Anthropic from '@anthropic-ai/sdk';
  const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY

  const response = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },      // 'high' for the "Expert" difficulty
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools,                                     // strict:true tool defs, stable order
      messages,                                  // conversation incl. per-turn state
  });
  ```
  Notes for the implementer:
  - Use **manual tool loop** semantics across HTTP round-trips (the SDK tool-runner
    can't pause for the browser); loop condition is `stop_reason === 'tool_use'`.
  - Do **not** send `temperature`/`top_p` (removed on Opus 4.8, returns 400).
  - Use the SDK's typed errors: on `RateLimitError`/`InternalServerError` the SDK
    already retries twice; if it still fails, respond 502 and the client makes the AI
    pass its turn with a log message ("Claude is thinking too hard — skipping turn").
  - **Prompt caching:** system prompt (persona + rules-of-engagement + decklist with
    oracle text, easily 5-15 K tokens) gets a `cache_control` breakpoint; the volatile
    per-turn `stateView` goes in the user message *after* it. Within a turn's loop the
    growing message list is a stable prefix, so every `continue` round is mostly
    cache-reads. Keep tool definitions byte-stable (sorted keys) for the same reason.
- **`server/ai/tools.ts`** — tool definitions (all `strict: true`,
  `additionalProperties: false`). v1 vocabulary:

  | Tool | Input | Host-side effect |
  |---|---|---|
  | `play_land` | `{ cardId }` | move hand→battlefield via existing play path |
  | `cast_spell` | `{ cardId, xValue?, targetsDescription? }` | auto-tap via `autoTapForCost`; put permanent on battlefield or spell→graveyard after log |
  | `cast_commander` | `{ cardId }` | from command zone, adds commander tax to cost |
  | `activate_mana` | `{ objectId }` | tap a source via `handleManaButtonClick` path |
  | `tap_permanent` / `untap_permanent` | `{ objectId }` | rotation/tappedQuantity update |
  | `create_token` | `{ name, quantity }` | from the seat's token list |
  | `add_counter` | `{ objectId, counterType, delta }` | counters map update |
  | `move_card` | `{ cardId, from, to }` | zone move (battlefield/graveyard/exile/hand/library-top/bottom) |
  | `declare_attackers` | `{ attacks: [{ objectId, defenderSeatId }] }` | tap attackers, log attack declarations |
  | `adjust_life` | `{ seatId, delta, reason }` | life change (self-damage, lifegain) |
  | `announce` | `{ message }` | writes to the game log — used for triggers, targeting, and table talk |
  | `end_turn` | `{ summary }` | terminates the loop; host runs `nextTurn()` |

  Every tool result the host returns is a short JSON string:
  `{ ok: true, newState?: <delta> }` or `{ ok: false, error: "why it was illegal" }` —
  errors go back to Claude so it can correct course (e.g. "not enough mana:
  available {W:1,G:2}, cost {2}{U}").
- **`server/ai/prompts.ts`** — system prompt builder. Contents:
  1. Role: "You are playing Magic: The Gathering Commander on an honor-system virtual
     tabletop against human players…" plus the persona (see 3.5).
  2. Rules of engagement: one land per turn; use `announce` for any trigger/choice the
     tools can't express; keep announcements short; when combat math or a rules
     question is ambiguous, choose the simple interpretation and say so; never claim to
     have done something without the corresponding tool call.
  3. The seat's full decklist with oracle text (from `CardData.oracleText` — already
     stored on every card), so casting decisions don't require oracle text in the
     per-turn state.
  4. Output discipline: "Take actions via tools only. Between tools, think, don't
     narrate — use `announce` when humans need to know something."

### 3.3 Game-state serialization (`services/aiState.ts`, client-side)

Build `GameStateView` from existing data (all of it already exists in `Tabletop.tsx`):

```ts
interface GameStateView {
  turn: number; phase: 'MAIN';           // v1: whole turn = one MAIN phase
  you: {
    seatId: string; life: number; commanderTax: number;
    hand: CardRef[];                     // id, name, manaCost, typeLine (oracle in system prompt)
    battlefield: BoardRef[];             // id, name, tapped, counters, isToken, quantity
    graveyard: string[]; exileCount: number; libraryCount: number;
    commandZone: CardRef[];
    manaAvailable: ManaPool;             // from calculateAvailableMana(...)
    landsPlayedThisTurn: number;
  };
  opponents: Array<{
    seatId: string; name: string; life: number; poison: number;
    battlefield: BoardRef[];             // public info only
    handCount: number; graveyardTop: string[]; commanders: string[];
    commanderDamageTakenFromYou: number;
  }>;
  recentLog: string[];                   // last ~15 log lines for context
}
```

Deliberately **exclude** hidden information (opponent hands, library order) — both for
fairness and prompt size. Typical size: 2-6 K tokens.

### 3.4 Host-side driver (`hooks/useAiTurn.ts`)

- Effect watches `currentTurnPlayerId`; when it lands on a seat whose
  `localOpponents[i].type === 'ai'` (and `isLocal`), start the turn sequence:
  1. Untap the AI's permanents + draw 1 (deterministic, no model call — reuse
     `untapAll`/`drawCard` logic against the AI seat's `localPlayerStates` entry).
  2. Serialize `GameStateView`, `POST /api/ai/turn`.
  3. For each returned tool call: **validate** (card exists in stated zone; for
     `cast_spell` run `autoTapForCost` against the AI's board and reject with the
     available-vs-required pools; enforce `landsPlayedThisTurn < 1` for `play_land`),
     apply via the shared `applyAction` path (so `emitAction` broadcasts it and the
     board animates for the humans), append a log line, then send the result via
     `/api/ai/continue`. Insert a 600-900 ms delay between applied actions so humans
     can follow.
  4. On `end_turn` (or round cap / error), call `nextTurn()`.
- Mulligans: when the game enters MULLIGAN, resolve every AI seat via
  `/api/ai/mulligan` (hand + a 1-line deck strategy summary), apply keep/mull with the
  existing `handleMobileMulligan`-style state code, mark `hasKeptHand` (integrates with
  fix P1-5).
- UI: a small "🤖 thinking…" badge on the AI's playmat while a request is in flight; an
  AI toggle + difficulty picker in `LocalSetup.tsx` (replace the hardcoded
  `type: 'ai'` default at `LocalSetup.tsx:115` with an explicit Human(hot-seat)/AI
  choice).
- Kill switch: host can click "Take over seat" to convert an AI seat to hot-seat mid-
  game (just stop the driver; the seat already works manually).

### 3.5 Personas & difficulty

- `server/ai/personas.ts`: 3-4 canned personas (e.g. "Casual Timmy — loves big
  creatures, attacks often, forgiving lines", "Spike — plays tightly, holds up
  interaction, values card advantage") appended to the system prompt. Auto-suggest one
  from the deck's composition (creature count, avg CMC — computable client-side).
- Difficulty maps to `output_config.effort`: Casual → `medium`, Competitive → `high`.
  Keep `model: 'claude-opus-4-8'` for all tiers (do not silently downgrade models; if
  the user later wants a cheaper tier, expose it as an explicit "fast/budget bot"
  option in the UI and only then use a smaller model).
- Table talk: personas may use `announce` sparingly for flavor ("That resolves. Nice
  play."), capped at 1 flavor message per turn in the prompt.

### 3.6 Cost & latency envelope (set expectations in the UI)

- Per AI turn: 1 initial + ~3-8 continue calls. With the cached system prompt
  (~10 K tokens cached, ~3 K fresh state, ~300 output/step at `effort: medium`), a turn
  costs roughly $0.05–0.15 and takes 5–20 s wall-clock. A 15-turn game with one AI ≈
  $1–2. Surface a per-game running token/cost counter (server returns `usage` with each
  response; sum `input_tokens`, `cache_read_input_tokens`, `output_tokens`) in the
  settings modal so users aren't surprised.
- Rate limiting: one in-flight conversation per AI seat; queue turns if the host
  runs multiple AI opponents.

### 3.7 v2 (after v1 ships and is stable)

1. **Reactive play:** a "Priority?" button on human turns sends a slim state + the
   pending action to a cheap single call answering `{ respond: boolean, action?, announce? }`
   (only if the AI's board/hand has instant-speed options — precompute that client-side
   to skip the call entirely most of the time).
2. **Online rooms:** the room host's browser runs the driver for AI seats it owns —
   works with zero server changes because actions already broadcast via `game_action`.
   Add the AI seat to the server roster as a virtual player entry so layouts/turn order
   include it.
3. **Blocks:** on being attacked, same slim-call pattern returns block assignments.
4. **Rules Judge (restores the removed Gemini feature, done right):**
   `POST /api/ai/judge { question, stateView? }` → one-shot answer rendered in a modal.
   Same server-side key, trivial once 3.2 exists.

### 3.8 Implementation order & acceptance tests

Milestones (each independently shippable):

- **M0** — Part 2 P0 items + P2-2 hygiene. *Accept:* verification checklist 1-6 passes.
- **M1** — Part 2 P1 items. *Accept:* stats match across two clients after a 10-action
  scripted exchange; reconnect works with server state after full disconnect.
- **M2** — P2-3 extraction steps 1-3 (`useGameSync`, `useLocalSeats`, `gameReducer`).
  *Accept:* tsc + build green, two-tab smoke test unchanged, hot-seat local game
  unchanged.
- **M3** — AI v1 (3.1-3.6). *Accept:*
  - With `ANTHROPIC_API_KEY` unset, Local Game with an AI opponent shows the
    unavailable notice and the seat falls back to hot-seat.
  - With a key: AI mulligans, then over 3 consecutive turns plays ≥1 land/turn when
    holding one, casts ≥1 affordable spell, never plays 2 lands, never casts a card
    not in its hand (validator logs zero rejections OR rejections are followed by a
    corrected action), ends its turn within the round cap, and every action appears in
    the human's game log exactly once.
  - Unit tests: tool-call validator (`aiState`/driver) covered with fixture states —
    illegal land #2, unaffordable spell, unknown cardId, commander tax math.
  - A CLI harness `scripts/ai-dry-run.ts` that feeds a canned `GameStateView` through
    the server loop with a mocked apply function — used for prompt iteration without
    opening the app.
- **M4** — AI v2 features as prioritized by the owner.

### Environment / config summary

| Variable | Where | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | server env (Render dashboard / `.env`, gitignored) | Claude API auth |
| `PORT` | server env | existing |
| `AI_MODEL` (optional) | server env, default `claude-opus-4-8` | override without redeploy |
| `AI_MAX_ROUNDS` (optional) | server env, default `12` | per-turn tool-loop cap |

New dependency: `@anthropic-ai/sdk` (server only). No client bundle impact.
