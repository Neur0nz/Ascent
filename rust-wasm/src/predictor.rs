use serde::Deserialize;

/// Shape of the object resolved by the JavaScript/TypeScript predictor Promise.
#[derive(Debug, Deserialize)]
pub struct NetworkPrediction {
    /// Log-probabilities or raw policy scores for each of the 162 actions.
    pub pi: Vec<f32>,
    /// Scalar evaluation in [-1.0, 1.0] from the perspective of the side-to-move.
    pub v: f32,
}
