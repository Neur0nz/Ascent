import type { LobbyMatch, MatchRecord } from '@/types/match';

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
