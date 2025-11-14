export type MatchVisibility = 'public' | 'private';
export type MatchStatus = 'waiting_for_opponent' | 'in_progress' | 'completed' | 'abandoned';

export interface SantoriniStateSnapshot {
  version: number;
  player: number;
  board: number[][][];
  history: unknown[];
  future: unknown[];
  gameEnded: [number, number];
  validMoves: boolean[];
}

export type EnginePreference = 'python' | 'rust';

export interface PlayerProfile {
  id: string;
  auth_user_id: string | null;
  display_name: string;
  avatar_url: string | null;
  rating: number;
  games_played: number;
  created_at: string;
  updated_at: string;
  engine_preference: EnginePreference;
  show_coordinate_labels: boolean;
}

export interface MatchRecord {
  id: string;
  creator_id: string;
  opponent_id: string | null;
  visibility: MatchVisibility;
  rated: boolean;
  private_join_code: string | null;
  clock_initial_seconds: number;
  clock_increment_seconds: number;
  status: MatchStatus;
  winner_id: string | null;
  rematch_parent_id: string | null;
  is_ai_match: boolean;
  ai_depth: number | null;
  created_at: string;
  updated_at?: string;
  clock_updated_at?: string | null;
  initial_state: SantoriniStateSnapshot;
}

export interface MatchMoveRecord<TAction = unknown> {
  id: string;
  match_id: string;
  move_index: number;
  player_id: string;
  action: TAction;
  state_snapshot: SantoriniStateSnapshot | null;
  eval_snapshot: unknown;
  created_at: string;
}

export type SantoriniMoveAction = {
  kind: 'santorini.move';
  move: number;
  by: 'creator' | 'opponent';
  clocks?: {
    creatorMs: number;
    opponentMs: number;
  };
};

export type RematchOfferAction = {
  kind: 'rematch.offer';
  offeredBy: string;
  newMatchId: string;
};

export type UndoRequestAction = {
  kind: 'undo.request';
  by: 'creator' | 'opponent';
  moveIndex: number;
  createdAt?: string;
};

export type UndoResponseAction = {
  kind: 'undo.response';
  by: 'creator' | 'opponent';
  accepted: boolean;
  moveIndex: number;
};

export type AbortRequestAction = {
  kind: 'abort.request';
  by: 'creator' | 'opponent';
  createdAt?: string;
};

export type AbortResponseAction = {
  kind: 'abort.response';
  by: 'creator' | 'opponent';
  accepted: boolean;
};

export interface AbortRequestRecord {
  id: string;
  match_id: string;
  requested_by: string;
  requested_at: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  responded_by: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}

export type MatchAction =
  | SantoriniMoveAction
  | RematchOfferAction
  | UndoRequestAction
  | UndoResponseAction
  | AbortRequestAction
  | AbortResponseAction
  | Record<string, unknown>;
