#![allow(clippy::too_many_arguments)]
#![deny(clippy::unwrap_used)]
//! WebAssembly bindings for a fast, no-gods Santorini engine and Monte Carlo Tree Search runner.
//!
//! The crate exposes two high-level building blocks:
//!
//! * [`SantoriniBoard`] – a compact, immutable-friendly board representation mirroring the legacy
//!   Python/NumPy layout (5×5×3 tensor flattened to 75 bytes). All helper methods are deterministic
//!   and tuned for minimal allocations, enabling hot-path use inside tight MCTS loops.
//! * [`SantoriniMcts`] – a batched Monte Carlo Tree Search orchestrator that relies on an
//!   externally supplied neural-network evaluator (JavaScript/TypeScript side). The evaluator is
//!   expected to return a Promise resolving to `{ pi: number[], v: number }`, matching the output
//!   of the Pyodide version. The implementation focuses on clarity, documentation and predictable
//!   performance.
//!
//! Both components are heavily documented to ease maintenance and future optimisation passes.

mod board;
mod mcts;
mod predictor;

pub use board::{SantoriniBoard, ACTION_SIZE, STATE_SIZE};
pub use mcts::{MctsConfig, SantoriniMcts, SEARCH_RESULT_VERSION};

use wasm_bindgen::prelude::*;

/// Install a panic hook sending Rust panics to the browser console. The hook is only compiled in
/// when the `console_error_panic_hook` feature is enabled (default).
#[wasm_bindgen]
pub fn init_panic_hook() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// Flattened board tensor length (5×5×3 = 75 entries).
#[wasm_bindgen(js_name = stateSize)]
pub fn state_size() -> usize {
    STATE_SIZE
}

/// Number of legal actions in the no-gods ruleset (162).
#[wasm_bindgen(js_name = actionSize)]
pub fn action_size() -> usize {
    ACTION_SIZE
}
