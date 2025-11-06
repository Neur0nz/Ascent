use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

pub const BOARD_SIZE: usize = 5;
pub const CHANNELS: usize = 3;
pub const CELL_COUNT: usize = BOARD_SIZE * BOARD_SIZE;
pub const STATE_SIZE: usize = CELL_COUNT * CHANNELS; // 75 i8 entries
pub const NUM_PLAYERS: usize = 2;

pub const NB_GODS: usize = 1;
pub const ACTION_SIZE: usize = NB_GODS * 2 * 9 * 9; // 162 actions, matches legacy model shape
pub const PLACEMENT_ACTIONS: usize = CELL_COUNT; // First 25 indices are dedicated to placements

/// Exported for TypeScript bindings: total flattened board size.
pub type StateSize = usize;
/// Exported for TypeScript bindings: total number of actions.
pub type ActionSize = usize;

const DIRECTIONS: [(i8, i8); 9] = [
    (-1, -1),
    (-1, 0),
    (-1, 1),
    (0, -1),
    (0, 0),
    (0, 1),
    (1, -1),
    (1, 0),
    (1, 1),
];

#[inline]
const fn idx(y: usize, x: usize) -> usize {
    y * BOARD_SIZE + x
}

#[inline]
pub const fn encode_action(worker: usize, move_direction: usize, build_direction: usize) -> usize {
    // No gods support – power channel is always zero.
    NB_GODS * 9 * 9 * worker + 9 * 9 * 0 + 9 * move_direction + build_direction
}

#[inline]
pub const fn decode_action(action: usize) -> (usize, usize, usize) {
    let worker = action / (NB_GODS * 9 * 9);
    let remainder = action % (NB_GODS * 9 * 9);
    let move_direction = remainder / 9;
    let build_direction = remainder % 9;
    (worker, move_direction, build_direction)
}

#[derive(Clone, Copy, Serialize, Deserialize)]
pub struct BoardState {
    workers: [i8; CELL_COUNT],
    levels: [i8; CELL_COUNT],
    round: u16,
}

impl BoardState {
    pub fn new() -> Self {
        Self {
            workers: [0; CELL_COUNT],
            levels: [0; CELL_COUNT],
            round: 0,
        }
    }

    pub fn reset(&mut self) {
        *self = Self::new();
    }

    pub fn as_bytes(&self) -> [i8; STATE_SIZE] {
        let mut flat = [0; STATE_SIZE];
        self.write_into_slice(&mut flat);
        flat
    }

    pub fn from_bytes(bytes: &[i8]) -> Self {
        assert!(bytes.len() == STATE_SIZE, "expected 75 entries for board state");
        let mut state = Self::new();
        let mut cursor = 0;
        for i in 0..CELL_COUNT {
            state.workers[i] = bytes[cursor];
            state.levels[i] = bytes[cursor + 1];
            if i == 0 {
                state.round = bytes[cursor + 2].clamp(0, 127) as u16;
            }
            cursor += CHANNELS;
        }
        state
    }

    pub fn canonicalised(&self, player: usize) -> Self {
        if player == 0 {
            *self
        } else {
            let mut clone = *self;
            for w in &mut clone.workers {
                *w = -*w;
            }
            clone
        }
    }

    pub fn valid_moves(&self, player: usize, out: &mut [bool; ACTION_SIZE]) {
        out.fill(false);

        if let Some((_placement_player, _worker_to_place)) = self.next_placement() {
            for index in 0..CELL_COUNT {
                out[index] = self.workers[index] == 0;
            }
            return;
        }

        let player_sign = if player == 0 { 1 } else { -1 };
        for worker in 0..2 {
            let worker_id = (worker as i8 + 1) * player_sign;
            let Some(position) = self.find_worker(worker_id) else {
                continue;
            };

            for move_direction in 0..9 {
                if move_direction == 4 {
                    continue; // NO_MOVE
                }
                let Some(target) = apply_direction(position, move_direction) else {
                    continue;
                };
                if !self.can_move(position, target) {
                    continue;
                }
                for build_direction in 0..9 {
                    if build_direction == 4 {
                        continue; // NO_BUILD
                    }
                    let Some(build_pos) = apply_direction(target, build_direction) else {
                        continue;
                    };
                    if !self.can_build(build_pos, worker_id) {
                        continue;
                    }
                    let action = encode_action(worker, move_direction, build_direction);
                    out[action] = true;
                }
            }
        }
    }

    pub fn make_move(&mut self, action: usize, player: usize) -> usize {
        if let Some((placement_player, worker_to_place)) = self.next_placement() {
            assert!(action < PLACEMENT_ACTIONS, "placement indices must be < 25");
            if placement_player != player {
                panic!("player {player} attempted to place worker for player {placement_player}");
            }
            let y = action / BOARD_SIZE;
            let x = action % BOARD_SIZE;
            if self.workers[idx(y, x)] != 0 {
                panic!("cannot place worker on occupied square");
            }
            self.workers[idx(y, x)] = worker_to_place;
            self.bump_round();
            return match worker_to_place {
                1 | -1 => placement_player,
                _ => 1 - placement_player,
            };
        }

        let (worker, move_direction, build_direction) = decode_action(action);
        let player_sign = if player == 0 { 1 } else { -1 };
        let worker_id = (worker as i8 + 1) * player_sign;
        let old_pos = self
            .find_worker(worker_id)
            .unwrap_or_else(|| panic!("missing worker {worker_id} for player {player}"));
        let target = apply_direction(old_pos, move_direction).expect("move direction off board");

        let old_level = self.levels[idx(old_pos.0, old_pos.1)];
        self.workers[idx(old_pos.0, old_pos.1)] = 0;
        self.workers[idx(target.0, target.1)] = worker_id;

        if build_direction != 4 {
            if let Some(build_pos) = apply_direction(target, build_direction) {
                let index = idx(build_pos.0, build_pos.1);
                self.levels[index] = (self.levels[index] + 1).min(4);
            }
        }

        let new_level = self.levels[idx(target.0, target.1)];
        if new_level >= 3 && new_level > old_level {
            // Victory detected later by `result_value`; keep method branch for clarity.
        }

        self.bump_round();
        1 - player
    }

    pub fn result_value(&self, next_player: usize) -> Option<f32> {
        if self.next_placement().is_some() {
            return None;
        }
        if self.score_for(0) == 3 {
            return Some(1.0);
        }
        if self.score_for(1) == 3 {
            return Some(-1.0);
        }
        if !self.has_any_valid_move(next_player) {
            return Some(if next_player == 0 { -1.0 } else { 1.0 });
        }
        None
    }

    pub fn round(&self) -> u16 {
        self.round
    }

    pub fn score_for(&self, player: usize) -> i8 {
        let compare: fn(i8) -> bool = if player == 0 {
            |w| w > 0
        } else {
            |w| w < 0
        };
        let mut highest = 0;
        for cell in 0..CELL_COUNT {
            if compare(self.workers[cell]) {
                highest = highest.max(self.levels[cell]);
            }
        }
        highest
    }

    pub fn write_into_slice(&self, target: &mut [i8]) {
        assert_eq!(target.len(), STATE_SIZE, "slice must be length 75");
        let mut cursor = 0;
        for i in 0..CELL_COUNT {
            target[cursor] = self.workers[i];
            target[cursor + 1] = self.levels[i];
            target[cursor + 2] = if i == 0 { self.round.min(127) as i8 } else { 0 };
            cursor += CHANNELS;
        }
    }

    pub fn to_vec(&self) -> Vec<i8> {
        let mut vec = vec![0; STATE_SIZE];
        self.write_into_slice(&mut vec);
        vec
    }

    pub fn from_vec(data: &[i8]) -> Self {
        Self::from_bytes(data)
    }

    pub fn key(&self) -> [i8; STATE_SIZE] {
        self.as_bytes()
    }

    fn has_any_valid_move(&self, player: usize) -> bool {
        let mut mask = [false; ACTION_SIZE];
        self.valid_moves(player, &mut mask);
        mask.iter().any(|&flag| flag)
    }

    fn next_placement(&self) -> Option<(usize, i8)> {
        if self.find_worker(1).is_none() {
            return Some((0, 1));
        }
        if self.find_worker(2).is_none() {
            return Some((0, 2));
        }
        if self.find_worker(-1).is_none() {
            return Some((1, -1));
        }
        if self.find_worker(-2).is_none() {
            return Some((1, -2));
        }
        None
    }

    fn find_worker(&self, worker: i8) -> Option<(usize, usize)> {
        for y in 0..BOARD_SIZE {
            for x in 0..BOARD_SIZE {
                if self.workers[idx(y, x)] == worker {
                    return Some((y, x));
                }
            }
        }
        None
    }

    fn can_move(&self, old_pos: (usize, usize), new_pos: (usize, usize)) -> bool {
        if old_pos == new_pos {
            return true;
        }
        let target_index = idx(new_pos.0, new_pos.1);
        if self.workers[target_index] != 0 {
            return false;
        }
        let new_level = self.levels[target_index];
        if new_level > 3 {
            return false;
        }
        let old_level = self.levels[idx(old_pos.0, old_pos.1)];
        new_level <= old_level + 1
    }

    fn can_build(&self, pos: (usize, usize), ignore: i8) -> bool {
        let index = idx(pos.0, pos.1);
        let occupant = self.workers[index];
        if occupant != 0 && occupant != ignore {
            return false;
        }
        self.levels[index] < 4
    }

    fn bump_round(&mut self) {
        if self.round < 127 {
            self.round += 1;
        }
    }
}

impl Default for BoardState {
    fn default() -> Self {
        Self::new()
    }
}

fn apply_direction(position: (usize, usize), direction: usize) -> Option<(usize, usize)> {
    let delta = DIRECTIONS[direction];
    let ny = position.0 as i8 + delta.0;
    let nx = position.1 as i8 + delta.1;
    if (0..BOARD_SIZE as i8).contains(&ny) && (0..BOARD_SIZE as i8).contains(&nx) {
        Some((ny as usize, nx as usize))
    } else {
        None
    }
}

/// A thin wasm-bindgen friendly board wrapper.
#[wasm_bindgen]
pub struct SantoriniBoard {
    state: BoardState,
}

#[wasm_bindgen]
impl SantoriniBoard {
    #[wasm_bindgen(constructor)]
    pub fn new() -> SantoriniBoard {
        SantoriniBoard {
            state: BoardState::new(),
        }
    }

    /// Serialize the board to a 75-entry `Int8Array` (workers, levels, meta).
    #[wasm_bindgen(js_name = getState)]
    pub fn get_state(&self) -> Vec<i8> {
        self.state.to_vec()
    }

    /// Replace the board contents from a 75-entry `Int8Array`.
    #[wasm_bindgen(js_name = setState)]
    pub fn set_state(&mut self, data: Vec<i8>) {
        assert_eq!(data.len(), STATE_SIZE, "state vectors must be length 75");
        self.state = BoardState::from_vec(&data);
    }

    /// Reset all pieces, levels and round counter.
    pub fn reset(&mut self) {
        self.state.reset();
    }

    /// Return the zero-sum evaluation for the current position, if terminal.
    #[wasm_bindgen(js_name = maybeTerminalScore)]
    pub fn maybe_terminal_score(&self, next_player: u8) -> Option<f32> {
        self.state.result_value(next_player as usize)
    }

    /// Compute valid moves for `player`.
    #[wasm_bindgen(js_name = validMoves)]
    pub fn valid_moves(&self, player: u8) -> Vec<u8> {
        let mut mask = [false; ACTION_SIZE];
        self.state.valid_moves(player as usize, &mut mask);
        mask.iter().map(|flag| u8::from(*flag)).collect()
    }

    /// Apply an action (placement or move) encoded in canonical action space and return the actual
    /// next player index before canonicalisation.
    #[wasm_bindgen(js_name = applyMove)]
    pub fn apply_move(&mut self, action: u16, player: u8) -> u8 {
        self.state.make_move(action as usize, player as usize) as u8
    }

    /// Round counter (mirrors the Python implementation, capped to 127).
    pub fn round(&self) -> u16 {
        self.state.round()
    }

    /// Return the board from the stated player's perspective (player 0 sees unflipped state).
    #[wasm_bindgen(js_name = canonicalState)]
    pub fn canonical_state(&self, player: u8) -> Vec<i8> {
        self.state.canonicalised(player as usize).to_vec()
    }

    /// Convenience accessor for unit tests / debugging.
    pub fn score_for(&self, player: u8) -> i8 {
        self.state.score_for(player as usize)
    }
}

impl SantoriniBoard {
    pub fn clone_internal(&self) -> BoardState {
        self.state
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_serialisation() {
        let mut board = BoardState::new();
        board.workers[idx(0, 0)] = 1;
        board.workers[idx(4, 4)] = -2;
        board.levels[idx(2, 2)] = 3;
        board.round = 42;

        let mut buffer = [0i8; STATE_SIZE];
        board.write_into_slice(&mut buffer);
        let reconstructed = BoardState::from_bytes(&buffer);

        assert_eq!(board.workers, reconstructed.workers);
        assert_eq!(board.levels, reconstructed.levels);
        assert_eq!(board.round(), reconstructed.round());
    }

    #[test]
    fn canonicalisation_swaps_players() {
        let mut board = BoardState::new();
        board.workers[idx(1, 1)] = 1;
        board.workers[idx(3, 3)] = -1;

        let flipped = board.canonicalised(1);
        assert_eq!(flipped.workers[idx(1, 1)], -1);
        assert_eq!(flipped.workers[idx(3, 3)], 1);
    }
}
