import type { SupabaseClient } from '@/lib/supabaseClient';
import type { MatchMoveRecord, MatchRecord, SantoriniMoveAction } from '@/types/match';

export interface MatchWithMoves {
  match: MatchRecord;
  moves: MatchMoveRecord<SantoriniMoveAction>[];
}

export const MIN_EVAL_MOVE_INDEX = 3;

export async function fetchMatchWithMoves(client: SupabaseClient, matchId: string): Promise<MatchWithMoves> {
  const trimmedId = matchId.trim();
  if (!trimmedId) {
    throw new Error('Match ID is required.');
  }

  const [{ data: matchData, error: matchError }, { data: movesData, error: movesError }] = await Promise.all([
    client.from('matches').select('*').eq('id', trimmedId).maybeSingle(),
    client.from('match_moves').select('*').eq('match_id', trimmedId).order('move_index', { ascending: true }),
  ]);

  if (matchError) {
    throw matchError;
  }
  if (!matchData) {
    throw new Error('Match not found.');
  }
  if (movesError) {
    throw movesError;
  }

  const typedMoves: MatchMoveRecord<SantoriniMoveAction>[] = (movesData ?? []).map((move) => ({
    ...move,
    action: move.action as SantoriniMoveAction,
  }));

  return {
    match: matchData as MatchRecord,
    moves: typedMoves,
  };
}
