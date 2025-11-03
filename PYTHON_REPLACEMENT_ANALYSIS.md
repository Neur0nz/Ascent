# Python Replacement Analysis

## Current State

### What Python/Pyodide is Used For

Python is **only** used for **AI features** via Pyodide (Python running in the browser via WebAssembly):

1. **MCTS (Monte Carlo Tree Search)** - The AI algorithm that:
   - Uses the ONNX neural network model to evaluate positions
   - Performs tree search simulations to find the best move
   - Located in: `web/src/assets/santorini/MCTS.py` (~243 lines)

2. **ONNX Model Inference** - Running the neural network (`model_no_god.onnx`) to:
   - Evaluate game positions
   - Provide move probabilities
   - Used by MCTS for decision-making

3. **AI Move Calculation** - Functions like:
   - `guessBestAction()` - Chooses the best move using MCTS
   - `calculate_eval_for_current_position()` - Evaluates current position
   - `list_current_moves_with_adv()` - Lists moves with advantages

### What TypeScript Already Does

The TypeScript engine (`shared/santoriniEngine.ts`) is **complete** for:
- ✅ Game logic (move validation, state management)
- ✅ Online games (server validates with TypeScript too)
- ✅ Local human vs human games
- ✅ Move encoding/decoding
- ✅ Placement logic
- ✅ History/undo/redo

**Python is NOT needed for:**
- Game rules validation
- Move validation
- Online gameplay
- Local human vs human games

## Can Python Be Replaced?

### ✅ **YES, but requires work**

### What's Already Available

1. **ONNX Runtime Web** - Already loaded! (`VITE_ONNX_URL`)
   - The TypeScript code already sets up `onnxSessionPromise` 
   - Can run the same `model_no_god.onnx` model in TypeScript

2. **Complete TypeScript Game Engine** - `shared/santoriniEngine.ts`
   - All game logic is implemented
   - Can generate valid moves, validate moves, manage state

### What Needs to Be Implemented

#### 1. Port MCTS to TypeScript (~300-400 lines)

The `MCTS.py` class needs to be ported to TypeScript. Key components:
- Tree search algorithm (selection, expansion, simulation, backpropagation)
- Node data structure (game states, visit counts, Q-values)
- Integration with ONNX model for position evaluation
- Dirichlet noise for exploration
- Policy target pruning

**Complexity:** Medium - The algorithm is well-defined, but requires careful porting of NumPy operations.

#### 2. Integrate ONNX Runtime Web (Already Started)

The code already loads ONNX Runtime Web. You need to:
- Create TypeScript wrapper for model inference
- Convert game state to model input format
- Parse model output (probabilities and value)

**Complexity:** Low - Most infrastructure exists

#### 3. Replace Python Bridge Functions

Replace calls like:
```typescript
game.py.guessBestAction()
game.py.calculate_eval_for_current_position()
```

With TypeScript equivalents:
```typescript
mcts.guessBestAction(engine)
mcts.calculateEval(engine)
```

**Complexity:** Low - Just routing changes

## Benefits of Replacing Python

### Pros ✅

1. **Faster Startup** - No Pyodide download (~1MB+ Python runtime)
2. **Smaller Bundle** - Remove Pyodide dependency
3. **Better Performance** - Native TypeScript is faster than WASM
4. **Easier Debugging** - No Python/TypeScript bridge complexity
5. **Simpler Architecture** - Single language stack
6. **Better Type Safety** - Full TypeScript coverage
7. **No Runtime Fetching** - Python files won't need to be fetched at runtime

### Cons ❌

1. **Development Time** - ~1-2 weeks to port MCTS properly
2. **Testing Burden** - Need to verify AI plays identically
3. **Potential Bugs** - Porting always introduces risk

## Recommended Approach

### Option 1: Full Replacement (Recommended)

**Timeline:** 1-2 weeks

1. Port `MCTS.py` to TypeScript (`src/lib/mcts.ts`)
2. Create ONNX wrapper (`src/lib/onnxEvaluator.ts`)
3. Replace Python calls in `useSantorini.tsx`
4. Remove Pyodide dependencies
5. Test AI behavior matches Python version

**Effort:** Medium
**Risk:** Low (can test side-by-side)

### Option 2: Gradual Migration

1. Keep Python for AI, but add TypeScript MCTS option
2. Feature flag to switch between Python/TypeScript AI
3. Test TypeScript AI in parallel
4. Switch default once validated

**Effort:** Medium-High
**Risk:** Very Low (fallback available)

### Option 3: Keep Python (Current State)

If AI features work well and bundle size/startup time aren't issues:
- Keep current architecture
- Focus on other technical debt items

**Effort:** None
**Risk:** None

## Technical Debt Context

From `TECHNICAL_DEBT.md`:
- Pyodide loading is fragile (no integrity checks, re-fetches on every load)
- Python files fetched at runtime (~1MB+)
- Complex bridge between Python and TypeScript
- Hard to test (no unit tests for Pyodide orchestration)

**Replacing Python would address these issues.**

## Conclusion

**Yes, Python can and should be replaced** for:
- Better performance
- Simpler architecture  
- Easier maintenance
- Better developer experience

**The main blocker is porting the MCTS algorithm**, which is straightforward but requires careful attention to detail.

**Recommendation:** Proceed with Option 1 (Full Replacement) if:
- AI features are critical
- You want better performance
- You have 1-2 weeks for the migration

**Otherwise:** Keep Python for now and focus on other technical debt.

