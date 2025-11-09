import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { PlayerProfile } from '@/types/match';

export type LeaderboardSource = 'live' | 'sample';

export type LeaderboardEntry = PlayerProfile & {
  rank: number;
};

interface UseLeaderboardState {
  entries: LeaderboardEntry[];
  loading: boolean;
  error: string | null;
  source: LeaderboardSource;
  lastUpdated: string | null;
}

const FALLBACK_PROFILES: PlayerProfile[] = [
  {
    id: 'sample-athena',
    auth_user_id: null,
    avatar_url: null,
    display_name: 'AthenaMind',
    rating: 2145,
    games_played: 428,
    created_at: '2024-01-04T10:00:00.000Z',
    updated_at: '2024-04-15T08:00:00.000Z',
    engine_preference: 'python',
  },
  {
    id: 'sample-minos',
    auth_user_id: null,
    avatar_url: null,
    display_name: 'MinosRampart',
    rating: 2098,
    games_played: 389,
    created_at: '2024-02-11T13:00:00.000Z',
    updated_at: '2024-04-12T17:45:00.000Z',
    engine_preference: 'python',
  },
  {
    id: 'sample-icarus',
    auth_user_id: null,
    avatar_url: null,
    display_name: 'IcarusFlight',
    rating: 2050,
    games_played: 312,
    created_at: '2024-01-18T09:15:00.000Z',
    updated_at: '2024-04-14T22:30:00.000Z',
    engine_preference: 'python',
  },
  {
    id: 'sample-nike',
    auth_user_id: null,
    avatar_url: null,
    display_name: 'NikeRush',
    rating: 2027,
    games_played: 280,
    created_at: '2023-12-28T19:20:00.000Z',
    updated_at: '2024-04-10T14:40:00.000Z',
    engine_preference: 'python',
  },
  {
    id: 'sample-dionysus',
    auth_user_id: null,
    avatar_url: null,
    display_name: 'DionysusDance',
    rating: 1992,
    games_played: 365,
    created_at: '2024-03-01T11:05:00.000Z',
    updated_at: '2024-04-16T09:12:00.000Z',
    engine_preference: 'python',
  },
  {
    id: 'sample-hera',
    auth_user_id: null,
    avatar_url: null,
    display_name: 'HeraSentinel',
    rating: 1978,
    games_played: 294,
    created_at: '2024-02-03T21:30:00.000Z',
    updated_at: '2024-04-18T07:50:00.000Z',
    engine_preference: 'python',
  },
  {
    id: 'sample-orion',
    auth_user_id: null,
    avatar_url: null,
    display_name: 'OrionBuild',
    rating: 1944,
    games_played: 256,
    created_at: '2024-01-22T06:45:00.000Z',
    updated_at: '2024-04-17T12:25:00.000Z',
    engine_preference: 'python',
  },
  {
    id: 'sample-hera2',
    auth_user_id: null,
    avatar_url: null,
    display_name: 'PoseidonWake',
    rating: 1910,
    games_played: 230,
    created_at: '2024-03-07T16:05:00.000Z',
    updated_at: '2024-04-17T18:05:00.000Z',
    engine_preference: 'python',
  },
  {
    id: 'sample-colossus',
    auth_user_id: null,
    avatar_url: null,
    display_name: 'ColossusClimb',
    rating: 1888,
    games_played: 215,
    created_at: '2024-01-30T14:12:00.000Z',
    updated_at: '2024-04-13T20:35:00.000Z',
    engine_preference: 'python',
  },
  {
    id: 'sample-hestia',
    auth_user_id: null,
    avatar_url: null,
    display_name: 'HestiaForge',
    rating: 1856,
    games_played: 198,
    created_at: '2024-02-14T09:45:00.000Z',
    updated_at: '2024-04-11T11:55:00.000Z',
    engine_preference: 'python',
  },
] as const;

function buildEntries(profiles: PlayerProfile[], limit: number): LeaderboardEntry[] {
  return [...profiles]
    .sort((a, b) => b.rating - a.rating)
    .slice(0, limit)
    .map((profile, index) => ({
      ...profile,
      rank: index + 1,
    }));
}

const FALLBACK_ENTRIES = buildEntries(FALLBACK_PROFILES, FALLBACK_PROFILES.length);

export function useLeaderboard(limit = 20) {
  const [state, setState] = useState<UseLeaderboardState>({
    entries: [],
    loading: true,
    error: null,
    source: 'live',
    lastUpdated: null,
  });
  const cancelRef = useRef(false);

  const fallbackEntries = useMemo(() => buildEntries(FALLBACK_PROFILES, Math.min(limit, FALLBACK_ENTRIES.length)), [limit]);

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      if (!supabase) {
        setState({
          entries: fallbackEntries,
          loading: false,
          error: 'Live leaderboard unavailable — showing sample data.',
          source: 'sample',
          lastUpdated: null,
        });
        return;
      }

      const { data, error } = await supabase
        .from('players')
        .select('id, auth_user_id, display_name, avatar_url, rating, games_played, created_at, updated_at, engine_preference')
        .order('rating', { ascending: false })
        .limit(limit);

      if (cancelRef.current) {
        return;
      }

      if (error) {
        throw error;
      }

      const records = (data ?? []) as PlayerProfile[];
      if (!records.length) {
        setState({
          entries: fallbackEntries,
          loading: false,
          error: 'No rated games found yet. Play a rated match to seed the leaderboard.',
          source: 'sample',
          lastUpdated: null,
        });
        return;
      }

      const entries = buildEntries(records, limit);
      const mostRecent = entries.reduce<string | null>((latest, entry) => {
        if (!entry.updated_at) return latest;
        if (!latest) return entry.updated_at;
        return entry.updated_at > latest ? entry.updated_at : latest;
      }, null);

      setState({
        entries,
        loading: false,
        error: null,
        source: 'live',
        lastUpdated: mostRecent,
      });
    } catch (error) {
      if (cancelRef.current) {
        return;
      }
      setState({
        entries: fallbackEntries,
        loading: false,
        error: error instanceof Error ? error.message : 'Unable to load leaderboard.',
        source: 'sample',
        lastUpdated: null,
      });
    }
  }, [fallbackEntries, limit]);

  useEffect(() => {
    cancelRef.current = false;
    refresh().catch((error) => {
      // eslint-disable-next-line no-console
      console.error('Failed to refresh leaderboard', error);
    });
    return () => {
      cancelRef.current = true;
    };
  }, [refresh]);

  return {
    ...state,
    refresh,
  };
}
