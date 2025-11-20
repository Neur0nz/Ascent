import type { LobbyMatch } from '@hooks/useMatchLobby';
import type { PlayerProfile } from '@/types/match';
import { getMatchAiDepth, isAiMatch } from '@/utils/matchAiDepth';

export function describeMatch(match: LobbyMatch, profile: PlayerProfile | null): string {
  if (match.status === 'waiting_for_opponent') {
    return 'Waiting for an opponent';
  }
  if (isAiMatch(match)) {
    const depth = getMatchAiDepth(match);
    const depthLabel = depth ? ` (depth ${depth})` : '';
    return `You vs AI${depthLabel}`;
  }
  const isCreator = profile ? match.creator_id === profile.id : false;
  if (isCreator) {
    const opponentName = match.opponent?.display_name ?? 'Unknown opponent';
    return `You vs ${opponentName}`;
  }
  if (profile && match.opponent_id === profile.id) {
    const creatorName = match.creator?.display_name ?? 'Unknown opponent';
    return `${creatorName} vs You`;
  }
  const creatorName = match.creator?.display_name ?? 'Player 1';
  const opponentName = match.opponent?.display_name ?? 'Player 2';
  return `${creatorName} vs ${opponentName}`;
}
