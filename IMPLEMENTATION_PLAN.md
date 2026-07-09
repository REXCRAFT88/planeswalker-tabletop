# Planeswalker Tabletop — Implementation Plan

Roadmap for the next round of work. Phases are ordered by priority and designed
to be implemented and shipped **one PR per phase**. Every phase's definition of
done includes **full mobile + desktop parity** and the verification steps listed
for it.

Two source lines feed this plan:

1. **Rework/fix requests** for the current build (multiplayer sync, mana strip,
   AI reliability, settings page, token auto-import, customization, mobile
   parity, input bindings).
2. **Feature ports from the `main-new` branch** — a parallel line of development
   that branched from old main (`b4ef406`) and contains a combat system, turn
   sub-phases, deck/card features, customization, and sound. These are ported
   by hand (both branches rewrote `Tabletop.tsx`; `git merge` is not viable).
   `main-new`'s client-side Gemini AI is **not** ported — the current
   server-side multi-provider brain with the voice firewall is strictly better
   and keeps API keys off the client.

---

## Phase 0 — Airtight multiplayer synchronization  *(top priority)*

**Goal:** complete parity and a smooth experience between online players:
turns, changing play order, disconnect + rejoin, leaving a game, host changes.
A client must never silently diverge from the table.

### Current state (verified)

- `game_action` (`server/index.ts:399`) is a **fire-and-forget broadcast**: no
  sequence numbers, no ordering guarantees, no delivery guarantee. A client that
  misses events (disconnect, phone lock, tab sleep) diverges permanently.
- Turn pointer and phase live **client-side** and are only synced via broadcast
  events; the server has no notion of whose turn it is.
- State backups (`backup_state`, line 371) are keyed by **seat index** with a
  `userId` tag; rejoin restores own state but not the rest of the table's
  current board.
- Reconnection reclaims a seat by `userId` (line 134) and re-emits roster, but
  the rejoining client's view of *other* players' boards is whatever it last
  saw.
- `update_player_order` (line 283) validates fields but any client can emit it.

### Design

1. **Server-authoritative game meta.** Move roster, seat order, current-turn
   pointer, and turn number into a per-room `GameMeta` object on the server.
   - New events: `advance_turn` (validated: only the current-turn player or the
     host may advance), `set_player_order` (host only). Server increments
     `turn`, rotates `currentTurnPlayerId` **skipping disconnected players**
     (port of main-new F3), and broadcasts `game_meta` to the room.
   - Clients render turn/order state from `game_meta` only — delete the
     client-side turn-advance broadcast path.
2. **Sequenced actions + gap detection.** Server stamps every `game_action`
   with a per-room monotonically increasing `seq`. Clients track the last seq
   seen; on a gap (or on reconnect) they request a **full resync**.
3. **Full resync protocol.** On `request_full_sync`, the server sends
   `game_meta` + all stored seat states, and asks the host client to push a
   fresh board snapshot (host already holds the whole table state). Incoming
   live actions are buffered on the client during resync and applied after.
   This is the rejoin path *and* the recover-from-gap path — one code path,
   well tested.
4. **Presence + grace period.** Server heartbeat marks players
   connected/disconnected (already partially exists); UI shows a
   "disconnected" badge on the mat. After a configurable grace period the
   turn rotation auto-skips them (and auto-unskips on rejoin).
5. **Leaving cleanly.** Explicit leave (and kick) removes the player from turn
   order, removes their board objects (port of main-new F4), and reflows mats
   (F5). Distinguish *leave* (gone for good — clean up) from *disconnect*
   (might come back — preserve seat + state through the grace period).
6. **Host migration.** Host disconnect already reassigns on rejoin; add
   immediate migration to the longest-connected player when the host leaves
   for good, and re-emit `game_meta` so everyone agrees who is host.

### Verification

- Scripted multi-client Playwright scenarios (2–3 headless browsers in one
  Node script — pattern already exists in the scratchpad harnesses):
  a) pass turns around a 3-player table and assert all clients agree on
  turn/player; b) reorder players mid-game; c) hard-kill one socket mid-turn,
  rejoin, assert full board matches the other clients' view; d) leave for
  good and assert cleanup + turn skip; e) kill the host, assert migration.
- Manual: two devices (one mobile), disconnect Wi-Fi mid-game, rejoin.

---

## Phase 1 — AI reliability in production + rules context + settings page

**Goal:** AI opponents always act or cleanly pass; they know the rules; users
can configure providers/keys from the home screen instead of env vars.

### Current state (verified)

- **Deployed failure mode:** `/api/ai/turn` and `/api/ai/mulligan` return
  **502** on Render (see user logs). The server *has* AI enabled (calls were
  attempted), so this is the request path dying — long-running LLM calls with
  no timeout/abort handling behind Render's proxy, and no structured error
  response. Client fallbacks fired ("keeps its hand", "passing"), so games
  limp along with a braindead AI.
- The turn-driver effect (`components/Tabletop.tsx:3241`) bails when
  `aiAvailable=false` — if `/api/ai/status` is unreachable or reports
  disabled, an AI seat's turn arrives and **nothing ever passes it** (hang).
- No UI exists for API keys; keys are env-only (`ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, `GEMINI_API_KEY`).

### Design

1. **Server hardening (fixes the 502s).**
   - Wrap every LLM call in an `AbortController` timeout (default 60s,
     env-tunable). On timeout/error return **structured JSON**
     (`{ error, retryable }`) with a 200/4xx — never let the request hang
     until the platform proxy kills it.
   - Add one retry with backoff server-side for transient provider errors.
   - Log provider, latency, and outcome per call so Render logs show *why*
     something failed.
   - Health: extend `/api/ai/status` with per-provider "last call ok/failed"
     so the client (and settings page) can surface issues.
2. **Client: never hang, degrade gracefully.**
   - Watchdog on AI turns: if an AI seat's turn makes no progress for N
     seconds, force `nextTurn()` with a log line.
   - When the brain is unreachable, fall back to a **scripted turn** (untap,
     draw, play a land if able, pass) instead of a bare pass, so keyless /
     offline games still feel alive.
   - Re-check `aiAvailable` when a turn starts (currently only checked once on
     mount), so fixing keys mid-game revives the AI without a reload.
3. **Rules context (feed the AI the rules .md).**
   - Port `public/magic_rules_context.md` (3,698 lines) from `main-new` into
     `server/ai/rules/`.
   - Distill a **compact rules digest** (~2–3k tokens: turn structure, combat
     math, stack basics, commander rules) baked into the brain's system
     prompt, with Anthropic prompt caching (`cache_control`) so it's nearly
     free per call; OpenAI/Gemini get it too (their implicit caching applies).
   - Add a `lookup_rule` tool to the brain's toolset: the server greps the
     full rules doc and returns the relevant section, so deep rules questions
     don't require stuffing 3,700 lines into every call.
4. **Settings page on the home screen.**
   - Gear icon in the Lobby → Settings screen with tabs: **AI** (per-provider
     API key entry, default provider, voice backend, realtime voice toggle),
     **Controls** (Phase 3's keybinding editor), **Appearance & Sound**
     (Phase 4's customization + SFX toggle).
   - Key handling: keys are POSTed to the server (`/api/ai/config`) and held
     **in server memory only** — never persisted to the client bundle, never
     echoed back (status reports only "configured: yes/no" per provider).
     This preserves the existing security model (browser never talks to AI
     vendors directly; the voice firewall stays intact). Optional `ADMIN_PIN`
     env gates the endpoint for shared deployments.
   - Status panel: live per-provider check ("Claude ✓ / OpenAI ✗ (bad key)"),
     driven by a test-call button.

### Verification

- Kill/deny outbound AI calls and confirm: mulligan resolves, AI turn scripted
  fallback plays a land and passes, no hang; restore and confirm recovery
  mid-game without reload.
- Set a key via the settings page and confirm `/api/ai/status` flips and a
  real AI turn runs. Confirm keys never appear in any client response body.
- Dry-run harness (`scripts/ai-dry-run.ts`): extend with a rules-digest
  presence check and a `lookup_rule` round-trip.

---

## Phase 2 — Strip mana tracking

**Goal:** remove the mana rules/auto-tracking system entirely — it's too
complicated to work reliably. Tapping lands stays (it's a physical action);
everything that *interprets* mana goes.

### Current state (verified)

- ~1,800 lines to delete outright: `services/mana.ts` (893),
  `components/ManaRulesModal.tsx` (777), `components/ManaDisplay.tsx` (137).
- References to purge: `DeckBuilder.tsx` (25), `App.tsx` (17), `Lobby.tsx`
  (17), `Tabletop.tsx` (13), `services/aiState.ts` (5), `services/aiTypes.ts`
  (2).

### Design

1. Delete the three files; remove the mana pool badge from the board, WUBRG
   activation, auto-tap, generic-cost payment, and the mana rules editors in
   DeckBuilder/Lobby.
2. **Saved-data migration:** saved decks and settings carry `manaRules`
   fields. The load path must tolerate and drop them without losing decks,
   sleeves, or deck identity (this bit us before — P0-5).
3. **AI serializer:** remove mana-pool fields from `aiState.ts`/`aiTypes.ts`;
   the brain already reads costs from card text. Update the system prompt to
   say mana is untracked and it should tap lands like a human would.
4. Keep the tapped/untapped land count visible on stacks (simple, useful, no
   interpretation).

### Verification

- Type-check + build; grep proves zero remaining `manaRules|manaPool` refs.
- Load a save created before the strip → decks and sleeves intact.
- Play a card, tap lands manually, AI plays a turn — no mana UI anywhere.

---

## Phase 3 — Input system: pointer bindings, custom shortcuts, turn sub-phases

**Goal:** right-click pans the board; users can rebind shortcuts; `T` taps the
hovered card; proper turn sub-phases with Enter to advance (port of main-new
Phase D).

### Current state (verified)

- Pan is middle-mouse or space+drag only (`Tabletop.tsx:4558`, `4631`);
  right-click is context menu (`6176`).
- `t` currently opens the **token search** (`Tabletop.tsx:4324`) — conflicts
  with the requested tap-toggle.
- No sub-phases: turns are a single monolithic step. `main-new` has the full
  UNTAP→UPKEEP→DRAW→MAIN1→COMBAT→MAIN2→END implementation to port
  (`TURN_PHASES`, `turnSubPhase`, `advancePhase`, auto-untap/auto-draw,
  Enter-to-advance, blocked when it isn't your turn).

### Design

1. **Pointer bindings:** right-button drag pans (suppress `contextmenu` only
   when a drag actually happened; a plain right-click still opens the card
   context menu). Middle-drag keeps panning. Mobile unaffected (one-finger
   pan / pinch zoom already work).
2. **Keybinding registry:** a single `ACTIONS` table (id, label, default key,
   handler ref). `handleKeyDown` resolves through user overrides stored in
   `localStorage` (`keybindings_v1`). Settings → Controls tab gets a
   rebinding editor with conflict detection and reset-to-defaults. All
   existing hardcoded keys move into the registry.
3. **`T` = tap/untap hovered card** (port of main-new D4): track
   `hoveredCardId`, default-bind `t` to tap-toggle; token search moves to a
   new default (and is rebindable like everything else).
4. **Turn sub-phases** (port of main-new D1/D2/D7/D8/D9): phase strip UI in
   the top bar; Enter advances; auto-untap on UNTAP and auto-draw on DRAW;
   blocked when not your turn; mulligan cap at 7; solo pass-to-self. Phase
   state rides the Phase 0 `game_meta` sync so all clients agree.
5. **Mobile parity:** the phase strip is tappable to advance; a long-press on
   a card exposes tap/untap (shortcut equivalents must all have a touch path).

### Verification

- Playwright: right-drag pans and context menu still opens on plain
  right-click; rebind a key in settings and confirm it takes effect; `t` over
  a card taps it. Multi-client: phase advance propagates (rides Phase 0
  tests). Mobile viewport: advance phases and tap cards touch-only.

---

## Phase 4 — Mat & sleeve customization + sound  *(port main-new C1–C5 + SFX)*

**Goal:** custom playmat and sleeve images (URL or upload) with pan/zoom
positioning, visible to all players; procedural sound effects with a toggle.

### Design

1. Port `main-new`'s customization modal into the new Settings → Appearance
   tab (upload → downscaled data URL, or plain URL; drag-pan + wheel-zoom
   transform; preview; remove buttons; localStorage persistence).
2. Port the server relay: `customMatUrl` / `customSleeveUrl` / transforms on
   the player object through `join_room`, reconnect, and pending-join
   approval (`main-new`'s `server/index.ts` diff is a direct reference).
3. Render: custom mats as playmat backgrounds, custom sleeves on face-down
   cards and library backs, YIQ-based dynamic name contrast (C4), and the
   stacked-card overflow fix (C5).
4. **Size guardrails:** uploads are client-side downscaled (target ≤200KB data
   URL) so player payloads stay well under the server's 1MB state cap; URLs
   preferred for big art.
5. Port `services/sounds.ts` (procedural Web Audio, no asset files) and its
   hook points: turn start, card play, draw, damage/heal, mulligan. Mute
   toggle in Settings → Appearance & Sound, persisted; **default respects the
   device** (no autoplay before first user gesture — required on mobile
   anyway).

### Verification

- Two-client test: player A sets a custom mat+sleeve; player B sees both,
  correctly transformed. Rejoin keeps them. Oversized upload gets downscaled.
- Mobile: customization editor usable via touch (drag/pinch instead of wheel).
- Sounds fire on the hook points; mute persists across reloads.

---

## Phase 5 — Deck & card features + Moxfield-style token auto-import

**Goal:** port `main-new`'s card/deck features and auto-import tokens the way
Moxfield does.

### Design

1. **Token auto-import (new):** Scryfall card objects carry `all_parts` with
   `component: "token"` entries. On deck import/save, collect unique token
   (and emblem) IDs across the deck, fetch them in batches via
   `/cards/collection` (75 per call, already rate-limit-friendly in
   `services/scryfall.ts`), and populate the deck's token list automatically.
   DeckBuilder shows "N tokens auto-added" with a reviewable list (remove/add
   manually as today).
2. **Ports from main-new (Phase A/B features):** sideboard support end-to-end
   (deck editor, size display, in-game sideboard zone), change card art
   (Scryfall `unique=prints` version picker modal), zone reveal (view-only
   shared reveal, per-card + reveal-all), copy card (white border + delete),
   steal card (controller change), inspect commanders in the command zone.
3. **Mobile parity:** all of the above reachable via the card long-press menu
   and the mobile game menu (art picker, reveal, copy/steal are currently
   desktop-hover patterns — each needs an explicit touch path).

### Verification

- Import a Moxfield/Arena list with token-makers → tokens appear
  automatically; token search shows them in-game.
- Playwright desktop + mobile: change art, reveal a zone to a second client,
  copy/steal, sideboard swap.

---

## Phase 6 — Combat system  *(port main-new's CombatOverlay)*

**Goal:** structured combat: declare attackers → assign to defenders → declare
blockers → resolve damage, synced to all players. Largest single port; done
last so it lands on top of sub-phases (Phase 3) and sync (Phase 0).

### Design

1. Port `CombatState`/`CombatAssignment` types and `CombatOverlay.tsx`
   (460 lines, self-contained component with a clean props interface).
2. Integrate with the phase system: combat UI only during the COMBAT
   sub-phase; leaving COMBAT cancels/clears state (main-new already handles
   this — `Tabletop.tsx:3140` in that branch).
3. Sync via a `COMBAT_UPDATE` action riding the Phase 0 sequenced relay, so
   attackers/blockers/resolution are seen live by every client.
4. Resolution applies damage to players (life/commander damage via existing
   stats paths) and logs a combat summary; creature death stays manual
   (tabletop philosophy — the overlay assists, it doesn't rules-enforce).
5. **Mobile:** attacker/blocker trays sized for touch (main-new's tray cards
   are 70×98 — verify hit targets ≥44px), tap-to-assign flows, overlay
   scrollable in portrait.

### Verification

- Multi-client Playwright: full combat round (declare, block, resolve) with
  all clients agreeing on the result; cancel mid-combat; phase-exit clears
  state. Mobile viewport: complete a combat round touch-only.

---

## Phase 7 — Mobile parity audit  *(continuous + final sweep)*

**Goal:** perfect parity between desktop and mobile during a game. Parity is a
definition-of-done item in every phase above; this phase is the final audit.

### Design

1. **Parity inventory:** enumerate every in-game capability (stats, log,
   zone searches, dice/counters, tokens, voice negotiate, settings, phase
   control, combat, sideboard, customization, shortcuts-equivalent touch
   actions) and record its mobile path. Anything `hidden md:` without a
   mobile equivalent is a defect.
2. Expand the mobile game menu into a full-parity drawer with sections
   (Game / Zones / Table / Settings), replacing the current partial menu.
3. Standardize touch interactions: long-press = card context menu everywhere;
   document the mapping from each keyboard shortcut to its touch path.
4. Fix the known gap: **in-game settings are unreachable on mobile** today.
5. Screenshot suite: scripted portrait + landscape walkthrough of every
   feature, kept in the repo as a re-runnable script (extends the existing
   scratchpad harnesses into `scripts/mobile-audit.mjs`).

### Verification

- The parity inventory table has zero "desktop-only" rows.
- The screenshot suite passes on iPhone (390×844) and a small Android
  (360×800) viewport, both orientations, with no horizontal overflow and no
  console errors.

---

## Sequencing summary

| Phase | Theme | Size | Depends on |
|-------|-------|------|-----------|
| 0 | Multiplayer sync (authoritative meta, resync, presence) | L | — |
| 1 | AI reliability + rules context + settings page | M–L | — |
| 2 | Strip mana tracking | M | — |
| 3 | Input bindings + T-tap + turn sub-phases | M | 0 (phase sync) |
| 4 | Mat/sleeve customization + sound | M | 1 (settings page) |
| 5 | Deck/card features + token auto-import | M | 2 (DeckBuilder churn) |
| 6 | Combat overlay | L | 0, 3 |
| 7 | Mobile parity audit | M | all |

Phases 0–2 are independent and could be developed in parallel; 3–6 build on
them. One PR per phase, each with its verification evidence (multi-client
and mobile-viewport runs) in the PR description.
