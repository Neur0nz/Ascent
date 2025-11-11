import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SantoriniEngine, type SantoriniSnapshot, type PlacementContext } from '@/lib/santoriniEngine';
import { TypeScriptMoveSelector } from '@/lib/moveSelectorTS';
import { renderCellSvg } from '@game/svg';
import type { LobbyMatch } from './useMatchLobby';
import type { MatchAction, MatchMoveRecord, SantoriniMoveAction } from '@/types/match';
import { useToast } from '@chakra-ui/react';

export interface UseOnlineSantoriniOptions {
  match: LobbyMatch | null;
  moves: MatchMoveRecord<MatchAction>[];
  role: 'creator' | 'opponent' | null;
  onSubmitMove: (match: LobbyMatch, index: number, action: SantoriniMoveAction) => Promise<void>;
  onGameComplete?: (winnerId: string | null) => void;
}

interface ClockState {
  creatorMs: number;
  opponentMs: number;
}

export interface BoardCell {
  worker: number;
  level: number;
  levels: number;
  svg: string;
  highlight: boolean;
}

/**
 * TypeScript-based online Santorini hook
 * 
 * NO PYTHON/PYODIDE! Pure TypeScript for fast loading and validation.
 * Uses the lightweight SantoriniEngine for all game logic.
 */

const TICK_INTERVAL = 1000;

const resolveActiveRole = (engine: SantoriniEngine): 'creator' | 'opponent' => {
  const placement = engine.getPlacementContext();
  if (placement) {
    return placement.player === 0 ? 'creator' : 'opponent';
  }
  return engine.player === 0 ? 'creator' : 'opponent';
};

const isRoleTurn = (engine: SantoriniEngine, role: 'creator' | 'opponent' | null): boolean => {
  if (!role) {
    return false;
  }
  return resolveActiveRole(engine) === role;
};

function deriveInitialClocks(match: LobbyMatch | null): ClockState {
  if (!match || match.clock_initial_seconds <= 0) {
    return { creatorMs: 0, opponentMs: 0 };
  }
  const baseMs = match.clock_initial_seconds * 1000;
  return { creatorMs: baseMs, opponentMs: baseMs };
}

function isSantoriniMoveAction(action: MatchAction | null | undefined): action is SantoriniMoveAction {
  return Boolean(action && (action as SantoriniMoveAction).kind === 'santorini.move');
}

const getLastSantoriniMove = (records: MatchMoveRecord<MatchAction>[]): number | null => {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const action = records[index]?.action;
    if (isSantoriniMoveAction(action) && typeof action.move === 'number') {
      return action.move;
    }
  }
  return null;
};

function engineToBoard(snapshot: SantoriniSnapshot): BoardCell[][] {
  const board: BoardCell[][] = [];
  for (let y = 0; y < 5; y++) {
    const row: BoardCell[] = [];
    for (let x = 0; x < 5; x++) {
      const cell = snapshot.board[y][x];
      const worker = cell[0] || 0;
      const level = cell[1] || 0;
      row.push({
        worker,
        level,
        levels: level,
        svg: renderCellSvg({ levels: level, worker }),
        highlight: false,
      });
    }
    board.push(row);
  }
  return board;
}

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
  const toast = useToast();
  
  // Game engine state - pure TypeScript!
  // NOTE: engineRef is the SINGLE SOURCE OF TRUTH for game state
  // The state variables are only for triggering React re-renders
  const engineRef = useRef<SantoriniEngine>(SantoriniEngine.createInitial().engine);
  const [engineVersion, setEngineVersion] = useState(0); // Trigger re-renders when engine changes
  const [board, setBoard] = useState<BoardCell[][]>(() => engineToBoard(engineRef.current.snapshot));
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
  const [cancelSelectable, setCancelSelectable] = useState<boolean[][]>(
    Array.from({ length: 5 }, () => Array(5).fill(false)),
  );
  
  // Clock state
  const [clock, setClock] = useState<ClockState>(() => deriveInitialClocks(match));
  const [clockEnabled, setClockEnabled] = useState(match?.clock_initial_seconds ? match.clock_initial_seconds > 0 : false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Sync tracking and locks
  const lastSyncedStateRef = useRef<{ matchId: string | null; snapshotMoveIndex: number; appliedMoveCount: number }>({ 
    matchId: null, 
    snapshotMoveIndex: -1,
    appliedMoveCount: 0
  });
  const pendingLocalMoveRef = useRef<{ 
    expectedHistoryLength: number; 
    expectedMoveIndex: number; 
    moveAction?: number;
  } | null>(null);
  const nextLocalMoveIndexRef = useRef<number>(0);
  const [pendingMoveVersion, setPendingMoveVersion] = useState(0); // Trigger submission effect
  const gameCompletedRef = useRef<string | null>(null);
  const submissionLockRef = useRef<boolean>(false);
  const syncInProgressRef = useRef<boolean>(false); // Prevent moves during sync
  const processingMoveRef = useRef<boolean>(false); // Prevent rapid clicks
  
  // Helper function to atomically update engine and derived state
  const updateEngineState = useCallback((newEngine: SantoriniEngine, myTurn: boolean) => {
    engineRef.current = newEngine;
    const newBoard = engineToBoard(newEngine.snapshot);
    const newSelectable = myTurn 
      ? computeSelectable(
          newEngine.getValidMoves(),
          newEngine.snapshot,
          moveSelectorRef.current,
          true,
          newEngine.getPlacementContext()
        )
      : Array.from({ length: 5 }, () => Array(5).fill(false));
    const newCancelSelectable = (() => {
      if (!myTurn) return Array.from({ length: 5 }, () => Array(5).fill(false));
      const mask = Array.from({ length: 5 }, () => Array(5).fill(false));
      const sel = moveSelectorRef.current as any;
      if (sel.stage === 1) {
        if (sel.workerY >= 0 && sel.workerY < 5 && sel.workerX >= 0 && sel.workerX < 5) {
          mask[sel.workerY][sel.workerX] = true;
        }
      } else if (sel.stage === 2) {
        if (sel.newY >= 0 && sel.newY < 5 && sel.newX >= 0 && sel.newX < 5) {
          mask[sel.newY][sel.newX] = true;
        }
      }
      return mask;
    })();
    
    // Batch all state updates together to prevent intermediate renders
    setBoard(newBoard);
    setSelectable(newSelectable);
    setCancelSelectable(newCancelSelectable);
    setEngineVersion(v => v + 1);
  }, []);
  
  const resetMatch = useCallback(() => {
    if (!match) return;
    
    try {
      const newEngine = SantoriniEngine.fromSnapshot(match.initial_state);
      moveSelectorRef.current.reset();
      const myTurn = isRoleTurn(newEngine, role);
      
      // Atomically update all state
      updateEngineState(newEngine, myTurn);
      
      lastSyncedStateRef.current = { 
        matchId: match.id, 
        snapshotMoveIndex: -1,
        appliedMoveCount: 0
      };
      pendingLocalMoveRef.current = null;
      setClock(deriveInitialClocks(match));
      nextLocalMoveIndexRef.current = moves.length;
    } catch (error) {
      console.error('Failed to reset match to server snapshot', error);
    }
  }, [match, moves.length, role, updateEngineState]);

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
      pendingLocalMoveRef.current = null;
      previousMatchRef.current = { id: null, status: null, clockSeconds: null };
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
      pendingLocalMoveRef.current = null;
      resetMatch();
    }

    setClockEnabled(match.clock_initial_seconds ? match.clock_initial_seconds > 0 : false);
    previousMatchRef.current = next;
  }, [match?.id, match?.clock_initial_seconds, match?.status, match, resetMatch]);

  // State synchronization effect - import snapshots and replay moves
  useEffect(() => {
    if (!match) {
      lastSyncedStateRef.current = { matchId: null, snapshotMoveIndex: -1, appliedMoveCount: 0 };
      syncInProgressRef.current = false;
      return;
    }

    const lastSynced = lastSyncedStateRef.current;
    
    const needsResync = 
      lastSynced.matchId !== match.id || 
      lastSynced.appliedMoveCount !== moves.length;

    if (!needsResync) {
      syncInProgressRef.current = false;
      return;
    }

    // Mark sync as in progress to block user moves
    syncInProgressRef.current = true;

    const syncStart = performance.now();
    console.log('useOnlineSantorini: Syncing state', { 
      matchId: match.id, 
      movesCount: moves.length, 
      lastSynced 
    });

    // OPTIMIZATION: If we only have 1 new optimistic move, use fast path
    const lastMove = moves[moves.length - 1];
    const isOptimisticOnly =
      moves.length === lastSynced.appliedMoveCount + 1 && lastMove?.id.startsWith('optimistic-');
    const pendingLocal = pendingLocalMoveRef.current;
    const isPendingLocalMove =
      pendingLocal != null &&
      lastMove?.move_index === pendingLocal.expectedMoveIndex &&
      lastMove?.id.startsWith('optimistic-');

    if (isOptimisticOnly && moves.length > 0) {
      const lastMove = moves[moves.length - 1];
      const action = lastMove.action;
      
      if (isSantoriniMoveAction(action) && typeof action.move === 'number') {
        if (action.by === role) {
          console.log('⚡ FAST PATH skipped for local move');
          syncInProgressRef.current = false;
          return;
        }
        try {
          console.log('⚡ FAST PATH: Applying single optimistic move', action.move);
          
          // Use engineRef for current state (not stale useState value)
          const currentEngine = engineRef.current;

          // Strict guards: only fast-apply if it's the correct player's turn and move is valid
          const placementCtx = currentEngine.getPlacementContext();
          const engineTurnRole = placementCtx
            ? (placementCtx.player === 0 ? 'creator' : 'opponent')
            : (currentEngine.player === 0 ? 'creator' : 'opponent');
          if (action.by && action.by !== engineTurnRole) {
            throw new Error(`Out-of-turn optimistic apply (expected ${engineTurnRole}, got ${action.by})`);
          }
          const valid = currentEngine.getValidMoves();
          if (!valid[action.move]) {
            throw new Error('Optimistic move not valid on current snapshot');
          }
          const result = currentEngine.applyMove(action.move);
          const newEngine = SantoriniEngine.fromSnapshot(result.snapshot);
          
          moveSelectorRef.current.reset();
          
          // Atomically update all state
          const myTurn = isRoleTurn(newEngine, role);
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
          
          syncInProgressRef.current = false;
          
          const syncElapsed = performance.now() - syncStart;
          console.log(`⚡ FAST PATH: State sync complete in ${syncElapsed.toFixed(0)}ms`);
          return;
        } catch (error) {
          console.warn('⚡ FAST PATH failed, falling back to full sync', error);
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
      console.warn('useOnlineSantorini: No snapshot available');
      syncInProgressRef.current = false;
      return;
    }

    const snapshotMoveIndex = snapshotSource ? snapshotSource.move_index : -1;

    try {
      console.log('useOnlineSantorini: Importing snapshot from move', snapshotMoveIndex);
      
      // Import the snapshot - pure TypeScript, instant!
      let newEngine = SantoriniEngine.fromSnapshot(snapshot);
      
      // Find moves that come after the snapshot
      const movesToReplay = moves.filter(m => m.move_index > snapshotMoveIndex);
      
      console.log('useOnlineSantorini: Replaying', movesToReplay.length, 'moves after snapshot');
      
      // Replay each move after the snapshot
      for (const moveRecord of movesToReplay) {
        const action = moveRecord.action;
        if (isSantoriniMoveAction(action) && typeof action.move === 'number') {
          try {
            const result = newEngine.applyMove(action.move);
            newEngine = SantoriniEngine.fromSnapshot(result.snapshot);
            console.log('useOnlineSantorini: Replayed move', action.move, 'at index', moveRecord.move_index);
          } catch (error) {
            console.error('useOnlineSantorini: Failed to replay move', action.move, error);
            // Don't throw - continue with next moves
          }
        }
      }
      
      moveSelectorRef.current.reset();
      
      // Atomically update all state
      const myTurn = isRoleTurn(newEngine, role);
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
      
      syncInProgressRef.current = false;
      
      const syncElapsed = performance.now() - syncStart;
      console.log(`useOnlineSantorini: State sync complete in ${syncElapsed.toFixed(0)}ms`);
    } catch (error) {
      console.error('useOnlineSantorini: Failed to synchronize board with server', error);
      syncInProgressRef.current = false;
    }
  }, [clockEnabled, match, moves, role, updateEngineState]);

  // Clock tick effect
  // Use engineVersion as dependency to recompute when engine changes
  const currentTurn = useMemo(() => {
    if (!match) return null;
    return resolveActiveRole(engineRef.current);
  }, [engineVersion, match]);
  
  const isMyTurn = useMemo(() => {
    return role !== null && currentTurn === role;
  }, [role, currentTurn]);

  useEffect(() => {
    if (!match || !role || !isMyTurn) {
      return;
    }
    const selector = moveSelectorRef.current;
    if (selector.stage !== 0) {
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
    setCancelSelectable(Array.from({ length: 5 }, () => Array(5).fill(false)));
  }, [isMyTurn, match, role, selectable]);

  useEffect(() => {
    if (isMyTurn) {
      return;
    }
    const hasSelectable = selectable.some((row) => row.some(Boolean));
    const hasCancelSelectable = cancelSelectable.some((row) => row.some(Boolean));
    if (hasSelectable || hasCancelSelectable) {
      setSelectable(Array.from({ length: 5 }, () => Array(5).fill(false)));
      setCancelSelectable(Array.from({ length: 5 }, () => Array(5).fill(false)));
    }
    moveSelectorRef.current.reset();
  }, [cancelSelectable, isMyTurn, selectable]);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!clockEnabled || !match || match.status !== 'in_progress') {
      return;
    }

    const side = currentTurn;
    timerRef.current = setInterval(() => {
      setClock((prev) => {
        const next = { ...prev };
        if (side === 'creator') {
          next.creatorMs = Math.max(0, next.creatorMs - TICK_INTERVAL);
        } else {
          next.opponentMs = Math.max(0, next.opponentMs - TICK_INTERVAL);
        }
        return next;
      });
    }, TICK_INTERVAL);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [clockEnabled, currentTurn, match?.status, match]);

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
    const pending = pendingLocalMoveRef.current;
    if (!pending || !match || !role) {
      return;
    }
    
    if (submissionLockRef.current) {
      console.log('useOnlineSantorini: Submission already in progress, skipping');
      return;
    }

    // Check if we actually have a new move
    const expectedMoveIndex = pending.expectedMoveIndex;
    
    // Check if the server already has this move
    const serverHasThisMove = moves.some(
      (move) =>
        move.move_index === expectedMoveIndex &&
        typeof move.id === 'string' &&
        !move.id.startsWith('optimistic-'),
    );
    
    if (serverHasThisMove) {
      console.log('useOnlineSantorini: Move already received from server, skipping submission');
      pendingLocalMoveRef.current = null;
      nextLocalMoveIndexRef.current = Math.max(nextLocalMoveIndexRef.current - 1, moves.length);
      return;
    }

    // Get the move from pending ref
    const moveAction = pending.moveAction;
    if (moveAction === undefined || moveAction === null) {
      console.warn('useOnlineSantorini: Pending move has no moveAction', pending);
      pendingLocalMoveRef.current = null;
      return;
    }

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

    console.log('useOnlineSantorini: Submitting move for server validation', { 
      moveIndex: expectedMoveIndex, 
      move: moveAction,
      by: role,
    });

    submissionLockRef.current = true;

    onSubmitMove(match, expectedMoveIndex, movePayload)
      .then(() => {
        console.log('useOnlineSantorini: Move submitted successfully');
        pendingLocalMoveRef.current = null;
      })
      .catch((error) => {
        console.error('useOnlineSantorini: Failed to submit move', error);
        toast({
          title: 'Failed to send move',
          status: 'error',
          description: error instanceof Error ? error.message : 'Unknown error',
        });
        pendingLocalMoveRef.current = null;
        nextLocalMoveIndexRef.current = Math.max(nextLocalMoveIndexRef.current - 1, moves.length);
      })
      .finally(() => {
        submissionLockRef.current = false;
      });
  }, [clock, clockEnabled, match, moves, onSubmitMove, pendingMoveVersion, role, toast]);

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
        console.log('useOnlineSantorini: Cannot make move - sync in progress');
        toast({ title: 'Please wait - syncing game state', status: 'info' });
        return;
      }
      
      // Block rapid clicks during move processing
      if (processingMoveRef.current) {
        console.log('useOnlineSantorini: Move processing in progress, ignoring click');
        return;
      }
      
      if (pendingLocalMoveRef.current) {
        toast({ title: 'Please wait - syncing previous move', status: 'info' });
        return;
      }
      if (currentTurn !== role) {
        toast({ title: "It's not your turn", status: 'warning' });
        return;
      }

      // Don't allow moves while state is still syncing
      const lastSynced = lastSyncedStateRef.current;
      if (lastSynced.matchId !== match.id || lastSynced.appliedMoveCount !== moves.length) {
        console.log('useOnlineSantorini: Cannot make move - state not synced', {
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
      const placementRole = placement ? (placement.player === 0 ? 'creator' : 'opponent') : null;
      const isPlacementPhase = Boolean(placement);
      
      console.log('🎯 onCellClick Debug:', {
        y, x,
        role,
        enginePlayer: engine.player,
        currentTurn,
        isPlacementPhase,
        moveSelector: {
          stage: moveSelectorRef.current.stage,
          workerIndex: moveSelectorRef.current.workerIndex,
          workerY: moveSelectorRef.current.workerY,
          workerX: moveSelectorRef.current.workerX,
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
          const result = engine.applyMove(placementAction);
          const newEngine = SantoriniEngine.fromSnapshot(result.snapshot);
          moveSelectorRef.current.reset();
          
          // Atomically update state
          const myTurn = isRoleTurn(newEngine, role);
          updateEngineState(newEngine, myTurn);
          
          const nextMoveIndex = nextLocalMoveIndexRef.current;
          nextLocalMoveIndexRef.current += 1;

          // Store pending move (server will compute state)
          pendingLocalMoveRef.current = { 
            expectedHistoryLength: 0, // Not used in TS version
            expectedMoveIndex: nextMoveIndex,
            moveAction: placementAction,
          };
          
          console.log('✅ Placement move queued for submission', { placementAction, nextMoveIndex });
          setPendingMoveVersion(v => v + 1); // Trigger submission effect
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
        console.log('🎮 Game phase click:', {
          stage: moveSelector.stage,
          player: engine.player,
          board_at_click: engine.snapshot.board[y][x],
        });

        if (moveSelector.stage === 0) {
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
            setCancelSelectable(Array.from({ length: 5 }, () => Array(5).fill(false)));
          }
        }

        const clicked = moveSelector.click(y, x, engine.snapshot.board, validMoves, engine.player);
        console.log('🎮 Click result:', clicked, 'New stage:', moveSelector.stage);
        
        if (!clicked) {
          console.warn('❌ Invalid selection at', {y, x}, 'stage:', moveSelector.stage);
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
        const cancelMask = Array.from({ length: 5 }, () => Array(5).fill(false));
        if (moveSelector.stage === 1) {
          cancelMask[(moveSelector as any).workerY][(moveSelector as any).workerX] = true;
        } else if (moveSelector.stage === 2) {
          cancelMask[(moveSelector as any).newY][(moveSelector as any).newX] = true;
        }
        setCancelSelectable(cancelMask);
        
        // Check if move is complete
        const action = moveSelector.getAction();
        if (action >= 0) {
          // Move is complete - apply it and submit
          try {
            const result = engine.applyMove(action);
            const newEngine = SantoriniEngine.fromSnapshot(result.snapshot);
            moveSelector.reset();
            
            // Atomically update state
            const myTurn = isRoleTurn(newEngine, role);
            updateEngineState(newEngine, myTurn);
            
            const nextMoveIndex = nextLocalMoveIndexRef.current;
            nextLocalMoveIndexRef.current += 1;

            pendingLocalMoveRef.current = {
              expectedHistoryLength: 0,
              expectedMoveIndex: nextMoveIndex,
              moveAction: action,
            };
            
            console.log('✅ Game move queued for submission', { action, nextMoveIndex });
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
            setCancelSelectable(Array.from({ length: 5 }, () => Array(5).fill(false)));
          }
        }
      } finally {
        processingMoveRef.current = false;
      }
    },
    [currentTurn, isMyTurn, match, moves.length, role, selectable, toast, updateEngineState],
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

     const winnerRole = p0Score === 1 ? 'creator' : p1Score === 1 ? 'opponent' : null;
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

    const winnerId = p0Score === 1 ? match.creator_id : p1Score === 1 ? match.opponent_id : null;
    
    console.log('useOnlineSantorini: Game end detected locally, winner:', winnerId);
    console.log('useOnlineSantorini: Server will handle match status update - NOT calling onGameComplete to avoid 409 conflict');
    // DON'T call onGameComplete here! The server already updates match status
    // when it processes the winning move in submit-move edge function.
    // Calling it from client causes 409 Conflict race condition.
  }, [engineVersion, match, onGameComplete, role, toast]);

  // Clock timeout detection
  useEffect(() => {
    if (!match || !onGameComplete || !clockEnabled || match.status !== 'in_progress') {
      return;
    }
    
    if (gameCompletedRef.current === match.id) {
      return;
    }

    if (clock.creatorMs <= 100 && currentTurn === 'creator') {
      gameCompletedRef.current = match.id;
      console.log('useOnlineSantorini: Creator ran out of time, opponent wins');
      onGameComplete(match.opponent_id);
      return;
    }

    if (clock.opponentMs <= 100 && currentTurn === 'opponent') {
      gameCompletedRef.current = match.id;
      console.log('useOnlineSantorini: Opponent ran out of time, creator wins');
      onGameComplete(match.creator_id);
    }
  }, [clock, clockEnabled, currentTurn, match, onGameComplete]);

  // Stub functions for compatibility with GameBoard component
  const onCellHover = useCallback(async () => {}, []);
  const onCellLeave = useCallback(async () => {}, []);
  const undo = useCallback(async () => {}, []);
  const redo = useCallback(async () => {}, []);

  const moveHistory = useMemo(() => {
    const creatorName = match?.creator?.display_name ?? 'Player 1 (Green)';
    const opponentName = match?.opponent?.display_name ?? 'Player 2 (Red)';
    return moves
      .filter((move) => isSantoriniMoveAction(move.action))
      .sort((a, b) => a.move_index - b.move_index)
      .map((move, index) => {
        const action = move.action as SantoriniMoveAction;
        const actorName = action.by === 'creator' ? creatorName : opponentName;
        return {
          action: action.move,
          description: `${index + 1}. ${actorName} played action ${action.move}`,
        };
      });
  }, [match?.creator?.display_name, match?.opponent?.display_name, moves]);

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
  };
}
