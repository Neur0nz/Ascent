import type { LobbyMatch, MatchRecord } from '@/types/match';

const DEFAULT_AI_PLAYER_ID = '00000000-0000-0000-0000-00000000a11a';

export const getMatchAiDepth = (
  match?: Pick<MatchRecord, 'ai_depth' | 'initial_state'> | LobbyMatch | null,
): number | null => {
  if (!match) return null;
  if (typeof match.ai_depth === 'number') {
    return match.ai_depth;
  }
  const metadataDepth = match.initial_state?.metadata?.aiDepth;
  return typeof metadataDepth === 'number' ? metadataDepth : null;
};

export const isAiMatch = (
  match?: Partial<Pick<MatchRecord, 'is_ai_match' | 'opponent_id' | 'initial_state'>> | LobbyMatch | null,
): boolean => {
  if (!match) return false;
  if (typeof match.is_ai_match === 'boolean') {
    return match.is_ai_match;
  }
  const metadataDepth = match.initial_state?.metadata?.aiDepth;
  if (typeof metadataDepth === 'number') {
    return true;
  }
  if (match.opponent_id) {
    return match.opponent_id === DEFAULT_AI_PLAYER_ID;
  }
  return false;
};
