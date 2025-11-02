<!-- 2e6444ec-f427-46cf-b774-f46b5ffd3fa9 4ce709b1-b860-41c6-8247-fe66442de1c0 -->
# Game Improvements and Bug Fixes - Complete Plan

## Implementation Plan

### 1. Eval Graph in Analyze Tab

**What this task does:** Adds a button in the analyze tab that calculates the neural network evaluation score for each move in the game and displays a graph showing how the evaluation (player advantage) changes throughout the game.

**Approach:** Use existing evaluation infrastructure from `useSantorini` hook. Add charting library (recharts recommended).

**Implementation:**

- Add `recharts` dependency to `package.json`
- Create evaluation calculation function that replays game and captures eval at each move
- Use Chakra UI `Box` component to wrap chart for consistent styling
- Add button in `AnalyzeWorkspace.tsx` card header area

**Files:** `web/src/components/analyze/AnalyzeWorkspace.tsx`, `web/package.json`

### 2. Emoji Reactions System  

**What this task does:** Adds an emoji picker (similar to Clash Royale) that allows players to send emojis to each other during a game. Emojis appear above the sender's avatar with a floating animation.

**Approach:** Use Chakra UI v2.8.1 `Popover` and Supabase realtime broadcast. **NO backend changes needed.**

**Implementation:**

- Create `EmojiPicker.tsx` using Chakra UI v2 `Popover` with 7 emojis: 😀 👍 ❤️ 🔥 💪 😮 👏
- Broadcast via `channel.send({ type: 'broadcast', event: 'emoji', payload: { emoji, player_id, timestamp } })`
- Listen in match channel subscription for `'emoji'` event (around line 880)
- Store emoji state only in React state (in-memory, not database)
- Use `framer-motion` for floating animations

**Emoji Display:**

- **Location**: Above player's avatar in `PlayerClockCard` component (absolute positioned relative to card)
- **Duration**: 2.5 seconds (fade in 0.2s, visible 2s, fade out 0.3s)
- **Animation**: Float upward ~60-80px, fade to opacity 0, slight scale bounce (1.2x → 1.0x)
- **Stacking**: Multiple emojis with horizontal offset
- **Note**: Mobile scrolling edge case handled later if needed

**Files:**

- New: `web/src/components/EmojiPicker.tsx`
- Modify: `web/src/hooks/useMatchLobby.ts`, `web/src/components/play/GamePlayWorkspace.tsx`

### 3. Analyze Button Navigation

**What this task does:** Makes the "Review in Analyze" button (shown next to rematch button at end of games) actually navigate to the analyze tab and automatically load the correct game for analysis.

**Approach:** Pass navigation callback from App.tsx. AnalyzeWorkspace already auto-loads from localStorage.

**Implementation:**

- Add `onNavigateToAnalyze` prop to `GamePlayWorkspace` from `App.tsx`
- Update `handlePrepareAnalyze` to call navigation callback after storing matchId
- Verify `AnalyzeWorkspace` useEffect (line 63) loads from localStorage on mount

**Files:** `web/src/App.tsx`, `web/src/components/play/GamePlayWorkspace.tsx`

### 4. Implement Increment Seconds

**What this task does:** Ensures the increment seconds feature in time controls actually works - when a player makes a move, they should receive the increment time added to their clock.

**Approach:** Server already computes increment correctly. Client needs to sync clocks from server.

**Implementation:**

- Server increment logic in `submit-move/index.ts` lines 223-230 is correct
- Client should use `action.clocks` from server when available (includes increment)
- Fix clock sync in `useOnlineSantorini.ts` to prefer server clocks over local calculation

**Files:** `web/src/hooks/useOnlineSantorini.ts`

### 5. Prevent Joining Own Game

**What this task does:** Prevents a user from joining their own game in the lobby (when someone creates a public game and tries to join it themselves).

**Approach:** Add check before status validation in `joinMatch` function.

**Implementation:**

- After finding `targetMatch` (line 1506), check if `profile.id === targetMatch.creator_id`
- Throw error: "You cannot join your own game" if match found

**Files:** `web/src/hooks/useMatchLobby.ts`

### 6. Fix Game State Propagation After End

**What this task does:** Fixes an issue where after a game ends, when the user goes to the play tab they still see that they have an active game, blocking them from creating new games.

**Approach:** Ensure realtime subscription clears activeMatchId when status changes.

**Implementation:**

- Update realtime subscription handler in `useMatchLobby.ts` to:
- Clear `activeMatchId` when match status becomes 'completed' or 'abandoned'
- Remove from `myMatches` array (filter out non-tracked statuses)
- Clear localStorage `ACTIVE_MATCH_STORAGE_KEY`

**Files:** `web/src/hooks/useMatchLobby.ts`, `web/src/components/play/GamePlayWorkspace.tsx`

### 7. Fix Undo to Revert to Requester's Last Move

**What this task does:** Fixes undo behavior so that when a player requests undo and it's accepted, it reverts to the position before the requester's last move (reverting both the requester's move and the opponent's subsequent move), not just the last move overall.

**Approach:** Find the last move made by the player requesting undo, not just the last move overall.

**Implementation:**

- In `requestUndo` function, filter moves where `action.by === role` (requester's role)
- Get highest `move_index` from filtered moves
- Use that as `targetIndex` instead of `state.moves.length - 1`

**Files:** `web/src/hooks/useMatchLobby.ts` (line 1975 area)

### 8. Fix Resigned and Timeout Games to Count as Completed Losses

**What this task does:** Ensures that when a player resigns (clicks resign button) or times out (clock runs to zero), the game counts as completed with the resigner/timer losing. These games should appear in the analyze tab and show the completion screen.

**Current State:**

- Timeouts already use 'completed' status (via `onGameComplete('completed')` in `useOnlineSantorini.ts` line 881/888) ✓
- Resignations currently use 'abandoned' status (line 1666 in `useMatchLobby.ts`) ✗

**Implementation:**

- Update `leaveMatch` function in `useMatchLobby.ts` (line 1666): change `status: 'abandoned'` to `status: 'completed'` when user clicks resign button
- Keep `'abandoned'` status only for actual abandonments (no opponent joined, etc.)
- Resigned and timeout games will automatically appear in analyze tab and show completion screen

**Files:** `web/src/hooks/useMatchLobby.ts`

### 9. Fix Fast Placement Rejection Issue

**What this task does:** Fixes a bug where during the placement phase at the start of the game, if a player places both workers too quickly in succession, the second placement gets rejected by the server even though it should be valid.

**Root Cause:** Race condition - server hasn't processed first placement when second arrives, so second sees stale game state.

**Approach:** Fix optimistic sync or server-side handling to maintain fast placement speed.

**Implementation Options:**

- **Option B - Server-side:** Handle rapid placements more gracefully, ensure sequential processing
- **Option C - Optimistic sync:** Ensure engine state updates synchronously after first placement before sending second

**Recommendation:** Focus on Option C (optimistic sync fix) - ensure client-side engine state properly reflects first placement before sending second. Avoid client-side blocking as it slows placement phase.

**Files to investigate:**

- `web/src/hooks/useOnlineSantorini.ts` (placement move submission and state sync)
- `web/src/hooks/useMatchLobby.ts` (move submission and optimistic updates)
- `supabase/functions/submit-move/index.ts` (server placement validation)
- `web/src/lib/santoriniEngine.ts` (placement context handling)

### To-dos

- [ ] Add eval graph button and calculation in analyze tab using charting library
- [ ] Implement emoji picker and broadcast system with floating animations
- [ ] Make analyze button navigate to analyze tab and auto-load match
- [ ] Verify and fix increment seconds implementation in time controls
- [ ] Verify and fix random start player selection
- [ ] Add check to prevent users from joining their own games
- [ ] Fix game state propagation after game ends to clear active match
- [ ] Research Android notification support and document findings
- [ ] Fix undo to revert to requester last move position instead of just last move
- [ ] Fix resigned games to show completion screen and appear in analyze tab