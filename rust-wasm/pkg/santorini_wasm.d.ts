/* tslint:disable */
/* eslint-disable */
/**
 * Flattened board tensor length (5×5×3 = 75 entries).
 */
export function stateSize(): number;
/**
 * Number of legal actions in the no-gods ruleset (162).
 */
export function actionSize(): number;
/**
 * Install a panic hook sending Rust panics to the browser console. The hook is only compiled in
 * when the `console_error_panic_hook` feature is enabled (default).
 */
export function init_panic_hook(): void;
/**
 * A thin wasm-bindgen friendly board wrapper.
 */
export class SantoriniBoard {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Apply an action (placement or move) encoded in canonical action space and return the actual
   * next player index before canonicalisation.
   */
  applyMove(action: number, player: number): number;
  /**
   * Compute valid moves for `player`.
   */
  validMoves(player: number): Uint8Array;
  /**
   * Return the board from the stated player's perspective (player 0 sees unflipped state).
   */
  canonicalState(player: number): Int8Array;
  /**
   * Return the zero-sum evaluation for the current position, if terminal.
   */
  maybeTerminalScore(next_player: number): number | undefined;
  constructor();
  /**
   * Reset all pieces, levels and round counter.
   */
  reset(): void;
  /**
   * Round counter (mirrors the Python implementation, capped to 127).
   */
  round(): number;
  /**
   * Serialize the board to a 75-entry `Int8Array` (workers, levels, meta).
   */
  getState(): Int8Array;
  /**
   * Convenience accessor for unit tests / debugging.
   */
  score_for(player: number): number;
  /**
   * Replace the board contents from a 75-entry `Int8Array`.
   */
  setState(data: Int8Array): void;
}
export class SantoriniMcts {
  free(): void;
  [Symbol.dispose](): void;
  static defaultConfig(): any;
  constructor(config: any, predictor: Function);
  search(board_state: Int8Array, player: number, temperature: number, force_full_search: boolean): Promise<any>;
  setSeed(seed: bigint): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_santoriniboard_free: (a: number, b: number) => void;
  readonly __wbg_santorinimcts_free: (a: number, b: number) => void;
  readonly actionSize: () => number;
  readonly init_panic_hook: () => void;
  readonly santoriniboard_applyMove: (a: number, b: number, c: number) => number;
  readonly santoriniboard_canonicalState: (a: number, b: number) => [number, number];
  readonly santoriniboard_getState: (a: number) => [number, number];
  readonly santoriniboard_maybeTerminalScore: (a: number, b: number) => number;
  readonly santoriniboard_new: () => number;
  readonly santoriniboard_reset: (a: number) => void;
  readonly santoriniboard_round: (a: number) => number;
  readonly santoriniboard_score_for: (a: number, b: number) => number;
  readonly santoriniboard_setState: (a: number, b: number, c: number) => void;
  readonly santoriniboard_validMoves: (a: number, b: number) => [number, number];
  readonly santorinimcts_defaultConfig: () => any;
  readonly santorinimcts_new: (a: any, b: any) => [number, number, number];
  readonly santorinimcts_search: (a: number, b: number, c: number, d: number, e: number, f: number) => any;
  readonly santorinimcts_setSeed: (a: number, b: bigint) => void;
  readonly stateSize: () => number;
  readonly wasm_bindgen__convert__closures_____invoke__h0fc66a9e31a94ec2: (a: number, b: number, c: any) => void;
  readonly wasm_bindgen__closure__destroy__hdc0e3d4262082e79: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__h2c729f55a14b41d1: (a: number, b: number, c: any, d: any) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
