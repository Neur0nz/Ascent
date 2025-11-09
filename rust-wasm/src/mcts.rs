use std::collections::HashMap;

use rand::distributions::Distribution;
use rand::rngs::SmallRng;
use rand::{Rng, SeedableRng};
use rand_distr::Dirichlet;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

use crate::board::{BoardState, ACTION_SIZE, STATE_SIZE};
use crate::predictor::NetworkPrediction;

const MIN_FLOAT: f32 = f32::MIN;
const EPS: f32 = 1e-8;

/// Version tag embedded in search results so the frontend can gate feature toggles if needed.
pub const SEARCH_RESULT_VERSION: u8 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MctsConfig {
    /// Maximum number of simulations when running a \"full\" search.
    pub num_simulations: u32,
    /// Divisor applied to `num_simulations` when a partial search is picked. Accepts legacy
    /// `ratio_fullMCTS` field for backwards compatibility.
    #[serde(default = "default_partial_divisor", alias = "ratio_fullMCTS")]
    pub partial_divisor: u32,
    /// Exploration constant in the UCB1 term.
    #[serde(default = "default_cpuct")]
    pub cpuct: f32,
    /// Dirichlet noise concentration parameter (α). Set ≤0 to disable.
    #[serde(default = "default_dirichlet_alpha")]
    pub dirichlet_alpha: f32,
    /// Weight applied to the sampled Dirichlet noise (0.0 disables mixing).
    #[serde(default = "default_dirichlet_weight")]
    pub dirichlet_weight: f32,
    /// First-play urgency reduction added when an edge was never visited.
    #[serde(default = "default_fpu_reduction")]
    pub fpu_reduction: f32,
    /// Simulation probability of running a full search instead of a partial one.
    #[serde(default = "default_prob_full_search")]
    pub prob_full_search: f32,
    /// Whether to apply the forced-playout heuristic (AlphaZero style).
    #[serde(default = "default_forced_playouts")]
    pub forced_playouts: bool,
    /// Coefficient `k` used in the forced-playout threshold `sqrt(k * P * n_iter)`.
    #[serde(default = "default_forced_playout_coefficient")]
    pub forced_playout_coefficient: f32,
    /// When true, skip periodic cleanup of the search tree (higher memory usage).
    #[serde(default)]
    pub no_mem_optim: bool,
    /// Interval (in rounds) between transposition-table cleanups.
    #[serde(default = "default_cleanup_interval")]
    pub cleanup_interval: u16,
    /// Number of recent rounds to retain in the tree during cleanup.
    #[serde(default = "default_retain_rounds")]
    pub retain_rounds: u16,
}

fn default_partial_divisor() -> u32 {
    4
}
fn default_cpuct() -> f32 {
    2.75
}
fn default_dirichlet_alpha() -> f32 {
    0.3
}
fn default_dirichlet_weight() -> f32 {
    0.0
}
fn default_fpu_reduction() -> f32 {
    0.03
}
fn default_prob_full_search() -> f32 {
    1.0
}
fn default_forced_playouts() -> bool {
    false
}
fn default_forced_playout_coefficient() -> f32 {
    0.5
}
fn default_cleanup_interval() -> u16 {
    20
}
fn default_retain_rounds() -> u16 {
    5
}

impl Default for MctsConfig {
    fn default() -> Self {
        Self {
            num_simulations: 128,
            partial_divisor: default_partial_divisor(),
            cpuct: default_cpuct(),
            dirichlet_alpha: default_dirichlet_alpha(),
            dirichlet_weight: default_dirichlet_weight(),
            fpu_reduction: default_fpu_reduction(),
            prob_full_search: default_prob_full_search(),
            forced_playouts: default_forced_playouts(),
            forced_playout_coefficient: default_forced_playout_coefficient(),
            no_mem_optim: false,
            cleanup_interval: default_cleanup_interval(),
            retain_rounds: default_retain_rounds(),
        }
    }
}

struct TreeNode {
    policy: [f32; ACTION_SIZE],
    valid: [bool; ACTION_SIZE],
    visit_count: u32,
    qsa: [f32; ACTION_SIZE],
    nsa: [u32; ACTION_SIZE],
    mean_value: f32,
    terminal_value: Option<f32>,
    round: u16,
}

impl TreeNode {
    fn from_prediction(
        valid: [bool; ACTION_SIZE],
        prediction: &NetworkPrediction,
        round: u16,
    ) -> Self {
        let mut policy = [0.0; ACTION_SIZE];
        let mut sum = 0.0;
        let mut valid_count = 0usize;
        for (idx, valid_flag) in valid.iter().copied().enumerate() {
            if !valid_flag {
                continue;
            }
            let score = prediction.pi.get(idx).copied().unwrap_or(0.0).exp();
            policy[idx] = score;
            sum += score;
            valid_count += 1;
        }

        if sum <= EPS {
            if valid_count == 0 {
                let uniform = 1.0 / ACTION_SIZE as f32;
                for weight in &mut policy {
                    *weight = uniform;
                }
            } else {
                let uniform = 1.0 / valid_count as f32;
                for (idx, flag) in valid.iter().copied().enumerate() {
                    if flag {
                        policy[idx] = uniform;
                    } else {
                        policy[idx] = 0.0;
                    }
                }
            }
        } else {
            for (idx, flag) in valid.iter().copied().enumerate() {
                if flag {
                    policy[idx] /= sum;
                } else {
                    policy[idx] = 0.0;
                }
            }
        }

        Self {
            policy,
            valid,
            visit_count: 0,
            qsa: [0.0; ACTION_SIZE],
            nsa: [0; ACTION_SIZE],
            mean_value: prediction.v,
            terminal_value: None,
            round,
        }
    }

    fn terminal(valid: [bool; ACTION_SIZE], value: f32, round: u16) -> Self {
        Self {
            policy: [0.0; ACTION_SIZE],
            valid,
            visit_count: 0,
            qsa: [0.0; ACTION_SIZE],
            nsa: [0; ACTION_SIZE],
            mean_value: value,
            terminal_value: Some(value),
            round,
        }
    }

    fn select_action(
        &self,
        cpuct: f32,
        fpu: f32,
        forced_playouts: bool,
        iteration: u32,
        coefficient: f32,
    ) -> usize {
        let sqrt_ns = (self.visit_count as f32 + EPS).sqrt();
        let total = (self.visit_count as f32).sqrt();
        let base_fpu = self.mean_value - fpu;
        let mut best = MIN_FLOAT;
        let mut best_action = 0;
        let iter_f = iteration.max(1) as f32;
        for (action, valid_flag) in self.valid.iter().copied().enumerate() {
            if !valid_flag {
                continue;
            }
            if forced_playouts {
                let expected = (coefficient * self.policy[action].max(0.0) * iter_f)
                    .sqrt()
                    .floor() as u32;
                if self.nsa[action] < expected {
                    return action;
                }
            }
            let visits = self.nsa[action];
            let (q, exploration) = if visits == 0 {
                let exploration = cpuct * self.policy[action] * sqrt_ns;
                (base_fpu, exploration)
            } else {
                let exploration = if total > 0.0 {
                    cpuct * self.policy[action] * total / (1.0 + visits as f32)
                } else {
                    0.0
                };
                (self.qsa[action], exploration)
            };
            let u = q + exploration;
            if u > best {
                best = u;
                best_action = action;
            }
        }
        best_action
    }

    fn record_value(&mut self, value: f32) {
        let previous_visits = self.visit_count;
        let weight = (previous_visits + 1) as f32;
        let updated_mean = (self.mean_value * weight + value) / (weight + 1.0);
        self.mean_value = updated_mean;
        self.visit_count = previous_visits + 1;
    }

    fn apply_dirichlet(&mut self, rng: &mut SmallRng, alpha: f32, weight: f32) {
        if weight <= 0.0 || alpha <= 0.0 {
            return;
        }
        let valid_indices: Vec<usize> = self
            .valid
            .iter()
            .enumerate()
            .filter_map(|(i, &flag)| flag.then_some(i))
            .collect();
        if valid_indices.len() < 2 {
            return;
        }
        let alphas = vec![alpha as f64; valid_indices.len()];
        let dirichlet = Dirichlet::new(&alphas).expect("alpha > 0");
        let samples = dirichlet.sample(rng);
        for (value, idx) in samples.iter().zip(valid_indices.iter()) {
            self.policy[*idx] = (1.0 - weight) * self.policy[*idx] + weight * (*value as f32);
        }
        let mut sum = 0.0;
        for (idx, flag) in self.valid.iter().copied().enumerate() {
            if flag {
                sum += self.policy[idx];
            }
        }
        if sum > EPS {
            for (idx, flag) in self.valid.iter().copied().enumerate() {
                if flag {
                    self.policy[idx] /= sum;
                }
            }
        }
    }
}

#[derive(Serialize)]
struct SearchResult {
    version: u8,
    policy: Vec<f32>,
    q: [f32; 2],
    visits: Vec<u32>,
    full_search: bool,
}

#[wasm_bindgen]
pub struct SantoriniMcts {
    config: MctsConfig,
    predictor: js_sys::Function,
    rng: SmallRng,
    nodes: HashMap<[i8; STATE_SIZE], TreeNode>,
    last_cleanup_round: u16,
    board_buffer: Vec<i8>,
    mask_buffer: Vec<u8>,
}

#[wasm_bindgen]
impl SantoriniMcts {
    #[wasm_bindgen(constructor)]
    pub fn new(config: JsValue, predictor: js_sys::Function) -> Result<SantoriniMcts, JsValue> {
        let cfg: MctsConfig = if config.is_undefined() || config.is_null() {
            MctsConfig::default()
        } else {
            serde_wasm_bindgen::from_value(config)?
        };
        Ok(Self {
            config: cfg,
            predictor,
            rng: SmallRng::from_entropy(),
            nodes: HashMap::new(),
            last_cleanup_round: 0,
            board_buffer: vec![0; STATE_SIZE],
            mask_buffer: vec![0; ACTION_SIZE],
        })
    }

    #[wasm_bindgen(js_name = defaultConfig)]
    pub fn default_config() -> JsValue {
        serde_wasm_bindgen::to_value(&MctsConfig::default()).expect("config serialises")
    }

    #[wasm_bindgen(js_name = setSeed)]
    pub fn set_seed(&mut self, seed: u64) {
        self.rng = SmallRng::seed_from_u64(seed);
    }

    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = search)]
    pub async fn search(
        &mut self,
        board_state: Vec<i8>,
        player: u8,
        temperature: f32,
        force_full_search: bool,
    ) -> Result<JsValue, JsValue> {
        if board_state.len() != STATE_SIZE {
            return Err(JsValue::from_str("board state must contain 75 entries"));
        }
        let mut board = BoardState::from_vec(&board_state);
        let root_player = player as usize;
        if root_player != 0 {
            board = board.canonicalised(root_player);
        }

        let mut full_search = force_full_search;
        if !full_search {
            let roll: f32 = self.rng.gen();
            if roll < self.config.prob_full_search {
                full_search = true;
            }
        }
        let mut num_sims = self.config.num_simulations;
        if !full_search {
            num_sims = (num_sims / self.config.partial_divisor.max(1)).max(1);
        }
        let forced_playouts = full_search && self.config.forced_playouts;

        for sim in 0..num_sims {
            let inject_dirichlet = sim == 0 && full_search && self.config.dirichlet_weight > 0.0;
            self.run_single_simulation(&board, inject_dirichlet, sim + 1, forced_playouts)
                .await?;
        }

        if !self.config.no_mem_optim {
            self.maybe_cleanup(board.round());
        }

        let key = board.key();
        let (valid, policy_prior, edge_visits, q) = {
            let node_ref = self
                .nodes
                .get(&key)
                .ok_or_else(|| JsValue::from_str("root node missing after simulations"))?;
            (
                node_ref.valid,
                node_ref.policy,
                node_ref.nsa,
                node_ref.mean_value,
            )
        };

        let (policy, visits) = self.root_distribution(
            &valid,
            &policy_prior,
            &edge_visits,
            temperature,
            forced_playouts,
            num_sims,
        );
        let green_value = if root_player == 0 { q } else { -q };
        let result = SearchResult {
            version: SEARCH_RESULT_VERSION,
            policy,
            q: [green_value, -green_value],
            visits,
            full_search,
        };
        serde_wasm_bindgen::to_value(&result).map_err(JsValue::from)
    }
}

impl SantoriniMcts {
    async fn run_single_simulation(
        &mut self,
        root: &BoardState,
        apply_dirichlet: bool,
        iteration: u32,
        forced_playouts: bool,
    ) -> Result<f32, JsValue> {
        let mut board = *root;
        let mut to_root_sign = 1.0f32;
        let mut breadcrumbs: Vec<([i8; STATE_SIZE], usize, bool)> = Vec::with_capacity(32);

        loop {
            let key = board.key();
            if let Some(node) = self.nodes.get_mut(&key) {
                if apply_dirichlet && breadcrumbs.is_empty() {
                    node.apply_dirichlet(
                        &mut self.rng,
                        self.config.dirichlet_alpha,
                        self.config.dirichlet_weight,
                    );
                }
                if let Some(result) = node.terminal_value {
                    self.backpropagate(&breadcrumbs, result);
                    return Ok(result * to_root_sign);
                }
                let action = node.select_action(
                    self.config.cpuct,
                    self.config.fpu_reduction,
                    forced_playouts,
                    iteration,
                    self.config.forced_playout_coefficient,
                );
                let next_player = board.make_move(action, 0);
                // When `next_player == 1` we flipped perspective to keep the canonical player always 0.
                breadcrumbs.push((key, action, next_player == 1));
                if next_player == 1 {
                    to_root_sign = -to_root_sign;
                }
                board = board.canonicalised(next_player);
                continue;
            }

            let mut valid = [false; ACTION_SIZE];
            board.valid_moves(0, &mut valid);
            if let Some(terminal) = board.result_value(0) {
                let node = TreeNode::terminal(valid, terminal, board.round());
                self.nodes.insert(key, node);
                self.backpropagate(&breadcrumbs, terminal);
                return Ok(terminal * to_root_sign);
            }

            let prediction = self.evaluate(&board, &valid).await?;
            let node = TreeNode::from_prediction(valid, &prediction, board.round());
            let leaf_value = node.mean_value;
            self.nodes.insert(key, node);
            self.backpropagate(&breadcrumbs, leaf_value);
            return Ok(leaf_value * to_root_sign);
        }
    }

    async fn evaluate(
        &mut self,
        board: &BoardState,
        valid: &[bool; ACTION_SIZE],
    ) -> Result<NetworkPrediction, JsValue> {
        board.write_into_slice(&mut self.board_buffer);
        for (idx, flag) in valid.iter().enumerate() {
            self.mask_buffer[idx] = u8::from(*flag);
        }

        let value = {
            let board_array = unsafe { js_sys::Int8Array::view(&self.board_buffer) };
            let mask_array = unsafe { js_sys::Uint8Array::view(&self.mask_buffer) };
            let board_js = JsValue::from(board_array);
            let mask_js = JsValue::from(mask_array);

            self.predictor
                .call2(&JsValue::NULL, &board_js, &mask_js)
                .map_err(|err| JsValue::from(err))?
        };
        let promise = js_sys::Promise::from(value);
        let prediction_value = JsFuture::from(promise).await?;
        let prediction: NetworkPrediction = serde_wasm_bindgen::from_value(prediction_value)?;

        if prediction.pi.len() < ACTION_SIZE {
            return Err(JsValue::from_str(
                "predictor returned fewer than 162 policy entries",
            ));
        }
        Ok(prediction)
    }

    fn backpropagate(&mut self, path: &[([i8; STATE_SIZE], usize, bool)], mut value: f32) {
        for (key, action, flipped) in path.iter().rev() {
            if *flipped {
                value = -value;
            }
            if let Some(node) = self.nodes.get_mut(key) {
                node.record_value(value);

                let edge_visits = &mut node.nsa[*action];
                *edge_visits += 1;
                let edge_visits_f = *edge_visits as f32;
                let edge_value = &mut node.qsa[*action];
                *edge_value += (value - *edge_value) / edge_visits_f;
            }
        }
    }

    fn maybe_cleanup(&mut self, current_round: u16) {
        if self.config.no_mem_optim {
            return;
        }
        if current_round <= self.last_cleanup_round + self.config.cleanup_interval {
            return;
        }
        let threshold = current_round.saturating_sub(self.config.retain_rounds);
        self.nodes.retain(|_, node| node.round >= threshold);
        self.last_cleanup_round = current_round;
    }

    fn root_distribution(
        &mut self,
        valid: &[bool; ACTION_SIZE],
        policy: &[f32; ACTION_SIZE],
        visits: &[u32; ACTION_SIZE],
        temperature: f32,
        forced_playouts: bool,
        num_sims: u32,
    ) -> (Vec<f32>, Vec<u32>) {
        let mut counts: Vec<f32> = visits.iter().map(|&count| count as f32).collect();
        for (idx, flag) in valid.iter().enumerate() {
            if !flag {
                counts[idx] = 0.0;
            }
        }

        if forced_playouts {
            let best_visit = visits
                .iter()
                .zip(valid.iter())
                .filter(|(_, &flag)| flag)
                .map(|(&count, _)| count)
                .max()
                .unwrap_or(0);
            if best_visit > 0 {
                for idx in 0..ACTION_SIZE {
                    if !valid[idx] {
                        continue;
                    }
                    if visits[idx] == best_visit {
                        counts[idx] = best_visit as f32;
                        continue;
                    }
                    let expected = (self.config.forced_playout_coefficient
                        * policy[idx].max(0.0)
                        * num_sims as f32)
                        .sqrt()
                        .floor() as u32;
                    let adjusted = visits[idx].saturating_sub(expected);
                    counts[idx] = if adjusted > 1 { adjusted as f32 } else { 0.0 };
                }
            }
        }

        let mut policy_vec = vec![0.0f32; ACTION_SIZE];
        if temperature == 0.0 {
            let mut best_value = -1.0f32;
            let mut ties: Vec<usize> = Vec::new();
            for (idx, (&count, &flag)) in counts.iter().zip(valid.iter()).enumerate() {
                if !flag {
                    continue;
                }
                if count > best_value + EPS {
                    best_value = count;
                    ties.clear();
                    ties.push(idx);
                } else if (count - best_value).abs() <= EPS {
                    ties.push(idx);
                }
            }
            let selected = if !ties.is_empty() {
                let choice = self.rng.gen_range(0..ties.len());
                ties[choice]
            } else {
                valid.iter().position(|&flag| flag).unwrap_or(0)
            };
            policy_vec[selected] = 1.0;
        } else {
            let temp = temperature.max(0.01);
            let mut total = 0.0f32;
            for (idx, (&count, &flag)) in counts.iter().zip(valid.iter()).enumerate() {
                if !flag || count <= 0.0 {
                    continue;
                }
                let weighted = count.powf(1.0 / temp);
                policy_vec[idx] = weighted;
                total += weighted;
            }
            if total > EPS {
                for (idx, &flag) in valid.iter().enumerate() {
                    if flag {
                        policy_vec[idx] /= total;
                    }
                }
            } else {
                let valid_count = valid.iter().filter(|flag| **flag).count();
                if valid_count > 0 {
                    let uniform = 1.0 / valid_count as f32;
                    for (idx, &flag) in valid.iter().enumerate() {
                        if flag {
                            policy_vec[idx] = uniform;
                        }
                    }
                }
            }
        }

        let visits_vec = visits
            .iter()
            .zip(valid.iter())
            .map(|(&count, &flag)| if flag { count } else { 0 })
            .collect();

        (policy_vec, visits_vec)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_value_matches_legacy_average() {
        let mut node = TreeNode {
            policy: [0.0; ACTION_SIZE],
            valid: [false; ACTION_SIZE],
            visit_count: 0,
            qsa: [0.0; ACTION_SIZE],
            nsa: [0; ACTION_SIZE],
            mean_value: 0.2,
            terminal_value: None,
            round: 0,
        };

        node.record_value(0.4);
        assert!((node.mean_value - 0.3).abs() < 1e-6);
        assert_eq!(node.visit_count, 1);

        node.record_value(-0.1);
        let expected = (0.2 + 0.4 - 0.1) / 3.0;
        assert!((node.mean_value - expected).abs() < 1e-6);
        assert_eq!(node.visit_count, 2);
    }

    #[test]
    fn default_config_has_no_dirichlet_noise() {
        let cfg = MctsConfig::default();
        assert_eq!(cfg.dirichlet_weight, 0.0);
    }
}
