import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type {
  MatchAction,
  MatchMoveRecord,
  MatchRecord,
  MatchStatus,
  MatchVisibility,
  PlayerProfile,
  SantoriniMoveAction,
  SantoriniStateSnapshot,
} from '@/types/match';

export type StartingPlayer = 'creator' | 'opponent' | 'random';

export interface CreateMatchPayload {
  visibility: MatchVisibility;
  rated: boolean;
  hasClock: boolean;
  clockInitialMinutes: number;
  clockIncrementSeconds: number;
  startingPlayer: StartingPlayer;
}

export interface LobbyMatch extends MatchRecord {
  creator?: PlayerProfile | null;
  opponent?: PlayerProfile | null;
}

export interface UndoRequestState {
  matchId: string;
  moveIndex: number;
  requestedBy: 'creator' | 'opponent';
  requestedAt: string;
  status: 'pending' | 'accepted' | 'rejected' | 'applied';
  respondedBy?: 'creator' | 'opponent';
}

export interface AbortRequestState {
  matchId: string;
  requestedBy: 'creator' | 'opponent';
  requestedAt: string;
  status: 'pending' | 'accepted' | 'rejected';
  respondedBy?: 'creator' | 'opponent';
}

export interface EmojiReaction {
  id: string;
  matchId: string;
  emoji: string;
  playerId: string;
  role: 'creator' | 'opponent' | 'spectator' | null;
  createdAt: number;
}

export type ConnectionQuality = 'connecting' | 'offline' | 'weak' | 'moderate' | 'strong';

export interface PlayerConnectionState {
  playerId: string;
  role: 'creator' | 'opponent' | 'spectator' | null;
  status: ConnectionQuality;
  lastSeen: number | null;
  isSelf: boolean;
}

export interface UseMatchLobbyState {
  matches: LobbyMatch[];
  myMatches: LobbyMatch[];
  loading: boolean;
  activeMatchId: string | null;
  activeMatch: LobbyMatch | null;
  moves: MatchMoveRecord<MatchAction>[];
  joinCode: string | null;
  sessionMode: 'local' | 'online' | null;
  undoRequests: Record<string, UndoRequestState | undefined>;
  abortRequests: Record<string, AbortRequestState | undefined>;
  rematchOffers: Record<string, LobbyMatch | undefined>;
  connectionStates: Record<string, PlayerConnectionState>;
}

const INITIAL_STATE: UseMatchLobbyState = {
  matches: [],
  myMatches: [],
  loading: false,
  activeMatchId: null,
  activeMatch: null,
  moves: [],
  joinCode: null,
  sessionMode: null,
  undoRequests: {},
  abortRequests: {},
  rematchOffers: {},
  connectionStates: {},
};

export interface UseMatchLobbyOptions {
  autoConnectOnline?: boolean;
}

const LOCAL_MATCH_ID = 'local:match';


interface MatchPresenceMeta {
  user_id?: string;
  role?: 'creator' | 'opponent' | 'spectator';
  last_seen?: number;
}

const CONNECTION_THRESHOLDS = {
  strong: 6000,
  moderate: 12000,
  weak: 20000,
} as const;

const PRESENCE_HEARTBEAT_INTERVAL = 5000;
const CONNECTION_MONITOR_INTERVAL = 6000;

function determineConnectionQuality(lastSeen: number | null, now: number): ConnectionQuality {
  if (lastSeen === null) {
    return 'offline';
  }
  const delta = now - lastSeen;
  if (delta <= CONNECTION_THRESHOLDS.strong) return 'strong';
  if (delta <= CONNECTION_THRESHOLDS.moderate) return 'moderate';
  if (delta <= CONNECTION_THRESHOLDS.weak) return 'weak';
  return 'offline';
}

function areConnectionStatesEqual(
  prev: Record<string, PlayerConnectionState>,
  next: Record<string, PlayerConnectionState>,
): boolean {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) {
    return false;
  }
  for (const key of prevKeys) {
    const prevState = prev[key];
    const nextState = next[key];
    if (!nextState) {
      return false;
    }
    if (
      prevState.status !== nextState.status ||
      prevState.lastSeen !== nextState.lastSeen ||
      prevState.role !== nextState.role ||
      prevState.isSelf !== nextState.isSelf
    ) {
      return false;
    }
  }
  return true;
}


function createEmptySnapshot(): SantoriniStateSnapshot {
  return {
    version: 1,
    player: 0,
    board: Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => [0, 0, 0]),
    ),
    history: [],
    future: [],
    gameEnded: [0, 0],
    validMoves: [],
  };
}

function createLocalMatch(): LobbyMatch {
  const createdAt = new Date().toISOString();
  return {
    id: LOCAL_MATCH_ID,
    creator_id: 'local-green',
    opponent_id: 'local-red',
    visibility: 'private',
    rated: false,
    private_join_code: null,
    clock_initial_seconds: 0,
    clock_increment_seconds: 0,
    status: 'in_progress',
    winner_id: null,
    rematch_parent_id: null,
    created_at: createdAt,
    initial_state: createEmptySnapshot(),
    creator: null,
    opponent: null,
  };
}

const TRACKED_MATCH_STATUSES: MatchStatus[] = ['waiting_for_opponent', 'in_progress'];

const MATCH_WITH_PROFILES =
  '*, creator:creator_id (id, auth_user_id, display_name, avatar_url, rating, games_played, created_at, updated_at), '
  + 'opponent:opponent_id (id, auth_user_id, display_name, avatar_url, rating, games_played, created_at, updated_at)';

function normalizeAction(action: unknown): MatchAction {
  if (typeof action === 'object' && action !== null) {
    return action as MatchAction;
  }
  return { kind: 'unknown' } as MatchAction;
}

function isSantoriniMoveAction(action: MatchAction | null | undefined): action is SantoriniMoveAction {
  return Boolean(action && (action as SantoriniMoveAction).kind === 'santorini.move');
}

function upsertMatch(list: LobbyMatch[], match: LobbyMatch): LobbyMatch[] {
  const index = list.findIndex((item) => item.id === match.id);
  if (index >= 0) {
    const next = [...list];
    next[index] = { ...next[index], ...match };
    return next;
  }
  return [match, ...list];
}

function removeMatch(list: LobbyMatch[], matchId: string): LobbyMatch[] {
  return list.filter((match) => match.id !== matchId);
}

function selectPreferredMatch(matches: LobbyMatch[]): LobbyMatch | null {
  if (!matches.length) return null;
  return matches.find((match) => match.status === 'in_progress') ?? matches[0] ?? null;
}

const ACTIVE_MATCH_STORAGE_KEY = 'santorini:activeMatchId';

export function useMatchLobby(profile: PlayerProfile | null, options: UseMatchLobbyOptions = {}) {
  const [state, setState] = useState<UseMatchLobbyState>(() => {
    // Restore active match ID from localStorage
    if (typeof window !== 'undefined') {
      try {
        const stored = window.localStorage.getItem(ACTIVE_MATCH_STORAGE_KEY);
        if (stored === LOCAL_MATCH_ID) {
          return {
            ...INITIAL_STATE,
            activeMatchId: LOCAL_MATCH_ID,
            activeMatch: createLocalMatch(),
            sessionMode: 'local',
          };
        }
        if (stored) {
          return { ...INITIAL_STATE, activeMatchId: stored };
        }
      } catch (error) {
        console.error('Failed to restore active match from localStorage', error);
      }
    }
    return INITIAL_STATE;
  });
  const [emojiReactions, setEmojiReactions] = useState<EmojiReaction[]>([]);
  const [onlineEnabled, setOnlineEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = window.localStorage.getItem(ACTIVE_MATCH_STORAGE_KEY);
        if (stored === LOCAL_MATCH_ID) {
          return false;
        }
      } catch (error) {
        console.error('Failed to determine initial online connectivity', error);
      }
    }
    return options.autoConnectOnline ?? false;
  });
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);
  const playersRef = useRef<Record<string, PlayerProfile>>({});
  const [playersVersion, setPlayersVersion] = useState(0);
  const isStartingLocalMatchRef = useRef(false);
  // Track moves being processed to prevent React setState race conditions
  const processingMovesRef = useRef<Set<number>>(new Set());
  // Hydration guard to avoid optimistic apply while fetching fresh state on (re)subscribe
  const hydratingRef = useRef<boolean>(false);
  const activeMatchRef = useRef<LobbyMatch | null>(null);
  const activeRoleRef = useRef<'creator' | 'opponent' | 'spectator' | null>(null);
  const presenceHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const presenceMonitorRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const channelStatusRef = useRef<'INIT' | 'SUBSCRIBED' | 'ERROR' | 'CLOSED'>('INIT');
  const emojiTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const emojiCounterRef = useRef(0);

  const matchId = state.activeMatchId;
  
  // Persist active match ID to localStorage whenever it changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (state.activeMatchId) {
        window.localStorage.setItem(ACTIVE_MATCH_STORAGE_KEY, state.activeMatchId);
      } else {
        window.localStorage.removeItem(ACTIVE_MATCH_STORAGE_KEY);
      }
    } catch (error) {
      console.error('Failed to persist active match to localStorage', error);
    }
  }, [state.activeMatchId]);

  useEffect(() => {
    activeMatchRef.current = state.activeMatch ?? null;
  }, [state.activeMatch]);

const mergePlayers = useCallback((records: PlayerProfile[]): void => {
    if (!records.length) return;
    const next = { ...playersRef.current };
    let changed = false;
    records.forEach((record) => {
      if (!record?.id) return;
      const existing = next[record.id];
      if (!existing || existing.updated_at !== record.updated_at || existing.display_name !== record.display_name) {
        next[record.id] = record;
        changed = true;
      }
    });
    if (changed) {
      playersRef.current = next;
      setPlayersVersion((prev) => prev + 1);
    }
  }, []);

  const removeEmojiReaction = useCallback((id: string) => {
    setEmojiReactions((prev) => prev.filter((reaction) => reaction.id !== id));
    if (emojiTimeoutsRef.current[id]) {
      clearTimeout(emojiTimeoutsRef.current[id]!);
      delete emojiTimeoutsRef.current[id];
    }
  }, []);

  const pushEmojiReaction = useCallback((reaction: EmojiReaction) => {
    const currentMatchId = activeMatchRef.current?.id;
    if (currentMatchId && currentMatchId !== reaction.matchId) {
      return;
    }
    setEmojiReactions((prev) => {
      const filtered = prev.filter((item) => item.id !== reaction.id);
      const next = [...filtered, reaction];
      // Keep recent reactions to avoid overflow
      return next.slice(-12);
    });

    if (emojiTimeoutsRef.current[reaction.id]) {
      clearTimeout(emojiTimeoutsRef.current[reaction.id]!);
    }

    const timeout = setTimeout(() => {
      removeEmojiReaction(reaction.id);
    }, 2500);
    emojiTimeoutsRef.current[reaction.id] = timeout;
  }, [removeEmojiReaction]);

  const clearEmojiReactions = useCallback(() => {
    Object.values(emojiTimeoutsRef.current).forEach((timeout) => {
      clearTimeout(timeout);
    });
    emojiTimeoutsRef.current = {};
    setEmojiReactions([]);
  }, []);

  useEffect(() => {
    clearEmojiReactions();
  }, [clearEmojiReactions, state.activeMatchId]);

  const ensurePlayersLoaded = useCallback(
    async (ids: Array<string | null | undefined>): Promise<void> => {
      if (!onlineEnabled) return;
      const client = supabase;
      if (!client) return;
      const missing = Array.from(
        new Set(
          ids
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
            .filter((id) => !playersRef.current[id]),
        ),
      );
      if (!missing.length) return;
      const { data, error } = await client.from('players').select('*').in('id', missing);
      if (error) {
        console.error('Failed to load player profiles', error);
        return;
      }
      mergePlayers((data ?? []) as PlayerProfile[]);
    },
    [mergePlayers, onlineEnabled],
  );

  const attachProfiles = useCallback(
    (match: (MatchRecord & Partial<LobbyMatch>) | null): LobbyMatch | null => {
      if (!match) return null;
      const creatorProfile = (match as LobbyMatch).creator ?? null;
      const opponentProfile = (match as LobbyMatch).opponent ?? null;
      return {
        ...match,
        creator:
          creatorProfile ?? (match.creator_id ? playersRef.current[match.creator_id] ?? null : null),
        opponent:
          opponentProfile ?? (match.opponent_id ? playersRef.current[match.opponent_id] ?? null : null),
      };
    },
    [], // Stable - reads from playersRef.current which is always up-to-date
  );

  const updateConnectionStatesFromPresence = useCallback(() => {
    if (!onlineEnabled) {
      setState((prev) => {
        if (Object.keys(prev.connectionStates).length === 0) {
          return prev;
        }
        return { ...prev, connectionStates: {} };
      });
      return;
    }

    const channel = channelRef.current;
    const activeMatch = activeMatchRef.current;
    if (!channel || !activeMatch) {
      setState((prev) => {
        if (Object.keys(prev.connectionStates).length === 0) {
          return prev;
        }
        return { ...prev, connectionStates: {} };
      });
      return;
    }

    const now = Date.now();
    const aggregated = new Map<string, { lastSeen: number; role: 'creator' | 'opponent' | 'spectator' | null }>();
    const presenceState = channel.presenceState<MatchPresenceMeta>();
    Object.values(presenceState).forEach((entries) => {
      entries.forEach((entry) => {
        const userId = entry?.user_id;
        if (!userId) return;
        const lastSeen = typeof entry.last_seen === 'number' ? entry.last_seen : now;
        const role = entry.role ?? null;
        const current = aggregated.get(userId);
        if (!current || lastSeen > current.lastSeen) {
          aggregated.set(userId, { lastSeen, role });
        }
      });
    });

    const expectedPlayers = new Set<string>();
    if (activeMatch.creator_id) expectedPlayers.add(activeMatch.creator_id);
    if (activeMatch.opponent_id) expectedPlayers.add(activeMatch.opponent_id);

    const userId = profile?.id ?? null;
    const next: Record<string, PlayerConnectionState> = {};

    aggregated.forEach((value, playerId) => {
      const status = determineConnectionQuality(value.lastSeen, now);
      const resolvedRole =
        value.role ??
        (activeMatch.creator_id === playerId
          ? 'creator'
          : activeMatch.opponent_id === playerId
            ? 'opponent'
            : null);
      next[playerId] = {
        playerId,
        role: resolvedRole,
        status,
        lastSeen: value.lastSeen,
        isSelf: playerId === userId,
      };
      expectedPlayers.delete(playerId);
    });

    expectedPlayers.forEach((playerId) => {
      const isSelf = playerId === userId;
      const resolvedRole =
        activeMatch.creator_id === playerId
          ? 'creator'
          : activeMatch.opponent_id === playerId
            ? 'opponent'
            : null;
      const status: ConnectionQuality =
        isSelf && channelStatusRef.current !== 'SUBSCRIBED' ? 'connecting' : 'offline';
      next[playerId] = {
        playerId,
        role: resolvedRole,
        status,
        lastSeen: null,
        isSelf,
      };
    });

    setState((prev) => {
      if (areConnectionStatesEqual(prev.connectionStates, next)) {
        return prev;
      }
      return { ...prev, connectionStates: next };
    });
  }, [onlineEnabled, profile?.id]);

  useEffect(() => {
    updateConnectionStatesFromPresence();
  }, [state.activeMatch, state.activeMatchId, onlineEnabled, updateConnectionStatesFromPresence]);

  const hydrateActiveMatch = useCallback(
    async (reason: string = 'manual'): Promise<void> => {
      if (!onlineEnabled) return;
      const client = supabase;
      if (!client || !matchId || matchId === LOCAL_MATCH_ID) return;

      console.log('useMatchLobby: Hydrating active match', { matchId, reason });

      hydratingRef.current = true;
      processingMovesRef.current = new Set();

      try {
        const [{ data: matchData, error: matchError }, { data: movesData, error: movesError }] = await Promise.all([
          client
            .from('matches')
            .select(MATCH_WITH_PROFILES)
            .eq('id', matchId)
            .maybeSingle(),
          client
            .from('match_moves')
            .select('*')
            .eq('match_id', matchId)
            .order('move_index', { ascending: true }),
        ]);

        if (matchError) {
          console.error('useMatchLobby: Failed to refresh match record', matchError);
        }
        if (movesError) {
          console.error('useMatchLobby: Failed to refresh match moves', movesError);
        }

        const record = matchError ? null : ((matchData ?? null) as MatchRecord & Partial<LobbyMatch> | null);
        if (record?.creator) mergePlayers([record.creator]);
        if (record?.opponent) mergePlayers([record.opponent]);
        const hydratedMatch = record ? attachProfiles(record) : null;

        const mappedMoves =
          movesError || !Array.isArray(movesData)
            ? null
            : (movesData as MatchMoveRecord<MatchAction>[]).map((move) => ({
                ...move,
                action: normalizeAction(move.action),
              }));

        setState((prev) => {
          if (prev.activeMatchId !== matchId) {
            return prev;
          }
          return {
            ...prev,
            activeMatch: hydratedMatch ?? prev.activeMatch,
            joinCode: record?.private_join_code ?? prev.joinCode,
            moves: mappedMoves ?? prev.moves,
          };
        });

        if (record) {
          void ensurePlayersLoaded([record.creator_id, record.opponent_id ?? undefined]);
        }
      } catch (error) {
        console.error('useMatchLobby: Hydration error', error);
      } finally {
        hydratingRef.current = false;
      }
    },
    [attachProfiles, ensurePlayersLoaded, matchId, mergePlayers, onlineEnabled],
  );

  useEffect(() => {
    if (profile) {
      mergePlayers([profile]);
    }
  }, [mergePlayers, profile]);

  useEffect(() => {
    const client = supabase;
    if (!client || !onlineEnabled) return undefined;

    const channel = client
      .channel('public:players')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'players' }, (payload) => {
        const record = payload.new as PlayerProfile | null;
        if (record) {
          mergePlayers([record]);
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'players' }, (payload) => {
        const record = payload.new as PlayerProfile | null;
        if (record) {
          mergePlayers([record]);
        }
      })
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [mergePlayers, onlineEnabled]);

  useEffect(() => {
    const client = supabase;
    if (!client || !profile || !onlineEnabled) return undefined;
    
    // Skip if we have a temporary profile (network error fallback)

    const cleanup = async () => {
      const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { error } = await client
        .from('matches')
        .update({ status: 'abandoned' })
        .eq('creator_id', profile.id)
        .eq('status', 'waiting_for_opponent')
        .lt('created_at', cutoff);
      if (error) {
        console.error('Failed to clean stale matches', error);
      }
    };

    cleanup();
    const timer = setInterval(cleanup, 5 * 60 * 1000);
    return () => {
      clearInterval(timer);
    };
  }, [profile, onlineEnabled]);

  useEffect(() => {
    const client = supabase;
    if (!client || !onlineEnabled) return undefined;

    const fetchMatches = async () => {
      setState((prev) => ({ ...prev, loading: true }));
      try {
        const { data, error } = await client
          .from('matches')
          .select(MATCH_WITH_PROFILES)
          .eq('status', 'waiting_for_opponent')
          .order('created_at', { ascending: true });

        if (error) {
          throw error;
        }

        const rawRecords = Array.isArray(data) ? data : [];
        const records = rawRecords as unknown as Array<MatchRecord & Partial<LobbyMatch>>;
        const profilesToCache: PlayerProfile[] = [];
        records.forEach((record) => {
          if (record.creator) profilesToCache.push(record.creator);
          if (record.opponent) profilesToCache.push(record.opponent);
        });
        mergePlayers(profilesToCache);
        const hydrated = records.map(
          (record) => attachProfiles(record) ?? { ...record, creator: null, opponent: null },
        );
        setState((prev) => ({ ...prev, loading: false, matches: hydrated }));
        void ensurePlayersLoaded(
          records.flatMap((match) => [match.creator_id, match.opponent_id ?? undefined]),
        );
      } catch (error) {
        console.error('Failed to fetch matches', error);
        setState((prev) => ({ ...prev, loading: false }));
      }
    };

    fetchMatches();

    const channel = client
      .channel('public:lobby')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches' },
        (payload: RealtimePostgresChangesPayload<MatchRecord>) => {
          setState((prev) => {
            const matches = [...prev.matches];
            if (payload.eventType === 'INSERT') {
              const record = payload.new as MatchRecord;
              if (record.status === 'waiting_for_opponent') {
                matches.unshift(attachProfiles(record) ?? { ...record, creator: null, opponent: null });
              }
              void ensurePlayersLoaded([record.creator_id, record.opponent_id ?? undefined]);
            } else if (payload.eventType === 'UPDATE') {
              const updated = payload.new as MatchRecord;
              const index = matches.findIndex((m) => m.id === updated.id);
              if (index >= 0) {
                matches[index] = attachProfiles({ ...matches[index], ...updated }) ?? {
                  ...matches[index],
                  ...updated,
                };
              } else if (updated.status === 'waiting_for_opponent') {
                matches.unshift(attachProfiles(updated) ?? { ...updated, creator: null, opponent: null });
              }
              if (updated.status !== 'waiting_for_opponent') {
                return { ...prev, matches: matches.filter((m) => m.id !== updated.id) };
              }
              void ensurePlayersLoaded([updated.creator_id, updated.opponent_id ?? undefined]);
            } else if (payload.eventType === 'DELETE') {
              return { ...prev, matches: matches.filter((m) => m.id !== (payload.old as MatchRecord).id) };
            }
            return { ...prev, matches };
          });
        },
      )
      .on(
        'broadcast',
        { event: 'emoji' },
        (payload: { type: string; event: string; payload: any }) => {
          const data = payload?.payload ?? {};
          const matchId = typeof data.match_id === 'string' ? data.match_id : activeMatchRef.current?.id ?? null;
          if (!matchId || activeMatchRef.current?.id !== matchId) {
            return;
          }
          const emojiValue = typeof data.emoji === 'string' ? data.emoji : null;
          const playerId = typeof data.player_id === 'string' ? data.player_id : null;
          if (!emojiValue || !playerId) {
            return;
          }
          const roleFromPayload = data.role === 'creator' || data.role === 'opponent' ? data.role : null;
          const resolvedRole = roleFromPayload
            ?? (activeMatchRef.current?.creator_id === playerId
              ? 'creator'
              : activeMatchRef.current?.opponent_id === playerId
                ? 'opponent'
                : null);
          const timestamp =
            typeof data.timestamp === 'number' && Number.isFinite(data.timestamp)
              ? data.timestamp
              : Date.now();
          const id =
            typeof data.id === 'string'
              ? data.id
              : `emoji-${matchId}-${timestamp}-${emojiCounterRef.current++}`;
          pushEmojiReaction({
            id,
            matchId,
            emoji: emojiValue,
            playerId,
            role: resolvedRole,
            createdAt: timestamp,
          });
        },
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [attachProfiles, ensurePlayersLoaded, mergePlayers, onlineEnabled]);

  useEffect(() => {
    const client = supabase;
    if (!client || !profile || !onlineEnabled) {
      // Don't clear state if we're starting a local match or already in local mode
      if (isStartingLocalMatchRef.current) {
        setState((prev) => ({ ...prev, myMatches: [] }));
        return undefined;
      }
      setState((prev) => {
        if (prev.sessionMode === 'local') {
          return { ...prev, myMatches: [] };
        }
        // Only clear matches list, keep activeMatch to preserve subscription
        return { ...prev, myMatches: [] };
      });
      return undefined;
    }
    

    let isMounted = true;

    const fetchMyMatches = async () => {
      const { data, error } = await client
        .from('matches')
        .select(MATCH_WITH_PROFILES)
        .in('status', TRACKED_MATCH_STATUSES)
        .or(`creator_id.eq.${profile.id},opponent_id.eq.${profile.id}`)
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('Failed to fetch player matches', error);
        return;
      }

      if (!isMounted) return;

      const rawRecords = Array.isArray(data) ? data : [];
      const records = rawRecords as unknown as Array<MatchRecord & Partial<LobbyMatch>>;
      const profilesToCache: PlayerProfile[] = [];
      records.forEach((record) => {
        if (record.creator) profilesToCache.push(record.creator);
        if (record.opponent) profilesToCache.push(record.opponent);
      });
      mergePlayers(profilesToCache);
      const hydrated = records.map((record) => attachProfiles(record) ?? { ...record, creator: null, opponent: null });

      setState((prev) => {
        const myMatches = hydrated;
        let nextActiveMatchId = prev.activeMatchId;
        let autoSelected = false;

        const hasCurrentMatch =
          nextActiveMatchId && myMatches.some((match) => match.id === nextActiveMatchId);

        if (!hasCurrentMatch) {
          const preferred = selectPreferredMatch(myMatches);
          nextActiveMatchId = preferred?.id ?? null;
          autoSelected = Boolean(nextActiveMatchId);
        }

        const nextActiveMatch = nextActiveMatchId
          ? myMatches.find((match) => match.id === nextActiveMatchId) ?? prev.activeMatch
          : null;

        const shouldForceOnline =
          nextActiveMatch?.status === 'in_progress' &&
          prev.sessionMode !== 'local' &&
          (autoSelected || prev.sessionMode !== 'online');

        const sessionMode = shouldForceOnline ? 'online' : prev.sessionMode;

        return {
          ...prev,
          myMatches,
          activeMatchId: nextActiveMatchId,
          activeMatch: nextActiveMatch,
          sessionMode,
          joinCode: nextActiveMatchId
            ? nextActiveMatch?.private_join_code ?? prev.joinCode
            : null,
        };
      });

      void ensurePlayersLoaded(records.flatMap((match) => [match.creator_id, match.opponent_id ?? undefined]));
    };

    fetchMyMatches();

    const channel = client
      .channel(`public:my_matches:${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'matches',
          filter: `or=(creator_id.eq.${profile.id},opponent_id.eq.${profile.id})`,
        },
        (payload: RealtimePostgresChangesPayload<MatchRecord>) => {
          const updated = payload.eventType === 'DELETE' ? (payload.old as MatchRecord) : (payload.new as MatchRecord);
          const isTracked = TRACKED_MATCH_STATUSES.includes(updated.status as MatchStatus);

          setState((prev) => {
            let myMatches = prev.myMatches;
            if (payload.eventType === 'DELETE' || !isTracked) {
              myMatches = removeMatch(prev.myMatches, updated.id);
            } else {
              const hydrated = attachProfiles({
                ...(prev.myMatches.find((match) => match.id === updated.id) ?? {}),
                ...updated,
              });
              const matchRecord = hydrated ?? { ...updated, creator: null, opponent: null };
              myMatches = upsertMatch(prev.myMatches, matchRecord);
            }

            let activeMatchId = prev.activeMatchId;
            let activeMatch = prev.activeMatch;
            if (activeMatchId && activeMatchId === updated.id) {
              if (payload.eventType === 'DELETE' || !isTracked) {
                const fallback = selectPreferredMatch(myMatches);
                activeMatchId = fallback?.id ?? null;
                activeMatch = fallback ?? null;
              } else {
                activeMatch = myMatches.find((match) => match.id === updated.id) ?? null;
              }
            } else if (!activeMatchId && isTracked && myMatches.length > 0) {
              const fallback = selectPreferredMatch(myMatches);
              activeMatchId = fallback?.id ?? null;
              activeMatch = fallback ?? null;
            }

            const joinCode = activeMatch ? activeMatch.private_join_code ?? null : null;

            return { ...prev, myMatches, activeMatchId, activeMatch, joinCode };
          });

          void ensurePlayersLoaded([updated.creator_id, updated.opponent_id ?? undefined]);
        },
      )
      .subscribe();

    return () => {
      isMounted = false;
      client.removeChannel(channel);
    };
  }, [attachProfiles, ensurePlayersLoaded, mergePlayers, profile, onlineEnabled]);

  useEffect(() => {
    const client = supabase;

    const clearPresenceTimers = () => {
      if (presenceHeartbeatRef.current) {
        clearInterval(presenceHeartbeatRef.current);
        presenceHeartbeatRef.current = null;
      }
      if (presenceMonitorRef.current) {
        clearInterval(presenceMonitorRef.current);
        presenceMonitorRef.current = null;
      }
    };

    if (!matchId) {
      clearPresenceTimers();
      if (channelRef.current) {
        client?.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      channelStatusRef.current = 'CLOSED';
      setState((prev) => ({ ...prev, moves: [], activeMatch: null, joinCode: null }));
      updateConnectionStatesFromPresence();
      return undefined;
    }

    if (matchId === LOCAL_MATCH_ID) {
      clearPresenceTimers();
      if (channelRef.current) {
        client?.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      channelStatusRef.current = 'CLOSED';
      setState((prev) => {
        if (prev.activeMatchId !== LOCAL_MATCH_ID) {
          return prev;
        }
        const activeMatch = prev.activeMatch && prev.activeMatch.id === LOCAL_MATCH_ID ? prev.activeMatch : createLocalMatch();
        return {
          ...prev,
          sessionMode: 'local',
          activeMatch,
          joinCode: null,
          moves: [],
        };
      });
      updateConnectionStatesFromPresence();
      return undefined;
    }

    if (!client || !onlineEnabled) {
      clearPresenceTimers();
      if (channelRef.current) {
        client?.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      channelStatusRef.current = 'CLOSED';
      setState((prev) => ({ ...prev, moves: [], activeMatch: null, joinCode: null }));
      updateConnectionStatesFromPresence();
      return undefined;
    }

    void hydrateActiveMatch('initial-load');
    clearPresenceTimers();
    channelStatusRef.current = 'INIT';

    const channel = client.channel(`match-${matchId}`, {
      config: {
        broadcast: { self: true }, // Receive our own broadcasts for instant feedback
      },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        updateConnectionStatesFromPresence();
      })
      .on('presence', { event: 'join' }, () => {
        updateConnectionStatesFromPresence();
      })
      .on('presence', { event: 'leave' }, () => {
        updateConnectionStatesFromPresence();
      });

    channel
      .on(
        'broadcast',
        { event: 'move' },
        (payload: { type: string; event: string; payload: any }) => {
          console.log('⚡ BROADCAST: Move received instantly!', { 
            matchId, 
            moveIndex: payload.payload?.move_index,
            from: payload.payload?.player_id === profile?.id ? 'self' : 'opponent',
            timestamp: Date.now()
          });
          
          const broadcastMove = payload.payload;
          if (!broadcastMove || typeof broadcastMove.move_index !== 'number') {
            console.warn('⚡ BROADCAST: Invalid move payload', payload);
            return;
          }
          // Skip optimistic path during hydration to avoid applying on stale state
          if (hydratingRef.current) {
            console.log('⚡ BROADCAST: Skipping optimistic apply during hydration');
            return;
          }
          
          // Check if we're already processing this move (prevents React setState race condition)
          if (processingMovesRef.current.has(broadcastMove.move_index)) {
            console.log('⚡ BROADCAST: Move already being processed, skipping duplicate', { 
              moveIndex: broadcastMove.move_index 
            });
            return;
          }
          
          // Mark as processing
          processingMovesRef.current.add(broadcastMove.move_index);
          
          setState((prev) => {
            if (prev.activeMatchId !== matchId) {
              // Clean up if match changed
              processingMovesRef.current.delete(broadcastMove.move_index);
              return prev;
            }
            
            // Check if move already exists (prevent duplicates from race conditions)
            const exists = prev.moves.some((move) => move.move_index === broadcastMove.move_index);
            if (exists) {
              console.log('⚡ BROADCAST: Move already exists, skipping', { moveIndex: broadcastMove.move_index });
              processingMovesRef.current.delete(broadcastMove.move_index);
              return prev;
            }
            
            // Check sequence (prevent out-of-order moves from breaking game state)
            const expectedIndex = prev.moves.length;
            if (broadcastMove.move_index !== expectedIndex) {
              console.warn('⚡ BROADCAST: Out of sequence move!', { 
                expected: expectedIndex, 
                received: broadcastMove.move_index,
                action: 'Will wait for DB confirmation'
              });
              // Don't add it yet - wait for DB to sort it out
              processingMovesRef.current.delete(broadcastMove.move_index);
              return prev;
            }

          // Turn ownership guard: for index N, only accept optimistic apply if
          // player_id matches the expected player based on move 0 parity.
          if (prev.activeMatch) {
            const { creator_id, opponent_id } = prev.activeMatch;
            const placementOrder: Array<string | null> = [
              creator_id ?? null,
              creator_id ?? null,
              opponent_id ?? null,
              opponent_id ?? null,
            ];

            let expectedPlayerId: string | null = null;

            if (broadcastMove.move_index < placementOrder.length) {
              expectedPlayerId = placementOrder[broadcastMove.move_index] ?? null;
            } else if (creator_id && opponent_id) {
              const postPlacementIndex = broadcastMove.move_index - placementOrder.length;
              expectedPlayerId = postPlacementIndex % 2 === 0 ? creator_id : opponent_id;
            }

            if (expectedPlayerId && broadcastMove.player_id !== expectedPlayerId) {
              console.warn('⚡ BROADCAST: Player/turn mismatch for optimistic apply, deferring to DB', {
                moveIndex: broadcastMove.move_index,
                expectedPlayerId,
                gotPlayerId: broadcastMove.player_id,
              });
              processingMovesRef.current.delete(broadcastMove.move_index);
              return prev;
            }
          }
            
            // Create optimistic move record
            const moveRecord: MatchMoveRecord<MatchAction> = {
              id: `optimistic-${broadcastMove.move_index}-${Date.now()}`,
              match_id: matchId,
              move_index: broadcastMove.move_index,
              player_id: broadcastMove.player_id,
              action: normalizeAction(broadcastMove.action),
              state_snapshot: null, // Server will compute
              eval_snapshot: null,
              created_at: new Date().toISOString(),
            };
            
            console.log('⚡ BROADCAST: Adding optimistic move', { 
              moveIndex: moveRecord.move_index,
              totalMoves: prev.moves.length + 1,
              isOptimistic: true
            });
            
            // Remove from processing set after adding
            processingMovesRef.current.delete(broadcastMove.move_index);
            
            const updatedMoves = [...prev.moves, moveRecord];
            return { ...prev, moves: updatedMoves };
          });
        },
      )
      .on(
        'broadcast',
        { event: 'move-rejected' },
        (payload: { type: string; event: string; payload: any }) => {
          console.error('❌ BROADCAST: Move rejected by server!', payload.payload);
          
          const rejection = payload.payload;
          setState((prev) => {
            if (prev.activeMatchId !== matchId) {
              return prev;
            }
            
            // Remove the optimistic move
            const updatedMoves = prev.moves.filter(
              (move) => move.move_index !== rejection.move_index || !move.id.startsWith('optimistic-')
            );
            
            console.log('❌ BROADCAST: Removed rejected optimistic move', { 
              moveIndex: rejection.move_index,
              reason: rejection.error
            });
            
            return { ...prev, moves: updatedMoves };
          });
        },
      )
      .on(
        'broadcast',
        { event: 'undo-request' },
        (payload: { type: string; event: string; payload: any }) => {
          const data = payload.payload ?? {};
          const moveIndexRaw = typeof data.move_index === 'number' ? data.move_index : null;
          const requestedByRole = data.requested_by_role === 'creator' ? 'creator' : data.requested_by_role === 'opponent' ? 'opponent' : null;
          if (requestedByRole === null) {
            console.warn('⚠️ Received undo-request with unknown role', data);
            return;
          }
          setState((prev) => {
            const moveIndex = moveIndexRaw ?? Math.max(prev.moves.length - 1, 0);
            const requestState: UndoRequestState = {
              matchId,
              moveIndex,
              requestedBy: requestedByRole,
              requestedAt: data.requested_at ?? new Date().toISOString(),
              status: 'pending',
            };
            return {
              ...prev,
              undoRequests: {
                ...prev.undoRequests,
                [matchId]: requestState,
              },
            };
          });
        },
      )
      .on(
        'broadcast',
        { event: 'undo-response' },
        (payload: { type: string; event: string; payload: any }) => {
          const data = payload.payload ?? {};
          const accepted = Boolean(data.accepted);
          const responderRole = data.responded_by_role === 'creator' ? 'creator' : data.responded_by_role === 'opponent' ? 'opponent' : null;
          const moveIndexRaw = typeof data.move_index === 'number' ? data.move_index : null;
          setState((prev) => {
            const existing = prev.undoRequests[matchId];
            if (!existing) {
              return prev;
            }
            if (moveIndexRaw !== null && existing.moveIndex !== moveIndexRaw) {
              return prev;
            }
            const nextState: UndoRequestState = {
              ...existing,
              status: accepted ? 'accepted' : 'rejected',
              respondedBy: responderRole ?? existing.respondedBy,
            };
            return {
              ...prev,
              undoRequests: {
                ...prev.undoRequests,
                [matchId]: nextState,
              },
            };
          });
        },
      )
      .on(
        'broadcast',
        { event: 'undo-applied' },
        (payload: { type: string; event: string; payload: any }) => {
          const data = payload.payload ?? {};
          const moveIndexRaw = typeof data.move_index === 'number' ? data.move_index : null;
          const removedIndexesRaw = Array.isArray(data.removed_move_indexes)
            ? (data.removed_move_indexes as unknown[])
            : [];
          const removedIndexesClean: number[] = removedIndexesRaw
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
            .map((value) => Math.trunc(value));
          setState((prev) => {
            if (prev.activeMatchId !== matchId) {
              return prev;
            }
            const existing = prev.undoRequests[matchId];
            const fallbackIndex = moveIndexRaw ?? existing?.moveIndex ?? prev.moves.length - 1;
            const removalList =
              removedIndexesClean.length > 0
                ? Array.from(new Set(removedIndexesClean)).sort((a, b) => a - b)
                : [fallbackIndex];
            const removalSet = new Set(removalList);
            const targetIndex = removalList.length > 0 ? removalList[0] : fallbackIndex;
            const nextUndo = existing
              ? {
                  ...existing,
                  moveIndex: targetIndex,
                  status: 'applied' as const,
                }
              : undefined;
            const nextUndoRequests = { ...prev.undoRequests };
            if (nextUndo) {
              nextUndoRequests[matchId] = nextUndo;
            }
            const updatedMoves = prev.moves.filter((move) => !removalSet.has(move.move_index));
            return {
              ...prev,
              moves: updatedMoves,
              undoRequests: nextUndo ? nextUndoRequests : prev.undoRequests,
            };
          });
        },
      )
      .on(
        'broadcast',
        { event: 'rematch-created' },
        (payload: { type: string; event: string; payload: any }) => {
          const data = payload.payload ?? {};
          const newMatchId = typeof data.new_match_id === 'string' ? data.new_match_id : null;
          const joinCode = typeof data.join_code === 'string' ? data.join_code : null;
          if (!client || !newMatchId) {
            return;
          }

          void (async () => {
            const { data: matchData, error: rematchError } = await client
              .from('matches')
              .select(MATCH_WITH_PROFILES)
              .eq('id', newMatchId)
              .maybeSingle();

            if (rematchError || !matchData) {
              console.error('Failed to fetch rematch match details', rematchError);
              return;
            }

            const record = matchData as unknown as MatchRecord & Partial<LobbyMatch>;
            const profiles: PlayerProfile[] = [];
            if (record.creator) profiles.push(record.creator);
            if (record.opponent) profiles.push(record.opponent);
            mergePlayers(profiles);
            const hydrated = attachProfiles(record) ?? { ...record, creator: null, opponent: null };

            // Ignore if we created this rematch ourselves
            if (profile && hydrated.creator_id === profile.id) {
              return;
            }

            setState((prev) => ({
              ...prev,
              rematchOffers: {
                ...prev.rematchOffers,
                [hydrated.id]: {
                  ...hydrated,
                  private_join_code: joinCode ?? hydrated.private_join_code ?? null,
                },
              },
            }));

            void ensurePlayersLoaded([hydrated.creator_id, hydrated.opponent_id ?? undefined]);
          })();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        (payload: RealtimePostgresChangesPayload<MatchRecord>) => {
          const updated = payload.new as MatchRecord;
          setState((prev) => {
            const existingActive = prev.activeMatch && prev.activeMatch.id === updated.id ? prev.activeMatch : null;
            const baseMatch = existingActive ? { ...existingActive, ...updated } : { ...updated, creator: null, opponent: null };
            const enriched = attachProfiles(baseMatch) ?? baseMatch;
            const shouldTrack = TRACKED_MATCH_STATUSES.includes(updated.status as MatchStatus);
            const nextMyMatches = shouldTrack
              ? upsertMatch(prev.myMatches, enriched)
              : removeMatch(prev.myMatches, updated.id);
            const nextLobbyMatches = shouldTrack
              ? upsertMatch(prev.matches, enriched)
              : removeMatch(prev.matches, updated.id);

            if (prev.activeMatchId === updated.id && !shouldTrack) {
              const nextUndo = { ...prev.undoRequests };
              delete nextUndo[updated.id];
              return {
                ...prev,
                sessionMode: prev.sessionMode === 'local' ? prev.sessionMode : null,
                activeMatchId: null,
                activeMatch: null,
                moves: [],
                joinCode: null,
                undoRequests: nextUndo,
                myMatches: nextMyMatches,
                matches: nextLobbyMatches,
              };
            }

            return {
              ...prev,
              activeMatch: prev.activeMatchId === updated.id ? enriched : prev.activeMatch,
              myMatches: nextMyMatches,
              matches: nextLobbyMatches,
            };
          });
          void ensurePlayersLoaded([updated.creator_id, updated.opponent_id ?? undefined]);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_moves', filter: `match_id=eq.${matchId}` },
        (payload: RealtimePostgresChangesPayload<MatchMoveRecord>) => {
          const newMove = payload.new as MatchMoveRecord;
          console.log('✅ DB: Move confirmed in database', { 
            eventType: payload.eventType, 
            matchId, 
            moveId: newMove?.id,
            moveIndex: newMove?.move_index 
          });
          setState((prev) => {
            if (prev.activeMatchId !== matchId) {
              return prev;
            }
            if (payload.eventType === 'INSERT') {
              const newMove = payload.new as MatchMoveRecord;
              const moveRecord: MatchMoveRecord<MatchAction> = {
                ...newMove,
                action: normalizeAction(newMove.action),
              };
              
              // Check if we have an optimistic version of this move
              const optimisticIndex = prev.moves.findIndex(
                (move) => move.move_index === moveRecord.move_index && move.id.startsWith('optimistic-')
              );
              
              if (optimisticIndex >= 0) {
                console.log('✅ DB: Replacing optimistic move with confirmed', { 
                  moveIndex: moveRecord.move_index,
                  optimisticId: prev.moves[optimisticIndex].id,
                  confirmedId: moveRecord.id
                });
                // Replace optimistic move with confirmed one
                const updatedMoves = [...prev.moves];
                updatedMoves[optimisticIndex] = moveRecord;
                return { ...prev, moves: updatedMoves };
              }
              
              // If a move with the same move_index already exists (non-optimistic), replace it to avoid duplicate application
              const sameIndex = prev.moves.findIndex((m) => m.move_index === moveRecord.move_index);
              if (sameIndex >= 0) {
                console.warn('⚠️ DB: Replacing existing move with same index to avoid duplicate application', {
                  moveIndex: moveRecord.move_index,
                  existingId: prev.moves[sameIndex].id,
                  confirmedId: moveRecord.id,
                });
                const updatedMoves = [...prev.moves];
                updatedMoves[sameIndex] = moveRecord;
                return { ...prev, moves: updatedMoves };
              }

              // Check if confirmed move already exists (shouldn't happen but be safe)
              const exists = prev.moves.some((move) => move.id === moveRecord.id);
              if (exists) {
                console.log('✅ DB: Move already exists, skipping');
                return prev;
              }
              
              console.log('✅ DB: Adding confirmed move', { 
                moveId: moveRecord.id, 
                moveIndex: moveRecord.move_index,
                totalMoves: prev.moves.length + 1,
                note: 'No broadcast received (slow network or missed)'
              });
              
              // Add move and ensure proper ordering by move_index
              const updatedMoves = [...prev.moves, moveRecord].sort((a, b) => a.move_index - b.move_index);
              return { ...prev, moves: updatedMoves };
            }
            if (payload.eventType === 'DELETE') {
              const deletedMove = payload.old as MatchMoveRecord;
              const updatedMoves = prev.moves
                .filter((move) => move.id !== deletedMove.id && move.move_index !== deletedMove.move_index)
                .sort((a, b) => a.move_index - b.move_index);
              const pendingUndo = prev.undoRequests[matchId];
              const nextUndoRequests = { ...prev.undoRequests };
              if (pendingUndo && pendingUndo.moveIndex === deletedMove.move_index) {
                nextUndoRequests[matchId] = {
                  ...pendingUndo,
                  status: 'applied',
                };
              }
              return { ...prev, moves: updatedMoves, undoRequests: nextUndoRequests };
            }
            return prev;
          });
        },
      );

    updateConnectionStatesFromPresence();

    const sendPresenceUpdate = async (reason: string) => {
      if (!profile) {
        return;
      }
      const role =
        activeRoleRef.current ??
        (activeMatchRef.current?.creator_id === profile.id
          ? 'creator'
          : activeMatchRef.current?.opponent_id === profile.id
            ? 'opponent'
            : 'spectator');
      try {
        await channel.track({
          user_id: profile.id,
          role,
          last_seen: Date.now(),
        });
      } catch (error) {
        console.warn('useMatchLobby: Failed to track presence', { matchId, reason, error });
      } finally {
        updateConnectionStatesFromPresence();
      }
    };

    channel.subscribe((status) => {
        console.log('useMatchLobby: Real-time subscription status', { 
          matchId, 
          status,
          channel: channel.topic 
        });

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('useMatchLobby: Real-time connection lost for match, will auto-reconnect', { matchId, status });
          channelStatusRef.current = 'ERROR';
          clearPresenceTimers();
          updateConnectionStatesFromPresence();
          // Supabase will automatically attempt to reconnect
        }

        if (status === 'SUBSCRIBED') {
          channelStatusRef.current = 'SUBSCRIBED';
          console.log('useMatchLobby: Real-time subscription active, refreshing match state', { matchId });
          void hydrateActiveMatch('re-subscribed');
          void sendPresenceUpdate('subscribed');
          if (!presenceHeartbeatRef.current) {
            presenceHeartbeatRef.current = setInterval(() => {
              void sendPresenceUpdate('heartbeat');
            }, PRESENCE_HEARTBEAT_INTERVAL);
          }
          if (!presenceMonitorRef.current) {
            presenceMonitorRef.current = setInterval(() => {
              updateConnectionStatesFromPresence();
            }, CONNECTION_MONITOR_INTERVAL);
          }
        }

        if (status === 'CLOSED') {
          channelStatusRef.current = 'CLOSED';
          clearPresenceTimers();
          updateConnectionStatesFromPresence();
        }
      });

    channelRef.current = channel;

    return () => {
      clearPresenceTimers();
      try {
        void channel.untrack();
      } catch (error) {
        console.warn('useMatchLobby: Failed to untrack presence on cleanup', { matchId, error });
      }
      client.removeChannel(channel);
      channelRef.current = null;
      channelStatusRef.current = 'CLOSED';
      updateConnectionStatesFromPresence();
    };
  }, [attachProfiles, ensurePlayersLoaded, hydrateActiveMatch, matchId, mergePlayers, onlineEnabled, profile, pushEmojiReaction]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void hydrateActiveMatch('visibilitychange');
      }
    };

    const handleFocus = () => {
      void hydrateActiveMatch('window-focus');
    };

    document.addEventListener('visibilitychange', handleVisibility);
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleFocus);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleFocus);
      }
    };
  }, [hydrateActiveMatch]);

  const createMatch = useCallback(
    async (payload: CreateMatchPayload) => {
      if (!onlineEnabled) {
        throw new Error('Online play is not enabled.');
      }
      const client = supabase;
      if (!client || !profile) {
        throw new Error('Authentication required.');
      }

      const selectedStartingPlayer: 'creator' | 'opponent' =
        payload.startingPlayer === 'random'
          ? (Math.random() < 0.5 ? 'creator' : 'opponent')
          : payload.startingPlayer;

      const { data, error } = await client.functions.invoke('create-match', {
        body: {
          visibility: payload.visibility,
          rated: payload.rated,
          hasClock: payload.hasClock,
          clockInitialMinutes: payload.clockInitialMinutes,
          clockIncrementSeconds: payload.clockIncrementSeconds,
          startingPlayer: selectedStartingPlayer,
        },
      });

      if (error) {
        console.error('Failed to create match', error);
        // Check if it's an active game conflict
        const errorData = (error as any).context?.body;
        if (errorData?.code === 'ACTIVE_GAME_EXISTS') {
          const err = new Error(errorData.error);
          (err as any).code = 'ACTIVE_GAME_EXISTS';
          (err as any).activeMatchId = errorData.activeMatchId;
          throw err;
        }
        throw new Error(error.message || 'Failed to create match');
      }

      const record = (data as { match?: MatchRecord & Partial<LobbyMatch> } | null)?.match;
      if (!record) {
        throw new Error('Match creation response was malformed.');
      }
      if (record.creator) mergePlayers([record.creator]);
      const enriched = attachProfiles(record) ?? { ...record, creator: profile, opponent: null };
      const joinCode = record.private_join_code ?? null;
      setState((prev) => ({
        ...prev,
        sessionMode: 'online',
        activeMatchId: enriched.id,
        activeMatch: enriched,
        joinCode,
        moves: [],
        myMatches: upsertMatch(prev.myMatches, enriched),
      }));
      void ensurePlayersLoaded([record.creator_id, record.opponent_id ?? undefined]);
      return enriched;
    },
    [attachProfiles, ensurePlayersLoaded, mergePlayers, onlineEnabled, profile],
  );

  const joinMatch = useCallback(
    async (idOrCode: string) => {
      if (!onlineEnabled) {
        throw new Error('Online play is not enabled.');
      }
      const client = supabase;
      if (!client || !profile) {
        throw new Error('Authentication required.');
      }

      // Check if player already has an active game
      if (state.activeMatchId && state.activeMatch) {
        const activeStatus = state.activeMatch.status;
        if (activeStatus === 'waiting_for_opponent' || activeStatus === 'in_progress') {
          const error = new Error('You already have an active game. Please finish or cancel your current game before joining a new one.');
          (error as any).code = 'ACTIVE_GAME_EXISTS';
          (error as any).activeMatchId = state.activeMatchId;
          throw error;
        }
      }

      const isCode = idOrCode.length <= 8;
      let targetMatch: (MatchRecord & Partial<LobbyMatch>) | null = null;

      if (isCode) {
        const { data, error } = await client
          .from('matches')
          .select(MATCH_WITH_PROFILES)
          .eq('private_join_code', idOrCode)
          .maybeSingle();
        if (error) {
          console.error('Failed to find match by code', error);
          throw error;
        }
        targetMatch = (data ?? null) as (MatchRecord & Partial<LobbyMatch>) | null;
      } else {
        const { data, error } = await client
          .from('matches')
          .select(MATCH_WITH_PROFILES)
          .eq('id', idOrCode)
          .maybeSingle();
        if (error) {
          console.error('Failed to find match by id', error);
          throw error;
        }
        targetMatch = (data ?? null) as (MatchRecord & Partial<LobbyMatch>) | null;
      }

      if (!targetMatch) {
        throw new Error('Match not found.');
      }

      if (targetMatch.status !== 'waiting_for_opponent') {
        throw new Error('Match is no longer accepting players.');
      }

      if (targetMatch.opponent_id !== null) {
        throw new Error('Match is no longer available or has already been joined by another player.');
      }

      const hydratedTarget = attachProfiles(targetMatch) ?? { ...targetMatch, creator: null, opponent: null };
      if (targetMatch.creator_id === profile.id) {
        throw new Error('You cannot join your own game.');
      }

      const { data, error } = await client
        .from('matches')
        .update({ opponent_id: profile.id, status: 'in_progress' })
        .eq('id', targetMatch.id)
        .is('opponent_id', null)
        .select(MATCH_WITH_PROFILES)
        .maybeSingle();

      if (error) {
        console.error('Failed to join match', error);
        throw error;
      }

      if (!data) {
        throw new Error('Match is no longer available or has already been joined by another player.');
      }

      const joined = data as unknown as MatchRecord & Partial<LobbyMatch>;
      const mergedProfiles: PlayerProfile[] = [];
      if (joined.creator) mergedProfiles.push(joined.creator);
      if (joined.opponent) mergedProfiles.push(joined.opponent);
      mergePlayers(mergedProfiles);
      const enriched = attachProfiles(joined) ?? {
        ...joined,
        creator: hydratedTarget.creator,
        opponent: profile,
      };
      setState((prev) => ({
        ...prev,
        activeMatchId: enriched.id,
        activeMatch: enriched,
        sessionMode: 'online',
        joinCode: targetMatch.private_join_code,
        moves: [],
        myMatches: upsertMatch(prev.myMatches, enriched),
      }));
      void ensurePlayersLoaded([joined.creator_id, joined.opponent_id ?? undefined]);
      return enriched;
    },
    [attachProfiles, ensurePlayersLoaded, mergePlayers, onlineEnabled, profile],
  );

  const leaveMatch = useCallback(
    async (matchId?: string | null) => {
      const targetId = matchId ?? state.activeMatchId;

      if (!targetId) {
        setState((prev) => ({
          ...prev,
          sessionMode: prev.sessionMode === 'local' ? null : prev.sessionMode,
          activeMatchId: null,
          activeMatch: null,
          moves: [],
          joinCode: null,
          undoRequests: prev.activeMatchId
            ? (() => {
                const next = { ...prev.undoRequests };
                delete next[prev.activeMatchId];
                return next;
              })()
            : prev.undoRequests,
        }));
        return;
      }

      if (targetId === LOCAL_MATCH_ID || state.sessionMode === 'local') {
        setState({ ...INITIAL_STATE });
        return;
      }

      if (!onlineEnabled) {
        setState((prev) => ({
          ...prev,
          sessionMode: null,
          activeMatchId: null,
          activeMatch: null,
          moves: [],
          joinCode: null,
          undoRequests: {},
        }));
        return;
      }

      const client = supabase;
      if (!client || !profile) {
        setState((prev) => ({
          ...prev,
          sessionMode: null,
          activeMatchId: null,
          activeMatch: null,
          moves: [],
          joinCode: null,
          undoRequests: {},
        }));
        return;
      }

      const candidate =
        state.activeMatch && state.activeMatch.id === targetId
          ? state.activeMatch
          : state.myMatches.find((match) => match.id === targetId) ?? null;

      const opponentId =
        candidate?.status === 'in_progress'
          ? profile.id === candidate.creator_id
            ? candidate.opponent_id
            : candidate.creator_id
          : null;

      const existingUndo = state.undoRequests[targetId];

      if (candidate) {
        setState((prev) => {
          const remaining = removeMatch(prev.myMatches, targetId);
          const remainingLobby = removeMatch(prev.matches, targetId);
          const wasActive = prev.activeMatchId === targetId;
          const fallback = wasActive ? selectPreferredMatch(remaining) : null;
          const nextUndo = { ...prev.undoRequests };
          delete nextUndo[targetId];
          return {
            ...prev,
            myMatches: remaining,
            matches: remainingLobby,
            sessionMode: wasActive ? (fallback ? 'online' : null) : prev.sessionMode,
            activeMatchId: wasActive ? fallback?.id ?? null : prev.activeMatchId,
            activeMatch: wasActive ? fallback ?? null : prev.activeMatch,
            moves: wasActive ? [] : prev.moves,
            joinCode: wasActive && fallback ? fallback.private_join_code ?? null : wasActive ? null : prev.joinCode,
            undoRequests: nextUndo,
          };
        });
      }

      const statusToSet: MatchStatus = opponentId ? 'completed' : 'abandoned';
      const { error } = await client.functions.invoke('update-match-status', {
        body: {
          matchId: targetId,
          status: statusToSet,
          winnerId: opponentId ?? null,
        },
      });

      if (error) {
        console.error('Failed to mark match as abandoned', error);
        if (candidate) {
          setState((prev) => {
            const restoredMatches = upsertMatch(prev.matches, candidate);
            const restoredMyMatches = upsertMatch(prev.myMatches, candidate);
            const shouldRestoreActive = prev.activeMatchId === null || prev.activeMatchId === targetId;
            const nextActive = shouldRestoreActive ? candidate : prev.activeMatch;
            const restoredUndo = { ...prev.undoRequests };
            if (existingUndo) {
              restoredUndo[targetId] = existingUndo;
            }
            return {
              ...prev,
              matches: restoredMatches,
              myMatches: restoredMyMatches,
              sessionMode: shouldRestoreActive ? 'online' : prev.sessionMode,
              activeMatchId: shouldRestoreActive ? candidate.id : prev.activeMatchId,
              activeMatch: nextActive,
              undoRequests: restoredUndo,
            };
          });
        }
        return;
      }

      if (!candidate) {
        setState((prev) => ({
          ...prev,
          matches: removeMatch(prev.matches, targetId),
          myMatches: removeMatch(prev.myMatches, targetId),
          undoRequests: (() => {
            if (!existingUndo) return prev.undoRequests;
            const next = { ...prev.undoRequests };
            delete next[targetId];
            return next;
          })(),
        }));
      }
    },
    [onlineEnabled, profile, state.activeMatch, state.activeMatchId, state.myMatches, state.sessionMode, state.undoRequests],
  );

  const submitMove = useCallback(
    async (match: LobbyMatch, moveIndex: number, movePayload: SantoriniMoveAction) => {
      if (!onlineEnabled) {
        throw new Error('Online play is not enabled.');
      }
      const client = supabase;
      if (!client || !profile) {
        throw new Error('Authentication required.');
      }

      const broadcastStart = performance.now();
      
      // 1️⃣ BROADCAST FIRST - Instant feedback (50-100ms)!
      console.log('⚡ Broadcasting move to all players...');
      // Reuse the existing subscribed channel instead of creating a new one
      const channel = channelRef.current || client.channel(`match-${match.id}`);
      
      try {
        await channel.send({
          type: 'broadcast',
          event: 'move',
          payload: {
            move_index: moveIndex,
            player_id: profile.id,
            action: {
              kind: movePayload.kind,
              move: movePayload.move,
              by: movePayload.by,
              clocks: movePayload.clocks,
            },
          },
        });
        
        const broadcastElapsed = performance.now() - broadcastStart;
        console.log(`⚡ Move broadcast in ${broadcastElapsed.toFixed(0)}ms - INSTANT!`);
      } catch (broadcastError) {
        console.warn('⚡ Broadcast failed (will fall back to DB confirmation)', broadcastError);
        // Continue anyway - DB confirmation will handle it
      }

      // 2️⃣ VALIDATE IN BACKGROUND - Non-blocking!
      const validationStart = performance.now();
      console.log('🔒 Validating move on server (async)...');
      
      client.functions
        .invoke('submit-move', {
          body: {
            matchId: match.id,
            moveIndex,
            action: {
              kind: movePayload.kind,
              move: movePayload.move,
              by: movePayload.by,
              clocks: movePayload.clocks,
            },
          },
        })
        .then(({ error }) => {
          const validationElapsed = performance.now() - validationStart;
          
          if (error) {
            console.error(`❌ Move rejected by server after ${validationElapsed.toFixed(0)}ms!`, error);
            
            // Broadcast rejection so all clients can revert
            channel.send({
              type: 'broadcast',
              event: 'move-rejected',
              payload: {
                move_index: moveIndex,
                error: error.message || 'Move validation failed',
              },
            }).catch((e) => console.error('Failed to broadcast rejection', e));
            
            return;
          }
          
          console.log(`✅ Move validated successfully in ${validationElapsed.toFixed(0)}ms`);
        })
        .catch((err) => {
          console.error('Validation request failed', err);
          // The optimistic move will be replaced by DB confirmation
          // or will stay if server is down (eventual consistency)
        });
      
      // Return immediately - don't wait for validation!
      const totalElapsed = performance.now() - broadcastStart;
      console.log(`⚡ TOTAL time (user perception): ${totalElapsed.toFixed(0)}ms`);
    },
    [onlineEnabled, profile, channelRef],
  );

  const updateMatchStatus = useCallback(
    async (status: MatchStatus, payload?: { winner_id?: string | null }) => {
      if (!onlineEnabled) return;
      const client = supabase;
      const matchId = state.activeMatchId;
      if (!client || !matchId) return;

      const { data, error } = await client.functions.invoke('update-match-status', {
        body: {
          matchId,
          status,
          winnerId: payload?.winner_id ?? null,
        },
      });

      if (error) {
        console.error('Failed to update match status', error);
        throw error;
      }

      const response = (data ?? null) as { match?: MatchRecord & Partial<LobbyMatch> } | null;
      const record = response?.match ?? null;
      if (!record) {
        return;
      }
      const enriched = attachProfiles(record) ?? { ...record, creator: null, opponent: null };
      setState((prev) => {
        const myMatches = upsertMatch(prev.myMatches, enriched);
        const activeMatch = prev.activeMatchId === matchId ? enriched : prev.activeMatch;
        return {
          ...prev,
          myMatches,
          activeMatch,
          joinCode: prev.activeMatchId === matchId ? enriched.private_join_code ?? null : prev.joinCode,
        };
      });
    },
    [attachProfiles, onlineEnabled, state.activeMatchId],
  );

  const offerRematch = useCallback(
    async () => {
      if (!onlineEnabled) {
        throw new Error('Online play is not enabled.');
      }
      const client = supabase;
      const currentMatch = state.activeMatch;
      if (!client || !profile || !currentMatch) return null;

      const hasClock = (currentMatch.clock_initial_seconds ?? 0) > 0;
      const clockInitialMinutes = hasClock ? Math.round((currentMatch.clock_initial_seconds ?? 0) / 60) : 0;

      const { data, error } = await client.functions.invoke('create-match', {
        body: {
          visibility: currentMatch.visibility,
          rated: currentMatch.rated,
          hasClock,
          clockInitialMinutes,
          clockIncrementSeconds: currentMatch.clock_increment_seconds,
          startingPlayer: 'opponent',
        },
      });

      if (error) {
        console.error('Failed to create rematch', error);
        throw error;
      }

      const rawResponse = data as unknown;
      const createdResponse =
        rawResponse && typeof rawResponse === 'object' && 'match' in rawResponse
          ? (rawResponse as { match?: MatchRecord & Partial<LobbyMatch> | null }).match ?? null
          : null;
      if (!createdResponse) {
        throw new Error('Rematch response was malformed.');
      }

      // Persist rematch link on the new match
      await client
        .from('matches')
        .update({ rematch_parent_id: currentMatch.id })
        .eq('id', createdResponse.id)
        .throwOnError();

      const record = createdResponse as MatchRecord & Partial<LobbyMatch>;
      const cachedProfiles: PlayerProfile[] = [];
      if (record.creator) cachedProfiles.push(record.creator);
      if (record.opponent) cachedProfiles.push(record.opponent);
      mergePlayers(cachedProfiles);
      const enriched = attachProfiles(record) ?? { ...record, creator: profile, opponent: null };

      // Notify opponent via current match channel
      const channel = channelRef.current;
      if (channel) {
        void channel.send({
          type: 'broadcast',
          event: 'rematch-created',
          payload: {
            match_id: currentMatch.id,
            new_match_id: record.id,
            join_code: record.private_join_code,
          },
        }).catch((broadcastError) => {
          console.warn('Failed to broadcast rematch creation', broadcastError);
        });
      }

      setState((prev) => ({
        ...prev,
        sessionMode: 'online',
        activeMatchId: enriched.id,
        activeMatch: enriched,
        moves: [],
        joinCode: record.private_join_code,
        myMatches: upsertMatch(prev.myMatches, enriched),
      }));
      void ensurePlayersLoaded([record.creator_id, record.opponent_id ?? undefined]);
      return enriched;
    },
    [attachProfiles, ensurePlayersLoaded, mergePlayers, onlineEnabled, profile, state.activeMatch],
  );

  const dismissRematch = useCallback((matchId: string) => {
    setState((prev) => {
      if (!prev.rematchOffers[matchId]) {
        return prev;
      }
      const next = { ...prev.rematchOffers };
      delete next[matchId];
      return { ...prev, rematchOffers: next };
    });
  }, []);

  const acceptRematch = useCallback(
    async (matchId: string) => {
      const offer = state.rematchOffers[matchId];
      if (!offer) {
        throw new Error('Rematch offer not found.');
      }
      try {
        const joined = await joinMatch(matchId);
        setState((prev) => {
          if (!prev.rematchOffers[matchId]) {
            return prev;
          }
          const next = { ...prev.rematchOffers };
          delete next[matchId];
          return { ...prev, rematchOffers: next };
        });
        return joined;
      } catch (error) {
        throw error;
      }
    },
    [joinMatch, state.rematchOffers],
  );

  const requestUndo = useCallback(
    async () => {
      if (!onlineEnabled) {
        throw new Error('Online play is not enabled.');
      }
      const channel = channelRef.current;
      const match = state.activeMatch;
      if (!channel || !match || state.sessionMode !== 'online') {
        throw new Error('No active online match to request undo.');
      }
      if (!profile) {
        throw new Error('Authentication required.');
      }
      if (state.moves.length === 0) {
        throw new Error('There are no moves to undo yet.');
      }
      const role =
        match.creator_id === profile.id
          ? 'creator'
          : match.opponent_id === profile.id
            ? 'opponent'
            : null;
      if (!role) {
        throw new Error('Only participants may request an undo.');
      }
      const lastMoveForRole = [...state.moves]
        .reverse()
        .find((move) => isSantoriniMoveAction(move.action) && move.action.by === role);
      if (!lastMoveForRole) {
        throw new Error('You have not made a move to undo yet.');
      }
      const targetMoveIndex = lastMoveForRole.move_index;
      const existing = state.undoRequests[match.id];
      if (existing && existing.status === 'pending') {
        throw new Error('Undo request already pending.');
      }
      const requestedAt = new Date().toISOString();
      const payload = {
        match_id: match.id,
        move_index: targetMoveIndex,
        requested_by_role: role,
        requested_by_user_id: profile.id,
        requested_at: requestedAt,
      };
      setState((prev) => ({
        ...prev,
        undoRequests: {
          ...prev.undoRequests,
          [match.id]: {
            matchId: match.id,
            moveIndex: targetMoveIndex,
            requestedBy: role,
            requestedAt,
            status: 'pending',
          },
        },
      }));
      try {
        await channel.send({
          type: 'broadcast',
          event: 'undo-request',
          payload,
        });
      } catch (error) {
        setState((prev) => {
          const existing = prev.undoRequests[match.id];
          if (!existing || existing.requestedAt !== requestedAt) {
            return prev;
          }
          const nextUndo = { ...prev.undoRequests };
          delete nextUndo[match.id];
          return { ...prev, undoRequests: nextUndo };
        });
        throw error;
      }
    },
    [onlineEnabled, profile, state.activeMatch, state.moves.length, state.sessionMode, state.undoRequests],
  );

  const respondUndo = useCallback(
    async (accepted: boolean) => {
      if (!onlineEnabled) {
        throw new Error('Online play is not enabled.');
      }
      const channel = channelRef.current;
      const client = supabase;
      const match = state.activeMatch;
      if (!channel || !match || state.sessionMode !== 'online') {
        throw new Error('No active online match to respond to.');
      }
      if (!profile) {
        throw new Error('Authentication required.');
      }
      const pending = state.undoRequests[match.id];
      if (!pending || pending.status !== 'pending') {
        throw new Error('There is no pending undo request to respond to.');
      }
      const responderRole =
        match.creator_id === profile.id
          ? 'creator'
          : match.opponent_id === profile.id
            ? 'opponent'
            : null;
      if (!responderRole) {
        throw new Error('Only participants may respond to undo requests.');
      }
      const requestedMoveIndex = pending.moveIndex;
      let undoResult:
        | {
            undone?: boolean;
            moveIndex?: number;
            removedMoveIndexes?: number[];
            snapshot?: SantoriniStateSnapshot | null;
          }
        | null = null;
      if (accepted) {
        if (!client) {
          throw new Error('Supabase client unavailable.');
        }
        const { data, error } = await client.functions.invoke('submit-move', {
          body: {
            matchId: match.id,
            moveIndex: requestedMoveIndex,
            action: {
              kind: 'undo.accept',
              moveIndex: requestedMoveIndex,
            },
          },
        });
        if (error) {
          console.error('Failed to apply undo on server', error);
          throw error;
        }
        undoResult = (data ?? null) as {
          undone?: boolean;
          moveIndex?: number;
          removedMoveIndexes?: number[];
          snapshot?: SantoriniStateSnapshot | null;
        } | null;
      }
      const respondedAt = new Date().toISOString();
      await channel.send({
        type: 'broadcast',
        event: 'undo-response',
        payload: {
          match_id: match.id,
          move_index: requestedMoveIndex,
          accepted,
          responded_by_role: responderRole,
          responded_by_user_id: profile.id,
          responded_at: respondedAt,
        },
      });
      if (undoResult?.undone) {
        const removedIndexes = Array.isArray(undoResult.removedMoveIndexes) && undoResult.removedMoveIndexes.length > 0
          ? Array.from(new Set(undoResult.removedMoveIndexes)).sort((a, b) => a - b)
          : [undoResult.moveIndex ?? requestedMoveIndex];
        try {
          await channel.send({
            type: 'broadcast',
            event: 'undo-applied',
            payload: {
              match_id: match.id,
              move_index: undoResult.moveIndex ?? requestedMoveIndex,
              removed_move_indexes: removedIndexes,
              snapshot: undoResult.snapshot ?? null,
            },
          });
        } catch (broadcastError) {
          console.warn('Failed to broadcast undo-applied event', broadcastError);
        }
      }
      setState((prev) => {
        const existing = prev.undoRequests[match.id];
        if (!existing) {
          return prev;
        }
        const targetIndex = undoResult?.moveIndex ?? existing.moveIndex ?? requestedMoveIndex;
        const removedIndexesSet =
          undoResult?.undone && Array.isArray(undoResult?.removedMoveIndexes) && undoResult.removedMoveIndexes.length > 0
            ? new Set(undoResult.removedMoveIndexes)
            : undoResult?.undone
              ? new Set([targetIndex])
              : null;
        const updatedMoves =
          undoResult?.undone && removedIndexesSet
            ? prev.moves.filter((move) => !removedIndexesSet.has(move.move_index))
            : prev.moves;
        return {
          ...prev,
          moves: updatedMoves,
          undoRequests: {
            ...prev.undoRequests,
            [match.id]: {
              ...existing,
              moveIndex: targetIndex,
              status: accepted ? (undoResult?.undone ? 'applied' : 'accepted') : 'rejected',
              respondedBy: responderRole,
            },
          },
        };
      });
    },
    [onlineEnabled, profile, state.activeMatch, state.sessionMode, state.undoRequests],
  );

  const clearUndoRequest = useCallback((matchId: string) => {
    setState((prev) => {
      if (!prev.undoRequests[matchId]) {
        return prev;
      }
      const next = { ...prev.undoRequests };
      delete next[matchId];
      return { ...prev, undoRequests: next };
    });
  }, []);

  const requestAbort = useCallback(
    async () => {
      if (!onlineEnabled) {
        throw new Error('Online play is not enabled.');
      }
      const client = supabase;
      const match = state.activeMatch;
      if (!client || !match || state.sessionMode !== 'online') {
        throw new Error('No active online match.');
      }
      if (!profile) {
        throw new Error('Authentication required.');
      }
      if (match.status !== 'in_progress') {
        throw new Error('Can only abort matches that are in progress.');
      }
      const role =
        match.creator_id === profile.id
          ? 'creator'
          : match.opponent_id === profile.id
            ? 'opponent'
            : null;
      if (!role) {
        throw new Error('Only participants may request an abort.');
      }
      const existing = state.abortRequests[match.id];
      if (existing && existing.status === 'pending') {
        throw new Error('Abort request already pending.');
      }
      const requestedAt = new Date().toISOString();
      
      // Create abort request in database
      const { data, error } = await client
        .from('abort_requests')
        .insert({
          match_id: match.id,
          requested_by: profile.id,
          requested_at: requestedAt,
          status: 'pending',
        })
        .select()
        .single();
      
      if (error) {
        console.error('Failed to create abort request', error);
        throw error;
      }
      
      setState((prev) => ({
        ...prev,
        abortRequests: {
          ...prev.abortRequests,
          [match.id]: {
            matchId: match.id,
            requestedBy: role,
            requestedAt,
            status: 'pending',
          },
        },
      }));
      
      // Broadcast to other player
      const channel = channelRef.current;
      if (channel) {
        try {
          await channel.send({
            type: 'broadcast',
            event: 'abort-request',
            payload: {
              match_id: match.id,
              requested_by_role: role,
              requested_by_user_id: profile.id,
              requested_at: requestedAt,
            },
          });
        } catch (broadcastError) {
          console.warn('Failed to broadcast abort request', broadcastError);
        }
      }
    },
    [onlineEnabled, profile, state.abortRequests, state.activeMatch, state.sessionMode],
  );

  const respondAbort = useCallback(
    async (accepted: boolean) => {
      if (!onlineEnabled) {
        throw new Error('Online play is not enabled.');
      }
      const client = supabase;
      const match = state.activeMatch;
      if (!client || !match || state.sessionMode !== 'online') {
        throw new Error('No active online match to respond to.');
      }
      if (!profile) {
        throw new Error('Authentication required.');
      }
      const pending = state.abortRequests[match.id];
      if (!pending || pending.status !== 'pending') {
        throw new Error('There is no pending abort request to respond to.');
      }
      const responderRole =
        match.creator_id === profile.id
          ? 'creator'
          : match.opponent_id === profile.id
            ? 'opponent'
            : null;
      if (!responderRole) {
        throw new Error('Only participants may respond to abort requests.');
      }
      
      const respondedAt = new Date().toISOString();
      
      // Update abort request in database
      const { error: updateError } = await client
        .from('abort_requests')
        .update({
          status: accepted ? 'accepted' : 'rejected',
          responded_by: profile.id,
          responded_at: respondedAt,
        })
        .eq('match_id', match.id)
        .eq('status', 'pending');
      
      if (updateError) {
        console.error('Failed to update abort request', updateError);
        throw updateError;
      }
      
      // If accepted, the database trigger will update the match status
      
      setState((prev) => {
        const existing = prev.abortRequests[match.id];
        if (!existing) {
          return prev;
        }
        return {
          ...prev,
          abortRequests: {
            ...prev.abortRequests,
            [match.id]: {
              ...existing,
              status: accepted ? 'accepted' : 'rejected',
              respondedBy: responderRole,
            },
          },
        };
      });
      
      // Broadcast response to other player
      const channel = channelRef.current;
      if (channel) {
        try {
          await channel.send({
            type: 'broadcast',
            event: 'abort-response',
            payload: {
              match_id: match.id,
              accepted,
              responded_by_role: responderRole,
              responded_by_user_id: profile.id,
              responded_at: respondedAt,
            },
          });
        } catch (broadcastError) {
          console.warn('Failed to broadcast abort response', broadcastError);
        }
      }
    },
    [onlineEnabled, profile, state.abortRequests, state.activeMatch, state.sessionMode],
  );

  const sendEmojiReaction = useCallback(
    async (emoji: string) => {
      if (!emoji || typeof emoji !== 'string') {
        return;
      }
      const match = activeMatchRef.current;
      const channel = channelRef.current;
      if (!channel || !match || state.sessionMode !== 'online' || !profile) {
        return;
      }
      const timestamp = Date.now();
      const role = activeRoleRef.current ?? null;
      const id = `emoji-${match.id}-${timestamp}-${emojiCounterRef.current++}`;
      const reaction: EmojiReaction = {
        id,
        matchId: match.id,
        emoji,
        playerId: profile.id,
        role,
        createdAt: timestamp,
      };
      pushEmojiReaction(reaction);
      try {
        await channel.send({
          type: 'broadcast',
          event: 'emoji',
          payload: {
            id,
            match_id: match.id,
            emoji,
            player_id: profile.id,
            role,
            timestamp,
          },
        });
      } catch (error) {
        console.warn('useMatchLobby: Failed to send emoji reaction', error);
      }
    },
    [profile, pushEmojiReaction, state.sessionMode],
  );

  const clearAbortRequest = useCallback((matchId: string) => {
    setState((prev) => {
      if (!prev.abortRequests[matchId]) {
        return prev;
      }
      const nextAbort = { ...prev.abortRequests };
      delete nextAbort[matchId];
      return { ...prev, abortRequests: nextAbort };
    });
  }, []);

  const setActiveMatch = useCallback(
    (matchId: string | null) => {
      if (matchId === LOCAL_MATCH_ID) {
        setState({
          ...INITIAL_STATE,
          sessionMode: 'local',
          activeMatchId: LOCAL_MATCH_ID,
          activeMatch: createLocalMatch(),
        });
        return;
      }
      setState((prev) => {
        if (!matchId) {
          return {
            ...prev,
            sessionMode: prev.sessionMode === 'local' ? null : prev.sessionMode,
            activeMatchId: null,
            activeMatch: null,
            moves: [],
            joinCode: null,
          };
        }
        const nextMatch =
          prev.myMatches.find((match) => match.id === matchId) ??
          (prev.activeMatch?.id === matchId ? prev.activeMatch : null);
        const hydrated = nextMatch ? attachProfiles(nextMatch) ?? nextMatch : null;
        const sameMatch = prev.activeMatchId === matchId;
        return {
          ...prev,
          sessionMode: 'online',
          activeMatchId: matchId,
          activeMatch: hydrated,
          moves: sameMatch ? prev.moves : [],
          joinCode: hydrated?.private_join_code ?? (sameMatch ? prev.joinCode : null),
        };
      });
    },
    [attachProfiles],
  );

  const activeRole = useMemo<'creator' | 'opponent' | null>(() => {
    if (!profile || !state.activeMatch || state.sessionMode !== 'online') return null;
    if (state.activeMatch.creator_id === profile.id) return 'creator';
    if (state.activeMatch.opponent_id === profile.id) return 'opponent';
    return null;
  }, [profile, state.activeMatch, state.sessionMode]);

  useEffect(() => {
    activeRoleRef.current = activeRole ?? null;
  }, [activeRole]);

  const hasActiveGame = useMemo(() => {
    return state.myMatches.some(m => 
      m.status === 'waiting_for_opponent' || m.status === 'in_progress'
    );
  }, [state.myMatches]);

  const myMatchesWithProfiles = useMemo(
    () =>
      state.myMatches.map((match) => {
        const enriched = attachProfiles(match);
        return enriched ?? { ...match, creator: null, opponent: null };
      }),
    [attachProfiles, state.myMatches],
  );

  const matchesWithProfiles = useMemo(
    () =>
      state.matches.map((match) => {
        const enriched = attachProfiles(match);
        return enriched ?? { ...match, creator: null, opponent: null };
      }),
    [attachProfiles, state.matches],
  );

  const activeMatchWithProfiles = useMemo(() => attachProfiles(state.activeMatch), [attachProfiles, state.activeMatch]);

  const startLocalMatch = useCallback(() => {
    const localMatch = createLocalMatch();
    // Set flag to prevent useEffect from clearing the match when we disable online
    isStartingLocalMatchRef.current = true;
    setOnlineEnabled(false);
    setState({
      ...INITIAL_STATE,
      sessionMode: 'local',
      activeMatchId: localMatch.id,
      activeMatch: localMatch,
    });
    // Reset flag after state is set
    setTimeout(() => {
      isStartingLocalMatchRef.current = false;
    }, 0);
  }, []);

  const stopLocalMatch = useCallback(() => {
    setState((prev) => ({
      ...prev,
      sessionMode: null,
      activeMatchId: null,
      activeMatch: null,
      moves: [],
      joinCode: null,
      undoRequests: {},
      rematchOffers: {},
    }));
  }, []);

  const enableOnline = useCallback(() => {
    setOnlineEnabled(true);
    setState((prev) => {
      if (prev.sessionMode === 'local') {
        return {
          ...prev,
          sessionMode: 'online',
          activeMatchId: null,
          activeMatch: null,
          moves: [],
          joinCode: null,
        };
      }
      return { ...prev, sessionMode: 'online' };
    });
  }, []);

  const disableOnline = useCallback(() => {
    setOnlineEnabled(false);
    setState((prev) => ({
      ...prev,
      sessionMode: null,
      activeMatchId: null,
      activeMatch: null,
      moves: [],
      joinCode: null,
      undoRequests: {},
      rematchOffers: {},
    }));
  }, []);

  useEffect(() => {
    return () => {
      Object.values(emojiTimeoutsRef.current).forEach((timeout) => {
        clearTimeout(timeout);
      });
      emojiTimeoutsRef.current = {};
    };
  }, []);

  return {
    matches: matchesWithProfiles,
    myMatches: myMatchesWithProfiles,
    loading: state.loading,
    activeMatchId: state.activeMatchId,
    activeMatch: activeMatchWithProfiles,
    moves: state.moves,
    joinCode: state.joinCode,
    activeRole,
    sessionMode: state.sessionMode,
    onlineEnabled,
    hasActiveGame,
    undoRequests: state.undoRequests,
    abortRequests: state.abortRequests,
    rematchOffers: state.rematchOffers,
    connectionStates: state.connectionStates,
    emojiReactions,
    setActiveMatch,
    createMatch,
    joinMatch,
    leaveMatch,
    submitMove,
    updateMatchStatus,
    offerRematch,
    acceptRematch,
    dismissRematch,
    startLocalMatch,
    stopLocalMatch,
    enableOnline,
    disableOnline,
    requestUndo,
    respondUndo,
    clearUndoRequest,
    requestAbort,
    respondAbort,
    clearAbortRequest,
    sendEmojiReaction,
  };
}

export type UseMatchLobbyReturn = ReturnType<typeof useMatchLobby>;
