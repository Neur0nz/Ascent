# AGENTS.md

Codex agents should treat this file as the source of truth for how to work inside this repository. Skim it at the start of every session, then combine it with the current task instructions.

## Repository Orientation
- `web/` — Vite + React + TypeScript app (UI, hooks, assets, tests). Most day-to-day work happens here.
- `shared/` — Shared TypeScript Santorini engine used by both the web client and Supabase functions. Keep logic in sync with the Python sources.
- `supabase/` — CLI project (config, SQL migrations, Deno edge functions). Server changes and RLS tweaks live here.
- `docs/` — Setup guides (Supabase, auth, notifications) plus development guidelines referenced in `README.md`.
- `scripts/` — Supabase function deployment helpers.
- `rust-wasm/` — Experimental Rust/WASM port; treat as WIP unless the task explicitly targets it.

## Core Commands
Run JavaScript tooling from `web/` (Vite is configured relative to that folder).

```bash
cd web
npm install                      # one-time deps
npm run dev                      # http://localhost:5174 by default
npm run build                    # runs wasm-pack, tsc, then vite build
npm run preview
npm run test                     # Vitest + jsdom
npm run test -- --watch Foo.test.tsx
```

File-scoped helpers (still inside `web/`):
- Type-check: `npx tsc --noEmit src/components/Foo.tsx`
- Format: `npx prettier --write src/components/Foo.tsx`
- Single test file: `npx vitest run src/components/__tests__/Foo.test.tsx`

## Testing Workflow
- Vitest + jsdom power all unit tests. Run `npm run test -- --run` for a single-pass check or `npm run test -- --watch Foo.test.tsx` while iterating.
- Co-locate tests next to the module they cover inside `__tests__/` directories. Name files after the module (`Foo.test.tsx`, `useBar.test.ts`).
- `vitest.config.ts` pins the jsdom URL and loads `src/test/setup.ts` to polyfill globals like `crypto`/`matchMedia`. Extend that setup file when you need additional DOM shims so tests stay consistent.
- When adding a test, favor deterministic fixtures (factory helpers at the top of the test file) and assert observable behavior (rendered output, return values, emitted actions) instead of implementation details.
- Use `vi.spyOn`/`vi.stubGlobal` instead of rewriting modules. Clean up mocks via `afterEach` hooks or helper utilities to keep suites isolated.
- Hooks should be validated via focused helpers or lightweight renderers; reducers/utilities should exercise both the “happy path” and guard rails.


## Build & CI Notes
- `npm run build` automatically invokes `npm run build:wasm` via the `prebuild` hook. That script runs `wasm-pack build --target web --release` inside `rust-wasm/` before TypeScript compilation (`tsc`) and `vite build`.
- Local env needs:
  1. `wasm-pack` (install with `cargo install wasm-pack`).
  2. `wasm-bindgen`/`wasm-bindgen-futures` are pulled via Cargo when `wasm-pack` runs.
  3. `wasm-opt` from Binaryen for the optimization step (e.g., `brew install binaryen` or download from https://github.com/WebAssembly/binaryen/releases).
- The Rust crate declares `license = "MIT"`. `wasm-pack` requires a `LICENSE` file inside `rust-wasm/`. Copy the root `LICENSE` (or add a symlink) to `rust-wasm/LICENSE` before running builds locally/CI to silence the warning seen in CI logs.
- When TypeScript build errors point at Chakra components wrapped with `motion()`, prefer `forwardRef` wrappers that expose the original props (e.g., `const MotionTag = motion(forwardRef((props, ref) => <Tag ref={ref} {...props} />));`). This allows passing button props such as `type="button"` without breaking the compile step.
- GitHub Actions runs `npm run test -- --run` in the `test` job before the Pages build. Keep suites deterministic (<60s) so deployments are not blocked.

## Coding Conventions
- React function components with Chakra UI primitives. Hooks own side effects and cross-cutting state (`useSantorini`, `useOnlineSantorini`, etc.).
- Two-space indentation, trailing commas, and existing ESLint/Prettier rules. Match file casing: PascalCase components, `useCamelCase` hooks, lower camelCase helpers.
- Keep diffs tight. Prefer focused modules over sprawling rewrites unless the task is explicitly a refactor.
- Tests live beside code in `__tests__/`. When touching reducers/hooks, add or update Vitest coverage.

## Feature Notes
- **Pyodide + ONNX:** Python sources and `model_no_god.onnx` reside in `web/src/assets/santorini/`. `useSantorini.tsx` loads them via the URLs defined in env vars (`VITE_PYODIDE_URL`, `VITE_ONNX_URL`). Fail fast if the files are missing.
- **Supabase:** Browser client is created in `web/src/lib/supabaseClient.ts`. Online features (Play/Analysis) should degrade gracefully when `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` are absent. Edge functions (`supabase/functions/{create-match,submit-move,update-match-status}`) must mirror the shared TypeScript engine.
- **Env files:** Place secrets in `web/.env.local`. Never commit actual keys.
- **Model download:** Document any change that requires a new ONNX model. Default instructions in `README.md` describe downloading from releases.

## Workflow Expectations
- Plan first for anything non-trivial (`update_plan` with ≥2 steps). Update the plan as steps complete.
- Use `rg`/`fd` for searches; avoid slow globbing.
- Before returning code, run the smallest meaningful verification (unit tests, targeted build, or `tsc --noEmit`). If something cannot run locally, spell out manual steps for the user.
- Do not undo user changes you did not make. If the tree is dirty, work around existing files.
- Cite file paths + line numbers in summaries (e.g., `web/src/hooks/useSantorini.tsx:42`).
- Large `apply_patch` blocks that include template literals can confuse the shell. When that happens, write the patch to a temp file via `cat <<'PATCH' >/tmp/your_patch.patch` and run `apply_patch < /tmp/your_patch.patch` from the repo directory to keep the content literal.

## MCP Tooling & Memory Usage
We have access to generic MCP services plus a memory graph (`mcp-neo4j-agent-memory`) for persistent knowledge. Follow these principles, based on current guidance for AGENTS.md usage and MCP memory servers (Builder.io blog on AGENTS.md best practices; agentsmd.io Codex guide; SmartScope Codex CLI best-practices; Basic Memory integration docs; Glama Agentic Tools `create_memory`/`update_memory` specs):

1. **When to store memory**
   - Capture durable project facts (architecture decisions, env quirks, repeating bugs) that will help in future sessions.
   - Summarize major migrations or conventions after they stabilize. Avoid noisy or short-lived details.
2. **How to store**
   - Use `mcp__mcp-neo4j-agent-memory__create_memory` with a short title, detailed content, optional tags/metadata.
   - Include the absolute working directory path when required by the tool schema.
   - If relating two memories (e.g., “Pyodide Loader” ↔ “Supabase Edge Functions”), create a connection so future searches surface context faster.
3. **Maintaining accuracy**
   - Before updating, call `search_memories` to confirm whether an entry already exists; prefer `update_memory` over duplicates.
   - Use `update_connection` or `delete_connection` sparingly and only when relationships truly change.
   - Keep secrets, credentials, and user-identifiable data out of memory (per SmartScope guidance on AGENTS.md hygiene).
4. **Retrieval**
   - For recurring tasks, run `list_memory_labels` or `search_memories` early to recall team decisions before coding.
   - Reference the memory ID in notes if a follow-up task depends on it.

## Communication & PR Notes
- Write commit subjects in imperative mood (“Add match lobby timeout”).
- Document testing evidence in PR descriptions (commands run, screenshots for UI changes).
- Flag migrations, env-variable additions, or manual deployment steps in both PRs and any new docs you touch.

## When In Doubt
- Prefer asking clarifying questions over guessing.
- If instructions in `AGENTS.md`, `README.md`, and `docs/development/guidelines.md` ever conflict, obey the most specific file or the latest user directive.
