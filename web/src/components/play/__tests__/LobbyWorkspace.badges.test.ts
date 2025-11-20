import { describe, expect, it } from 'vitest';
import { buildMatchSettingsBadges } from '../LobbyWorkspace';
import type { LobbyMatch } from '@hooks/useMatchLobby';
import { getMatchAiDepth, isAiMatch } from '@/utils/matchAiDepth';
import type { SantoriniStateSnapshot } from '@/types/match';

const makeSnapshot = (metadata?: SantoriniStateSnapshot['metadata']): SantoriniStateSnapshot => ({
  version: 1,
  player: 0,
  board: Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => [0, 0, 0]),
  ),
  history: [],
  future: [],
  gameEnded: [0, 0],
  validMoves: Array(25).fill(false),
  metadata,
});

const baseMatch: LobbyMatch = {
  id: 'match-1',
  creator_id: 'creator',
  opponent_id: null,
  visibility: 'public',
  rated: true,
  private_join_code: null,
  status: 'waiting_for_opponent',
  winner_id: null,
  rematch_parent_id: null,
  clock_initial_seconds: 600,
  clock_increment_seconds: 5,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  initial_state: makeSnapshot(),
  is_ai_match: false,
  ai_depth: null,
};

describe('buildMatchSettingsBadges', () => {
  it('omits AI badge for human matches', () => {
    const badges = buildMatchSettingsBadges(baseMatch);
    const labels = badges.map((b) => b.label);
    expect(labels).toContain('Rated');
    expect(labels.find((label) => typeof label === 'string' && label.toString().startsWith('AI depth'))).toBeUndefined();
  });

  it('includes AI depth when flagged as ai match', () => {
    const badges = buildMatchSettingsBadges({
      ...baseMatch,
      visibility: 'private',
      rated: false,
      clock_initial_seconds: 0,
      clock_increment_seconds: 0,
      is_ai_match: true,
      ai_depth: 300,
    });
    const aiBadge = badges.find((b) => typeof b.label === 'string' && b.label.toString().startsWith('AI depth'));
    expect(aiBadge?.label).toBe('AI depth 300');
  });

  it('derives depth from snapshot metadata when ai_depth is missing', () => {
    const match: LobbyMatch = {
      ...baseMatch,
      // Simulate legacy records that only stored metadata depth
      is_ai_match: undefined as unknown as boolean,
      ai_depth: null,
      visibility: 'private',
      rated: false,
      clock_initial_seconds: 0,
      clock_increment_seconds: 0,
      initial_state: makeSnapshot({ aiDepth: 150 }),
    };
    expect(isAiMatch(match)).toBe(true);
    expect(getMatchAiDepth(match)).toBe(150);
    const badges = buildMatchSettingsBadges(match);
    const aiBadge = badges.find((b) => typeof b.label === 'string' && b.label.toString().startsWith('AI depth'));
    expect(aiBadge?.label).toBe('AI depth 150');
  });
});
