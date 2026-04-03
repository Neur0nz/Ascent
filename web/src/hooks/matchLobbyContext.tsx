import { createContext, useContext, useMemo, type ReactNode, useEffect } from 'react';
import type { PlayerProfile } from '@/types/match';
import { useMatchLobby } from './useMatchLobby';
import type { UseMatchLobbyReturn } from './useMatchLobby';

/**
 * Split the lobby context into focused slices so consumers only re-render
 * when the slice they actually read changes.
 */

// ── Core match state (changes rarely) ──────────────────────────────────
export interface MatchCoreSlice {
  activeMatch: UseMatchLobbyReturn['activeMatch'];
  activeMatchId: UseMatchLobbyReturn['activeMatchId'];
  myMatches: UseMatchLobbyReturn['myMatches'];
  matches: UseMatchLobbyReturn['matches'];
  moves: UseMatchLobbyReturn['moves'];
  loading: UseMatchLobbyReturn['loading'];
  joinCode: UseMatchLobbyReturn['joinCode'];
  sessionMode: UseMatchLobbyReturn['sessionMode'];
  lastCompletedMatch: UseMatchLobbyReturn['lastCompletedMatch'];
}

// ── Actions (stable refs – almost never changes) ───────────────────────
export interface MatchActionsSlice {
  createMatch: UseMatchLobbyReturn['createMatch'];
  joinMatch: UseMatchLobbyReturn['joinMatch'];
  leaveMatch: UseMatchLobbyReturn['leaveMatch'];
  submitMove: UseMatchLobbyReturn['submitMove'];
  updateMatchStatus: UseMatchLobbyReturn['updateMatchStatus'];
  requestUndo: UseMatchLobbyReturn['requestUndo'];
  respondUndo: UseMatchLobbyReturn['respondUndo'];
  enableOnline: UseMatchLobbyReturn['enableOnline'];
  disableOnline: UseMatchLobbyReturn['disableOnline'];
  pingOpponent: UseMatchLobbyReturn['pingOpponent'];
  sendEmojiReaction: UseMatchLobbyReturn['sendEmojiReaction'];
}

// ── Presence / connection state (changes frequently) ───────────────────
export interface MatchPresenceSlice {
  connectionStates: UseMatchLobbyReturn['connectionStates'];
  onlineEnabled: UseMatchLobbyReturn['onlineEnabled'];
}

// ── Request states (changes on user action) ────────────────────────────
export interface MatchRequestsSlice {
  undoRequests: UseMatchLobbyReturn['undoRequests'];
  abortRequests: UseMatchLobbyReturn['abortRequests'];
  rematchOffers: UseMatchLobbyReturn['rematchOffers'];
  emojiReactions: UseMatchLobbyReturn['emojiReactions'];
}

// ── Contexts ───────────────────────────────────────────────────────────
const MatchCoreContext = createContext<MatchCoreSlice | null>(null);
const MatchActionsContext = createContext<MatchActionsSlice | null>(null);
const MatchPresenceContext = createContext<MatchPresenceSlice | null>(null);
const MatchRequestsContext = createContext<MatchRequestsSlice | null>(null);

// Keep the full-value context for backward compat so callers that need
// everything can still import the existing hook unchanged.
type MatchLobbyValue = ReturnType<typeof useMatchLobby>;
const MatchLobbyContext = createContext<MatchLobbyValue | null>(null);

// ── Provider ───────────────────────────────────────────────────────────

interface MatchLobbyProviderProps {
  profile: PlayerProfile | null;
  children: ReactNode;
}

export function MatchLobbyProvider({ profile, children }: MatchLobbyProviderProps) {
  const lobby = useMatchLobby(profile, { autoConnectOnline: true });
  const { onlineEnabled, disableOnline, enableOnline, sessionMode } = lobby;

  useEffect(() => {
    if (sessionMode === 'local') return;
    if (!profile && onlineEnabled) {
      disableOnline();
    } else if (profile && !onlineEnabled) {
      enableOnline();
    }
  }, [profile, onlineEnabled, disableOnline, enableOnline, sessionMode]);

  // Memoize each slice so consumers only re-render for their slice
  const coreSlice = useMemo<MatchCoreSlice>(
    () => ({
      activeMatch: lobby.activeMatch,
      activeMatchId: lobby.activeMatchId,
      myMatches: lobby.myMatches,
      matches: lobby.matches,
      moves: lobby.moves,
      loading: lobby.loading,
      joinCode: lobby.joinCode,
      sessionMode: lobby.sessionMode,
      lastCompletedMatch: lobby.lastCompletedMatch,
    }),
    [
      lobby.activeMatch,
      lobby.activeMatchId,
      lobby.myMatches,
      lobby.matches,
      lobby.moves,
      lobby.loading,
      lobby.joinCode,
      lobby.sessionMode,
      lobby.lastCompletedMatch,
    ],
  );

  const actionsSlice = useMemo<MatchActionsSlice>(
    () => ({
      createMatch: lobby.createMatch,
      joinMatch: lobby.joinMatch,
      leaveMatch: lobby.leaveMatch,
      submitMove: lobby.submitMove,
      updateMatchStatus: lobby.updateMatchStatus,
      requestUndo: lobby.requestUndo,
      respondUndo: lobby.respondUndo,
      enableOnline: lobby.enableOnline,
      disableOnline: lobby.disableOnline,
      pingOpponent: lobby.pingOpponent,
      sendEmojiReaction: lobby.sendEmojiReaction,
    }),
    [
      lobby.createMatch,
      lobby.joinMatch,
      lobby.leaveMatch,
      lobby.submitMove,
      lobby.updateMatchStatus,
      lobby.requestUndo,
      lobby.respondUndo,
      lobby.enableOnline,
      lobby.disableOnline,
      lobby.pingOpponent,
      lobby.sendEmojiReaction,
    ],
  );

  const presenceSlice = useMemo<MatchPresenceSlice>(
    () => ({
      connectionStates: lobby.connectionStates,
      onlineEnabled: lobby.onlineEnabled,
    }),
    [lobby.connectionStates, lobby.onlineEnabled],
  );

  const requestsSlice = useMemo<MatchRequestsSlice>(
    () => ({
      undoRequests: lobby.undoRequests,
      abortRequests: lobby.abortRequests,
      rematchOffers: lobby.rematchOffers,
      emojiReactions: lobby.emojiReactions,
    }),
    [lobby.undoRequests, lobby.abortRequests, lobby.rematchOffers, lobby.emojiReactions],
  );

  return (
    <MatchLobbyContext.Provider value={lobby}>
      <MatchCoreContext.Provider value={coreSlice}>
        <MatchActionsContext.Provider value={actionsSlice}>
          <MatchPresenceContext.Provider value={presenceSlice}>
            <MatchRequestsContext.Provider value={requestsSlice}>
              {children}
            </MatchRequestsContext.Provider>
          </MatchPresenceContext.Provider>
        </MatchActionsContext.Provider>
      </MatchCoreContext.Provider>
    </MatchLobbyContext.Provider>
  );
}

// ── Hooks ──────────────────────────────────────────────────────────────

/** Full lobby value – use sparingly; prefer the focused hooks below. */
export function useMatchLobbyContext(): MatchLobbyValue {
  const context = useContext(MatchLobbyContext);
  if (!context) {
    throw new Error('useMatchLobbyContext must be used within a MatchLobbyProvider');
  }
  return context;
}

/** Core match state – matches, moves, active match, loading. */
export function useMatchCore(): MatchCoreSlice {
  const context = useContext(MatchCoreContext);
  if (!context) {
    throw new Error('useMatchCore must be used within a MatchLobbyProvider');
  }
  return context;
}

/** Stable action dispatchers – rarely triggers re-renders. */
export function useMatchActions(): MatchActionsSlice {
  const context = useContext(MatchActionsContext);
  if (!context) {
    throw new Error('useMatchActions must be used within a MatchLobbyProvider');
  }
  return context;
}

/** Connection / presence state – updates frequently. */
export function useMatchPresence(): MatchPresenceSlice {
  const context = useContext(MatchPresenceContext);
  if (!context) {
    throw new Error('useMatchPresence must be used within a MatchLobbyProvider');
  }
  return context;
}

/** Undo, abort, rematch, and emoji reactions. */
export function useMatchRequests(): MatchRequestsSlice {
  const context = useContext(MatchRequestsContext);
  if (!context) {
    throw new Error('useMatchRequests must be used within a MatchLobbyProvider');
  }
  return context;
}
