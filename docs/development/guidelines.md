# Repository Guidelines

## Project Structure & Module Organization
- `src/` holds the TypeScript app: UI in `components/`, Supabase and board hooks in `hooks/`, game logic in `game/`, styling tokens in `theme/`, and shared helpers in `lib/` and `utils/`.
- Tests live beside their targets under `src/**/__tests__`; use `src/game/__tests__/localReducer.test.ts` as the baseline layout.
- Static assets and HTML shells sit in `public/`, production bundles land in `dist/`, and TypeScript aliases (`@components/HeaderBar`) keep imports readable.

## Build, Test, and Development Commands
- `npm run dev` starts the Vite dev server on port 5173 with hot reload.
- `npm run build` type-checks via `tsc` and emits an optimized bundle into `dist/`.
- `npm run preview` serves the production bundle locally for pre-release smoke tests.
- `npm run test` executes the Vitest suite; append `--watch` for iterative runs.

## Coding Style & Naming Conventions
- Favor function components with Chakra UI primitives; push shared state or effects into custom hooks.
- Keep two-space indentation and trailing commas consistent with existing files; enable your editor’s formatter to avoid drift.
- Components and files use PascalCase (`GameBoard.tsx`), hooks are camelCase prefixed with `use`, and helper utilities remain lower camelCase. Prefer the configured path aliases over long relative paths.

## Testing Guidelines
- Vitest (jsdom) is the default runner; add new `*.test.ts` or `*.test.tsx` files in a sibling `__tests__` directory.
- Mock Supabase and network effects, and focus on deterministic board positions when covering reducers, selectors, and hooks.
- Run `npm run test` before every PR and resolve or document all failures.

## Commit & Pull Request Guidelines
- Match current history with concise, imperative commit subjects such as `Add lobby matchmaking guard`; rebase to keep commits focused.
- PRs should outline scope, testing performed, linked issues, and UI screenshots or GIFs when screens change.
- Call out required env vars, migrations, or follow-up work directly in the PR body.

## Environment & Configuration
- Create `web/.env.local` for local secrets and keep real credentials out of git. Required variables:
  - `VITE_SUPABASE_URL` – Your Supabase project URL
  - `VITE_SUPABASE_ANON_KEY` – Your Supabase anonymous key
  - `VITE_PYODIDE_URL` – Pyodide runtime URL (optional, defaults to CDN)
  - `VITE_ONNX_URL` – ONNX Runtime Web URL (optional, defaults to CDN)
  - `VITE_VAPID_PUBLIC_KEY` – For push notifications (optional)
- Coordinate Supabase configuration or schema changes with backend maintainers and document any new RPCs.
- Update this guide whenever scripts, directories, or workflows change meaningfully.

## Python Engine Integration
- The canonical Santorini engine lives in `web/src/assets/santorini/` (Python modules plus `model_no_god.onnx`). These files are imported via Vite's `?url` suffix and loaded dynamically by Pyodide at runtime.
- `src/hooks/useSantorini.tsx` is the single entry-point that wires Pyodide into the UI. On mount it loads the Pyodide runtime from `VITE_PYODIDE_URL`, fetches every file listed in `PY_FILES`, writes them into the in-memory Pyodide FS, and instantiates the `Santorini` bridge class from `src/game/santorini.ts`.
- The bridge exposes helper methods (`_findWorker`, `_read_level`, etc.) that mirror the Python API. React state is synced by calling those methods after each move and by forwarding player actions back into Pyodide.
- Neural-network evaluation is optional: when `evaluationEnabled` is true the hook also loads ONNX Runtime Web from `VITE_ONNX_URL`, downloads `model_no_god.onnx`, and keeps a singleton inference session on `window.ort`. Missing URLs will hard-fail initialization.
- The Supabase edge functions reuse a TypeScript port of the Python logic (`supabase/functions/_shared/santorini.ts`) to validate moves server-side. Keep behaviour changes in sync across Python, the TS bridge, and the shared engine.

## Supabase Backend & Configuration
- Front-end code accesses Supabase through `src/lib/supabaseClient.ts`, which creates a browser client when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are present. Without them the Play/Analysis tabs gracefully disable online features but leave Practice offline mode untouched.
- Provision Supabase using the CLI config in `supabase/config.toml`. The project expects the `players`, `matches`, and `match_moves` schema plus the RLS policies defined in [`../setup/supabase.md`](../setup/supabase.md); run `supabase start` locally to mirror the hosted stack.
- Three edge functions (`supabase/functions/create-match`, `submit-move`, and `update-match-status`) enforce server authority. They authenticate the caller with a bearer token, load match data via RPCs, run the shared `SantoriniEngine` to validate requested actions, and then write back to `public.matches` / `public.match_moves`.
- Deploy edge functions with `supabase functions deploy <name>`; each function needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables in production. Keep their return payloads aligned with the React callers in `src/hooks/useMatchLobby.ts`.
- Supabase realtime is required for lobby updates and in-game clocks—ensure `public.matches` and `public.match_moves` are part of the `supabase_realtime` publication (see step 5 in [`../setup/supabase.md`](../setup/supabase.md)). Realtime channels are created in `useMatchLobby` whenever a user joins or creates a match.
