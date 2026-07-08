# Planeswalker Tabletop

A browser-based virtual tabletop for playing **Magic: The Gathering** Commander online.
Import a deck, share a room code, and play on a shared board with physics-style card
handling, a mana calculator, per-card mana rules, life/commander-damage tracking, and
game stats. Includes a **Local Table** mode (one device as the board, phones as
controllers) and **AI opponents** powered by the Claude API.

It is an *honor-system* sandbox: the app tracks state and moves cards but does not
enforce the rules — players (and the AI) resolve triggers and interactions socially,
just like paper Commander.

## Tech stack

- **Client:** React 19 + Vite + TypeScript, Tailwind, lucide-react. Card data from the
  [Scryfall API](https://scryfall.com/docs/api).
- **Server:** Express + Socket.IO relay (`server/`). It relays game actions between
  clients and holds no authoritative game state (each client is authoritative for its
  own seat). It also hosts the AI endpoints.

## Development

```bash
npm install
npm run dev      # starts the Socket.IO/API server (tsx) AND the Vite dev client together
```

- Client dev server: <http://localhost:3000>
- Socket.IO/API server: <http://localhost:3001> (the client points at it automatically in dev)

Build for production:

```bash
npm run build    # outputs static client to dist/
NODE_ENV=production node --import tsx server/index.ts   # serves dist/ + sockets + API on $PORT (default 3001)
```

## AI opponents

Local games can include AI Commander opponents driven by the Claude API. The AI plays
its own turns — mulligans, plays lands, casts spells (mana is auto-tapped and validated
against the real board), attacks, and announces triggers/targeting in the game log so
humans can resolve anything the sandbox can't.

### Enabling

Set an Anthropic API key on the **server** (never the client):

```bash
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=sk-ant-...
```

Optional overrides: `AI_MODEL` (default `claude-opus-4-8`), `AI_MAX_ROUNDS` (default 12).

Without a key, AI is disabled: the setup UI shows AI as unavailable, `/api/ai/*` returns
`503`, and any opponent marked AI simply falls back to hot-seat (manual) play.

### Using

1. **Local Game** → **Import Deck** (or **Select from Library**) for an opponent.
2. On the commander-selection step, choose **AI**, a **difficulty** (Casual → medium
   reasoning effort, Competitive → high), and a **personality** (auto-suggested from the
   deck's shape).
3. Start the game. On the AI's turn a "🤖 …is thinking" badge appears while it plays; its
   actions animate on the board and appear in the log. The AI's hand stays hidden.

### How it works

- The host browser owns all local-game state, so it drives AI seats: it serializes a
  hidden-info-free view of the board (`services/aiState.ts`), calls the server
  (`services/ai.ts` → `/api/ai/turn`), then validates and applies each returned tool call
  through the same board/emit path as human actions (`components/Tabletop.tsx`).
- The server (`server/ai/`) is a thin Claude proxy: it holds the API key, builds the
  persona + rules-of-engagement + decklist system prompt (cached), exposes the turn tool
  vocabulary, and keeps the per-turn tool-use conversation in memory so the loop can span
  HTTP round-trips.
- Each tool result the host returns (`{ ok, error, detail }`) is fed back to the model, so
  an illegal move (e.g. not enough mana) produces a correction rather than a crash.

Iterate on prompts without opening the app:

```bash
npx tsx scripts/ai-dry-run.ts                              # offline checks
ANTHROPIC_API_KEY=... npx tsx scripts/ai-dry-run.ts --live # run one real AI turn loop
```

### Cost & latency

A single AI turn is one initial call plus a few follow-ups (roughly $0.05–0.15 and
5–20s), with the large system prompt served from cache. One AI over a full game is on the
order of $1–2. Difficulty maps to reasoning effort; all tiers use `claude-opus-4-8`.

## Project layout

```
App.tsx                 top-level view routing + saved-deck state
components/              Lobby, DeckBuilder, LocalSetup, Tabletop (board), MobileController, ...
services/
  scryfall.ts           card fetching + deck parsing + default mana-rule generation
  mana.ts               mana pool / cost parsing / auto-tap engine
  ai.ts, aiState.ts     AI client + game-state serialization
  aiTypes.ts            shared AI types (client + server)
server/
  index.ts              Socket.IO relay + static hosting
  ai/                   Claude API proxy (client, tools, prompts, personas, router)
scripts/ai-dry-run.ts   offline/live AI harness
docs/IMPLEMENTATION_PLAN.md   the repair + AI design this codebase was built against
```
