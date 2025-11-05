# Technical Debt Backlog

This document captures the largest sources of technical debt that surfaced while surveying the repo. Each item links back to the code for quick triage and includes the blast radius plus pragmatic next steps.

## Themes at a Glance

- The Santorini client leans on multi‑thousand‑line hooks/components that couple React rendering, Pyodide orchestration, move logic, storage, and networking in one place, which makes regression‑free change nearly impossible.
- Model loading and Pyodide bootstrapping rely on ad‑hoc script injection and runtime fetches with no integrity checks or caching strategy.
- Critical game rules are copy‑pasted between the Vite app (`web/src/lib`) and the Supabase Edge Functions (`supabase/functions/_shared`), so fixes routinely need to be duplicated.
- Supabase Edge Functions still use dated dependencies, service-role keys, in-memory caches, and unchecked `any` payloads—leaving little room for observability or rate limiting.
- Online-play UX exposes TODOs (e.g. undo, rematch) and clocks/rematch flows are only partially wired.
- Automated testing is effectively non-existent and CI never exercises `npm run test`, so regressions hit production.
- Tooling scripts (`scripts/manage-functions.sh`) prioritize convenience over reproducibility or completeness.

## Detailed Items

### 1. Monolithic client state containers

- **Evidence:** `web/src/hooks/useSantorini.tsx:1` weighs in at **1,711** lines and combines Pyodide setup, ONNX inference, practice-mode UI state, undo/redo stacks, move logs, localStorage persistence, and Chakra toast messaging. `web/src/hooks/useOnlineSantorini.ts:1` (943 lines) repeats similar concerns for online play, and `web/src/hooks/useMatchLobby.ts:1` grows to **2,801** lines of Supabase RPC orchestration, realtime channels, push notifications, emoji reactions, connection telemetry, and optimistic updates. `web/src/components/play/PlayWorkspace.tsx:724` renders ~1,400 lines of UI and still contains TODOs.
- **Impact:** Virtually impossible to unit-test. Small UI tweaks risk breaking Pyodide bootstrapping or lobby syncing. Bundle size and re-render cost suffer because hooks reallocate giant objects each state change.
- **Path to resolution:** 
  1. Extract discrete modules: Pyodide loader, ONNX evaluator, move/eval history manager, lobby data source, etc., each returning plain objects/promises.
  2. Wrap the modules in thin hooks that only translate module events into React state.
  3. Add targeted unit tests around each module before refactoring the main hooks.

### 2. Pyodide/ONNX asset pipeline fragility

- **Evidence:** `web/src/hooks/useSantorini.tsx:22-114` hard-codes the set of Python files fetched at runtime, and `web/src/hooks/useSantorini.tsx:768-825` injects `<script>` tags using `loadScript` with no Subresource Integrity, retries, or caching. Each page load re-fetches ~1 MB of Python even in dev. The ONNX session is kept in a global `onnxSessionPromise` (`web/src/hooks/useSantorini.tsx:32-756`) without invalidation when `model_no_god.onnx` changes.
- **Impact:** Slow cold-starts, brittle caching, and zero protection against tampered CDN payloads. Debugging model updates is painful because the promise never refreshes when a new binary is deployed.
- **Path to resolution:** 
  1. Package the Python files and ONNX model as part of the Vite asset pipeline (e.g., import via `new URL('./santorini/Game.py', import.meta.url)`).
  2. Add hash-based cache busting and integrity metadata.
  3. Replace the global promise with a small loader class that watches the model version and recreates sessions when inputs change.

### 3. Game-engine duplication across runtimes (Partially Resolved)

- **Evidence:** The game engine is now shared via `shared/santoriniEngine.ts`, which is imported by both `web/src/lib/santoriniEngine.ts` (re-export) and `supabase/functions/_shared/santorini.ts` (re-export). This eliminates code duplication. However, the TypeScript path aliases (`@shared`) may need verification to ensure both contexts can properly resolve the shared module, and runtime differences between browser and Deno environments should be tested.
- **Impact:** Reduced risk of desyncs since both client and server use the same source. However, testing across both runtimes is still critical to catch environment-specific issues.
- **Path to resolution:** 
  1. Add golden tests that replay the same move lists through both runtimes (browser and Deno).
  2. Verify path resolution works correctly in both build contexts.
  3. Document any runtime differences or limitations.

### 4. Supabase Edge Function robustness gaps

- **Evidence:** All edge functions (`supabase/functions/create-match/index.ts:1`, `submit-move/index.ts:1`, `update-match-status/index.ts:1`) pin `std@0.177.0` (early 2023) while Supabase now targets ≥0.208. `submit-move/index.ts:57-155` implements custom auth/match caches with shared `Map`s, which provide no benefit in a serverless context but complicate logic. Functions pass around `any`/`unknown` matches and moves instead of generated Supabase types, so schema regressions won’t be caught at compile time. There are no unit tests or contract tests validating illegal-move handling, clock calculations, or push notifications.
- **Impact:** Hard to reason about correctness, limited observability, and elevated risk of runtime crashes during Supabase upgrades. Since caches don’t persist across invocations, the added complexity mostly introduces bugs (e.g., stale penalty counters).
- **Path to resolution:** 
  1. Upgrade to the latest `std` and `supabase-js` ESM builds.
  2. Generate typed clients via `supabase gen types typescript` and replace ad-hoc `any` structures.
  3. Remove in-memory caches in favor of explicit rate limits or dedicated storage (e.g., Redis) if truly needed.
  4. Back the functions with unit tests (Deno or Vitest) that assert move validation, status transitions, and push payloads.

### 5. Online gameplay gaps (undo/rematch/clocks)

- **Evidence:** `web/src/components/play/PlayWorkspace.tsx:742` leaves undo handling as a TODO despite exposing a button. `web/src/hooks/useOnlineSantorini.ts:166-235` maintains clock state locally but never reconciles against authoritative `match.moves`, so reconnecting clients can display stale timers. `web/src/types/match.ts:63-110` defines rematch/undo/abort actions, yet there are no flows in the UI or edge functions to persist or react to them.
- **Impact:** Players see UI affordances that do nothing, and multi-device reconnects can lead to time forfeits because the local timer drifts from the server clock. Without server-side undo/rematch endpoints, clients can only fall back to chat to resolve disputes.
- **Path to resolution:** 
  1. Decide on the authoritative component (client vs. edge function) for undo/rematch actions, then implement the missing RPCs.
  2. Wire the `GameBoard` undo button to those RPCs, showing pending/success states.
  3. Derive clocks from server timestamps only (reuse the computation in `supabase/functions/submit-move/index.ts:186-270`) to keep clients honest.

### 6. Testing and CI blind spots

- **Evidence:** Only `web/src/hooks/__tests__/useSupabaseAuth.test.ts` exists; there are zero tests for Pyodide orchestration, move encoding, lobby syncing, or edge functions. The CI workflow `.github/workflows/deploy.yml` runs `npm run build` but never calls `npm test` even though `web/package.json` defines a Vitest target.
- **Impact:** Regressions in edge cases (undo, clocks, placement) go live unchecked. Supabase functions can accumulate unhandled promise rejections without detection.
- **Path to resolution:** 
  1. Introduce Vitest suites for `santoriniEngine`, `TypeScriptMoveSelector`, and the lobby data source.
  2. Add Deno or Vitest tests that import the edge function handlers directly.
  3. Update the workflow to execute `npm run test -- --runInBand` (or similar) before building.

### 7. Tooling and operational friction

- **Evidence:** `scripts/manage-functions.sh` only deploys `create-match` and `submit-move` (lines 37-78) even though `supabase/functions/update-match-status` exists, so that function can silently fall behind. No scripts verify that required env vars (e.g., `VITE_PYODIDE_URL`, `VITE_ONNX_URL`, Supabase keys) are set before builds.
- **Impact:** Operators may unknowingly run outdated edge code. Missing env guards make deployments fragile.
- **Path to resolution:** 
  1. Expand `scripts/manage-functions.sh` (or replace with package.json scripts) to deploy/log all functions.
  2. Add a preflight script that validates required env variables for both dev and CI.

---

Addressing the top three themes (modularizing the hooks, fixing asset loading, and deduplicating the game engine) will unlock safer feature work. The remaining items can be scheduled as follow-up milestones once the foundational work lands.
