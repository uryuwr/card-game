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
```

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

## Game Engine

### Turn Phases
REFRESH → DRAW → DON → MAIN → BATTLE → END

### Battle Flow
1. `declareAttack`: Attacker selects target (must be Active/Rested)
2. `declareBlocker`: Defender selects blocker (optional)
3. `playCounter`: Both players can play counter events (optional)
4. `resolveBattle`: Compare power, resolve damage

### Adding New Game Actions
1. Define event constant in `shared/constants.js`
2. Implement method in `game-server/src/engine.js`
3. Add socket handler in `game-server/src/index.js`
4. Add client helper in `client/src/services/socket.ts`

### Card States
- `ACTIVE`: Ready to act (vertical)
- `RESTED`: Already acted this turn (horizontal)
- `DON`: Attached to card as power bonus
