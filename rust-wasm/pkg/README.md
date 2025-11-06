# Santorini Rust WASM Core

High-performance, no-gods Santorini engine plus Monte Carlo Tree Search written in Rust and exposed
via wasm-bindgen. This module is intended to replace the Pyodide-based Python stack that currently
powers AI play inside the browser.

## Modules

- `SantoriniBoard` – minimal board representation mirroring the legacy NumPy tensor (5×5×3 = 75
  `i8`s). Provides helpers for canonicalisation, validity checks, move application, and terminal
  detection. Designed to avoid heap churn while remaining easy to reason about.
- `SantoriniMcts` – orchestrates simulations using a user-supplied neural network evaluator on the
  JavaScript side. The evaluator is expected to return a promise resolving to
  `{ pi: number[], v: number }`, just like the Pyodide bridge. Dirichlet noise, fractional search,
  first-play urgency, optional forced play-outs, and tree cleanup mirror the old defaults. Legacy
  knobs such as `ratio_fullMCTS` and `no_mem_optim` are honoured for drop-in parity with the Python
  configuration objects.

## Building

```
wasm-pack build rust-wasm --target web --release
```

(or use `--target bundler` / `--target nodejs` depending on your tooling.)

## JavaScript usage sketch

```ts
import init, { init_panic_hook, SantoriniBoard, SantoriniMcts } from '../pkg/santorini_wasm';

await init();
init_panic_hook();

const predictor = async (boardBytes: Int8Array, validMask: Uint8Array) => {
  const logits = await runOnnx(boardBytes, validMask); // existing ONNX Runtime Web helper
  return { pi: logits, v: logitsValue }; // match Pyodide contract
};

const mcts = new SantoriniMcts(SantoriniMcts.defaultConfig(), predictor);
const board = new SantoriniBoard();
const { policy, q } = await mcts.search(board.getState(), 0, 1.0, true);
```

## Testing

```
cargo test -p santorini_wasm      # fast host-side unit tests
wasm-pack test --headless --chrome rust-wasm   # optional browser smoke tests
```

## Integration TODOs

- Wire the `predictor` callback to the existing `onnxSessionPromise` helper.
- Replace Pyodide calls in `web/src/hooks/useSantorini.tsx` (or other React hooks) with the Rust WASM
  exports.
- Remove dead Python assets once parity is verified.
- Consider shipping prebuilt `.wasm` via Vite plugin for faster dev builds.
- If you change `SantoriniMcts` defaults (e.g., forced play-outs, full-search probability),
  keep the UI's assumptions in sync.
