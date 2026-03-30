# Plan: Territory Control Game Mode + Multi-Game Landing Page

## Overview

Add a new "Territory Control" game mode alongside the existing Amoebas game, plus a landing page that lets agents choose which game to play and humans choose which game to spectate.

---

## Architecture Decision

**Approach: Unified API server with game-type routing**

Rather than spinning up a separate server per game, we extend the existing `api/` server to support multiple game types. Each game type gets its own:
- Game logic module (`api/src/games/territoryControl.js`)
- REST endpoints under a game prefix (`/api/territory/...`)
- Spectator page (`/territory/`)
- Spectator WebSocket namespace (`/territory`)

The existing Amoebas game moves under `/api/amoebas/...` (with backward-compat redirects from `/api/join`, `/api/state`, etc.) and its spectator page moves to `/amoebas/`.

The root `/` becomes the new landing page.

---

## Phase 1: Restructure for Multi-Game Support

### 1.1 Reorganize game logic into `api/src/games/`
- Move `api/src/gameLogic.js` → `api/src/games/amoebas.js`
- Update imports in `api/server.js`, `api/src/restApi.js`, `api/src/socketHandlers.js`

### 1.2 Create game registry (`api/src/gameRegistry.js`)
- Central registry mapping game IDs to their modules
- Each game module exports: `createWorld()`, `tick(world)`, `serializeState(world)`, `getInfo()`
- Registry manages worlds, tick loops, and spectator namespaces per game

### 1.3 Refactor REST API routing
- Create `api/src/routes/amoebas.js` — moves existing endpoints under `/api/amoebas/`
- Add backward-compat middleware: `/api/join` → `/api/amoebas/join`, etc.
- Each game gets its own Express router mounted at `/api/<game-id>/`

### 1.4 Refactor WebSocket spectator handling
- Amoebas spectators connect to namespace `/amoebas`
- Territory Control spectators connect to namespace `/territory`
- Each namespace gets its own state broadcast from its game's tick loop

---

## Phase 2: Landing Page

### 2.1 Create landing page (`api/public/index.html`)
- Replace the current redirect-to-screen behavior at `/`
- Dark theme consistent with existing styles
- Sections:
  - **Hero/Header**: "Amoebas Arena" (or similar umbrella name) — tagline about AI agent competition
  - **Game Cards**: One card per registered game, each showing:
    - Game name + icon/illustration
    - Short description
    - Live player count (fetched via API or WebSocket)
    - "Spectate" button → links to `/amoebas/` or `/territory/`
  - **How to Join** (for agents): Collapsible section explaining the general flow:
    1. Pick a game
    2. GET `/api/<game>/info` for rules
    3. POST `/api/<game>/join` to enter
    - Links to each game's `skill.md`
  - **Footer**: Links to GitHub, docs

### 2.2 Landing page API endpoint
- `GET /api/games` — returns list of available games with metadata (name, description, player count, endpoints)

---

## Phase 3: Territory Control Game

### 3.1 Game Design

**Map**: Hex grid (e.g., 30×20 hexes = 600 hexes total) on a 2400×1600 world
- Each hex has: owner (player_id or null), capture_progress (0–100)

**Mechanics**:
- Agents spawn on a random unclaimed hex
- Each tick, an agent occupies one hex based on their position
- Standing on an unclaimed/enemy hex increases capture_progress toward you
- Standing on your own hex reinforces it (slower decay when attacked)
- Capturing a hex: progress reaches 100 → hex becomes yours
- Adjacent owned hexes form "territory" — more contiguous territory = higher score
- Score = number of hexes owned
- Agents move with same `{ x, y }` direction input as Amoebas (familiar API)

**Combat**:
- No direct PvP death — instead, you contest enemy hexes
- If two agents are on the same hex, capture progress is contested (net zero or advantage to higher-territory player)
- Strategic depth: expand vs. defend vs. cut off enemy territory

**Win Condition / Prestige**:
- Control 50%+ of the map → prestige, map resets
- Or: timed rounds (5 minutes), most hexes wins

**Vision**: Agents see hexes within a radius (e.g., 8 hex distance), plus a summary of the full map (territory counts per player)

### 3.2 Implementation: Game Logic (`api/src/games/territoryControl.js`)
- Hex grid utilities: axial coordinates, neighbor calculation, distance
- World state: grid[], players Map, tick count
- `createWorld()` — initialize hex grid, all unclaimed
- `tick(world)` — move players, update capture progress, check prestige
- `serializeState(world, playerId)` — filtered view per agent (vision radius)
- `broadcastState(world)` — full state for spectators
- Constants: HEX_SIZE, GRID_COLS, GRID_ROWS, CAPTURE_RATE, REINFORCE_RATE, DECAY_RATE, VISION_RADIUS

### 3.3 Implementation: REST API (`api/src/routes/territory.js`)
- `POST /api/territory/join` — join game, get token, spawn on random hex
- `GET /api/territory/state` — hex grid (visible), nearby players, your territory count, leaderboard
- `POST /api/territory/move` — direction { x, y } (same as Amoebas)
- `POST /api/territory/respawn` — re-enter after being idle-evicted
- `DELETE /api/territory/leave` — exit
- `GET /api/territory/info` — rules + endpoints (no auth)
- `GET /api/territory/status` — health check
- Reuse existing `auth.js` and `rateLimiter.js` (parameterized per game)

### 3.4 Implementation: Spectator Page (`api/public/territory/`)
- `screen.html` + `screen.js` — Canvas rendering of hex grid
- Hex rendering: colored by owner, brightness by capture progress
- Player dots on the grid
- Leaderboard: territory count per player
- Minimap showing full grid overview
- "How to Play" collapsible panel (similar to Amoebas spectator)
- Connected via Socket.IO namespace `/territory`

### 3.5 Agent Documentation (`api/public/territory/skill.md`)
- Game rules, hex grid explanation
- API endpoints reference
- Strategy tips (expand early, defend borders, cut off enemy territory)
- Quick reference table

### 3.6 Example Bot (`api/examples/territory-bot.js`)
- Simple strategy: expand to nearest unclaimed hex, flee from enemies
- Demonstrates the API usage for new agents

---

## Phase 4: Update Existing Amoebas Pages

### 4.1 Move Amoebas spectator page
- `api/public/screen.html` → `api/public/amoebas/screen.html`
- Update `api/public/amoebas/screen.js` WebSocket to use `/amoebas` namespace
- Add redirect: `/screen.html` → `/amoebas/` for backward compat

### 4.2 Move Amoebas skill.md
- `api/public/skill.md` → `api/public/amoebas/skill.md`
- Add redirect for old URL

### 4.3 Update Amoebas spectator "How to Play" panel
- Update API endpoint URLs to include `/amoebas/` prefix
- Add "Back to lobby" link to landing page

---

## Phase 5: Polish & Integration

### 5.1 Live player counts on landing page
- Landing page JS polls `GET /api/games` periodically (every 5s)
- Or uses a lightweight WebSocket connection for real-time counts

### 5.2 Consistent styling
- Ensure territory spectator page matches Amoebas dark theme
- Landing page uses same color palette and font

### 5.3 Update root README.md
- Document the multi-game structure
- Link to each game's skill.md

---

## File Changes Summary

**New Files:**
- `api/src/gameRegistry.js` — game registry
- `api/src/games/territoryControl.js` — TC game logic
- `api/src/routes/amoebas.js` — Amoebas REST routes (extracted)
- `api/src/routes/territory.js` — TC REST routes
- `api/public/index.html` — landing page
- `api/public/index.js` — landing page JS
- `api/public/amoebas/screen.html` — Amoebas spectator (moved)
- `api/public/amoebas/screen.js` — Amoebas spectator JS (moved)
- `api/public/amoebas/skill.md` — Amoebas agent docs (moved)
- `api/public/territory/screen.html` — TC spectator page
- `api/public/territory/screen.js` — TC spectator JS
- `api/public/territory/skill.md` — TC agent docs
- `api/examples/territory-bot.js` — example TC bot

**Modified Files:**
- `api/server.js` — use game registry, mount routers, serve landing page
- `api/src/gameLogic.js` → `api/src/games/amoebas.js` (rename + minor refactor)
- `api/src/restApi.js` — extract into routes, add backward-compat redirects
- `api/src/socketHandlers.js` — namespace-based spectator handling
- `api/src/auth.js` — minor: support per-game token maps
- `api/src/rateLimiter.js` — minor: parameterize per game

**Unchanged:**
- `server.js` (host server) — untouched, it's the LAN/phone version
- `public/` (host server pages) — untouched

---

## Implementation Order

1. Phase 1 (restructure) — foundation for multi-game
2. Phase 4 (move Amoebas pages) — do this with Phase 1 to avoid double-work
3. Phase 2 (landing page) — can test immediately with just Amoebas listed
4. Phase 3 (Territory Control) — the big feature
5. Phase 5 (polish) — final integration
