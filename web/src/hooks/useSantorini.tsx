import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Santorini } from '@game/santorini';
import { MoveSelector } from '@game/moveSelector';
import { renderCellSvg, type CellState } from '@game/svg';
import { GAME_CONSTANTS } from '@game/constants';
import type { SantoriniStateSnapshot } from '@/types/match';
import {
  SantoriniEngine,
  SANTORINI_CONSTANTS,
  type SantoriniSnapshot,
  type PlacementContext as EnginePlacementContext,
} from '@/lib/santoriniEngine';
import { TypeScriptMoveSelector } from '@/lib/moveSelectorTS';
import { useToast } from '@chakra-ui/react';
import { createSantoriniRuntime } from '@/lib/runtime/santoriniRuntime';
import {
  DEFAULT_PRACTICE_DIFFICULTY,
  DEFAULT_PRACTICE_MODE,
  type PracticeGameMode,
  persistPracticeDifficulty as storePracticeDifficulty,
  persistPracticeMode as storePracticeMode,
  readPracticeSettings,
  readPracticeSnapshot,
  writePracticeSnapshot,
  clearPracticeSnapshot,
} from '@/lib/practiceState';
import { SantoriniPythonBridge } from '@/lib/pythonBridge/bridge';
import {
  applyActionToBoard,
  formatCoordinate,
  normalizeBoardPayload,
  nextPlacementWorkerId,
  findWorkerPosition,
} from '@/lib/practice/practiceEngine';
import { summarizeHistoryEntries, type MoveSummary } from '@/lib/practice/history';
import type { PracticeTopMove } from '@/lib/practice/types';
import {
  normalizeTopMoves as normalizePracticeTopMoves,
  toFiniteNumber as toFinitePracticeNumber,
} from '@/lib/practice/valueUtils';

export interface UseSantoriniOptions {
  evaluationEnabled?: boolean;
}


export type BoardCell = CellState & {
  svg: string;
  highlight: boolean;
};

export type ButtonsState = {
  loading: boolean;
  canUndo: boolean;
  canRedo: boolean;
  editMode: number;
  status: string;
  setupMode: boolean;
  setupTurn: number;
};

export type { PracticeGameMode } from '@/lib/practiceState';

type UiPlacementContext =
  | { phase: 'placement'; player: 0 | 1; workerId: 1 | 2 | -1 | -2 }
  | { phase: 'play' };

export type EvaluationState = {
  value: number;
  advantage: string;
  label: string;
};

export type TopMove = PracticeTopMove;
export type { MoveSummary } from '@/lib/practice/history';

export type ApplyMoveOptions = {
  triggerAi?: boolean;
  asHuman?: boolean;
};

export type Controls = {
  reset: () => Promise<void>;
  setGameMode: (mode: PracticeGameMode) => Promise<void>;
  changeDifficulty: (sims: number) => void;
  toggleEdit: () => void;
  setEditMode: (mode: number) => void;
  refreshEvaluation: () => Promise<EvaluationState | null>;
  calculateOptions: () => Promise<void>;
  updateEvaluationDepth: (depth: number | null) => void;
  updateOptionsDepth: (depth: number | null) => void;
  jumpToMove: (index: number) => Promise<void>;
};

const INITIAL_BOARD: BoardCell[][] = Array.from({ length: GAME_CONSTANTS.BOARD_SIZE }, () =>
  Array.from({ length: GAME_CONSTANTS.BOARD_SIZE }, () => ({ levels: 0, worker: 0, svg: '', highlight: false })),
);

const INITIAL_SELECTABLE = Array.from({ length: GAME_CONSTANTS.BOARD_SIZE }, () =>
  Array.from({ length: GAME_CONSTANTS.BOARD_SIZE }, () => false),
);

type PyLike = {
  toJs?: (options?: { create_proxies?: boolean }) => unknown;
  destroy?: () => void;
  valueOf?: () => unknown;
};

const toPlainValue = (value: unknown): unknown => {
  if (value && typeof value === 'object') {
    const candidate = value as PyLike;
    if (typeof candidate.toJs === 'function') {
      try {
        const plain = candidate.toJs({ create_proxies: false });
        candidate.destroy?.();
        if (plain !== value) {
          return toPlainValue(plain);
        }
        return plain;
      } catch {
        // Fall through and try other conversions
      }
    }

    if (value instanceof Map) {
      const plainObject: Record<string, unknown> = {};
      value.forEach((mapValue, key) => {
        if (typeof key === 'string' || typeof key === 'number' || typeof key === 'boolean') {
          plainObject[String(key)] = toPlainValue(mapValue);
        }
      });
      return plainObject;
    }

    if (Array.isArray(value)) {
      return value.map((item) => toPlainValue(item));
    }

    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
      const iterableCandidate = value as { [Symbol.iterator]?: () => Iterator<unknown> };
      if (typeof iterableCandidate[Symbol.iterator] !== 'function') {
        return value;
      }
      const items = Array.from(iterableCandidate as unknown as Iterable<unknown>, (item) => toPlainValue(item));
      return items.length === 1 ? items[0] : items;
    }

    if (typeof candidate.valueOf === 'function') {
      try {
        const plain = candidate.valueOf();
        if (plain !== value) {
          return toPlainValue(plain);
        }
      } catch {
        // Ignore and fall through to default handling
      }
    }
  }
  return value;
};

const toFiniteNumber = (value: unknown): number | null => toFinitePracticeNumber(value);

const yieldToMainThread = () =>
  new Promise<void>((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(() => resolve(), 0);
  });

const normalizeTopMoves = (rawMoves: unknown): TopMove[] => normalizePracticeTopMoves(rawMoves);

function useSantoriniInternal(options: UseSantoriniOptions = {}) {
  const { evaluationEnabled = true } = options;
  const [loading, setLoading] = useState(false); // Start with UI enabled
  const [board, setBoard] = useState<BoardCell[][]>(INITIAL_BOARD);
  const [selectable, setSelectable] = useState<boolean[][]>(INITIAL_SELECTABLE);
  const [cancelSelectable, setCancelSelectable] = useState<boolean[][]>(INITIAL_SELECTABLE);
  const [buttons, setButtons] = useState<ButtonsState>({
    loading: false,
    canRedo: false,
    canUndo: false,
    editMode: 0,
    status: 'Initializing game engine...',
    setupMode: false,
    setupTurn: 0
  });
  const [practiceMode, setPracticeMode] = useState<PracticeGameMode>(DEFAULT_PRACTICE_MODE);
  const [practiceDifficulty, setPracticeDifficulty] = useState<number>(DEFAULT_PRACTICE_DIFFICULTY);
  const buttonsRef = useRef(buttons);
  useEffect(() => {
    buttonsRef.current = buttons;
  }, [buttons]);

  const updateButtonsState = useCallback(
    (updater: ButtonsState | ((prev: ButtonsState) => ButtonsState)) => {
      setButtons((prev) => {
        const next =
          typeof updater === 'function'
            ? (updater as (prevState: ButtonsState) => ButtonsState)(prev)
            : (updater as ButtonsState);
        buttonsRef.current = next;
        return next;
      });
    },
    [],
  );
  const persistPracticeMode = useCallback((mode: PracticeGameMode) => {
    try {
      storePracticeMode(mode);
    } catch (error) {
      console.error('Failed to persist practice mode:', error);
    }
  }, []);

  const persistPracticeDifficulty = useCallback((value: number) => {
    try {
      storePracticeDifficulty(value);
    } catch (error) {
      console.error('Failed to persist practice difficulty:', error);
    }
  }, []);
  const [evaluation, setEvaluation] = useState<EvaluationState>({ value: 0, advantage: 'Balanced', label: '0.00' });
  const [topMoves, setTopMoves] = useState<TopMove[]>([]);
  const [history, setHistory] = useState<MoveSummary[]>([]);
  const [nextPlayer, setNextPlayer] = useState(0);
  const [calcOptionsBusy, setCalcOptionsBusy] = useState(false);
  const [evaluationDepthOverride, setEvaluationDepthOverride] = useState<number | null>(null);
  const [optionsDepthOverride, setOptionsDepthOverride] = useState<number | null>(null);
  const evaluationRequestIdRef = useRef(0);

  const toast = useToast();
  
  // TypeScript engine for fast game logic (single source of truth)
  const engineRef = useRef<SantoriniEngine>(SantoriniEngine.createInitial().engine);
  const [engineVersion, setEngineVersion] = useState(0);
  const moveSelectorRef = useRef<TypeScriptMoveSelector>(new TypeScriptMoveSelector());
  
  // Python engine for AI features only
  const gameRef = useRef<Santorini>();
  const selectorRef = useRef<MoveSelector>();
  const aiPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const guidedSetupPlacementsRef = useRef<Array<[number, number]>>([]);
  const processingMoveRef = useRef<boolean>(false); // Prevent rapid clicks

  const getPlacementContext = useCallback((): UiPlacementContext => {
    const enginePlacement: EnginePlacementContext | null = engineRef.current?.getPlacementContext() ?? null;
    if (!enginePlacement) {
      return { phase: 'play' };
    }
    return {
      phase: 'placement',
      player: enginePlacement.player,
      workerId: enginePlacement.workerId,
    };
  }, []);

  const updateSelectable = useCallback(() => {
    const selector = selectorRef.current;
    if (!selector) {
      return;
    }

    selector.selectRelevantCells();
    const placement = getPlacementContext();
    if (buttonsRef.current.setupMode || placement.phase === 'placement') {
      const snapshot = engineRef.current.snapshot;
      const cells = Array.from({ length: GAME_CONSTANTS.BOARD_SIZE }, (_, y) =>
        Array.from({ length: GAME_CONSTANTS.BOARD_SIZE }, (_, x) => snapshot.board[y][x][0] === 0),
      );
      setSelectable(cells);
      return;
    }

    setSelectable(selector.cells.map((row) => row.slice()));
  }, [getPlacementContext]);

  // Helper to sync TypeScript engine state to UI and Python engine
  const syncEngineToUi = useCallback(() => {
    const snapshot = engineRef.current.snapshot;
    const newBoard = Array.from({ length: 5 }, (_, y) =>
      Array.from({ length: 5 }, (_, x) => {
        const cell = snapshot.board[y][x];
        const worker = cell[0] || 0;
        const level = cell[1] || 0;
        return {
          worker,
          level,
          levels: level,
          svg: renderCellSvg({ levels: level, worker }),
          highlight: false,
        };
      })
    );
    setBoard(newBoard);
    setNextPlayer(snapshot.player);
    
    // Update selectable based on TypeScript engine state
    const placement = engineRef.current.getPlacementContext();
    const validMoves = engineRef.current.getValidMoves();
    const game = gameRef.current;
    
    if (placement) {
      // During placement, all empty cells are selectable
      const cells = Array.from({ length: 5 }, (_, y) =>
        Array.from({ length: 5 }, (_, x) => snapshot.board[y][x][0] === 0)
      );
      setSelectable(cells);
      setCancelSelectable(INITIAL_SELECTABLE.map((row) => row.slice()));
    } else {
      // During game phase, check if it's human's turn
      let isHumanTurn = true; // Default to true if no game mode set
      
      if (game && game.gameMode && game.gameMode !== 'Human') {
        const currentPlayer = snapshot.player; // 0 or 1
        
        if (game.gameMode === 'P0') {
          // Human is Player 0 (Green)
          isHumanTurn = currentPlayer === 0;
        } else if (game.gameMode === 'P1') {
          // Human is Player 1 (Red)
          isHumanTurn = currentPlayer === 1;
        } else if (game.gameMode === 'AI') {
          // Both are AI - no human turns
          isHumanTurn = false;
        }
      }
      
      if (isHumanTurn) {
        // Human's turn: show selectable pieces
        const newSelectable = moveSelectorRef.current.computeSelectable(
          snapshot.board,
          validMoves,
          snapshot.player
        );
        setSelectable(newSelectable);

        // Compute cancel-selectable mask based on selector stage
        const cancelMask = INITIAL_SELECTABLE.map((row) => row.slice());
        const selector = moveSelectorRef.current as any;
        if (selector.stage === 1) {
          cancelMask[selector.workerY]?.[selector.workerX] && (cancelMask[selector.workerY][selector.workerX] = true);
          if (!cancelMask[selector.workerY]) cancelMask[selector.workerY] = Array(5).fill(false);
          cancelMask[selector.workerY][selector.workerX] = true;
        } else if (selector.stage === 2) {
          if (!cancelMask[selector.newY]) cancelMask[selector.newY] = Array(5).fill(false);
          cancelMask[selector.newY][selector.newX] = true;
        }
        setCancelSelectable(cancelMask);
      } else {
        // AI's turn: clear selectable
        const emptySelectable = Array.from({ length: 5 }, () => Array(5).fill(false));
        setSelectable(emptySelectable);
        setCancelSelectable(emptySelectable.map((row) => row.slice()));
      }
    }
    
    setEngineVersion(v => v + 1);
  }, []);

  // Persist TypeScript engine state (single source of truth)
  const persistPracticeState = useCallback(async () => {
    try {
      writePracticeSnapshot(engineRef.current.snapshot);
    } catch (error) {
      console.error('Failed to persist practice state:', error);
    }
  }, []);

  const restorePracticeSettings = useCallback((game: Santorini) => {
    const validModes: PracticeGameMode[] = ['P0', 'P1', 'Human', 'AI'];
    const stored = readPracticeSettings();
    const modeToApply =
      typeof game.gameMode === 'string' && validModes.includes(game.gameMode as PracticeGameMode)
        ? (game.gameMode as PracticeGameMode)
        : stored.mode ?? DEFAULT_PRACTICE_MODE;

    game.gameMode = modeToApply;
    setPracticeMode(modeToApply);

    const difficultyToApply = stored.difficulty ?? DEFAULT_PRACTICE_DIFFICULTY;

    try {
      game.change_difficulty(difficultyToApply);
    } catch (error) {
      console.error('Failed to apply difficulty to practice game:', error);
    }
    setPracticeDifficulty(difficultyToApply);
  }, []);

  // Restore TypeScript engine state from localStorage
  const restorePracticeState = useCallback(async () => {
    const snapshot = readPracticeSnapshot();
    if (!snapshot) {
      return false;
    }

    try {
      engineRef.current = SantoriniEngine.fromSnapshot(snapshot as SantoriniSnapshot);
      moveSelectorRef.current.reset();
      await syncPythonFromTypeScript();
      return true;
    } catch (error) {
      console.error('Failed to restore practice state:', error);
      clearPracticeSnapshot();
      return false;
    }
  }, []);

  // Sync Python engine FROM TypeScript engine (for AI and evaluation)
  const syncPythonFromTypeScript = useCallback(async () => {
    const game = gameRef.current;
    const bridge = pythonBridgeRef.current;
    if (!game || !bridge) {
      console.error('🔄 Cannot sync: missing Python runtime');
      return;
    }
    const snapshot = engineRef.current.snapshot;
    const result = bridge.importPracticeState(snapshot);
    if (!result) {
      console.error('🔄 import_practice_state unavailable');
      return;
    }
    game.nextPlayer = result.nextPlayer;
    game.gameEnded = result.gameEnded;
    game.validMoves =
      result.validMoves.length > 0 ? result.validMoves : Array(GAME_CONSTANTS.TOTAL_MOVES).fill(false);
  }, []);

  const loadPyodideRuntime = useCallback(async () => {
    try {
      const { game, selector } = await createSantoriniRuntime({ evaluationEnabled });
      gameRef.current = game;
      selectorRef.current = selector;
      pythonBridgeRef.current = new SantoriniPythonBridge(game);
    } catch (error) {
      console.error('Failed to load Santorini runtime:', error);
      throw error;
    }
  }, [evaluationEnabled]);

  const pythonBridgeRef = useRef<SantoriniPythonBridge | null>(null);

  const readBoard = useCallback(() => {
    const game = gameRef.current;
    const bridge = pythonBridgeRef.current;
    if (!game || !game.py || !bridge) return;
    const nextBoard: BoardCell[][] = Array.from({ length: GAME_CONSTANTS.BOARD_SIZE }, (_, y) =>
      Array.from({ length: GAME_CONSTANTS.BOARD_SIZE }, (_, x) => {
        const cell = bridge.readBoardCell(y, x);
        const boardCell: CellState = { worker: cell.worker, levels: cell.levels };
        const highlight = game.has_changed_on_last_move([y, x]);
        return { ...boardCell, svg: renderCellSvg(boardCell), highlight };
      }),
    );
    setBoard(nextBoard);
  }, []);

  const updateButtons = useCallback(async (loadingState = false) => {
    const selector = selectorRef.current;
    const engine = engineRef.current;
    if (!selector || !engine) return;
    
    // Use TypeScript engine for undo/redo status
    const canUndo = engine.canUndo();
    const canRedo = engine.canRedo();
    
    const stage = moveSelectorRef.current.stage;
    const placement = getPlacementContext();

    updateButtonsState((prev) => {
      let status = prev.status;
      if (placement.phase === 'placement') {
        const pieceNumber = placement.workerId === 1 || placement.workerId === -1 ? 1 : 2;
        const playerLabel = placement.player === 0 ? 'Green' : 'Red';
        status = `Place ${playerLabel} worker ${pieceNumber}`;
      } else {
        if (stage <= 0) {
          status = 'Ready. Select a worker to start your move.';
        } else if (stage === 1) {
          status = 'Step 1/3: Select destination for the worker.';
        } else if (stage === 2) {
          status = 'Step 2/3: Select a build square.';
        } else {
          status = 'Confirming build.';
        }
      }
      return {
        ...prev,
        loading: loadingState,
        canUndo,
        canRedo,
        editMode: selector.editMode,
        status,
      };
    });
    setNextPlayer(engine.player);
  }, [getPlacementContext, updateButtonsState]);

  const refreshHistory = useCallback(() => {
    const bridge = pythonBridgeRef.current;
    if (!bridge) return;
    const snapshot = bridge.getHistorySnapshot() as Array<Record<string, unknown>>;
    setHistory(summarizeHistoryEntries(snapshot));
  }, []);

  const refreshEvaluation = useCallback(async (): Promise<EvaluationState | null> => {
    const balancedEvaluation: EvaluationState = { value: 0, advantage: 'Balanced', label: '0.00' };

    const game = gameRef.current;

    const terminalEvaluation = (() => {
      const ended = game?.gameEnded;
      if (!ended || ended.length < 2) {
        return null;
      }
      const [creatorWin, opponentWin] = ended;
      if (creatorWin === 1) {
        return { value: 1, advantage: 'Creator wins', label: '+1.00' } satisfies EvaluationState;
      }
      if (opponentWin === 1) {
        return { value: -1, advantage: 'Opponent wins', label: '-1.00' } satisfies EvaluationState;
      }
      return null;
    })();

    if (terminalEvaluation) {
      setEvaluation(terminalEvaluation);
      setTopMoves([]);
      return terminalEvaluation;
    }

    if (!evaluationEnabled) {
      setEvaluation(balancedEvaluation);
      setTopMoves([]);
      return balancedEvaluation;
    }

    const bridge = pythonBridgeRef.current;
    if (!game || !bridge) {
      return null;
    }

    const requestId = ++evaluationRequestIdRef.current;
    let nextEvaluation: EvaluationState | undefined;
    let nextTopMoves: TopMove[] | undefined;

    try {
      const evalResponse = await bridge.calculateEvaluation(evaluationDepthOverride ?? undefined);
      if (evalResponse?.value?.length) {
        const value = Number(evalResponse.value[0]);
        if (Number.isFinite(value)) {
          const label = value >= 0 ? `+${value.toFixed(3)}` : value.toFixed(3);
          const advantage = value > 0 ? 'Player 0 ahead' : value < 0 ? 'Player 1 ahead' : 'Balanced';
          nextEvaluation = { value, label, advantage };
        }
      }

      const baseMoves = await bridge.listCurrentMoves(10);
      let normalizedMoves = normalizeTopMoves(baseMoves);

      if (normalizedMoves.length === 0 || normalizedMoves.every((move) => move.prob === 0)) {
        console.log('No moves or zero probabilities from list_current_moves, trying list_current_moves_with_adv...');
        try {
          const advMoves = await bridge.listMovesWithAdv(6, optionsDepthOverride ?? undefined);
          normalizedMoves = normalizeTopMoves(advMoves);
        } catch (advError) {
          console.error('Failed to get advanced moves:', advError);
        }
      }
      nextTopMoves = normalizedMoves;

      if (requestId === evaluationRequestIdRef.current) {
        if (nextEvaluation !== undefined) {
          setEvaluation(nextEvaluation);
        }
        if (nextTopMoves !== undefined) {
          setTopMoves(nextTopMoves);
        }
        return nextEvaluation ?? null;
      }
      return null;
    } catch (error) {
      console.error('Failed to refresh evaluation:', error);
      if (requestId === evaluationRequestIdRef.current) {
        const errorEvaluation: EvaluationState = { value: 0, advantage: 'Error', label: '0.00' };
        setEvaluation(errorEvaluation);
        setTopMoves([]);
        return errorEvaluation;
      }
      return null;
    }
  }, [evaluationDepthOverride, evaluationEnabled, optionsDepthOverride]);

  const calculateOptions = useCallback(async () => {
    if (!evaluationEnabled) {
      setTopMoves([]);
      return;
    }
    const bridge = pythonBridgeRef.current;
    if (!bridge) {
      console.warn('calculateOptions skipped: Python bridge unavailable');
      return;
    }
    setCalcOptionsBusy(true);
    try {
      const result = await bridge.listMovesWithAdv(6, optionsDepthOverride ?? undefined);
      setTopMoves(normalizeTopMoves(result));
    } catch (error) {
      console.error('Failed to calculate options:', error);
      setTopMoves([]);
    } finally {
      setCalcOptionsBusy(false);
    }
  }, [evaluationEnabled, optionsDepthOverride]);

  const syncUi = useCallback(async (loadingState = false) => {
    // TypeScript engine is source of truth - sync UI from it
    syncEngineToUi();
    await updateButtons(loadingState);
    refreshHistory();
    await persistPracticeState();
  }, [persistPracticeState, refreshHistory, syncEngineToUi, updateButtons]);

  const startGuidedSetup = useCallback(async () => {
    // Simply reset to initial state - no special setup mode needed!
    // The placement phase is handled naturally by the engine
    guidedSetupPlacementsRef.current = [];

    const { engine } = SantoriniEngine.createInitial();
    engineRef.current = engine;
    moveSelectorRef.current.reset();

    const selector = selectorRef.current;
    if (selector) {
      selector.setEditMode(0);
      selector.resetAndStart();
    }

    updateButtonsState((prev) => ({
      ...prev,
      setupMode: false, // No special setup mode
      setupTurn: 0,
      editMode: 0,
      canUndo: false,
      canRedo: false,
      status: 'Ready to place workers',
    }));
    
    setHistory([]);
    await syncUi();
  }, [syncUi, updateButtonsState]);

  const initializeStartedRef = useRef(false);
  const initializePromiseRef = useRef<Promise<void> | null>(null);

  const initialize = useCallback(async () => {
    if (initializeStartedRef.current) {
      if (initializePromiseRef.current) {
        await initializePromiseRef.current;
      }
      return;
    }

    initializeStartedRef.current = true;
    setLoading(true);

    const initPromise = (async () => {
      try {
        // Don't block UI - just update status
        updateButtonsState((prev) => ({ ...prev, status: 'Loading game engine...' }));
        await yieldToMainThread();
        await loadPyodideRuntime();
        const game = gameRef.current;
        const selector = selectorRef.current;
        if (!game || !selector) {
          return;
        }
        game.init_game();
        restorePracticeSettings(game);

        const restored = await restorePracticeState();
        selector.resetAndStart();
        await syncUi(true);
        await refreshEvaluation();
        let statusOverride: string | null = 'Ready to play!';
        if (!restored) {
          await startGuidedSetup();
          statusOverride = null;
        }
        updateButtonsState((prev) => ({
          ...prev,
          loading: false,
          status: statusOverride ?? prev.status,
        }));
      } catch (error) {
        initializeStartedRef.current = false;
        updateButtonsState((prev) => ({ ...prev, status: 'Failed to load game engine' }));
        throw error;
      } finally {
        initializePromiseRef.current = null;
        setLoading(false);
      }
    })();

    initializePromiseRef.current = initPromise;
    await initPromise;
  }, [loadPyodideRuntime, refreshEvaluation, restorePracticeSettings, restorePracticeState, startGuidedSetup, syncUi, updateButtonsState]);

  const aiPlayIfNeeded = useCallback(async () => {
    if (!evaluationEnabled) {
      return;
    }
    const game = gameRef.current;
    const selector = selectorRef.current;
    if (!game || !selector) return;
    
    console.log('🤖 AI Check - Game mode:', game.gameMode, 'Current player:', engineRef.current.player);
    
    // Check if it's AI's turn using TypeScript engine (source of truth)
    const engine = engineRef.current;
    const currentPlayer = engine.player;
    let isAiTurn = false;
    
    if (game.gameMode === 'P0') {
      // Player 0 is human, Player 1 is AI
      isAiTurn = currentPlayer === 1;
    } else if (game.gameMode === 'P1') {
      // Player 0 is AI, Player 1 is human
      isAiTurn = currentPlayer === 0;
    } else if (game.gameMode === 'AI') {
      // Both are AI
      isAiTurn = true;
    }
    
    console.log('🤖 Is AI turn?', isAiTurn);
    
    if (!isAiTurn) {
      console.log('🤖 Not AI\'s turn, skipping');
      return;
    }
    
    await updateButtons(true);
    
    // Check if game is not ended
    const gameEnded = engine.getGameEnded();
    if (gameEnded[0] !== 0 || gameEnded[1] !== 0) {
      console.log('🤖 Game ended, skipping AI');
      await updateButtons(false);
      return;
    }
    
    console.log('🤖 AI making move...');
    selector.selectNone();
    
    try {
      const bridge = pythonBridgeRef.current;
      if (!bridge) {
        throw new Error('Python bridge unavailable for AI move');
      }
      // Get AI's chosen action
      const bestAction = await bridge.guessBestAction();
      if (bestAction == null) {
        throw new Error('AI did not return a move');
      }
      console.log('🤖 AI chose action:', bestAction, 'Current TS player:', engineRef.current.player);
      
      // Apply to TypeScript engine (source of truth)
      const result = engineRef.current.applyMove(bestAction);
      engineRef.current = SantoriniEngine.fromSnapshot(result.snapshot);
      moveSelectorRef.current.reset();
      console.log('🤖 AI move applied to TypeScript, new player:', engineRef.current.player);
      
      // Sync TypeScript → Python (AI made move in Python, but we re-apply from TS as source of truth)
      await syncPythonFromTypeScript();
      
      await syncUi();
      refreshEvaluation().catch((error) => {
        console.error('Failed to refresh evaluation after importing state:', error);
      });
    } catch (error) {
      console.error('🤖 AI move failed:', error);
    }
    
    await updateButtons(false);
  }, [evaluationEnabled, refreshEvaluation, syncPythonFromTypeScript, syncUi, updateButtons]);

  const ensureAiIdle = useCallback(() => aiPromiseRef.current, []);

  // No longer needed - placement is handled naturally by the engine
  const finalizeGuidedSetup = useCallback(async () => {
    // After 4 workers are placed, sync to Python and trigger AI if needed
    await syncPythonFromTypeScript();
    refreshEvaluation().catch((error) => {
      console.error('Failed to refresh evaluation after guided setup:', error);
    });
    
    // Trigger AI if it should move first
    const game = gameRef.current;
    if (game && game.gameMode) {
      aiPromiseRef.current = aiPlayIfNeeded();
    }
  }, [aiPlayIfNeeded, refreshEvaluation, syncPythonFromTypeScript]);

  const applyMove = useCallback(
    async (move: number, options: ApplyMoveOptions = {}) => {
      const { triggerAi = true } = options;
      await ensureAiIdle();
      
      console.log('👤 Human applying move:', move, 'Current player:', engineRef.current.player);
      
      // Apply move to TypeScript engine (source of truth)
      try {
        const result = engineRef.current.applyMove(move);
        engineRef.current = SantoriniEngine.fromSnapshot(result.snapshot);
        moveSelectorRef.current.reset();
        
        console.log('👤 Move applied to TS. New player:', engineRef.current.player);
        
        // Sync to Python engine for AI/evaluation
        await syncPythonFromTypeScript();
        
        await syncUi();
        refreshEvaluation().catch((error) => {
          console.error('Failed to refresh evaluation after applying move:', error);
        });
        
        // Only trigger AI if not in placement phase
        const placement = engineRef.current.getPlacementContext();
        if (triggerAi && !placement) {
          aiPromiseRef.current = ensureAiIdle().then(() => aiPlayIfNeeded());
        }
      } catch (error) {
        console.error('Failed to apply move:', error);
        toast({ title: 'Invalid move', status: 'error' });
      }
    },
    [aiPlayIfNeeded, ensureAiIdle, refreshEvaluation, syncPythonFromTypeScript, syncUi, toast],
  );

  const onCellClick = useCallback(
    async (y: number, x: number) => {
      // Prevent overlapping move processing
      if (processingMoveRef.current) {
        return;
      }

      // Use TypeScript engine for all game logic
      const engine = engineRef.current;
      const validMoves = engine.getValidMoves();
      const placement = engine.getPlacementContext();
      const moveSelector = moveSelectorRef.current;
      const pythonSelector = selectorRef.current;
      const game = gameRef.current;
      
      // Edit mode (requires Python for board manipulation)
      if (pythonSelector && (pythonSelector.editMode === 1 || pythonSelector.editMode === 2)) {
        const bridge = pythonBridgeRef.current;
        if (!game || !game.py || !bridge) return;
        processingMoveRef.current = true;
        try {
          game.editCell(y, x, pythonSelector.editMode);
          
          // Sync back to TypeScript engine
          const snapshot = bridge.exportPracticeState();
          if (snapshot) {
            engineRef.current = SantoriniEngine.fromSnapshot(snapshot as SantoriniSnapshot);
          }
          
          syncEngineToUi();
          await updateButtons(false);
          await persistPracticeState();
        } finally {
          processingMoveRef.current = false;
        }
        return;
      }
      
      // Check turn enforcement for game phase (not placement)
      if (!placement && game && game.gameMode && game.gameMode !== 'Human') {
        // Determine which player is human based on game mode
        const currentPlayer = engine.player; // 0 or 1
        let isHumanTurn = false;
        
        if (game.gameMode === 'P0') {
          // Human is Player 0 (Green)
          isHumanTurn = currentPlayer === 0;
        } else if (game.gameMode === 'P1') {
          // Human is Player 1 (Red)
          isHumanTurn = currentPlayer === 1;
        } else if (game.gameMode === 'AI') {
          // Both are AI - no human turns
          isHumanTurn = false;
        }
        
        if (!isHumanTurn) {
          toast({ title: "It's the AI's turn", status: 'info' });
          return;
        }
      }
      
      // Placement phase (like local mode)
      if (placement) {
        const placementAction = y * 5 + x;
        if (placementAction >= validMoves.length || !validMoves[placementAction]) {
          toast({ title: 'Invalid placement', status: 'warning' });
          return;
        }
        
        processingMoveRef.current = true;
        try {
          await applyMove(placementAction, { triggerAi: true });
          
          // After 4th worker, sync to Python for AI
          const newPlacement = engineRef.current.getPlacementContext();
          if (!newPlacement) {
            await finalizeGuidedSetup();
          }
        } finally {
          processingMoveRef.current = false;
        }
        return;
      }
      
      // Game phase: Use TypeScript move selector
      processingMoveRef.current = true;
      try {
        const clicked = moveSelector.click(y, x, engine.snapshot.board, validMoves, engine.player);
        
        if (!clicked) {
          toast({ title: 'Invalid selection', status: 'warning' });
          return;
        }
        
        // Update selectable highlighting
        const newSelectable = moveSelector.computeSelectable(engine.snapshot.board, validMoves, engine.player);
        setSelectable(newSelectable);

        // Update cancel-selectable highlighting
        const cancelMask = INITIAL_SELECTABLE.map((row) => row.slice());
        if (moveSelector.stage === 1) {
          cancelMask[(moveSelector as any).workerY][(moveSelector as any).workerX] = true;
        } else if (moveSelector.stage === 2) {
          cancelMask[(moveSelector as any).newY][(moveSelector as any).newX] = true;
        }
        setCancelSelectable(cancelMask);
        
        // Check if move is complete
        const action = moveSelector.getAction();
        if (action >= 0) {
          await applyMove(action, { triggerAi: true });
        }
      } finally {
        processingMoveRef.current = false;
      }
    },
    [
      applyMove,
      finalizeGuidedSetup,
      persistPracticeState,
      syncEngineToUi,
      toast,
      updateButtons,
    ],
  );

  const onCellHover = useCallback((_y: number, _x: number) => {
    // Placeholder for future hover previews.
  }, []);

  const onCellLeave = useCallback((_y: number, _x: number) => {
    // Placeholder for future hover previews.
  }, []);

  const undo = useCallback(async () => {
    await ensureAiIdle();
    
    // Use TypeScript engine for undo (source of truth)
    const result = engineRef.current.undo();
    if (!result.success) {
      toast({ title: 'Nothing to undo', status: 'info' });
      return;
    }
    
    engineRef.current = SantoriniEngine.fromSnapshot(result.snapshot);
    moveSelectorRef.current.reset();
    
    // Sync UI and Python engine
    await syncUi();
    await syncPythonFromTypeScript();
    refreshEvaluation().catch((error) => {
      console.error('Failed to refresh evaluation after undo:', error);
    });
  }, [ensureAiIdle, refreshEvaluation, syncPythonFromTypeScript, syncUi, toast]);

  const redo = useCallback(async () => {
    await ensureAiIdle();
    
    // Use TypeScript engine for redo (source of truth)
    const result = engineRef.current.redo();
    if (!result.success) {
      toast({ title: 'Nothing to redo', status: 'info' });
      return;
    }
    
    engineRef.current = SantoriniEngine.fromSnapshot(result.snapshot);
    moveSelectorRef.current.reset();
    
    // Sync UI and Python engine
    await syncUi();
    await syncPythonFromTypeScript();
    refreshEvaluation().catch((error) => {
      console.error('Failed to refresh evaluation after redo:', error);
    });
  }, [ensureAiIdle, refreshEvaluation, syncPythonFromTypeScript, syncUi, toast]);

  const reset = useCallback(async () => {
    await ensureAiIdle();
    
    // Reset TypeScript engine (source of truth)
    const { engine } = SantoriniEngine.createInitial();
    engineRef.current = engine;
    moveSelectorRef.current.reset();
    
    const selector = selectorRef.current;
    if (selector) {
      selector.resetAndStart();
    }
    
    await startGuidedSetup();
  }, [ensureAiIdle, startGuidedSetup]);

  const setGameMode = useCallback(
    async (mode: PracticeGameMode) => {
      const game = gameRef.current;
      const selector = selectorRef.current;
      if (!game || !selector) return;
      game.gameMode = mode;
      setPracticeMode(mode);
      persistPracticeMode(mode);
      await ensureAiIdle();
      selector.resetAndStart();
      await aiPlayIfNeeded();
      await syncUi();
    },
    [aiPlayIfNeeded, ensureAiIdle, persistPracticeMode, syncUi],
  );

  const changeDifficulty = useCallback((sims: number) => {
    const game = gameRef.current;
    if (!game) return;
    const sanitized = Number.isFinite(sims) && sims > 0 ? sims : DEFAULT_PRACTICE_DIFFICULTY;
    game.change_difficulty(sanitized);
    setPracticeDifficulty(sanitized);
    persistPracticeDifficulty(sanitized);
  }, [persistPracticeDifficulty]);

  const toggleEdit = useCallback(() => {
    const selector = selectorRef.current;
    if (!selector) return;
    selector.edit();
    updateSelectable();
    updateButtons(false);
  }, [updateButtons, updateSelectable]);

  const setEditMode = useCallback(
    (mode: number) => {
      const selector = selectorRef.current;
      if (!selector) return;
      selector.setEditMode(mode);
      updateSelectable();
      updateButtons(false);
    },
    [updateButtons, updateSelectable],
  );

  const jumpToMove = useCallback(
    async (index: number) => {
      const game = gameRef.current;
      const selector = selectorRef.current;
      const bridge = pythonBridgeRef.current;
      if (!game || !selector || !bridge) return;
      const historyLength = bridge.getHistoryLength();
      const reverseIndex = historyLength - 1 - index;
      const jumpResult = bridge.jumpToMoveIndex(reverseIndex);
      if (jumpResult) {
        game.nextPlayer = jumpResult.nextPlayer;
        game.gameEnded = jumpResult.gameEnded;
        game.validMoves = jumpResult.validMoves;
        const snapshot = bridge.exportPracticeState();
        if (snapshot) {
          engineRef.current = SantoriniEngine.fromSnapshot(snapshot as SantoriniSnapshot);
        }
      }
      selector.resetAndStart();
      await syncUi();
      refreshEvaluation().catch((error) => {
        console.error('Failed to refresh evaluation after jumping to move:', error);
      });
    },
    [refreshEvaluation, syncUi],
  );

  const importState = useCallback(
    async (
      snapshot: SantoriniStateSnapshot | null | undefined,
      options: { waitForEvaluation?: boolean } = {},
    ) => {
      if (!snapshot) {
        return;
      }
      await ensureAiIdle();

      const { waitForEvaluation = true } = options;

      try {
        engineRef.current = SantoriniEngine.fromSnapshot(snapshot as SantoriniSnapshot);
        moveSelectorRef.current.reset();
      } catch (error) {
        console.error('Failed to update TypeScript engine from snapshot:', error);
        throw error;
      }

      await syncPythonFromTypeScript();

      const selector = selectorRef.current;
      if (selector) {
        if (typeof selector.resetAndStart === 'function') {
          selector.resetAndStart();
        } else {
          selector.reset?.();
          selector.start?.();
        }
      }

      await syncUi();
      if (waitForEvaluation) {
        await refreshEvaluation();
      } else {
        refreshEvaluation().catch((error) => {
          console.error('Failed to refresh evaluation after importing state:', error);
        });
      }
    },
    [ensureAiIdle, refreshEvaluation, syncPythonFromTypeScript, syncUi],
  );

  const updateEvaluationDepth = useCallback(
    (depth: number | null) => {
      setEvaluationDepthOverride(depth);
      refreshEvaluation().catch((error) => {
        console.error('Failed to refresh evaluation with updated depth:', error);
      });
    },
    [refreshEvaluation],
  );

  const updateOptionsDepth = useCallback((depth: number | null) => {
    setOptionsDepthOverride(depth);
  }, []);

  const controls: Controls = useMemo(
    () => ({
      reset,
      setGameMode,
      changeDifficulty,
      toggleEdit,
      setEditMode,
      refreshEvaluation,
      calculateOptions,
      updateEvaluationDepth,
      updateOptionsDepth,
      jumpToMove,
    }),
    [
      calculateOptions,
      changeDifficulty,
      jumpToMove,
      refreshEvaluation,
      reset,
      setEditMode,
      setGameMode,
      toggleEdit,
      updateEvaluationDepth,
      updateOptionsDepth,
    ],
  );

  return {
    loading,
    initialize,
    board,
    selectable,
    cancelSelectable,
    onCellClick,
    applyMove,
    onCellHover,
    onCellLeave,
    buttons,
    evaluation,
    topMoves,
    controls,
    history,
    undo,
    redo,
    evaluationDepth: evaluationDepthOverride,
    optionsDepth: optionsDepthOverride,
    calcOptionsBusy,
    nextPlayer,
    gameEnded: gameRef.current?.gameEnded ?? [0, 0],
    importState,
    gameMode: practiceMode,
    difficulty: practiceDifficulty,
  };
}

type SantoriniStore = ReturnType<typeof useSantoriniInternal>;

const SantoriniContext = createContext<SantoriniStore | null>(null);

export interface SantoriniProviderProps {
  children: ReactNode;
  evaluationEnabled?: boolean;
}

export function SantoriniProvider({ children, evaluationEnabled }: SantoriniProviderProps) {
  const store = useSantoriniInternal({ evaluationEnabled });
  return <SantoriniContext.Provider value={store}>{children}</SantoriniContext.Provider>;
}

export function useSantorini(options: UseSantoriniOptions = {}) {
  const context = useContext(SantoriniContext);
  if (context) {
    return context;
  }
  return useSantoriniInternal(options);
}
