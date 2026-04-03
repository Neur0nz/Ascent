# CLAUDE.md

This file provides context for Claude Code and other AI assistants working in this repository.

## Project Overview

Ascent is a full-stack web application implementing the **Santorini board game** with AI opponents and online multiplayer. It features offline practice mode (Python AI via Pyodide + ONNX neural network), online play (Supabase backend with realtime), game analysis, and leaderboards.

## Repository Structure

```
web/                  # Vite + React + TypeScript frontend (most work happens here)
  src/
    components/       # React UI components (auth, play, analyze, profile, leaderboard)
    hooks/            # Custom React hooks (game orchestration, auth, lobby)
    game/             # Board visualization and move selection
    lib/              # Core utilities, Python bridge, WASM proxy, practice helpers
    stores/           # Zustand state stores
    types/            # TypeScript type definitions
    utils/            # Helper utilities
    theme/            # Chakra UI theme tokens
    workers/          # Web Workers
    assets/santorini/ # Python engine files + ONNX model
    test/             # Test setup and polyfills
shared/               # Shared TypeScript Santorini engine (used by web + Supabase)
supabase/             # Backend: Deno edge functions, SQL migrations, config
  functions/          # create-match, submit-move, update-match-status, etc.
  migrations/         # PostgreSQL schema migrations
rust-wasm/            # Experimental Rust/WASM port (WIP, don't touch unless asked)
scripts/              # Deployment and utility scripts
docs/                 # Setup guides and development documentation
.github/workflows/    # CI/CD (test -> build -> deploy to GitHub Pages)
```

## Tech Stack

- **Frontend**: React 18, Vite 5, TypeScript 5.3 (strict), Chakra UI 2.8, Framer Motion, Zustand
- **Backend**: Supabase (PostgreSQL 17, Realtime, Deno edge functions)
- **AI**: Pyodide (browser Python), ONNX Runtime Web, Monte Carlo Tree Search
- **Testing**: Vitest + jsdom
- **Linting**: ESLint 9 + Prettier
- **Deployment**: GitHub Actions -> GitHub Pages (static) + Supabase (serverless)

## Essential Commands

All commands run from the `web/` directory:

```bash
npm install                     # Install dependencies (one-time)
npm run dev                     # Dev server at http://localhost:5174
npm run build                   # Full build (wasm-pack + tsc + vite)
npm run build:no-rust           # Build without WASM compilation
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

- **Indentation**: 2 spaces, trailing commas, single quotes, 120-char line width
- **Components**: PascalCase files (`GameBoard.tsx`), React function components only
- **Hooks**: `useCamelCase` prefix (`useSantorini.tsx`)
- **Utilities**: lower camelCase (`formatCoordinate.ts`)
- **Imports**: Use path aliases (`@components/`, `@hooks/`, `@game/`, `@shared/`, `@wasm/`)
- **No `any`**: Use `unknown` + narrowing or generics
- **Unused vars**: Prefix with `_` (ESLint allows this pattern)
- **Console**: `console.log` warns in lint; use `console.warn`/`console.error` for real logging

## Testing Patterns

- Tests live in `__tests__/` directories beside their modules
- Name test files after the module: `Foo.test.tsx`, `useBar.test.ts`
- Use deterministic fixtures, not random data
- Mock Supabase and network effects; use `vi.spyOn` and clean up in `afterEach`
- Focus on observable behavior (return values, rendered output), not implementation
- CI runs `npm run test -- --run` and expects <60s deterministic execution

## Architecture Notes

### Key Files

| File | Purpose |
|------|---------|
| `shared/santoriniEngine.ts` | Core game engine (637 lines) - pure TS, no deps, shared by client + server |
| `web/src/hooks/useSantorini.tsx` | Practice mode orchestration (Pyodide, ONNX, board state) |
| `web/src/hooks/useOnlineSantorini.tsx` | Online game state (clocks, move validation, realtime sync) |
| `web/src/hooks/useMatchLobby.ts` | Lobby matchmaking, Supabase RPC + Realtime |
| `web/src/lib/supabaseClient.ts` | Supabase browser client creation |
| `supabase/functions/submit-move/index.ts` | Server-side move validation |

### Game Engine

The Santorini game engine exists in three places that must stay in sync:
1. **TypeScript** (`shared/santoriniEngine.ts`) - authoritative for online play
2. **Python** (`web/src/assets/santorini/`) - used by AI (Pyodide)
3. **Supabase edge functions** (`supabase/functions/_shared/santorini.ts`) - server-side validation

Move encoding uses a single integer (0-161): `worker * 162 + power * 81 + moveDirection * 9 + buildDirection`

### State Management

- **Zustand** stores for app-level navigation
- **Custom hooks** for domain logic (game, lobby, auth)
- **SantoriniSnapshot** objects for serializing game state (history, persistence, network)

### Pyodide + ONNX Integration

- Python files in `web/src/assets/santorini/` are loaded into Pyodide's in-memory filesystem
- ONNX model (`model_no_god.onnx`) downloaded at runtime for neural network evaluation
- URLs configured via `VITE_PYODIDE_URL` and `VITE_ONNX_URL` environment variables
- Practice mode works offline; AI is optional (model downloads on first use)

### Supabase Backend

- Online features degrade gracefully when `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are absent
- Edge functions authenticate via bearer token, validate moves with the shared engine
- Realtime channels power lobby updates and in-game clock synchronization
- Tables: `players`, `matches`, `match_moves`, `players_presence` (all with RLS)

## Environment Variables

Place secrets in `web/.env.local` (never committed):

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | For online features | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | For online features | Supabase anonymous key |
| `VITE_PYODIDE_URL` | No (CDN default) | Pyodide runtime URL |
| `VITE_ONNX_URL` | No (CDN default) | ONNX Runtime Web URL |
| `VITE_VAPID_PUBLIC_KEY` | No | Push notification key |
| `VITE_PUBLIC_BASE_PATH` | No (defaults `/Ascent/`) | Base path for deployment |

## CI/CD Pipeline

GitHub Actions (`.github/workflows/deploy.yml`):
1. **Test**: `npm run test -- --run` (Node 20, ubuntu-latest)
2. **Build**: Rust toolchain + wasm-pack, `npm run build`, copy ONNX model to public/
3. **Deploy**: Upload to GitHub Pages

Triggered on push to `main` or `master`.

## Build Prerequisites

For full builds (including WASM):
- Node.js 20+
- Rust stable toolchain
- `wasm-pack` (`cargo install wasm-pack`)
- `wasm-opt` from Binaryen (for optimization)

For frontend-only builds: `npm run build:no-rust`

## Known Technical Debt

- Large monolithic hooks (1,000-3,000 lines) need modularization
- Pyodide/ONNX asset loading is fragile and slow
- Supabase edge functions use outdated `std@0.177.0`
- Minimal test coverage (~10 test files)
- Online features incomplete (undo, rematch, clocks partially done)

See `docs/technical-debt.md` for the full backlog.

## Commit Conventions

- Imperative mood subjects: "Add match lobby timeout", "Fix clock sync bug"
- Keep diffs tight and focused
- Document testing evidence, env var additions, or migration steps in PRs
- Flag any required manual deployment steps
