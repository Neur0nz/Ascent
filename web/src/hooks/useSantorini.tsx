import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { renderCellSvg, type CellState } from '@game/svg';
import { GAME_CONSTANTS } from '@game/constants';
import type { SantoriniStateSnapshot, EnginePreference } from '@/types/match';
import {
  SantoriniEngine,
  SANTORINI_CONSTANTS,
  type SantoriniSnapshot,
  type PlacementContext as EnginePlacementContext,
} from '@/lib/santoriniEngine';
import { TypeScriptMoveSelector } from '@/lib/moveSelectorTS';
import { useToast } from '@chakra-ui/react';
import { SantoriniWorkerClient } from '@/lib/runtime/santoriniWorkerClient';
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
  enginePreference?: EnginePreference;
  persistState?: boolean;
  storageNamespace?: string;
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

export type EvaluationStatus =
  | { state: 'idle' }
  | { state: 'running'; startedAt: number; durationMs: number; sims?: number; message?: string }
  | { state: 'success'; startedAt: number; durationMs: number; sims?: number }
  | { state: 'error'; startedAt: number; durationMs: number; sims?: number; message: string };

function useSantoriniInternal(options: UseSantoriniOptions = {}) {
  const {
    evaluationEnabled = true,
    enginePreference = 'python',
    persistState = true,
    storageNamespace = 'practice',
  } = options;
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
  const [editMode, setEditModeState] = useState(0);
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
    if (!persistState) return;
    try {
      storePracticeMode(mode, storageNamespace);
    } catch (error) {
      console.error('Failed to persist practice mode:', error);
    }
  }, [persistState, storageNamespace]);

  const persistPracticeDifficulty = useCallback((value: number) => {
    if (!persistState) return;
    try {
      storePracticeDifficulty(value, storageNamespace);
    } catch (error) {
      console.error('Failed to persist practice difficulty:', error);
    }
  }, [persistState, storageNamespace]);
  const [evaluation, setEvaluation] = useState<EvaluationState>({ value: 0, advantage: 'Balanced', label: '0.00' });
  const [topMoves, setTopMoves] = useState<TopMove[]>([]);
  const [history, setHistory] = useState<MoveSummary[]>([]);
  const [nextPlayer, setNextPlayer] = useState(0);
  const [calcOptionsBusy, setCalcOptionsBusy] = useState(false);
  const [evaluationStatus, setEvaluationStatus] = useState<EvaluationStatus>({ state: 'idle' });
  const [evaluationDepthOverride, setEvaluationDepthOverride] = useState<number | null>(null);
  const [optionsDepthOverride, setOptionsDepthOverride] = useState<number | null>(null);
  const evaluationRequestIdRef = useRef(0);
  const wasmStateVersionRef = useRef(0);

  const toast = useToast();
  
  // TypeScript engine for fast game logic (single source of truth)
  const engineRef = useRef<SantoriniEngine>(SantoriniEngine.createInitial().engine);
  const [engineVersion, setEngineVersion] = useState(0);
  const moveSelectorRef = useRef<TypeScriptMoveSelector>(new TypeScriptMoveSelector());
  
  // Python engine for AI features only
  const aiPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const guidedSetupPlacementsRef = useRef<Array<[number, number]>>([]);
  const processingMoveRef = useRef<boolean>(false); // Prevent rapid clicks
  const workerClientRef = useRef<SantoriniWorkerClient | null>(null);
  const workerPreferenceRef = useRef<EnginePreference>('python');

  useEffect(() => {
    if (evaluationStatus.state !== 'running') {
      return undefined;
    }
    const timer = window.setInterval(() => {
      setEvaluationStatus((prev) => {
        if (prev.state !== 'running') {
          return prev;
        }
        return {
          ...prev,
          durationMs: performance.now() - prev.startedAt,
        };
      });
    }, 200);
    return () => window.clearInterval(timer);
  }, [evaluationStatus.state]);

  const ensureWorkerClient = useCallback(async () => {
    if (!workerClientRef.current) {
      const client = new SantoriniWorkerClient();
      workerClientRef.current = client;
      await client.init(enginePreference);
      workerPreferenceRef.current = enginePreference;
      return client;
    }
    if (workerPreferenceRef.current !== enginePreference) {
      await workerClientRef.current.init(enginePreference);
      workerPreferenceRef.current = enginePreference;
    }
    return workerClientRef.current;
  }, [enginePreference]);

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
  }, [practiceMode]);

  const updateSelectable = useCallback(() => {
    const placement = getPlacementContext();
    if (buttonsRef.current.setupMode || placement.phase === 'placement') {
      const snapshot = engineRef.current.snapshot;
      const cells = Array.from({ length: GAME_CONSTANTS.BOARD_SIZE }, (_, y) =>
        Array.from({ length: GAME_CONSTANTS.BOARD_SIZE }, (_, x) => snapshot.board[y][x][0] === 0),
      );
      setSelectable(cells);
      return;
    }
    const snapshot = engineRef.current.snapshot;
    const validMoves = engineRef.current.getValidMoves();
    const nextSelectable = moveSelectorRef.current.computeSelectable(snapshot.board, validMoves, snapshot.player);
    setSelectable(nextSelectable);
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

    if (placement) {
      // During placement, all empty cells are selectable
      const cells = Array.from({ length: 5 }, (_, y) =>
        Array.from({ length: 5 }, (_, x) => snapshot.board[y][x][0] === 0)
      );
      setSelectable(cells);
      setCancelSelectable(INITIAL_SELECTABLE.map((row) => row.slice()));
    } else {
      // During game phase, check if it's human's turn
      let isHumanTurn = true;
      const currentPlayer = snapshot.player;
      if (practiceMode === 'P0') {
        isHumanTurn = currentPlayer === 0;
      } else if (practiceMode === 'P1') {
        isHumanTurn = currentPlayer === 1;
      } else if (practiceMode === 'AI') {
        isHumanTurn = false;
      } else if (practiceMode === 'Human') {
        isHumanTurn = true;
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
    if (!persistState) {
      return;
    }
    try {
      writePracticeSnapshot(engineRef.current.snapshot, storageNamespace);
    } catch (error) {
      console.error('Failed to persist practice state:', error);
    }
  }, [persistState, storageNamespace]);

  const restorePracticeSettings = useCallback(async () => {
    const stored = persistState ? readPracticeSettings(storageNamespace) : null;
    const modeToApply = stored?.mode ?? DEFAULT_PRACTICE_MODE;
    setPracticeMode(modeToApply);

    const difficultyToApply = stored?.difficulty ?? DEFAULT_PRACTICE_DIFFICULTY;
    setPracticeDifficulty(difficultyToApply);

    try {
      const client = workerClientRef.current ?? (await ensureWorkerClient());
      if (client) {
        await client.changeDifficulty(difficultyToApply);
      }
    } catch (error) {
      console.error('Failed to apply difficulty to backend:', error);
    }
  }, [ensureWorkerClient, persistState, storageNamespace]);

  // Sync background engine FROM TypeScript engine (for AI and evaluation)
  const syncPythonFromTypeScript = useCallback(async () => {
    const client = workerClientRef.current ?? (await ensureWorkerClient());
    if (!client) {
      console.error('🔄 Cannot sync: missing worker client');
      return;
    }
    const snapshot = engineRef.current.snapshot;
    try {
      await client.syncSnapshot(snapshot);
    } catch (error) {
      console.error('Failed to synchronize worker state:', error);
    }
  }, [ensureWorkerClient]);

  // Restore TypeScript engine state from localStorage
  const restorePracticeState = useCallback(async () => {
    if (!persistState) {
      return false;
    }
    const snapshot = readPracticeSnapshot(storageNamespace);
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
      clearPracticeSnapshot(storageNamespace);
      return false;
    }
  }, [persistState, storageNamespace, syncPythonFromTypeScript]);

  const updateButtons = useCallback(async (loadingState = false) => {
    const engine = engineRef.current;
    if (!engine) return;
    
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
        editMode,
        status,
      };
    });
    setNextPlayer(engine.player);
  }, [editMode, getPlacementContext, updateButtonsState]);

  const refreshHistory = useCallback(async () => {
    const client = workerClientRef.current ?? (await ensureWorkerClient());
    if (!client) {
      return;
    }
    try {
      const snapshot = await client.getHistorySnapshot();
      setHistory(summarizeHistoryEntries(snapshot as Array<Record<string, unknown>>));
    } catch (error) {
      console.error('Failed to refresh history snapshot:', error);
    }
  }, [ensureWorkerClient]);

  type EvaluationOverrides = { evaluationDepth?: number | null; optionsDepth?: number | null };

  const isPlacementPhase = useCallback(() => {
    const placementContext = getPlacementContext();
    return placementContext.phase === 'placement';
  }, [getPlacementContext]);

  const safeListMoves = useCallback(
    async (limit: number, depth: number | null) => {
      const client = workerClientRef.current ?? (await ensureWorkerClient());
      if (!client) return [];
      try {
        return await client.listMovesWithAdv(limit, depth ?? null);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? '');
        if (
          message.includes('place a worker') ||
          message.includes('placement') ||
          message.includes('occupied tile') ||
          message.includes('NoneType')
        ) {
          console.warn('Skipping best-move listing during placement/setup phase:', message);
          return [];
        }
        throw error;
      }
    },
    [ensureWorkerClient],
  );

  const evaluatePosition = useCallback(async (overrides?: EvaluationOverrides): Promise<EvaluationState | null> => {
    const balancedEvaluation: EvaluationState = { value: 0, advantage: 'Balanced', label: '0.00' };
    const evalDepth = overrides?.evaluationDepth ?? evaluationDepthOverride;
    const optionsDepth = overrides?.optionsDepth ?? optionsDepthOverride ?? evalDepth;

    const terminalEvaluation = (() => {
      const ended = engineRef.current.getGameEnded();
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
      setEvaluationStatus({
        state: 'success',
        startedAt: performance.now(),
        durationMs: 0,
        sims: evalDepth ?? practiceDifficulty,
      });
      return terminalEvaluation;
    }

    if (!evaluationEnabled || isPlacementPhase()) {
      setEvaluation(balancedEvaluation);
      setTopMoves([]);
      setEvaluationStatus({ state: 'idle' });
      return balancedEvaluation;
    }

    const placementContext = getPlacementContext();
    if (placementContext.phase === 'placement') {
      const placementEvaluation: EvaluationState = { value: 0, advantage: 'Placement phase', label: '0.00' };
      setEvaluation(placementEvaluation);
      setTopMoves([]);
      setEvaluationStatus({ state: 'idle' });
      return placementEvaluation;
    }

    const requestId = ++evaluationRequestIdRef.current;
    const evalStart = performance.now();
    const plannedSims = evalDepth ?? practiceDifficulty;
    setEvaluationStatus({
      state: 'running',
      startedAt: evalStart,
      durationMs: 0,
      sims: plannedSims,
    });
    let nextEvaluation: EvaluationState | undefined;
    let nextTopMoves: TopMove[] | undefined;

    try {
      const snapshotVersion = wasmStateVersionRef.current;
      const client = workerClientRef.current ?? (await ensureWorkerClient());
      if (!client) {
        setEvaluationStatus({
          state: 'error',
          startedAt: evalStart,
          durationMs: performance.now() - evalStart,
          sims: plannedSims,
          message: 'AI runtime unavailable',
        });
        return null;
      }
      const evalResponse = await client.calculateEvaluation(evalDepth ?? null);
      if (snapshotVersion !== wasmStateVersionRef.current) {
        return null;
      }
      if (evalResponse?.value?.length) {
        const value = Number(evalResponse.value[0]);
        if (Number.isFinite(value)) {
          const label = value >= 0 ? `+${value.toFixed(3)}` : value.toFixed(3);
          const advantage = value > 0 ? 'Player 0 ahead' : value < 0 ? 'Player 1 ahead' : 'Balanced';
          nextEvaluation = { value, label, advantage };
        }
      }

      const baseMoves = await safeListMoves(10, optionsDepth ?? null);
      nextTopMoves = normalizeTopMoves(baseMoves);

      if (requestId === evaluationRequestIdRef.current) {
        setEvaluationStatus({
          state: 'success',
          startedAt: evalStart,
          durationMs: performance.now() - evalStart,
          sims: plannedSims,
        });
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
        setEvaluationStatus({
          state: 'error',
          startedAt: evalStart,
          durationMs: performance.now() - evalStart,
          sims: plannedSims,
          message: error instanceof Error ? error.message : 'Evaluation failed',
        });
        return errorEvaluation;
      }
      return null;
    }
  }, [ensureWorkerClient, evaluationDepthOverride, evaluationEnabled, getPlacementContext, isPlacementPhase, optionsDepthOverride, practiceDifficulty, safeListMoves]);

  const refreshEvaluation = useCallback(() => evaluatePosition(), [evaluatePosition]);

  const calculateOptions = useCallback(async () => {
    if (!evaluationEnabled || isPlacementPhase()) {
      setTopMoves([]);
      return;
    }
    const placementContext = getPlacementContext();
    if (placementContext.phase === 'placement') {
      setTopMoves([]);
      return;
    }
    setCalcOptionsBusy(true);
    try {
      const requestVersion = wasmStateVersionRef.current;
      const depth = optionsDepthOverride ?? evaluationDepthOverride ?? null;
      const result = await safeListMoves(6, depth ?? null);
      if (requestVersion !== wasmStateVersionRef.current) {
        setTopMoves([]);
        return;
      }
      setTopMoves(normalizeTopMoves(result));
    } catch (error) {
      console.error('Failed to calculate options:', error);
      setTopMoves([]);
    } finally {
      setCalcOptionsBusy(false);
    }
  }, [evaluationDepthOverride, evaluationEnabled, getPlacementContext, isPlacementPhase, optionsDepthOverride, safeListMoves]);

  const syncUi = useCallback(async (loadingState = false) => {
    // TypeScript engine is source of truth - sync UI from it
    syncEngineToUi();
    await updateButtons(loadingState);
    await refreshHistory();
    await persistPracticeState();
  }, [persistPracticeState, refreshHistory, syncEngineToUi, updateButtons]);

  const startGuidedSetup = useCallback(async () => {
    // Simply reset to initial state - no special setup mode needed!
    // The placement phase is handled naturally by the engine
    guidedSetupPlacementsRef.current = [];

    const { engine } = SantoriniEngine.createInitial();
    engineRef.current = engine;
    moveSelectorRef.current.reset();
    setEditModeState(0);

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
    await syncPythonFromTypeScript();
  }, [syncPythonFromTypeScript, syncUi, updateButtonsState]);

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
        const client = await ensureWorkerClient();
        if (!client) {
          throw new Error('Failed to initialize Santorini worker');
        }
        await restorePracticeSettings();
        moveSelectorRef.current.reset();
        const restored = await restorePracticeState();
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
  }, [ensureWorkerClient, refreshEvaluation, restorePracticeSettings, restorePracticeState, startGuidedSetup, syncUi, updateButtonsState]);

  const aiPlayIfNeeded = useCallback(async () => {
    if (!evaluationEnabled) {
      return;
    }

    const engine = engineRef.current;
    const currentPlayer = engine.player;
    let isAiTurn = false;
    if (practiceMode === 'P0') {
      isAiTurn = currentPlayer === 1;
    } else if (practiceMode === 'P1') {
      isAiTurn = currentPlayer === 0;
    } else if (practiceMode === 'AI') {
      isAiTurn = true;
    }

    if (!isAiTurn) {
      return;
    }

    await updateButtons(true);

    const gameEnded = engine.getGameEnded();
    if (gameEnded[0] !== 0 || gameEnded[1] !== 0) {
      await updateButtons(false);
      return;
    }

    try {
      const client = workerClientRef.current ?? (await ensureWorkerClient());
      if (!client) {
        throw new Error('Worker client unavailable for AI move');
      }
      const requestVersion = wasmStateVersionRef.current;
      const bestAction = await client.guessBestAction();
      if (requestVersion !== wasmStateVersionRef.current) {
        console.warn('AI result ignored; state changed during request');
        return;
      }
      if (bestAction == null) {
        throw new Error('AI did not return a move');
      }

      const result = engineRef.current.applyMove(bestAction);
      engineRef.current = SantoriniEngine.fromSnapshot(result.snapshot);
      moveSelectorRef.current.reset();
      updateSelectable();

      await syncPythonFromTypeScript();
      await syncUi();
      refreshEvaluation().catch((error) => {
        console.error('Failed to refresh evaluation after importing state:', error);
      });
    } catch (error) {
      console.error('🤖 AI move failed:', error);
    }

    await updateButtons(false);
  }, [
    ensureWorkerClient,
    evaluationEnabled,
    practiceMode,
    refreshEvaluation,
    syncPythonFromTypeScript,
    syncUi,
    updateButtons,
    updateSelectable,
  ]);

  const ensureAiIdle = useCallback(() => aiPromiseRef.current, []);

  // No longer needed - placement is handled naturally by the engine
  const finalizeGuidedSetup = useCallback(async () => {
    // After 4 workers are placed, sync to Python and trigger AI if needed
    await syncPythonFromTypeScript();
    refreshEvaluation().catch((error) => {
      console.error('Failed to refresh evaluation after guided setup:', error);
    });
    
    // Trigger AI if it should move first
    if (practiceMode && practiceMode !== 'Human') {
      aiPromiseRef.current = aiPlayIfNeeded();
    }
  }, [aiPlayIfNeeded, practiceMode, refreshEvaluation, syncPythonFromTypeScript]);

  const applyMove = useCallback(
    async (move: number, options: ApplyMoveOptions = {}) => {
      const { triggerAi = true } = options;
      await ensureAiIdle();
      
      console.log('👤 Human applying move:', move, 'Current player:', engineRef.current.player);
      
      // Apply move to TypeScript engine (source of truth)
      try {
        const result = engineRef.current.applyMove(move);
        engineRef.current = SantoriniEngine.fromSnapshot(result.snapshot);
        wasmStateVersionRef.current += 1;
        wasmStateVersionRef.current += 1;
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
      
      // Edit mode (requires Python for board manipulation)
      if (editMode === 1 || editMode === 2) {
        const client = workerClientRef.current ?? (await ensureWorkerClient());
        if (!client) return;
        processingMoveRef.current = true;
        try {
          const snapshot = await client.editCell(y, x, editMode);
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
      if (!placement && practiceMode !== 'Human') {
        const currentPlayer = engine.player;
        let isHumanTurn = true;
        if (practiceMode === 'P0') {
          isHumanTurn = currentPlayer === 0;
        } else if (practiceMode === 'P1') {
          isHumanTurn = currentPlayer === 1;
        } else if (practiceMode === 'AI') {
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
      editMode,
      ensureWorkerClient,
      finalizeGuidedSetup,
      practiceMode,
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
    
    await startGuidedSetup();
  }, [ensureAiIdle, startGuidedSetup]);

  const setGameMode = useCallback(
    async (mode: PracticeGameMode) => {
      setPracticeMode(mode);
      persistPracticeMode(mode);
      await ensureAiIdle();
      moveSelectorRef.current.reset();
      await aiPlayIfNeeded();
      await syncUi();
    },
    [aiPlayIfNeeded, ensureAiIdle, persistPracticeMode, syncUi],
  );

  const changeDifficulty = useCallback(
    (sims: number) => {
      const sanitized = Number.isFinite(sims) && sims > 0 ? sims : DEFAULT_PRACTICE_DIFFICULTY;
      setPracticeDifficulty(sanitized);
      persistPracticeDifficulty(sanitized);
      (async () => {
        const client = workerClientRef.current ?? (await ensureWorkerClient());
        if (client) {
          await client.changeDifficulty(sanitized);
        }
      })().catch((error) => {
        console.error('Failed to update worker difficulty:', error);
      });
    },
    [ensureWorkerClient, persistPracticeDifficulty],
  );

  const toggleEdit = useCallback(() => {
    setEditModeState((prev) => {
      const next = (prev + 1) % 3;
      updateButtonsState((current) => ({ ...current, editMode: next }));
      return next;
    });
    updateSelectable();
    updateButtons(false);
  }, [updateButtons, updateButtonsState, updateSelectable]);

  const changeEditMode = useCallback(
    (mode: number) => {
      setEditModeState(mode);
      updateButtonsState((current) => ({ ...current, editMode: mode }));
      updateSelectable();
      updateButtons(false);
    },
    [updateButtons, updateButtonsState, updateSelectable],
  );

  const jumpToMove = useCallback(
    async (index: number) => {
      const client = workerClientRef.current ?? (await ensureWorkerClient());
      if (!client) return;
      const historyLength = await client.getHistoryLength();
      const reverseIndex = historyLength - 1 - index;
      const jumpResult = await client.jumpToMoveIndex(reverseIndex);
      if (jumpResult?.snapshot) {
        engineRef.current = SantoriniEngine.fromSnapshot(jumpResult.snapshot as SantoriniSnapshot);
      }
      moveSelectorRef.current.reset();
      await syncUi();
      refreshEvaluation().catch((error) => {
        console.error('Failed to refresh evaluation after jumping to move:', error);
      });
    },
    [ensureWorkerClient, refreshEvaluation, syncUi],
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
      evaluatePosition({ evaluationDepth: depth }).catch((error) => {
        console.error('Failed to refresh evaluation with updated depth:', error);
      });
    },
    [evaluatePosition],
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
      setEditMode: changeEditMode,
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
      changeEditMode,
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
    evaluationStatus,
    topMoves,
    controls,
    history,
    undo,
    redo,
    evaluationDepth: evaluationDepthOverride,
    optionsDepth: optionsDepthOverride,
    calcOptionsBusy,
    nextPlayer,
    gameEnded: engineRef.current?.getGameEnded() ?? [0, 0],
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
  enginePreference?: EnginePreference;
  persistState?: boolean;
  storageNamespace?: string;
}

export function SantoriniProvider({ children, evaluationEnabled, enginePreference, persistState, storageNamespace }: SantoriniProviderProps) {
  const store = useSantoriniInternal({ evaluationEnabled, enginePreference, persistState, storageNamespace });
  return <SantoriniContext.Provider value={store}>{children}</SantoriniContext.Provider>;
}

export function useSantorini(options: UseSantoriniOptions = {}) {
  const context = useContext(SantoriniContext);
  if (context) {
    return context;
  }
  return useSantoriniInternal(options);
}
const useWasmRequestVersion = () => {
  const versionRef = useRef(0);
  const bump = useCallback(() => {
    versionRef.current += 1;
    return versionRef.current;
  }, []);
  const get = useCallback(() => versionRef.current, []);
  return { versionRef, bump, get };
};
