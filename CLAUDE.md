# CLAUDE.md

This file provides context for Claude Code and other AI assistants working in this repository.

## Project Overview

Ascent is a full-stack web application implementing the **Santorini board game** with AI opponents and online multiplayer. It features offline practice mode (Python AI via Pyodide + ONNX neural network), online play (Supabase backend with realtime), game analysis, leaderboards, and PWA support for installable deployment.

## Repository Structure

```
web/                  # Vite + React + TypeScript frontend (most work happens here)
  src/
    App.tsx           # Root app component (482 lines) - routing, auth, workspace switching
    main.tsx          # Vite entry point
    service-worker.ts # PWA service worker (injectManifest strategy)
    components/       # React UI components
      auth/           # AuthJourney, AuthLoadingScreen, GoogleIcon
      play/           # PlayWorkspace (1,387 lines), LobbyWorkspace, GamePlayWorkspace, etc.
      analyze/        # AnalyzeWorkspace, EvaluationJobToasts
      leaderboard/    # LeaderboardWorkspace
      profile/        # ProfileWorkspace
    hooks/            # Custom React hooks (game orchestration, auth, lobby)
    game/             # Board visualization, move selection, SVG rendering
    lib/              # Core utilities
      runtime/        # Unified runtime dispatcher, WASM proxy, worker client, script loader
      practice/       # Practice engine, history, value utilities
      pythonBridge/   # Pyodide integration (bridge.ts, types.ts)
    stores/           # Zustand state stores (useNavigationStore)
    types/            # TypeScript type definitions (evaluation, match, supabaseErrors)
    utils/            # Helper utilities (~21 files)
    theme/            # Chakra UI theme tokens and surface hooks
    workers/          # Web Workers (santoriniEngine.worker.ts, clockWorker.ts)
    assets/santorini/ # Python engine files (7 .py) + ONNX model (1.6 MB)
    test/             # Test setup and polyfills (setup.ts)
shared/               # Shared TypeScript Santorini engine (used by web + Supabase)
supabase/             # Backend: Deno edge functions, SQL migrations, config
  functions/          # 6 edge functions + _shared/ module
  migrations/         # 18 PostgreSQL schema migrations
rust-wasm/            # Rust/WASM port (game logic + MCTS, builds via wasm-pack)
scripts/              # Deployment and utility scripts
docs/                 # Setup guides and development documentation
  setup/              # supabase.md, google-auth.md, android-notifications.md
  development/        # guidelines.md, analysis docs
  technical-debt.md   # Full technical debt backlog
.github/workflows/    # CI/CD (test -> build -> deploy to GitHub Pages)
```

**File counts**: 105 TypeScript/TSX source files, 12 test files, 26 components, 16 hooks.

## Tech Stack

- **Frontend**: React 18.2, Vite 5, TypeScript 5.3 (strict), Chakra UI 2.8, Framer Motion 11, Zustand 5
- **Backend**: Supabase (PostgreSQL 17, Realtime, Deno edge functions)
- **AI**: Pyodide (browser Python), ONNX Runtime Web, Monte Carlo Tree Search
- **WASM**: Rust + wasm-pack (game logic and MCTS in `rust-wasm/`)
- **Charts**: Recharts 2.8 (evaluation/analysis views)
- **PWA**: vite-plugin-pwa with injectManifest, custom service worker
- **Testing**: Vitest 1.6 + jsdom
- **Linting**: ESLint 9 (flat config) + Prettier
- **Deployment**: GitHub Actions -> GitHub Pages (static) + Supabase (serverless)

## Essential Commands

All commands run from the `web/` directory:

```bash
npm install                     # Install dependencies (one-time)
npm run dev                     # Dev server at http://localhost:5174
npm run dev:with-wasm-watch     # Dev server with WASM hot rebuild
npm run build                   # Full build (prebuild runs wasm-pack, then tsc + vite)
npm run build:no-rust           # Build without WASM compilation (tsc + vite only)
npm run preview                 # Preview production build locally
npm run test                    # Vitest (watch mode)
npm run test -- --run           # Single-pass test run (used in CI)
npm run lint                    # ESLint check
npm run lint:fix                # Auto-fix ESLint issues
npm run format                  # Prettier format
npm run format:check            # Check formatting
```

Single-file operations:
```bash
npx tsc --noEmit                          # Type-check entire project
npx vitest run src/utils/__tests__/foo.test.ts  # Run single test file
npx prettier --write src/components/Foo.tsx      # Format single file
```

## Code Style & Conventions

- **Indentation**: 2 spaces, trailing commas, single quotes, 120-char line width, LF line endings
- **Semicolons**: Required (Prettier enforced)
- **Arrow parens**: Always (`(x) => x`, not `x => x`)
- **Components**: PascalCase files (`GameBoard.tsx`), React function components only
- **Hooks**: `useCamelCase` prefix (`useSantorini.tsx`)
- **Utilities**: lower camelCase (`formatCoordinate.ts`)
- **Imports**: Use path aliases (`@components/`, `@hooks/`, `@game/`, `@shared/`, `@wasm/`, `@theme/`, `@/`)
- **No `any`**: Use `unknown` + narrowing or generics (`@typescript-eslint/no-explicit-any` warns)
- **Unused vars**: Prefix with `_` (ESLint allows `_`-prefixed args and variables)
- **Console**: `console.log` warns in lint; use `console.warn`/`console.error` for real logging
- **ESLint**: Flat config format (ESLint 9+) in `web/eslint.config.js` with `@typescript-eslint`, `react-hooks`, and `prettier` integration

## Testing Patterns

- Tests live in `__tests__/` directories beside their modules
- Name test files after the module: `Foo.test.tsx`, `useBar.test.ts`
- 12 test files currently covering: clock utils, auth hook, WASM proxy, move selector, lobby storage, evaluation, join links, match configs, player roles, lobby badges, game reducer
- Use deterministic fixtures, not random data
- Mock Supabase and network effects; use `vi.spyOn` and clean up in `afterEach`
- Focus on observable behavior (return values, rendered output), not implementation
- Vitest globals enabled (`describe`, `test`, `expect` available without imports)
- Test environment: jsdom with custom URL `https://santorini.test/`
- Setup file (`src/test/setup.ts`) polyfills `crypto`, `matchMedia`, etc.
- CI runs `npm run test -- --run` and expects <60s deterministic execution

## Architecture Notes

### Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `shared/santoriniEngine.ts` | 638 | Core game engine - pure TS, no deps, shared by client + server |
| `web/src/hooks/useMatchLobby.ts` | 3,188 | Lobby matchmaking, Supabase RPC + Realtime + notifications |
| `web/src/components/play/PlayWorkspace.tsx` | 1,387 | Main play UI workspace with game mode orchestration |
| `web/src/hooks/useSantorini.tsx` | 1,359 | Practice mode orchestration (Pyodide, ONNX, board state) |
| `web/src/hooks/useOnlineSantorini.tsx` | 1,318 | Online game state (clocks, move validation, realtime sync) |
| `web/src/lib/runtime/santoriniRuntime.ts` | — | Unified runtime dispatcher (WASM, Pyodide, fallbacks) |
| `web/src/lib/supabaseClient.ts` | — | Supabase browser client creation |
| `web/src/workers/santoriniEngine.worker.ts` | — | Game logic web worker |
| `web/src/workers/clockWorker.ts` | — | Clock/timer web worker |
| `supabase/functions/submit-move/index.ts` | 1,158 | Server-side move validation + push notifications |
| `supabase/functions/create-match/index.ts` | 377 | Match initialization and player setup |

### Game Engine

The Santorini game engine exists in three places that must stay in sync:
1. **TypeScript** (`shared/santoriniEngine.ts`) - authoritative for online play; re-exported by `supabase/functions/_shared/santorini.ts`
2. **Python** (`web/src/assets/santorini/`) - 7 Python files used by AI (Pyodide): `Game.py`, `SantoriniGame.py`, `SantoriniLogicNumba.py`, `SantoriniConstants.py`, `SantoriniDisplay.py`, `MCTS.py`, `proxy.py`
3. **Supabase edge functions** import from the shared engine via `_shared/santorini.ts`

Move encoding uses a single integer (0-161): `worker * 162 + power * 81 + moveDirection * 9 + buildDirection`

### State Management

- **Zustand** store (`useNavigationStore`) for app-level navigation/workspace switching
- **Custom hooks** for domain logic (game, lobby, auth, chat, notifications)
- **SantoriniSnapshot** objects for serializing game state (history, persistence, network)
- **Context providers**: `matchLobbyContext.tsx` for lobby state distribution

### Runtime Architecture

The app supports multiple game engine runtimes via a unified dispatcher (`lib/runtime/santoriniRuntime.ts`):
- **WASM runtime**: Rust-compiled game logic + MCTS (`santoriniWasmProxy.ts`)
- **Pyodide runtime**: Python AI with ONNX neural network evaluation (`pythonBridge/`)
- **Web Worker**: Offloads computation to separate threads (`santoriniEngine.worker.ts`)
- **Script loader**: Handles asset loading with integrity checks (`scriptLoader.ts`)

### Pyodide + ONNX Integration

- Python files in `web/src/assets/santorini/` are loaded into Pyodide's in-memory filesystem
- ONNX model (`model_no_god.onnx`, 1.6 MB) downloaded at runtime for neural network evaluation
- URLs configured via `VITE_PYODIDE_URL` and `VITE_ONNX_URL` environment variables
- Practice mode works offline; AI is optional (model downloads on first use)

### Supabase Backend

- Online features degrade gracefully when `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are absent
- Edge functions authenticate via bearer token, validate moves with the shared engine
- Realtime channels power lobby updates and in-game clock synchronization
- Tables: `players`, `matches`, `match_moves`, `players_presence`, `undo_requests`, `web_push_subscriptions`, `match_ping_events` (all with RLS)

**Edge Functions** (6):
| Function | Lines | Purpose |
|----------|-------|---------|
| `submit-move` | 1,158 | Move validation, state updates, push notifications |
| `create-match` | 377 | Match initialization, player setup |
| `join-match` | 178 | Join existing match with validation |
| `ping-opponent` | 249 | Opponent ping notifications |
| `update-match-status` | 165 | Status updates, clock management |
| `sync-push-subscription` | 116 | Push subscription sync |

### Rust WASM Module

Located in `rust-wasm/` with 4 source files:
- `lib.rs` - WASM entry point with exported functions
- `board.rs` - Compact board representation (5x5x3 tensor, 75 bytes)
- `mcts.rs` - Monte Carlo Tree Search implementation
- `predictor.rs` - Neural network evaluator integration

Built with `wasm-pack build --target web --release`. Uses LTO, single codegen unit, size optimization.
Key deps: `wasm-bindgen`, `serde`, `rand`, `smallvec`, `hashbrown`.

**Note**: `wasm-pack` requires a `LICENSE` file inside `rust-wasm/`. Copy or symlink the root `LICENSE` before building.

### PWA Configuration

- Configured via `vite-plugin-pwa` in `vite.config.ts`
- Uses `injectManifest` strategy with custom `service-worker.ts`
- App manifest: "Ascent", standalone display, themed icons (192x192, 512x512)
- Auto-update on new service worker detection

## Environment Variables

Place secrets in `web/.env.local` (never committed). See `web/.env.example` for template.

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | For online features | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | For online features | Supabase anonymous key |
| `VITE_PYODIDE_URL` | No (CDN default) | Pyodide runtime URL |
| `VITE_ONNX_URL` | No (CDN default) | ONNX Runtime Web URL |
| `VITE_VAPID_PUBLIC_KEY` | No | Push notification VAPID key |
| `VITE_PUBLIC_BASE_PATH` | No (defaults `/Ascent/`) | Base path for deployment |
| `VITE_DEV_PORT` | No (defaults `5174`) | Dev server port |
| `VITE_PREVIEW_PORT` | No (defaults `4173`) | Preview server port |

## CI/CD Pipeline

GitHub Actions (`.github/workflows/deploy.yml`), triggered on push to `main`/`master`:

1. **Test**: `npm run test -- --run` (Node 20, ubuntu-latest)
2. **Build**: Rust toolchain + wasm-pack, copy ONNX model to `web/public/santorini/`, `npm run build`
3. **Deploy**: Upload `web/dist/` to GitHub Pages

Build-time env vars:
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` from GitHub secrets
- `VITE_PUBLIC_BASE_PATH` from GitHub vars (default `/Ascent/`)
- `VITE_PYODIDE_URL`: `https://cdn.jsdelivr.net/pyodide/v0.26.1/full/pyodide.mjs`
- `VITE_ONNX_URL`: `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.16.0/dist/ort.min.js`

## Build Prerequisites

For full builds (including WASM):
- Node.js 20+
- Rust stable toolchain
- `wasm-pack` (`cargo install wasm-pack`)
- `wasm-opt` from Binaryen (for optimization)

For frontend-only builds: `npm run build:no-rust`

## Known Technical Debt

- **Monolithic hooks**: 3 hooks exceed 1,300 LOC (`useMatchLobby` at 3,188 lines); `PlayWorkspace.tsx` at 1,387 lines
- **Pyodide/ONNX asset loading** is fragile and slow (no SRI checks, global promise caching)
- **Supabase edge functions** use outdated `std@0.177.0`
- **Minimal test coverage**: 12 test files covering ~105 source files
- **Online features incomplete**: undo, rematch, and clock flows partially wired
- **submit-move** edge function at 1,158 lines combines validation, state, and notifications

See `docs/technical-debt.md` for the full backlog.

## Commit Conventions

- Imperative mood subjects: "Add match lobby timeout", "Fix clock sync bug"
- Keep diffs tight and focused
- Document testing evidence, env var additions, or migration steps in PRs
- Flag any required manual deployment steps
