import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SantoriniEngine, type SantoriniSnapshot, type PlacementContext } from '@/lib/santoriniEngine';
import { TypeScriptMoveSelector } from '@/lib/moveSelectorTS';
import { createBoardViewFromSnapshot, createEmptyMask, type BoardCell } from '@game/boardView';
import type { LobbyMatch } from './useMatchLobby';
import type { MatchAction, MatchMoveRecord, SantoriniMoveAction } from '@/types/match';
import { computeSynchronizedClock, deriveInitialClocks, getIncrementMs, type ClockState } from './clockUtils';
import { isAiMatch, getPlayerZeroRole, getOppositeRole } from '@/utils/matchAiDepth';
import { createCancelMaskFromSelector } from '@/utils/moveSelectorMasks';
import { isSantoriniMoveAction } from '@/utils/matchActions';
import { useToast } from '@chakra-ui/react';

export interface UseOnlineSantoriniOptions {
  match: LobbyMatch | null;
  moves: MatchMoveRecord<MatchAction>[];
  role: 'creator' | 'opponent' | null;
  onSubmitMove: (match: LobbyMatch, index: number, action: SantoriniMoveAction) => Promise<void>;
  onGameComplete?: (winnerId: string | null) => void;
}

interface PendingLocalMove {
  expectedMoveIndex: number;
  moveAction: number | number[];
  snapshotBefore: SantoriniSnapshot | null;
}

/**
 * TypeScript-based online Santorini hook
 * 
 * NO PYTHON/PYODIDE! Pure TypeScript for fast loading and validation.
 * Uses the lightweight SantoriniEngine for all game logic.
 */

const TICK_INTERVAL = 250;

const toMoveArray = (move: number | number[] | null | undefined): number[] => {
  if (Array.isArray(move)) {
    return move
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0);
  }
  return typeof move === 'number' && Number.isInteger(move) && move >= 0 ? [move] : [];
};

const mapPlayerIndexToRole = (
  playerIndex: number,
  playerZeroRole: 'creator' | 'opponent',
): 'creator' | 'opponent' => {
  // Player 0 is always the starting player, their role is defined by playerZeroRole
  if (playerIndex === 0) {
    return playerZeroRole;
  }
  // Player 1 is the other player
  return getOppositeRole(playerZeroRole);
};

const resolveActiveRole = (
  engine: SantoriniEngine,
  playerZeroRole: 'creator' | 'opponent',
): 'creator' | 'opponent' => {
  const placement = engine.getPlacementContext();
  if (placement) {
    return mapPlayerIndexToRole(placement.player, playerZeroRole);
  }
  return mapPlayerIndexToRole(engine.player, playerZeroRole);
};

const isRoleTurn = (
  engine: SantoriniEngine,
  role: 'creator' | 'opponent' | null,
  playerZeroRole: 'creator' | 'opponent',
): boolean => {
  if (!role) {
    return false;
  }
  return resolveActiveRole(engine, playerZeroRole) === role;
};

const getLastSantoriniMove = (records: MatchMoveRecord<MatchAction>[]): number | null => {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const action = records[index]?.action;
    if (isSantoriniMoveAction(action)) {
      const sequence = toMoveArray(action.move);
      if (sequence.length > 0) {
        return sequence[sequence.length - 1];
      }
    }
  }
  return null;
};

const getNextMoveIndexFromRecords = (records: MatchMoveRecord<MatchAction>[]): number => {
  let maxMoveIndex = -1;
  for (const record of records) {
    if (typeof record.move_index === 'number') {
      maxMoveIndex = Math.max(maxMoveIndex, record.move_index);
    }
  }
  return maxMoveIndex + 1;
};

const isDevEnv = typeof import.meta !== 'undefined' ? Boolean(import.meta.env?.DEV) : false;
const debugLog = (...args: unknown[]) => {
  if (isDevEnv) {
    console.log(...args);
  }
};
const debugWarn = (...args: unknown[]) => {
  if (isDevEnv) {
    console.warn(...args);
  }
};

function computeSelectable(
  validMoves: boolean[],
  snapshot: SantoriniSnapshot,
  moveSelector: TypeScriptMoveSelector | null,
  isMyTurn: boolean,
  placement: PlacementContext | null,
): boolean[][] {
  const selectable: boolean[][] = Array.from({ length: 5 }, () => Array(5).fill(false));

  // If it's not my turn, don't highlight anything!
  if (!isMyTurn) {
    return selectable;
  }

  // During placement phase highlight available empty squares
  if (placement) {
    for (let i = 0; i < 25; i++) {
      if (validMoves[i]) {
        const y = Math.floor(i / 5);
        const x = i % 5;
        selectable[y][x] = true;
      }
    }
    return selectable;
  }
  
  // During game phase: Use move selector to highlight relevant cells
  if (moveSelector) {
    return moveSelector.computeSelectable(snapshot.board, validMoves, snapshot.player);
  }
  
  return selectable;
}

export function useOnlineSantorini(options: UseOnlineSantoriniOptions) {
  const { match, moves, role, onSubmitMove, onGameComplete } = options;
  const matchId = match?.id ?? null;
  const matchIsAi = useMemo(() => isAiMatch(match), [match]);
  const toast = useToast();
  const playerZeroRole = useMemo(
    () => getPlayerZeroRole(match),
    [match?.initial_state, match?.id],
  );
  
  // Game engine state - pure TypeScript!
  // NOTE: engineRef is the SINGLE SOURCE OF TRUTH for game state
  // The state variables are only for triggering React re-renders
  const engineRef = useRef<SantoriniEngine>(SantoriniEngine.createInitial().engine);
  const [engineVersion, setEngineVersion] = useState(0); // Trigger re-renders when engine changes
  const [board, setBoard] = useState<BoardCell[][]>(() => createBoardViewFromSnapshot(engineRef.current.snapshot));
  const moveSelectorRef = useRef<TypeScriptMoveSelector>(new TypeScriptMoveSelector());
  const [selectable, setSelectable] = useState<boolean[][]>(() =>
    computeSelectable(
      engineRef.current.getValidMoves(),
      engineRef.current.snapshot,
      moveSelectorRef.current,
      false,
      engineRef.current.getPlacementContext(),
    ),
  );
  const [cancelSelectable, setCancelSelectable] = useState<boolean[][]>(() => createEmptyMask());
  
  // Clock state
  const [clock, setClock] = useState<ClockState>(() => deriveInitialClocks(match));
  const [clockEnabled, setClockEnabled] = useState(match?.clock_initial_seconds ? match.clock_initial_seconds > 0 : false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const [placementComplete, setPlacementComplete] = useState<boolean>(
    () => engineRef.current.getPlacementContext() === null,
  );
  const incrementMs = useMemo(() => getIncrementMs(match), [match?.id, match?.clock_increment_seconds]);
  
  // Sync tracking and locks
  const lastSyncedStateRef = useRef<{ matchId: string | null; snapshotMoveIndex: number; appliedMoveCount: number }>({ 
    matchId: null, 
    snapshotMoveIndex: -1,
    appliedMoveCount: 0
  });
  const pendingLocalMovesRef = useRef<PendingLocalMove[]>([]);
  const placementBatchRef = useRef<{ actions: number[]; snapshotBefore: SantoriniSnapshot | null }>({
    actions: [],
    snapshotBefore: null,
  });
  const nextLocalMoveIndexRef = useRef<number>(0);
  const [pendingMoveVersion, setPendingMoveVersion] = useState(0); // Trigger submission effect
  const gameCompletedRef = useRef<string | null>(null);
  const submissionLockRef = useRef<boolean>(false);
  const syncInProgressRef = useRef<boolean>(false); // Prevent moves during sync
  const processingMoveRef = useRef<boolean>(false); // Prevent rapid clicks
  const [syncing, setSyncing] = useState(false);
  const [pendingSubmissionCount, setPendingSubmissionCount] = useState(0);
  const setSyncInProgress = useCallback((value: boolean) => {
    syncInProgressRef.current = value;
    setSyncing(value);
  }, []);
  
  // Helper function to atomically update engine and derived state
  const updateEngineState = useCallback((newEngine: SantoriniEngine, myTurn: boolean) => {
    engineRef.current = newEngine;
    const newBoard = createBoardViewFromSnapshot(newEngine.snapshot);
    const newSelectable = myTurn
      ? computeSelectable(
          newEngine.getValidMoves(),
          newEngine.snapshot,
          moveSelectorRef.current,
          true,
          newEngine.getPlacementContext(),
        )
      : createEmptyMask();
    const newCancelSelectable = myTurn
      ? createCancelMaskFromSelector(moveSelectorRef.current)
      : createEmptyMask();
    
    // Batch all state updates together to prevent intermediate renders
    setBoard(newBoard);
    setSelectable(newSelectable);
    setCancelSelectable(newCancelSelectable);
    setPlacementComplete(newEngine.getPlacementContext() === null);
    setEngineVersion(v => v + 1);
  }, []);
  
  const resetMatch = useCallback(() => {
    if (!match) return;
    
    try {
      const newEngine = SantoriniEngine.fromSnapshot(match.initial_state);
      moveSelectorRef.current.reset();
      const myTurn = isRoleTurn(newEngine, role, playerZeroRole);
      
      // Atomically update all state
      updateEngineState(newEngine, myTurn);
      
      lastSyncedStateRef.current = { 
        matchId: match.id, 
        snapshotMoveIndex: -1,
        appliedMoveCount: 0
      };
      pendingLocalMovesRef.current = [];
      placementBatchRef.current = { actions: [], snapshotBefore: null };
      setPendingSubmissionCount(0);
      setClock(deriveInitialClocks(match));
      nextLocalMoveIndexRef.current = moves.length;
    } catch (error) {
      console.error('Failed to reset match to server snapshot', error);
    }
  }, [match, moves.length, playerZeroRole, role, updateEngineState]);

  const previousMatchRef = useRef<{
    id: string | null;
    status: string | null;
    clockSeconds: number | null;
  }>({ id: null, status: null, clockSeconds: null });

  // Match change effect - reset clocks when match changes
  useEffect(() => {
    const previous = previousMatchRef.current;

    if (!match) {
      setClock(deriveInitialClocks(null));
      setClockEnabled(false);
      lastSyncedStateRef.current = { matchId: null, snapshotMoveIndex: -1, appliedMoveCount: 0 };
      pendingLocalMovesRef.current = [];
      placementBatchRef.current = { actions: [], snapshotBefore: null };
      setPendingSubmissionCount(0);
      previousMatchRef.current = { id: null, status: null, clockSeconds: null };
      setPlacementComplete(false);
      setSyncInProgress(false);
      return;
    }

    const next: typeof previous = {
      id: match.id,
      status: match.status,
      clockSeconds: match.clock_initial_seconds,
    };

    const shouldResetClock =
      previous.id !== next.id ||
      previous.clockSeconds !== next.clockSeconds ||
      (previous.status === 'waiting_for_opponent' && next.status === 'in_progress');

    if (shouldResetClock) {
      setClock(deriveInitialClocks(match));
      lastSyncedStateRef.current = { matchId: match.id, snapshotMoveIndex: -1, appliedMoveCount: 0 };
      pendingLocalMovesRef.current = [];
      placementBatchRef.current = { actions: [], snapshotBefore: null };
      setPendingSubmissionCount(0);
      resetMatch();
    }

    setClockEnabled(match.clock_initial_seconds ? match.clock_initial_seconds > 0 : false);
    previousMatchRef.current = next;
  }, [match?.id, match?.clock_initial_seconds, match?.status, match, resetMatch, setSyncInProgress]);

  // State synchronization effect - import snapshots and replay moves
  useEffect(() => {
    if (!match) {
      lastSyncedStateRef.current = { matchId: null, snapshotMoveIndex: -1, appliedMoveCount: 0 };
      setPendingSubmissionCount(0);
      setSyncInProgress(false);
      return;
    }

    const lastSynced = lastSyncedStateRef.current;
    
    const needsResync = 
      lastSynced.matchId !== match.id || 
      lastSynced.appliedMoveCount !== moves.length;

    if (!needsResync) {
      setSyncInProgress(false);
      return;
    }

    // Mark sync as in progress to block user moves
    setSyncInProgress(true);

    const syncStart = performance.now();
    debugLog('useOnlineSantorini: Syncing state', { 
      matchId: match.id, 
      movesCount: moves.length, 
      lastSynced 
    });

    // OPTIMIZATION: If we only have 1 new optimistic move, use fast path
    const lastMove = moves[moves.length - 1];
    const isOptimisticOnly =
      moves.length === lastSynced.appliedMoveCount + 1 && lastMove?.id.startsWith('optimistic-');
    if (isOptimisticOnly && moves.length > 0) {
      const lastMove = moves[moves.length - 1];
      const action = lastMove.action;
      
      if (isSantoriniMoveAction(action)) {
        const moveSequence = toMoveArray(action.move);
        if (moveSequence.length === 0) {
          setSyncInProgress(false);
          return;
        }
        if (action.by === role) {
          debugLog('⚡ FAST PATH skipped for local move');
          setSyncInProgress(false);
          return;
        }
        try {
          debugLog('⚡ FAST PATH: Applying optimistic move sequence', moveSequence);
          
          // Use engineRef for current state (not stale useState value)
          const currentEngine = engineRef.current;

          // Strict guards: only fast-apply if it's the correct player's turn and moves are valid
          const engineTurnRole = resolveActiveRole(currentEngine, playerZeroRole);
          if (action.by && action.by !== engineTurnRole) {
            throw new Error(`Out-of-turn optimistic apply (expected ${engineTurnRole}, got ${action.by})`);
          }
          
          let lastResult: { snapshot: SantoriniSnapshot; winner: 0 | 1 | null } | null = null;
          for (const value of moveSequence) {
            const valid = currentEngine.getValidMoves();
            if (!valid[value]) {
              throw new Error('Optimistic move not valid on current snapshot');
            }
            lastResult = currentEngine.applyMove(value);
          }

          if (!lastResult) {
            throw new Error('No optimistic moves applied');
          }

          const newEngine = SantoriniEngine.fromSnapshot(lastResult.snapshot);
          
          moveSelectorRef.current.reset();
          
          // Atomically update all state
          const myTurn = isRoleTurn(newEngine, role, playerZeroRole);
          updateEngineState(newEngine, myTurn);

          if (action.clocks) {
            setClock({
              creatorMs: action.clocks.creatorMs,
              opponentMs: action.clocks.opponentMs,
            });
          }
          
          lastSyncedStateRef.current = { 
            matchId: match.id, 
            snapshotMoveIndex: lastSynced.snapshotMoveIndex,
            appliedMoveCount: moves.length
          };
          nextLocalMoveIndexRef.current = moves.length;
          
          setSyncInProgress(false);
          
          const syncElapsed = performance.now() - syncStart;
          debugLog(`⚡ FAST PATH: State sync complete in ${syncElapsed.toFixed(0)}ms`);
          return;
        } catch (error) {
          debugWarn('⚡ FAST PATH failed, falling back to full sync', error);
          // Fall through to full sync
        }
      }
    }

    // FULL SYNC PATH (for DB confirmations, reconnections, etc.)
    // Find the most recent snapshot
    let snapshotSource: MatchMoveRecord<MatchAction> | null = null;
    for (let index = moves.length - 1; index >= 0; index -= 1) {
      const candidate = moves[index];
      if (candidate?.state_snapshot) {
        snapshotSource = candidate;
        break;
      }
    }
    
    const snapshot: SantoriniSnapshot | null =
      snapshotSource?.state_snapshot ?? match.initial_state ?? null;
    if (!snapshot) {
      debugWarn('useOnlineSantorini: No snapshot available');
      setSyncInProgress(false);
      return;
    }

    const snapshotMoveIndex = snapshotSource ? snapshotSource.move_index : -1;

    try {
      debugLog('useOnlineSantorini: Importing snapshot from move', snapshotMoveIndex);
      
      // Import the snapshot - pure TypeScript, instant!
      let newEngine = SantoriniEngine.fromSnapshot(snapshot);
      
      // Find moves that come after the snapshot
      const movesToReplay = moves.filter(m => m.move_index > snapshotMoveIndex);
      
      debugLog('useOnlineSantorini: Replaying', movesToReplay.length, 'moves after snapshot');
      
      // Replay each move after the snapshot
      for (const moveRecord of movesToReplay) {
        const action = moveRecord.action;
        if (isSantoriniMoveAction(action)) {
          const sequence = toMoveArray(action.move);
          for (const value of sequence) {
            try {
              const result = newEngine.applyMove(value);
              newEngine = SantoriniEngine.fromSnapshot(result.snapshot);
              debugLog('useOnlineSantorini: Replayed move', value, 'at index', moveRecord.move_index);
            } catch (error) {
              console.error('useOnlineSantorini: Failed to replay move', value, error);
              break;
            }
          }
        }
      }
      
      moveSelectorRef.current.reset();
      
      // Atomically update all state
      const myTurn = isRoleTurn(newEngine, role, playerZeroRole);
      updateEngineState(newEngine, myTurn);
      
      // Update clock states from all moves (only process last clock update for speed)
      setClock(deriveInitialClocks(match));
      for (let i = moves.length - 1; i >= 0; i--) {
        const action = moves[i].action;
        if (isSantoriniMoveAction(action) && action.clocks) {
          setClock({ creatorMs: action.clocks.creatorMs, opponentMs: action.clocks.opponentMs });
          break; // Found most recent clock, stop
        }
      }
      
      lastSyncedStateRef.current = { 
        matchId: match.id, 
        snapshotMoveIndex,
        appliedMoveCount: moves.length
      };
      nextLocalMoveIndexRef.current = moves.length;
      
      setSyncInProgress(false);
      
      const syncElapsed = performance.now() - syncStart;
      debugLog(`useOnlineSantorini: State sync complete in ${syncElapsed.toFixed(0)}ms`);
    } catch (error) {
      console.error('useOnlineSantorini: Failed to synchronize board with server', error);
      setSyncInProgress(false);
    }
  }, [clockEnabled, match, moves, playerZeroRole, role, setSyncInProgress, updateEngineState]);

  // Clock tick effect
  // Use engineVersion as dependency to recompute when engine changes
  const currentTurn = useMemo(() => {
    if (!match) return null;
    return resolveActiveRole(engineRef.current, playerZeroRole);
  }, [engineVersion, match, playerZeroRole]);
  
  const isMyTurn = useMemo(() => {
    return role !== null && currentTurn === role;
  }, [role, currentTurn]);

  useEffect(() => {
    if (!match) {
      setClock(deriveInitialClocks(null));
      lastTickRef.current = null;
      return;
    }
    if (!clockEnabled) {
      setClock(deriveInitialClocks(match));
      lastTickRef.current = null;
      return;
    }
    const synced = computeSynchronizedClock(match, moves, currentTurn, Date.now());
    setClock(synced);
    lastTickRef.current = performance.now();
  }, [clockEnabled, currentTurn, match, match?.clock_initial_seconds, match?.clock_updated_at, match?.updated_at, moves]);

  useEffect(() => {
    if (!match || !role || !isMyTurn) {
      return;
    }
    const selector = moveSelectorRef.current;
    if (selector.getStage() !== 0) {
      return;
    }
    const hasSelectable = selectable.some((row) => row.some(Boolean));
    if (hasSelectable) {
      return;
    }

    const engine = engineRef.current;
    const refreshedSelectable = computeSelectable(
      engine.getValidMoves(),
      engine.snapshot,
      selector,
      true,
      engine.getPlacementContext(),
    );
    setSelectable(refreshedSelectable);
    setCancelSelectable(createEmptyMask());
  }, [isMyTurn, match, role, selectable]);

  useEffect(() => {
    if (isMyTurn) {
      return;
    }
    const hasSelectable = selectable.some((row) => row.some(Boolean));
    const hasCancelSelectable = cancelSelectable.some((row) => row.some(Boolean));
    if (hasSelectable || hasCancelSelectable) {
      setSelectable(createEmptyMask());
      setCancelSelectable(createEmptyMask());
    }
    moveSelectorRef.current.reset();
  }, [cancelSelectable, isMyTurn, selectable]);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    lastTickRef.current = null;

    if (!clockEnabled || !match || match.status !== 'in_progress' || !placementComplete) {
      return;
    }

    const side = currentTurn;
    if (!side) {
      return;
    }

    lastTickRef.current = performance.now();
    timerRef.current = setInterval(() => {
      setClock((prev) => {
        const now = performance.now();
        const last = lastTickRef.current ?? now;
        lastTickRef.current = now;
        const delta = Math.max(0, Math.round(now - last));

        if (delta === 0) {
          return prev;
        }

        const next = { ...prev };
        if (side === 'creator') {
          next.creatorMs = Math.max(0, next.creatorMs - delta);
        } else if (side === 'opponent') {
          next.opponentMs = Math.max(0, next.opponentMs - delta);
        }
        return next;
      });
    }, TICK_INTERVAL);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      lastTickRef.current = null;
    };
  }, [clockEnabled, currentTurn, match?.status, match, placementComplete]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // Move submission effect
  useEffect(() => {
    if (!match || !role) {
      return;
    }

    const pendingQueue = pendingLocalMovesRef.current;
    if (pendingQueue.length === 0) {
      return;
    }
    
    if (submissionLockRef.current) {
      debugLog('useOnlineSantorini: Submission already in progress, skipping');
      return;
    }

    const pending = pendingQueue[0];
    const expectedMoveIndex = pending.expectedMoveIndex;
    
    const serverHasThisMove = moves.some(
      (move) =>
        move.move_index === expectedMoveIndex &&
        typeof move.id === 'string' &&
        !move.id.startsWith('optimistic-'),
    );
    
    if (serverHasThisMove) {
      debugLog('useOnlineSantorini: Move already received from server, skipping submission');
      pendingQueue.shift();
      if (pendingQueue.length > 0) {
        setPendingMoveVersion((v) => v + 1);
      }
      return;
    }

    const moveAction = pending.moveAction;
    if (moveAction === undefined || moveAction === null) {
      debugWarn('useOnlineSantorini: Pending move has no moveAction', pending);
      pendingQueue.shift();
      if (pendingQueue.length > 0) {
        setPendingMoveVersion((v) => v + 1);
      }
      return;
    }
    const pendingSnapshot = pending.snapshotBefore;

    const updatedClock = clockEnabled
      ? {
          creatorMs: clock.creatorMs,
          opponentMs: clock.opponentMs,
        }
      : undefined;

    const movePayload: SantoriniMoveAction = {
      kind: 'santorini.move',
      move: moveAction,
      by: role,
      clocks: updatedClock,
    };

    debugLog('useOnlineSantorini: Submitting move for server validation', { 
      moveIndex: expectedMoveIndex, 
      move: moveAction,
      by: role,
    });

    submissionLockRef.current = true;

    onSubmitMove(match, expectedMoveIndex, movePayload)
      .then(() => {
        debugLog('useOnlineSantorini: Move submitted successfully');
        pendingLocalMovesRef.current.shift();
        if (pendingLocalMovesRef.current.length > 0) {
          setPendingMoveVersion((v) => v + 1);
        }
        setPendingSubmissionCount(pendingLocalMovesRef.current.length);
      })
      .catch((error) => {
        console.error('useOnlineSantorini: Failed to submit move', error);
        toast({
          title: 'Failed to send move',
          status: 'error',
          description: error instanceof Error ? error.message : 'Unknown error',
        });
        pendingLocalMovesRef.current = [];
        placementBatchRef.current = { actions: [], snapshotBefore: null };
        setPendingSubmissionCount(0);
        const nextFromRecords = getNextMoveIndexFromRecords(moves);
        nextLocalMoveIndexRef.current = nextFromRecords;
        if (pendingSnapshot) {
          try {
            const revertEngine = SantoriniEngine.fromSnapshot(pendingSnapshot);
            moveSelectorRef.current.reset();
            const myTurn = isRoleTurn(revertEngine, role, playerZeroRole);
            updateEngineState(revertEngine, myTurn);
          } catch (revertError) {
            console.error('useOnlineSantorini: Failed to revert local move after submission error', revertError);
          }
        }
        if (match) {
          const syncedClock = clockEnabled
            ? computeSynchronizedClock(match, moves, currentTurn, Date.now())
            : deriveInitialClocks(match);
          setClock(syncedClock);
        } else {
          setClock(deriveInitialClocks(null));
        }
      })
      .finally(() => {
        submissionLockRef.current = false;
      });
  }, [clock, clockEnabled, currentTurn, match, moves, onSubmitMove, pendingMoveVersion, role, toast, updateEngineState]);

  const formatClock = useCallback((ms: number) => {
    if (!clockEnabled) return '--:--';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }, [clockEnabled]);

  const onCellClick = useCallback(
    (y: number, x: number) => {
      if (!match) {
        // Match is still loading, silently ignore clicks
        return;
      }
      if (!role) {
        toast({ title: 'Loading match...', status: 'info' });
        return;
      }
      if (match.status !== 'in_progress') {
        toast({ title: 'Waiting for opponent', status: 'info' });
        return;
      }
      
      // Block moves during sync (critical guard!)
      if (syncInProgressRef.current) {
        debugLog('useOnlineSantorini: Cannot make move - sync in progress');
        toast({ title: 'Please wait - syncing game state', status: 'info' });
        return;
      }
      
      // Block rapid clicks during move processing
      if (processingMoveRef.current) {
        debugLog('useOnlineSantorini: Move processing in progress, ignoring click');
        return;
      }
      
      if (currentTurn !== role) {
        toast({ title: "It's not your turn", status: 'warning' });
        return;
      }

      // Don't allow moves while state is still syncing
      const lastSynced = lastSyncedStateRef.current;
      if (lastSynced.matchId !== match.id || lastSynced.appliedMoveCount !== moves.length) {
        debugLog('useOnlineSantorini: Cannot make move - state not synced', {
          lastSynced,
          currentMatchId: match.id,
          currentMovesLength: moves.length,
        });
        toast({ title: 'Please wait - syncing game state', status: 'info' });
        return;
      }

      // ALWAYS use engineRef.current for latest state (not closure variable)
      const engine = engineRef.current;
      const validMoves = engine.getValidMoves();
      const placement = engine.getPlacementContext();
      const placementRole = placement ? mapPlayerIndexToRole(placement.player, playerZeroRole) : null;
      const isPlacementPhase = Boolean(placement);

      const hasPendingMoves = pendingLocalMovesRef.current.length > 0;
      const canQueueDuringPlacement = hasPendingMoves && isPlacementPhase && placementRole === role;
      if (hasPendingMoves && !canQueueDuringPlacement) {
        toast({ title: 'Please wait - syncing previous move', status: 'info' });
        return;
      }
      
      debugLog('🎯 onCellClick Debug:', {
        y, x,
        role,
        enginePlayer: engine.player,
        currentTurn,
        isPlacementPhase,
        moveSelector: {
          stage: moveSelectorRef.current.getStage(),
          workerIndex: moveSelectorRef.current.workerIndex,
          workerY: moveSelectorRef.current.getSelectedWorker()?.y ?? null,
          workerX: moveSelectorRef.current.getSelectedWorker()?.x ?? null,
        },
        cellWorker: engine.snapshot.board[y][x][0],
        cellLevel: engine.snapshot.board[y][x][1],
        validMovesCount: validMoves.filter(v => v).length,
        firstFewValidMoves: validMoves.slice(0, 30).map((v, i) => v ? i : null).filter(Boolean),
      });
      
      // During placement phase ONLY - apply placement moves
      const placementAction = y * 5 + x;
      if (isPlacementPhase) {
        if (placementRole && placementRole !== role) {
          toast({ title: "It's not your placement turn", status: 'warning' });
          return;
        }
        if (placementAction >= validMoves.length || !validMoves[placementAction]) {
          toast({ title: 'Invalid placement', status: 'warning' });
          return;
        }
        processingMoveRef.current = true;
        try {
          const snapshotBefore = engine.snapshot;
          const result = engine.applyMove(placementAction);
          const newEngine = SantoriniEngine.fromSnapshot(result.snapshot);
          moveSelectorRef.current.reset();
          
          // Atomically update state
          const myTurn = isRoleTurn(newEngine, role, playerZeroRole);
          updateEngineState(newEngine, myTurn);

          const batch = placementBatchRef.current;
          if (batch.actions.length === 0) {
            batch.snapshotBefore = snapshotBefore;
          }
          batch.actions.push(placementAction);

          const nextPlacement = newEngine.getPlacementContext();
          const stillMyPlacement = nextPlacement
            ? mapPlayerIndexToRole(nextPlacement.player, playerZeroRole) === role
            : false;

          if (!stillMyPlacement) {
            const nextMoveIndex = nextLocalMoveIndexRef.current;
            nextLocalMoveIndexRef.current += 1;
            const movePayload = batch.actions.length === 1 ? batch.actions[0] : batch.actions.slice();
            pendingLocalMovesRef.current.push({
              expectedMoveIndex: nextMoveIndex,
              moveAction: movePayload,
              snapshotBefore: batch.snapshotBefore ?? snapshotBefore,
            });
            setPendingSubmissionCount(pendingLocalMovesRef.current.length);

            if (clockEnabled && incrementMs > 0 && role) {
              setClock((prev) => {
                const next = { ...prev };
                if (role === 'creator') {
                  next.creatorMs = Math.max(0, next.creatorMs + incrementMs);
                } else {
                  next.opponentMs = Math.max(0, next.opponentMs + incrementMs);
                }
                return next;
              });
            }

            debugLog('✅ Placement batch queued for submission', {
              placementActions: batch.actions,
              nextMoveIndex,
            });
            batch.actions = [];
            batch.snapshotBefore = null;
            setPendingMoveVersion((v) => v + 1);
          } else {
            debugLog('🧱 Placement recorded locally, awaiting remaining workers');
          }
        } catch (error) {
          console.error('useOnlineSantorini: Move failed', error);
          toast({ title: 'Invalid move', status: 'error' });
        } finally {
          processingMoveRef.current = false;
        }
        return;
      }

      // During game phase: Use move selector
      processingMoveRef.current = true;
      try {
        const moveSelector = moveSelectorRef.current;
        debugLog('🎮 Game phase click:', {
          stage: moveSelector.getStage(),
          player: engine.player,
          board_at_click: engine.snapshot.board[y][x],
        });

        if (moveSelector.getStage() === 0) {
          const hasSelectable = selectable.some((row) => row.some(Boolean));
          if (!hasSelectable) {
            const refreshedSelectable = computeSelectable(
              validMoves,
              engine.snapshot,
              moveSelector,
              true,
              engine.getPlacementContext(),
            );
            setSelectable(refreshedSelectable);
            setCancelSelectable(createEmptyMask());
          }
        }

        const clicked = moveSelector.click(y, x, engine.snapshot.board, validMoves, engine.player);
        const updatedStage = moveSelector.getStage();
        debugLog('🎮 Click result:', clicked, 'New stage:', updatedStage);
        
        if (!clicked) {
          debugWarn('❌ Invalid selection at', { y, x }, 'stage:', updatedStage);
          toast({ title: 'Invalid selection', status: 'warning' });
          return;
        }
        
        // Update highlighting for next stage
        const nextSelectable = computeSelectable(
          validMoves,
          engine.snapshot,
          moveSelector,
          isMyTurn,
          engine.getPlacementContext(),
        );
        setSelectable(nextSelectable);
        setCancelSelectable(createCancelMaskFromSelector(moveSelector));
        
        // Check if move is complete
        const action = moveSelector.getAction();
        if (action >= 0) {
          // Move is complete - apply it and submit
          try {
            const snapshotBefore = engine.snapshot;
            const result = engine.applyMove(action);
            const newEngine = SantoriniEngine.fromSnapshot(result.snapshot);
            moveSelector.reset();
            
            // Atomically update state
            const myTurn = isRoleTurn(newEngine, role, playerZeroRole);
            updateEngineState(newEngine, myTurn);
            
            const nextMoveIndex = nextLocalMoveIndexRef.current;
            nextLocalMoveIndexRef.current += 1;

            pendingLocalMovesRef.current.push({
              expectedMoveIndex: nextMoveIndex,
              moveAction: action,
              snapshotBefore,
            });
            setPendingSubmissionCount(pendingLocalMovesRef.current.length);
            if (clockEnabled && incrementMs > 0 && role) {
              setClock((prev) => {
                const next = { ...prev };
                if (role === 'creator') {
                  next.creatorMs = Math.max(0, next.creatorMs + incrementMs);
                } else if (role === 'opponent') {
                  next.opponentMs = Math.max(0, next.opponentMs + incrementMs);
                }
                return next;
              });
            }
            
            debugLog('✅ Game move queued for submission', { action, nextMoveIndex });
            setPendingMoveVersion(v => v + 1); // Trigger submission effect
          } catch (error) {
            console.error('useOnlineSantorini: Move failed', error);
            toast({ title: 'Move failed', status: 'error' });
            moveSelector.reset();
            // Restore selectable state on error
            const nextSel = computeSelectable(
              validMoves,
              engine.snapshot,
              moveSelector,
              isMyTurn,
              engine.getPlacementContext(),
            );
            setSelectable(nextSel);
            setCancelSelectable(createEmptyMask());
          }
        }
      } finally {
        processingMoveRef.current = false;
      }
    },
    [clockEnabled, currentTurn, incrementMs, isMyTurn, match, moves.length, playerZeroRole, role, selectable, toast, updateEngineState],
  );

  // Game completion detection
  useEffect(() => {
    if (!match || !onGameComplete || match.status !== 'in_progress') {
      if (!match || match.status !== 'in_progress') {
        gameCompletedRef.current = null;
      }
      return;
    }
    
    if (gameCompletedRef.current === match.id) {
      return;
    }

    const [p0Score, p1Score] = engineRef.current.getGameEnded();
    if (p0Score === 0 && p1Score === 0) {
      return;
    }

    gameCompletedRef.current = match.id;

    const winnerIndex = p0Score === 1 ? 0 : p1Score === 1 ? 1 : null;
    const winnerRole = winnerIndex === null ? null : mapPlayerIndexToRole(winnerIndex, playerZeroRole);
    if (winnerRole) {
      const isUserWinner = winnerRole === role;
      toast({
        title: isUserWinner ? 'Victory!' : 'Defeat',
        description: isUserWinner ? 'You reached level 3.' : 'Your opponent reached level 3.',
        status: isUserWinner ? 'success' : 'error',
        duration: 4000,
      });
    } else {
      toast({
        title: 'Drawn game',
        description: 'Neither player could secure a win.',
        status: 'info',
        duration: 4000,
      });
    }

    const winnerId = winnerRole === 'creator' ? match.creator_id : winnerRole === 'opponent' ? match.opponent_id : null;
    
    debugLog('useOnlineSantorini: Game end detected locally, winner:', winnerId);
    debugLog('useOnlineSantorini: Server will handle match status update - NOT calling onGameComplete to avoid 409 conflict');
    // DON'T call onGameComplete here! The server already updates match status
    // when it processes the winning move in submit-move edge function.
    // Calling it from client causes 409 Conflict race condition.
  }, [engineVersion, match, onGameComplete, playerZeroRole, role, toast]);

  // Stub functions for compatibility with GameBoard component
  const onCellHover = useCallback(async () => {}, []);
  const onCellLeave = useCallback(async () => {}, []);
  const undo = useCallback(async () => {}, []);
  const redo = useCallback(async () => {}, []);

  const moveHistory = useMemo(() => {
    const creatorName = match?.creator?.display_name ?? 'Creator';
    const opponentName = match?.opponent?.display_name ?? (matchIsAi ? 'Santorini AI' : 'Opponent');
    const greenRole = playerZeroRole;
    return moves
      .filter((move) => isSantoriniMoveAction(move.action))
      .sort((a, b) => a.move_index - b.move_index)
      .map((move, index) => {
        const action = move.action as SantoriniMoveAction;
        const actorRole = action.by === 'creator' ? 'creator' : 'opponent';
        const actorName = actorRole === 'creator' ? creatorName : opponentName;
        const colorLabel = actorRole === greenRole ? 'Green' : 'Red';
        const moveDescriptor = toMoveArray(action.move).join(', ');
        return {
          action: action.move,
          description: `${index + 1}. ${actorName} (${colorLabel}) played ${moveDescriptor || 'action'}`,
        };
      });
  }, [match?.creator?.display_name, match?.opponent?.display_name, moves, playerZeroRole, matchIsAi]);

  return {
    board,
    selectable,
    cancelSelectable,
    onCellClick,
    onCellHover,
    onCellLeave,
    resetMatch,
    currentTurn,
    creatorClockMs: clock.creatorMs,
    opponentClockMs: clock.opponentMs,
    formatClock,
    gameEnded: engineRef.current.getGameEnded(),
    buttons: { loading: false, canUndo: false, canRedo: false, status: '', editMode: 0, setupMode: false, setupTurn: 0 },
    undo,
    redo,
    history: moveHistory,
    pendingSubmissions: pendingSubmissionCount,
    snapshot: engineRef.current.snapshot,
    isSyncing: syncing,
  };
}
