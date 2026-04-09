-- Add unique constraint to prevent duplicate moves in a match.
-- This closes a race condition where concurrent move submissions could
-- both succeed for the same move_index.

ALTER TABLE public.match_moves
  ADD CONSTRAINT match_moves_match_id_move_index_unique
  UNIQUE (match_id, move_index);
