import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { SantoriniEngine, type SantoriniSnapshot, type PlacementContext } from '@/lib/santoriniEngine';
import { TypeScriptMoveSelector } from '@/lib/moveSelectorTS';
import { useToast } from '@chakra-ui/react';
import { createBoardViewFromSnapshot, createEmptyMask, type BoardCell } from '@game/boardView';
import { createCancelMaskFromSelector } from '@/utils/moveSelectorMasks';

/**
 * TypeScript-based LOCAL Santorini hook (human vs human, no AI)
 * 
 * NO PYTHON/PYODIDE! Pure TypeScript for instant loading.
 * For AI features, use useSantorini.tsx instead.
 */

function computeSelectable(
  validMoves: boolean[],
  snapshot: SantoriniSnapshot,
  moveSelector: TypeScriptMoveSelector | null,
  placement: PlacementContext | null,
): boolean[][] {
  const selectable: boolean[][] = Array.from({ length: 5 }, () => Array(5).fill(false));

  // During placement phase highlight available empty squares
  const isPlacementPhase = placement && placement.player === snapshot.player;
  if (isPlacementPhase) {
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

export function useLocalSantorini() {
  const toast = useToast();
  
  // Game state
  // NOTE: engineRef is the SINGLE SOURCE OF TRUTH for game state
  const engineRef = useRef<SantoriniEngine>(SantoriniEngine.createInitial().engine);
  const [engineVersion, setEngineVersion] = useState(0);
  const [board, setBoard] = useState<BoardCell[][]>(() => createBoardViewFromSnapshot(engineRef.current.snapshot));
  const moveSelectorRef = useRef<TypeScriptMoveSelector>(new TypeScriptMoveSelector());
  const [selectable, setSelectable] = useState<boolean[][]>(() =>
    computeSelectable(
      engineRef.current.getValidMoves(),
      engineRef.current.snapshot,
      moveSelectorRef.current,
      engineRef.current.getPlacementContext(),
    ),
  );
  const [cancelSelectable, setCancelSelectable] = useState<boolean[][]>(() => createEmptyMask());
  const [history, setHistory] = useState<Array<{ action: number; description: string }>>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const processingMoveRef = useRef<boolean>(false);
  
  // Helper function to atomically update engine and derived state
  const updateEngineState = useCallback((newEngine: SantoriniEngine) => {
    engineRef.current = newEngine;
    const newBoard = createBoardViewFromSnapshot(newEngine.snapshot);
    const newSelectable = computeSelectable(
      newEngine.getValidMoves(),
      newEngine.snapshot,
      moveSelectorRef.current,
      newEngine.getPlacementContext()
    );
    const cancelMask = createCancelMaskFromSelector(moveSelectorRef.current);
    
    // Batch all state updates together
    setBoard(newBoard);
    setSelectable(newSelectable);
    setCancelSelectable(cancelMask);
    setEngineVersion(v => v + 1);
  }, []);
  
  const nextPlayer = useMemo(() => engineRef.current.player, [engineVersion]);
  
  const gameEnded = useMemo(() => {
    const [p0Score, p1Score] = engineRef.current.getGameEnded();
    return p0Score !== 0 || p1Score !== 0;
  }, [engineVersion]);
  
  const canUndo = historyIndex >= 0;
  const canRedo = historyIndex < history.length - 1;

  const initialize = useCallback(async () => {
    const { engine: newEngine } = SantoriniEngine.createInitial();
    moveSelectorRef.current.reset();
    updateEngineState(newEngine);
    setHistory([]);
    setHistoryIndex(-1);
  }, [updateEngineState]);

  const reset = useCallback(async () => {
    await initialize();
  }, [initialize]);

  const onCellClick = useCallback(
    (y: number, x: number) => {
      // Prevent overlapping move processing
      if (processingMoveRef.current) {
        console.log('useLocalSantorini: Move processing in progress, ignoring click');
        return;
      }

      if (gameEnded) {
        toast({ title: 'Game has ended', status: 'info' });
        return;
      }

      // ALWAYS use engineRef.current for latest state
      const engine = engineRef.current;
      const validMoves = engine.getValidMoves();
      const placement = engine.getPlacementContext();

      // During placement phase ONLY
      const isPlacementPhase = placement && placement.player === engine.player;
      const placementAction = y * 5 + x;
      if (isPlacementPhase) {
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
          updateEngineState(newEngine);

          // Update history
          const newHistory = history.slice(0, historyIndex + 1);
          newHistory.push({
            action: placementAction,
            description: `Place worker at (${x}, ${y})`,
          });
          setHistory(newHistory);
          setHistoryIndex(newHistory.length - 1);
        } catch (error) {
          console.error('Move failed:', error);
          toast({ title: 'Invalid move', status: 'error' });
        } finally {
          processingMoveRef.current = false;
        }
        return;
      }

      // During game phase: Use move selector
      const moveSelector = moveSelectorRef.current;
      const clicked = moveSelector.click(y, x, engine.snapshot.board, validMoves, engine.player);
      
      if (!clicked) {
        toast({ title: 'Invalid selection', status: 'warning' });
        return;
      }
      
      // Update highlighting for next stage
      setSelectable(
        computeSelectable(validMoves, engine.snapshot, moveSelector, engine.getPlacementContext()),
      );
      setCancelSelectable(createCancelMaskFromSelector(moveSelector));
      
      // Check if move is complete
      const action = moveSelector.getAction();
      if (action >= 0) {
        // Move is complete - apply it
        processingMoveRef.current = true;
        try {
          const result = engine.applyMove(action);
          const newEngine = SantoriniEngine.fromSnapshot(result.snapshot);
          moveSelector.reset();
          
          // Atomically update state
          updateEngineState(newEngine);
          
          // Update history
          const newHistory = history.slice(0, historyIndex + 1);
          newHistory.push({
            action,
            description: `Move action ${action}`,
          });
          setHistory(newHistory);
          setHistoryIndex(newHistory.length - 1);
        } catch (error) {
          console.error('Move failed:', error);
          toast({ title: 'Invalid move', status: 'error' });
          moveSelector.reset();
          setSelectable(
            computeSelectable(validMoves, engine.snapshot, moveSelector, engine.getPlacementContext()),
          );
        } finally {
          processingMoveRef.current = false;
        }
      }
    },
    [gameEnded, history, historyIndex, toast, updateEngineState],
  );

  const undo = useCallback(async () => {
    if (!canUndo) return;

    try {
      // Rebuild engine from initial state + history up to new index
      const { engine: newEngine } = SantoriniEngine.createInitial();
      let currentEngine = newEngine;
      
      const newIndex = historyIndex - 1;
      for (let i = 0; i <= newIndex; i++) {
        const result = currentEngine.applyMove(history[i].action);
        currentEngine = SantoriniEngine.fromSnapshot(result.snapshot);
      }
      
      moveSelectorRef.current.reset();
      updateEngineState(currentEngine);
      setHistoryIndex(newIndex);
    } catch (error) {
      console.error('Undo failed:', error);
      toast({ title: 'Undo failed', status: 'error' });
    }
  }, [canUndo, historyIndex, history, toast, updateEngineState]);

  const redo = useCallback(async () => {
    if (!canRedo) return;

    try {
      const newIndex = historyIndex + 1;
      const move = history[newIndex];
      
      const result = engineRef.current.applyMove(move.action);
      const newEngine = SantoriniEngine.fromSnapshot(result.snapshot);
      
      moveSelectorRef.current.reset();
      updateEngineState(newEngine);
      setHistoryIndex(newIndex);
    } catch (error) {
      console.error('Redo failed:', error);
      toast({ title: 'Redo failed', status: 'error' });
    }
  }, [canRedo, historyIndex, history, toast, updateEngineState]);

  // Stub functions for compatibility
  const onCellHover = useCallback(async () => {}, []);
  const onCellLeave = useCallback(async () => {}, []);

  // Memoize controls to prevent infinite re-renders
  const controls = useMemo(
    () => ({
      triggerAi: async () => {},
      applyBestMove: async () => {},
      enableEvaluation: async () => {},
      disableEvaluation: async () => {},
      setGameMode: async (_mode: string) => {},
      reset: async () => { await reset(); },
    }),
    [reset],
  );

  return {
    loading: false,
    board,
    selectable,
    cancelSelectable,
    onCellClick,
    onCellHover,
    onCellLeave,
    initialize,
    reset,
    undo,
    redo,
    nextPlayer,
    gameEnded,
    history,
    buttons: {
      loading: false,
      canUndo,
      canRedo,
      status: '',
      editMode: 0,
      setupMode: false,
      setupTurn: 0,
    },
    controls,
  };
}
