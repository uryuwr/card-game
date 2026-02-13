# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

One Piece Card Game simulator - a full-stack multiplayer TCG with real-time battles. Three main components:
- **API Server** (Python/FastAPI): Card data, user auth, deck management, OCR/scraping
- **Game Server** (Node.js/Socket.IO): Real-time battle engine, room management
- **Client** (React/TypeScript/Vite): Game UI, deck builder

## Development Commands

```bash
# Start all services in dev mode
./start-dev.sh

# Manual start:
# API Server (port 8000)
cd api-server && source venv/bin/activate && uvicorn app.main:app --reload

# Game Server (port 3001)
cd game-server && npm run dev

# Client (port 5173)
cd client && npm run dev

# Client build/lint
cd client && npm run build && npm run lint

# Test game engine
cd game-server && node test-game.mjs

# Run all game tests
cd game-server && node test-full.mjs      # Full game flow
cd game-server && node test-effects.mjs   # Card effects
```

## TDD Development Workflow

Follow the TDD cycle: **Red → Green → Refactor**

### Game Server (Engine/Effects)

```bash
# 1. Write failing test first
# Create or edit: game-server/test-*.mjs

# 2. Run test to verify it fails (Red)
cd game-server && node test-game.mjs

# 3. Implement code to make test pass (Green)
# Edit: game-server/src/engine.js or script-engine/*.js

# 4. Refactor if needed, ensure all tests pass
cd game-server && node test-game.mjs
```

### API Server

```bash
# Run API tests
cd api-server && pytest

# Run specific test
cd api-server && pytest tests/test_decks.py -v
```

### Client

```bash
# Run tests with Vitest
cd client && npm run test

# Watch mode
cd client && npm run test -- --watch

# Coverage
cd client && npm run test -- --coverage
```

### TDD Principles
1. **Red**: Write a minimal failing test describing the expected behavior
2. **Green**: Write minimum code to make the test pass
3. **Refactor**: Improve code while keeping tests green
4. **Repeat**: Next feature starts with a new failing test

## Architecture

### Component Ports
| Component | Port | Entry Point |
|-----------|------|-------------|
| Client | 5173 | `client/src/main.tsx` |
| API Server | 8000 | `api-server/app/main.py` (FastAPI) |
| Game Server | 3001 | `game-server/src/index.js` (Socket.IO) |

### Data Flow
1. Client displays UI and emits socket events
2. Game Server receives events, engine.js validates/executes actions
3. Engine broadcasts updated game state to both players
4. API Server handles deck/card data via REST

### Key Files
- `game-server/src/engine.js`: Core battle logic (turn phases, battle flow, card effects)
- `client/src/pages/Game.tsx`: Main battle UI
- `shared/constants.js`: Socket events, game phases, card types shared between server/client

### Database
- SQLite: `api-server/cards.db` (cards), `api-server/card_game.db.unused` (legacy)
- Card data also in `/data/` directory with images in `/asserts/cards/`

## Game Engine

### Turn Phases
REFRESH → DRAW → DON → MAIN → BATTLE → END

### Battle Flow
1. `declareAttack`: Attacker selects target (must be Active/Rested)
2. `declareBlocker`: Defender selects blocker (optional)
3. `playCounter`: Both players can play counter events (optional)
4. `resolveBattle`: Compare power, resolve damage

### Card States
- `ACTIVE`: Ready to act (vertical)
- `RESTED`: Already acted this turn (horizontal)
- `DON`: Attached to card as power bonus

### Player State Structure
```javascript
{
  id: string,
  leader: { card, state, attachedDon, power },
  characters: [{ card, state, attachedDon, power, canAttackThisTurn }],
  hand: Card[],
  deck: Card[],
  trash: Card[],
  life: Card[],
  stage: { card } | null,
  donDeck: number,
  donActive: number,
  donRested: number,
}
```

## Card Script Engine

Located in `game-server/src/script-engine/`:

| File | Purpose |
|------|---------|
| `index.js` | Module entry, exports all modules |
| `CardScripts.js` | Card script registry (keyed by cardNumber) |
| `ActionDSL.js` | Atomic action library (MODIFY_POWER, LOG, etc.) |
| `ScriptContext.js` | Script execution context (access to engine state) |
| `TriggerSystem.js` | Trigger system (ON_PLAY, COUNTER, etc.) |

### Script Format
```javascript
{
  triggerType: 'ON_PLAY' | 'ON_ATTACK' | 'COUNTER' | 'TURN_END' | 'ON_KO',
  cost: number,              // DON cost (e.g., Counter cards)
  conditions: [{ type, ... }], // Trigger conditions
  actions: [{ type, ... }],    // Actions to execute
}
```

### Counter Card Staging
Counter cards use a "staging" mechanism allowing players to preview and cancel:
1. Click Counter card → `stageCounterCard()` → effects apply immediately
2. Can cancel → `unstageCounterCard()` → revert all effects
3. Confirm → `confirmCounter()` → move to trash, resolve battle

### Adding New Card Effects
1. Add script to `CardScripts.js` keyed by cardNumber
2. Add action type to `ActionDSL.js` if needed
3. Register action in `TriggerSystem.executeAction()`
4. Add conditions in `TriggerSystem.checkConditions()` if needed

## Adding New Game Actions

1. Define event constant in `shared/constants.js`
2. Implement method in `game-server/src/engine.js`
3. Add socket handler in `game-server/src/index.js`
4. Add client helper in `client/src/services/socket.ts`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/cards/` | List cards (pagination, filters) |
| GET | `/api/cards/{id}` | Get card by ID |
| GET | `/api/cards/number/{card_number}` | Get card by number |
| GET | `/api/decks/` | List decks |
| POST | `/api/decks/` | Create deck |
| GET/PUT/DELETE | `/api/decks/{id}` | Deck CRUD |

API docs at http://localhost:8000/docs (Swagger UI)
