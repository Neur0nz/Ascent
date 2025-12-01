import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import {
  Avatar,
  AvatarGroup,
  Badge,
  Box,
  Button,
  ButtonGroup,
  Card,
  CardBody,
  CardHeader,
  Center,
  Divider,
  Flex,
  FormControl,
  FormErrorMessage,
  FormLabel,
  Heading,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  NumberDecrementStepper,
  NumberIncrementStepper,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  Radio,
  RadioGroup,
  SimpleGrid,
  Spinner,
  Stack,
  Text,
  Tooltip as ChakraTooltip,
  Wrap,
  WrapItem,
  useColorModeValue,
  useDisclosure,
  useToast,
} from '@chakra-ui/react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ReferenceLine,
} from 'recharts';
import type { TooltipProps } from 'recharts';
import { ChevronLeftIcon, ChevronRightIcon, ArrowBackIcon, ArrowForwardIcon } from '@chakra-ui/icons';
import { MdShare } from 'react-icons/md';
import GameBoard from '@components/GameBoard';
import EvaluationPanel from '@components/EvaluationPanel';
import MoveHistoryList, { type MoveHistoryItem, MiniBoardPreview } from '@components/MoveHistoryList';
import { supabase } from '@/lib/supabaseClient';
import { fetchMatchWithMoves, MIN_EVAL_MOVE_INDEX } from '@/lib/matchAnalysis';
import { SantoriniEngine, SANTORINI_CONSTANTS, type SantoriniSnapshot } from '@/lib/santoriniEngine';
import { useSantorini } from '@hooks/useSantorini';
import type { MatchMoveRecord, MatchRecord, MatchRole, SantoriniMoveAction, PlayerProfile, SantoriniStateSnapshot } from '@/types/match';
import { getMatchAiDepth, getOppositeRole, getPlayerZeroRole, isAiMatch } from '@/utils/matchAiDepth';
import { findWorkerPosition } from '@/lib/practice/practiceEngine';
import { describeMatch } from '@/utils/matchDescription';
import type { EvaluationSeriesPoint } from '@/types/evaluation';
import type { SupabaseAuthState } from '@hooks/useSupabaseAuth';
import type { LobbyMatch } from '@hooks/useMatchLobby';
import { useEvaluationJobs } from '@hooks/useEvaluationJobs';
import { orientEvaluationToCreator } from '@/utils/evaluationPerspective';
import { getLastAnalyzedMatch, rememberLastAnalyzedMatch } from '@/utils/analysisStorage';
import { showEvaluationStartedToast } from '@/utils/analysisNotifications';
import { formatMoveLabel as formatMoveNotation } from '@/lib/moveNotation';

interface LoadedAnalysis {
  match: MatchRecord;
  moves: MatchMoveRecord<SantoriniMoveAction>[];
}

const EVALUATION_DEPTH_PRESETS = [
  { label: 'Use AI default', value: 'ai', description: 'Follow the engine\'s current practice setting.' },
  { label: 'Easy (50 sims)', value: '50', description: 'Very fast, lower-quality reads.' },
  { label: 'Medium (200 sims)', value: '200', description: 'Balanced speed and accuracy.' },
  { label: 'Native (800 sims)', value: '800', description: 'Matches the default engine depth.' },
  { label: 'Boosted (3200 sims)', value: '3200', description: 'Slow but the strongest single-eval search.' },
];

const NUMERIC_PRESET_VALUES = new Set(
  EVALUATION_DEPTH_PRESETS.filter((preset) => preset.value !== 'ai').map((preset) => preset.value),
);

const toMoveArray = (move: number | number[] | null | undefined): number[] => {
  if (Array.isArray(move)) {
    return move.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0);
  }
  return typeof move === 'number' && Number.isInteger(move) && move >= 0 ? [move] : [];
};

// formatMoveLabel imported from @/lib/moveNotation as formatMoveNotation


const clampValue = (value: number, domain: [number, number]): number =>
  Math.max(domain[0], Math.min(domain[1], value));

const DEFAULT_CUSTOM_DEPTH = 800;

const describeRoleName = (role: MatchRole): string => (role === 'creator' ? 'Creator' : 'Opponent');

interface RecentGameCardProps {
  game: LobbyMatch;
  profile: PlayerProfile | null;
  isActive: boolean;
  isLoading: boolean;
  onLoad: (id: string) => void;
}

function RecentGameCard({ game, profile, isActive, isLoading, onLoad }: RecentGameCardProps) {
  const borderColor = useColorModeValue('gray.200', 'whiteAlpha.200');
  const hoverBorder = useColorModeValue('teal.400', 'teal.300');
  const activeBg = useColorModeValue('teal.50', 'whiteAlpha.200');
  const muted = useColorModeValue('gray.600', 'whiteAlpha.700');
  const clockLabel =
    game.clock_initial_seconds > 0
      ? `${Math.round(game.clock_initial_seconds / 60)}+${game.clock_increment_seconds}`
      : 'No clock';
  const visibilityLabel = game.visibility === 'public' ? 'Public' : 'Private';
  const createdAt = new Date(game.updated_at ?? game.created_at);
  const createdLabel = Number.isNaN(createdAt.valueOf())
    ? ''
    : createdAt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const tags = [
    { label: game.rated ? 'Rated' : 'Casual', colorScheme: game.rated ? 'purple' : 'gray' },
    { label: clockLabel, colorScheme: game.clock_initial_seconds > 0 ? 'green' : 'gray' },
    { label: visibilityLabel, colorScheme: game.visibility === 'public' ? 'green' : 'orange' },
  ];
  if (isAiMatch(game)) {
    const depth = getMatchAiDepth(game);
    tags.push({ label: depth ? `AI depth ${depth}` : 'AI match', colorScheme: 'pink' });
  }

  let resultTag: { label: string; colorScheme: string } | null = null;
  if (game.status === 'completed') {
    if (!game.winner_id) {
      resultTag = { label: 'Draw', colorScheme: 'yellow' };
    } else if (profile && game.winner_id === profile.id) {
      resultTag = { label: 'You won', colorScheme: 'teal' };
    } else if (profile && (game.creator_id === profile.id || game.opponent_id === profile.id)) {
      resultTag = { label: 'You lost', colorScheme: 'red' };
    } else {
      const winnerName =
        game.winner_id === game.creator_id
          ? game.creator?.display_name ?? 'Creator'
          : game.opponent?.display_name ?? 'Opponent';
      resultTag = { label: `${winnerName} won`, colorScheme: 'blue' };
    }
  }

  const handleLoad = () => onLoad(game.id);

  return (
    <Box
      borderWidth="1px"
      borderColor={isActive ? hoverBorder : borderColor}
      borderRadius="lg"
      p={4}
      bg={isActive ? activeBg : 'transparent'}
      cursor={isLoading ? 'default' : 'pointer'}
      transition="all 0.2s ease"
      opacity={isLoading ? 0.85 : 1}
      onClick={isLoading ? undefined : handleLoad}
      _hover={
        isLoading
          ? undefined
          : {
              borderColor: hoverBorder,
              transform: 'translateY(-2px)',
              boxShadow: 'lg',
            }
      }
    >
      <Stack spacing={3}>
        <HStack justify="space-between" align="flex-start" spacing={3}>
          <Stack spacing={1} flex="1" minW={0}>
            <Text fontSize="sm" fontWeight="semibold">
              {describeMatch(game, profile)}
            </Text>
            {createdLabel && (
              <Text fontSize="xs" color={muted}>
                {createdLabel}
              </Text>
            )}
          </Stack>
          <AvatarGroup size="sm" max={2} spacing={-2}>
            <Avatar name={game.creator?.display_name ?? 'Creator'} src={game.creator?.avatar_url ?? undefined} />
            <Avatar name={game.opponent?.display_name ?? 'Opponent'} src={game.opponent?.avatar_url ?? undefined} />
          </AvatarGroup>
        </HStack>
        <Wrap spacing={2}>
          {tags.map((tag, index) => (
            <WrapItem key={`${game.id}-tag-${index}`}>
              <Badge colorScheme={tag.colorScheme} borderRadius="full" px={2.5} py={0.5} fontSize="xs">
                {tag.label}
              </Badge>
            </WrapItem>
          ))}
          {resultTag && (
            <WrapItem>
              <Badge colorScheme={resultTag.colorScheme} borderRadius="full" px={2.5} py={0.5} fontSize="xs">
                {resultTag.label}
              </Badge>
            </WrapItem>
          )}
        </Wrap>
        <Flex justify="flex-end">
          <Button
            size="sm"
            colorScheme="teal"
            variant={isActive ? 'solid' : 'outline'}
            onClick={(event) => {
              event.stopPropagation();
              handleLoad();
            }}
            isLoading={isLoading}
          >
            {isActive ? 'Analyzing' : 'Analyze game'}
          </Button>
        </Flex>
      </Stack>
    </Box>
  );
}

interface AnalyzeWorkspaceProps {
  auth: SupabaseAuthState;
  pendingJobId?: string | null;
  onPendingJobConsumed?: () => void;
}

function AnalyzeWorkspace({ auth, pendingJobId = null, onPendingJobConsumed }: AnalyzeWorkspaceProps) {
  const toast = useToast();
  const santorini = useSantorini(); // AI engine for evaluation
  const initializeSantorini = santorini.initialize;
  const setSantoriniGameMode = santorini.controls.setGameMode;
  const { jobs, startJob } = useEvaluationJobs();
  const [matchId, setMatchId] = useState(() => getLastAnalyzedMatch());
  const [loaded, setLoaded] = useState<LoadedAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [myCompletedGames, setMyCompletedGames] = useState<LobbyMatch[]>([]);
  const [loadingMyGames, setLoadingMyGames] = useState(false);
  const [aiInitialized, setAiInitialized] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [isExploring, setIsExploring] = useState(false);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const evaluationDepthModal = useDisclosure();
  const [depthSelection, setDepthSelection] = useState<string>('ai');
  const [customDepth, setCustomDepth] = useState<string>(String(DEFAULT_CUSTOM_DEPTH));
  const [depthError, setDepthError] = useState<string | null>(null);
  const [confirmingEvalDepth, setConfirmingEvalDepth] = useState(false);
  const [sharingGraph, setSharingGraph] = useState(false);
  const evaluationGraphCardRef = useRef<HTMLDivElement>(null);
  const activeEvaluationJob = useMemo(() => {
    if (!loaded) {
      return null;
    }
    const candidates = Object.values(jobs).filter((job) => job.matchId === loaded.match.id);
    if (candidates.length === 0) {
      return null;
    }
    return candidates.reduce((latest, job) => (job.updatedAt > latest.updatedAt ? job : latest));
  }, [jobs, loaded?.match.id]);
  const evaluationSeries = activeEvaluationJob?.points ?? null;
  const evaluationLoading =
    activeEvaluationJob?.status === 'running' || activeEvaluationJob?.status === 'queued';
  const evaluationDepthUsed = activeEvaluationJob?.depth ?? null;
  const jobDerivedError =
    activeEvaluationJob && activeEvaluationJob.status === 'error'
      ? activeEvaluationJob.error ?? 'Evaluation failed'
      : null;
  const combinedEvaluationError = jobDerivedError ?? evaluationError;
  const evaluationProgressText =
    activeEvaluationJob && activeEvaluationJob.totalPositions > 0
      ? `${activeEvaluationJob.evaluatedCount}/${activeEvaluationJob.totalPositions} positions evaluated`
      : null;
  const playerZeroRole = useMemo(
    () => getPlayerZeroRole(loaded?.match ?? null),
    [loaded],
  );
  const oppositeStartRole = getOppositeRole(playerZeroRole);
  const greenDescriptor = `Green (starting player – ${describeRoleName(playerZeroRole)})`;
  const redDescriptor = `Red (other player – ${describeRoleName(oppositeStartRole)})`;

  const evaluationForAnalysis = useMemo(() => {
    const orientedValue = orientEvaluationToCreator(santorini.evaluation.value, playerZeroRole);
    const hasOrientedValue = Number.isFinite(orientedValue);
    const numericValue = hasOrientedValue && orientedValue != null ? Number(orientedValue) : 0;
    const label = hasOrientedValue
      ? numericValue >= 0
        ? `+${numericValue.toFixed(3)}`
        : numericValue.toFixed(3)
      : santorini.evaluation.label;

    const baseAdvantage = santorini.evaluation.advantage;
    const advantage =
      baseAdvantage === 'Placement phase' || baseAdvantage === 'Error'
        ? baseAdvantage
        : numericValue > 0
          ? 'Creator ahead'
          : numericValue < 0
            ? 'Opponent ahead'
            : 'Balanced';

    return {
      ...santorini.evaluation,
      value: numericValue,
      label,
      advantage,
    };
  }, [playerZeroRole, santorini.evaluation]);

  const topMovesForAnalysis = useMemo(
    () =>
      santorini.topMoves.map((move) => ({
        ...move,
        eval:
          typeof move.eval === 'number'
            ? orientEvaluationToCreator(move.eval, playerZeroRole) ?? undefined
            : move.eval,
        delta:
          typeof move.delta === 'number'
            ? orientEvaluationToCreator(move.delta, playerZeroRole) ?? undefined
            : move.delta,
      })),
    [playerZeroRole, santorini.topMoves],
  );

  // Initialize AI engine on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await initializeSantorini();
        if (!cancelled) {
          await setSantoriniGameMode('Human');
          setAiInitialized(true);
        }
      } catch (error) {
        console.error('Failed to initialize AI engine for analysis', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initializeSantorini, setSantoriniGameMode]);

  // Fetch user's completed games
  useEffect(() => {
    const fetchMyCompletedGames = async () => {
      if (!supabase || !auth?.profile) {
        setMyCompletedGames([]);
        return;
      }

      setLoadingMyGames(true);
      try {
        const { data, error } = await supabase
          .from('matches')
          .select(`
            *,
            creator:players!matches_creator_id_fkey(*),
            opponent:players!matches_opponent_id_fkey(*)
          `)
          .eq('status', 'completed')
          .or(`creator_id.eq.${auth.profile.id},opponent_id.eq.${auth.profile.id}`)
          .order('updated_at', { ascending: false })
          .limit(20);

        if (error) {
          console.error('Failed to fetch completed games', error);
          return;
        }

        setMyCompletedGames((data ?? []) as unknown as LobbyMatch[]);
      } catch (error) {
        console.error('Failed to fetch completed games', error);
      } finally {
        setLoadingMyGames(false);
      }
    };

    fetchMyCompletedGames();
  }, [auth?.profile]);

  // Replay game to a specific move index
  const replayToSnapshot = useCallback(
    async (index: number, analysis: LoadedAnalysis) => {
      if (!aiInitialized || replaying) return;

      setReplaying(true);
      try {
        let snapshotToImport: SantoriniStateSnapshot | null = null;

        // Try to use stored snapshot first (most efficient)
        if (index < 0) {
          // Initial state - should always be available
          snapshotToImport = analysis.match.initial_state as SantoriniStateSnapshot;
        } else if (index < analysis.moves.length) {
          // Check if this move has a stored snapshot
          snapshotToImport = analysis.moves[index]?.state_snapshot as SantoriniStateSnapshot | null;
        }

        // Fallback: replay moves if snapshot is missing
        if (!snapshotToImport) {
          const initialState = analysis.match.initial_state as SantoriniSnapshot | null;
          if (!initialState) {
            throw new Error('Missing initial match snapshot');
          }
          
          const playbackEngine = SantoriniEngine.fromSnapshot(initialState);
          
          // Only replay if we have moves to replay
          if (index >= 0 && analysis.moves.length > 0) {
            const lastIndex = Math.min(index, analysis.moves.length - 1);
            for (let i = 0; i <= lastIndex; i++) {
              const action = analysis.moves[i]?.action;
              if (action && action.kind === 'santorini.move') {
                const moveSequence = toMoveArray(action.move);
                for (const value of moveSequence) {
                  try {
                    playbackEngine.applyMove(value);
                  } catch (moveError) {
                    console.warn('Skipping invalid move during replay', { index: i, move: value }, moveError);
                    break;
                  }
                }
              }
            }
          }
          
          snapshotToImport = playbackEngine.snapshot as SantoriniStateSnapshot;
        }

        if (!snapshotToImport) {
          throw new Error('Unable to resolve board state for this move');
        }

        await santorini.importState(snapshotToImport, { waitForEvaluation: false });
        setCurrentIndex(index);
        setIsExploring(false);
      } catch (error) {
        console.error('Failed to replay to move', index, error);
        toast({
          title: 'Failed to replay move',
          status: 'error',
          description: error instanceof Error ? error.message : 'Unknown error',
        });
      } finally {
        setReplaying(false);
      }
    },
    [aiInitialized, replaying, santorini, toast],
  );

  const loadMatchById = useCallback(async (id: string) => {
    if (!supabase) {
      toast({
        title: 'Supabase not configured',
        description: 'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable analysis.',
        status: 'warning',
      });
      return;
    }
    const trimmedId = id.trim();
    if (!trimmedId) {
      toast({ title: 'Enter a match ID', status: 'info' });
      return;
    }

    setLoading(true);
    try {
      const loadedData = await fetchMatchWithMoves(supabase, trimmedId);
      setLoaded(loadedData);
      
      // Start at the last move
      await replayToSnapshot(loadedData.moves.length - 1, loadedData);
      
      rememberLastAnalyzedMatch(trimmedId);
      setMatchId(trimmedId);
      
      toast({
        title: 'Match loaded',
        description: `${loadedData.moves.length} moves loaded successfully`,
        status: 'success',
      });
    } catch (error) {
      console.error('Failed to load match', error);
      toast({
        title: 'Failed to load match',
        status: 'error',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  }, [replayToSnapshot, toast]);

  useEffect(() => {
    setEvaluationError(null);
  }, [loaded?.match.id]);

  useEffect(() => {
    if (!pendingJobId) {
      return;
    }
    const targetJob = jobs[pendingJobId];
    if (!targetJob) {
      return;
    }
    if (matchId !== targetJob.matchId) {
      setMatchId(targetJob.matchId);
    }
    loadMatchById(targetJob.matchId);
    onPendingJobConsumed?.();
  }, [jobs, loadMatchById, matchId, onPendingJobConsumed, pendingJobId]);

  const handleCellClick = useCallback(
    (y: number, x: number) => {
      if (replaying) return;
      const result = santorini.onCellClick(y, x);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>)
          .then(() => setIsExploring(true))
          .catch(() => {});
      } else {
        setIsExploring(true);
      }
    },
    [replaying, santorini],
  );

  const restorePosition = useCallback(() => {
    if (loaded) {
      void replayToSnapshot(currentIndex, loaded);
    }
  }, [currentIndex, loaded, replayToSnapshot]);

  const handleOpenEvaluationModal = useCallback(() => {
    if (!loaded) {
      toast({
        title: 'Load a match first',
        description: 'Choose a game to analyze before generating the evaluation graph.',
        status: 'info',
      });
      return;
    }

    const referenceDepth = evaluationDepthUsed ?? santorini.evaluationDepth ?? null;
    if (referenceDepth == null) {
      setDepthSelection('ai');
      setCustomDepth(String(DEFAULT_CUSTOM_DEPTH));
    } else if (NUMERIC_PRESET_VALUES.has(String(referenceDepth))) {
      setDepthSelection(String(referenceDepth));
      setCustomDepth(String(referenceDepth));
    } else {
      setDepthSelection('custom');
      setCustomDepth(String(referenceDepth));
    }
    setDepthError(null);
    evaluationDepthModal.onOpen();
  }, [evaluationDepthModal, evaluationDepthUsed, loaded, santorini.evaluationDepth, toast]);

  const handleConfirmEvaluationDepth = useCallback(async () => {
    if (!loaded) {
      toast({
        title: 'Load a match first',
        description: 'Choose a game to analyze before generating the evaluation graph.',
        status: 'info',
      });
      return;
    }

    let resolvedDepth: number | null;
    if (depthSelection === 'ai') {
      resolvedDepth = null;
    } else if (depthSelection === 'custom') {
      const parsedCustomDepth = Math.round(Number(customDepth));
      resolvedDepth = Number.isFinite(parsedCustomDepth) ? parsedCustomDepth : null;
    } else {
      resolvedDepth = Number(depthSelection);
    }

    if (
      depthSelection === 'custom' &&
      (!Number.isFinite(resolvedDepth) || resolvedDepth == null || resolvedDepth <= 0)
    ) {
      setDepthError('Enter a positive number of simulations.');
      return;
    }

    const lobbyMatch = myCompletedGames.find((game) => game.id === loaded.match.id) ?? null;
    const matchLabel = lobbyMatch
      ? describeMatch(lobbyMatch, auth?.profile ?? null)
      : `Match ${loaded.match.id.slice(0, 8)}`;

    setDepthError(null);
    setConfirmingEvalDepth(true);
    try {
      await startJob({
        match: loaded.match,
        moves: loaded.moves,
        minMoveIndex: MIN_EVAL_MOVE_INDEX,
        depth: resolvedDepth,
        enginePreference: auth.profile?.engine_preference ?? 'rust',
        matchLabel,
      });
      setEvaluationError(null);
      evaluationDepthModal.onClose();
      showEvaluationStartedToast(toast, {
        matchLabel,
        depth: resolvedDepth,
        mode: 'manual',
        toastId: `analysis-start-${loaded.match.id}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start evaluation.';
      setEvaluationError(message);
      toast({
        title: 'Unable to start evaluation',
        description: message,
        status: 'error',
      });
    } finally {
      setConfirmingEvalDepth(false);
    }
  }, [
    MIN_EVAL_MOVE_INDEX,
    auth,
    customDepth,
    depthSelection,
    evaluationDepthModal,
    loaded,
    myCompletedGames,
    startJob,
    toast,
  ]);

  const handleCloseDepthModal = useCallback(() => {
    if (confirmingEvalDepth) {
      return;
    }
    setDepthError(null);
    evaluationDepthModal.onClose();
  }, [confirmingEvalDepth, evaluationDepthModal]);

  const goToMove = useCallback(
    async (index: number) => {
      if (!loaded || replaying) return;
      await replayToSnapshot(index, loaded);
    },
    [loaded, replayToSnapshot, replaying],
  );

  const goToStart = useCallback(() => {
    void goToMove(-1);
  }, [goToMove]);

  const goToEnd = useCallback(() => {
    if (loaded) {
      void goToMove(loaded.moves.length - 1);
    }
  }, [goToMove, loaded]);

  const stepBack = useCallback(() => {
    if (currentIndex > -1) {
      void goToMove(currentIndex - 1);
    }
  }, [currentIndex, goToMove]);

  const stepForward = useCallback(() => {
    if (loaded && currentIndex < loaded.moves.length - 1) {
      void goToMove(currentIndex + 1);
    }
  }, [currentIndex, goToMove, loaded]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!loaded) return;
      
      // Arrow keys for navigation
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepBack();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepForward();
      } else if (e.key === 'Home') {
        e.preventDefault();
        goToStart();
      } else if (e.key === 'End') {
        e.preventDefault();
        goToEnd();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [loaded, stepBack, stepForward, goToStart, goToEnd]);

  const summary = useMemo(() => {
    if (!loaded) return null;
    return {
      rated: loaded.match.rated,
      visibility: loaded.match.visibility,
      status: loaded.match.status,
      clock: loaded.match.clock_initial_seconds > 0
        ? `${Math.round(loaded.match.clock_initial_seconds / 60)}+${loaded.match.clock_increment_seconds}`
        : 'No clock',
    };
  }, [loaded]);

  const gameResult = useMemo(() => {
    const [p0Score, p1Score] = santorini.gameEnded;
    if (p0Score === 0 && p1Score === 0) {
      return null;
    }
    return p0Score === 1 ? 'Creator' : p1Score === 1 ? 'Opponent' : 'Draw';
  }, [santorini.gameEnded]);

  const evaluationChartData = useMemo(() => {
    if (!evaluationSeries) {
      return [];
    }
    const formatRoleLabel = (role: MatchRole) => {
      const descriptor = role === playerZeroRole ? 'starting player' : 'other player';
      const colorLabel = role === playerZeroRole ? 'Green' : 'Red';
      return `${colorLabel} (${descriptor} – ${describeRoleName(role)})`;
    };

    return evaluationSeries.map((point) => ({
      ...point,
      moveLabel: point.moveIndex === -1 ? 'Start' : `${point.moveNumber}`,
      playerLabel:
        point.player === playerZeroRole
          ? formatRoleLabel(playerZeroRole)
          : point.player === oppositeStartRole
            ? formatRoleLabel(oppositeStartRole)
            : 'Initial position',
    }));
  }, [evaluationSeries, playerZeroRole, oppositeStartRole]);

  const evaluationDomain: [number, number] = [-1, 1];

  // Convert loaded moves to MoveHistoryItem format for the new component
  const moveHistoryItems: MoveHistoryItem[] = useMemo(() => {
    if (!loaded) return [];
    
    const { BOARD_SIZE, decodeAction, DIRECTIONS, NO_BUILD } = SANTORINI_CONSTANTS;

    return loaded.moves.map((move, index) => {
      const action = move.action;
      const moveValue = action?.kind === 'santorini.move'
        ? (Array.isArray(action.move) ? action.move[0] : action.move)
        : null;
      
      // Get board from state_snapshot if available (board AFTER this move)
      const stateSnapshot = move.state_snapshot;
      const board = stateSnapshot?.board ?? null;
      
      // Get board state BEFORE this move (needed for coordinate-based labels)
      const prevSnapshot = index > 0
        ? loaded.moves[index - 1]?.state_snapshot
        : loaded.match.initial_state;
      const boardBefore = prevSnapshot?.board ?? null;
      
      // Determine player from action.by (creator=0, opponent=1)
      // This correctly handles placement phase where same player moves twice
      const moveBy = action?.kind === 'santorini.move' ? action.by : null;
      const player = moveBy === 'creator' ? 0 : moveBy === 'opponent' ? 1 : (index % 2);
      
      // Calculate move details
      let from: [number, number] | undefined;
      let to: [number, number] | undefined;
      let build: [number, number] | null = null;
      
      if (typeof moveValue === 'number') {
        // Placement phase is first 4 moves (indices 0-3), game phase starts at index 4
        // Use move_index instead of action value to distinguish - action values 0-24 overlap!
        const isPlacement = move.move_index < 4;
        
        if (isPlacement) {
          to = [Math.floor(moveValue / BOARD_SIZE), moveValue % BOARD_SIZE];
        } else if (boardBefore) {
          // Movement action - decode using the board state before this move
          const [workerIndex, _power, moveDirection, buildDirection] = decodeAction(moveValue);
          const workerId = (workerIndex + 1) * (player === 0 ? 1 : -1);
          const origin = findWorkerPosition(boardBefore, workerId);
          
          if (origin) {
            from = origin;
            const moveDelta = DIRECTIONS[moveDirection];
            to = [origin[0] + moveDelta[0], origin[1] + moveDelta[1]];
            
            if (buildDirection !== NO_BUILD) {
              const buildDelta = DIRECTIONS[buildDirection];
              build = [to[0] + buildDelta[0], to[1] + buildDelta[1]];
            }
          }
        }
      }
      
      const timestamp = new Date(move.created_at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      // Use unified move notation for the label
      const moveLabel = typeof moveValue === 'number'
        ? formatMoveNotation(moveValue, player, boardBefore)
        : 'Move';

      return {
        id: move.id,
        index,
        label: `${index + 1}. ${moveLabel}`,
        player,
        timestamp,
        board,
        from,
        to,
        build,
      };
    });
  }, [loaded, playerZeroRole]);

  // Compute last move info for visual indicator based on current position
  const lastMoveInfo = useMemo(() => {
    if (currentIndex < 0 || moveHistoryItems.length === 0) return null;
    const currentMove = moveHistoryItems[currentIndex];
    if (!currentMove) return null;
    return {
      from: currentMove.from ?? null,
      to: currentMove.to ?? null,
      build: currentMove.build ?? null,
      player: currentMove.player,
    };
  }, [moveHistoryItems, currentIndex]);

  const canStepBack = currentIndex > -1;
  const canStepForward = loaded ? currentIndex < loaded.moves.length - 1 : false;
  const cardBg = useColorModeValue('white', 'whiteAlpha.100');
  const cardBorder = useColorModeValue('gray.200', 'whiteAlpha.200');
  const mutedText = useColorModeValue('gray.600', 'whiteAlpha.700');
  const helperText = useColorModeValue('gray.600', 'whiteAlpha.700');
  const highlightBorder = useColorModeValue('teal.500', 'teal.300');
  const highlightBg = useColorModeValue('teal.50', 'teal.900');
  const badgeBorder = useColorModeValue('gray.200', 'whiteAlpha.200');
  const evaluationLineColor = useColorModeValue('#2F855A', '#68D391'); // Chakra green.600 / green.300
  const evaluationDotStroke = useColorModeValue('#22543D', '#C6F6D5');
  const chartGridColor = useColorModeValue('rgba(64, 64, 64, 0.12)', 'rgba(255, 255, 255, 0.15)');
  const chartAxisColor = useColorModeValue('#1A202C', 'rgba(255,255,255,0.92)');
  const chartReferenceColor = useColorModeValue('rgba(49, 130, 206, 0.8)', 'rgba(144, 205, 244, 0.9)');
  const tooltipBg = useColorModeValue('#FFFFFF', '#1F2933');
  const graphBackground = useColorModeValue('#f8fafc', '#020617');
  const shareGraphEnabled = !evaluationLoading && evaluationChartData.length > 0;

  const renderEvaluationTooltip = useCallback(
    ({ active, payload }: TooltipProps<number, string>) => {
      if (!active || !payload || payload.length === 0) {
        return null;
      }
      const point = payload[0]?.payload as
        | (EvaluationSeriesPoint & { moveLabel: string; playerLabel: string })
        | undefined;
      if (!point) {
        return null;
      }

      const timestamp =
        point.timestamp && typeof point.timestamp === 'string'
          ? new Date(point.timestamp)
          : null;
      const timestampLabel =
        timestamp && !Number.isNaN(timestamp.valueOf())
          ? timestamp.toLocaleString()
          : null;

      // Get board state for this move from moveHistoryItems
      const moveItem = point.moveIndex >= 0 ? moveHistoryItems[point.moveIndex] : null;
      const boardState = moveItem?.board ?? null;

      return (
        <Box
          bg={tooltipBg}
          borderRadius="lg"
          px={3.5}
          py={3}
          borderWidth="1px"
          borderColor={cardBorder}
          boxShadow="xl"
          color={chartAxisColor}
          maxW="220px"
        >
          <Stack spacing={2}>
            <Box>
              <Text fontWeight="semibold" fontSize="sm">
                {point.moveIndex === -1 ? 'Initial position' : `Move ${point.moveNumber}`}
              </Text>
              <Text fontSize="sm" color={evaluationLineColor} fontWeight="semibold">
                {point.label}
              </Text>
              <Text fontSize="xs" color={mutedText}>
                {point.playerLabel}
              </Text>
              {timestampLabel && (
                <Text fontSize="xs" color={mutedText}>
                  {timestampLabel}
                </Text>
              )}
            </Box>
            {boardState && (
              <MiniBoardPreview
                board={boardState}
                from={moveItem?.from}
                to={moveItem?.to}
                build={moveItem?.build}
              />
            )}
          </Stack>
        </Box>
      );
    },
    [cardBorder, chartAxisColor, evaluationLineColor, moveHistoryItems, mutedText, tooltipBg],
  );

  const handleShareEvaluationGraph = useCallback(async () => {
    if (!shareGraphEnabled || !evaluationGraphCardRef.current) {
      return;
    }
    setSharingGraph(true);
    try {
      const dataUrl = await toPng(evaluationGraphCardRef.current, {
        cacheBust: true,
        backgroundColor: graphBackground,
      });
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const fileName = `santorini-evaluation-${Date.now()}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });
      const shareTarget =
        typeof navigator !== 'undefined'
          ? (navigator as Navigator & { canShare?: (data: unknown) => boolean })
          : null;
      if (shareTarget?.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Santorini evaluation graph',
          text: 'Santorini evaluation graph',
        });
      } else if (typeof document !== 'undefined') {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 2000);
        toast({
          status: 'success',
          title: 'Evaluation graph exported',
          description: 'Saved as a PNG for sharing.',
          duration: 3000,
          isClosable: true,
        });
      }
    } catch (error) {
      console.error('Failed to share evaluation graph', error);
      toast({
        status: 'error',
        title: 'Unable to share evaluation graph',
        description: 'Please try again.',
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setSharingGraph(false);
    }
  }, [graphBackground, shareGraphEnabled, toast]);

  const handleChartClick = useCallback(
    (state: { activePayload?: Array<{ payload?: { moveIndex?: number } }> } | undefined) => {
      if (!state || !state.activePayload || state.activePayload.length === 0) {
        return;
      }
      const point = state.activePayload[0]?.payload;
      if (!point || typeof point.moveIndex !== 'number' || replaying) {
        return;
      }
      void goToMove(point.moveIndex);
    },
    [goToMove, replaying],
  );

  const analyzeButtons = useMemo(() => {
    const totalMoves = loaded?.moves.length ?? 0;
    const status = replaying
      ? 'Loading position...'
      : isExploring
        ? currentIndex >= 0
          ? `Exploring from move ${currentIndex + 1}`
          : 'Exploring from initial position'
        : currentIndex === -1
          ? 'Initial position'
          : `Move ${currentIndex + 1} of ${totalMoves}`;

    return {
      ...santorini.buttons,
      loading: santorini.buttons.loading,
      status,
      setupMode: false,
      editMode: 0,
    };
  }, [currentIndex, isExploring, loaded?.moves.length, replaying, santorini.buttons]);

  return (
    <>
      <Stack spacing={6} py={{ base: 6, md: 10 }}>
      <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder}>
        <CardHeader>
          <Flex align="center" justify="space-between" gap={3} flexWrap="wrap">
            <Heading size="md">Run analysis on a completed match</Heading>
            <Button
              size="sm"
              colorScheme="teal"
              onClick={handleOpenEvaluationModal}
              isLoading={evaluationLoading}
              isDisabled={!loaded || loading}
            >
              {evaluationSeries ? 'Recalculate eval graph' : 'Generate eval graph'}
            </Button>
          </Flex>
        </CardHeader>
        <CardBody as={Stack} spacing={4}>
          {combinedEvaluationError && (
            <Text color="red.400" fontSize="sm">
              {combinedEvaluationError}
            </Text>
          )}
          {evaluationLoading && evaluationProgressText && (
            <Text color={mutedText} fontSize="sm">
              {evaluationProgressText}
            </Text>
          )}
          {/* Your Completed Games */}
          {auth?.profile && (
            <>
              <Box>
                <Heading size="sm" mb={3}>Your recent games</Heading>
                {loadingMyGames ? (
                  <Center py={4}>
                    <Spinner size="sm" />
                  </Center>
                ) : myCompletedGames.length === 0 ? (
                  <Text color={mutedText} fontSize="sm">
                    No completed games yet. Finish a game to see it here.
                  </Text>
                ) : (
                  <Box maxH="360px" overflowY="auto" pr={1}>
                    <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3} minChildWidth="260px">
                      {myCompletedGames.map((game) => (
                        <RecentGameCard
                          key={game.id}
                          game={game}
                          profile={auth?.profile ?? null}
                          isActive={loaded?.match.id === game.id}
                          isLoading={loading && matchId === game.id}
                          onLoad={loadMatchById}
                        />
                      ))}
                    </SimpleGrid>
                  </Box>
                )}
              </Box>

              <Divider />
            </>
          )}

          {loaded && summary && (
            <HStack spacing={3} flexWrap="wrap">
              <Badge colorScheme={summary.rated ? 'purple' : 'gray'}>
                {summary.rated ? 'Rated' : 'Casual'}
              </Badge>
              <Badge colorScheme="green">
                {summary.visibility === 'public' ? 'Public' : 'Private'}
              </Badge>
              <Badge colorScheme={summary.status === 'completed' ? 'green' : 'gray'}>
                {summary.status}
              </Badge>
              <Badge borderWidth="1px" borderColor={badgeBorder}>
                {summary.clock}
              </Badge>
              {gameResult && (
                <Badge colorScheme="yellow">
                  Winner: {gameResult}
                </Badge>
              )}
              <Badge>
                {loaded.moves.length} moves
              </Badge>
            </HStack>
          )}
        </CardBody>
      </Card>

      {!loaded ? (
        <Center py={12}>
          {loading ? (
            <Stack spacing={3} align="center">
              <Spinner size="lg" color="teal.500" />
              <Text color={mutedText}>Loading match...</Text>
            </Stack>
          ) : (
            <Text color={mutedText}>Load a match to begin analysis.</Text>
          )}
        </Center>
      ) : (
        <Stack spacing={6}>
          {/* Navigation Controls */}
          <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder}>
            <CardBody>
              <Stack spacing={4}>
                <Flex justify="space-between" align="center" gap={4} flexWrap="wrap">
                  <Text fontSize="sm" color={mutedText}>
                    {isExploring
                      ? currentIndex >= 0
                        ? `Exploring from move ${currentIndex + 1}`
                        : 'Exploring from initial position'
                      : `Move ${currentIndex + 1} of ${loaded.moves.length}`}
                  </Text>
                  <ButtonGroup size="sm" isAttached variant="outline">
                    <ChakraTooltip label="Go to start (Home)" hasArrow>
                      <IconButton
                        aria-label="Go to start"
                        icon={<ArrowBackIcon />}
                        onClick={goToStart}
                        isDisabled={!canStepBack || replaying}
                      />
                    </ChakraTooltip>
                    <ChakraTooltip label="Previous move (←)" hasArrow>
                      <IconButton
                        aria-label="Previous move"
                        icon={<ChevronLeftIcon />}
                        onClick={stepBack}
                        isDisabled={!canStepBack || replaying}
                      />
                    </ChakraTooltip>
                    <ChakraTooltip label="Next move (→)" hasArrow>
                      <IconButton
                        aria-label="Next move"
                        icon={<ChevronRightIcon />}
                        onClick={stepForward}
                        isDisabled={!canStepForward || replaying}
                      />
                    </ChakraTooltip>
                    <ChakraTooltip label="Go to end (End)" hasArrow>
                      <IconButton
                        aria-label="Go to end"
                        icon={<ArrowForwardIcon />}
                        onClick={goToEnd}
                        isDisabled={!canStepForward || replaying}
                      />
                    </ChakraTooltip>
                  </ButtonGroup>
                </Flex>
              </Stack>
            </CardBody>
          </Card>

          {/* Board and Move List */}
          <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder}>
            <CardBody>
              <Flex direction={{ base: 'column', xl: 'row' }} gap={6} align="stretch">
                {/* Game Board */}
                <Box flex="1" display="flex" justifyContent="center" pointerEvents={replaying ? 'none' : 'auto'}>
                  <Stack spacing={4} w="100%" align="center">
                    {isExploring && (
                      <Badge colorScheme="purple" alignSelf="flex-start">
                        Exploring custom variation
                      </Badge>
                    )}
                    <GameBoard
                      board={santorini.board}
                      selectable={santorini.selectable}
                      cancelSelectable={santorini.cancelSelectable}
                      onCellClick={handleCellClick}
                      onCellHover={santorini.onCellHover}
                      onCellLeave={santorini.onCellLeave}
                      buttons={analyzeButtons}
                      undo={santorini.undo}
                      redo={santorini.redo}
                      showPrimaryControls={false}
                      undoDisabledOverride={replaying}
                      lastMove={lastMoveInfo}
                    />
                    {isExploring && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={restorePosition}
                        isDisabled={replaying}
                      >
                        Restore to selected move
                      </Button>
                    )}
                  </Stack>
                </Box>

                {/* Move List and Evaluation */}
                <Box flex={{ base: '1', xl: '0 0 360px' }}>
                  <Stack spacing={4}>
                    {/* AI Evaluation Panel */}
                    <EvaluationPanel
                      loading={santorini.loading}
                      evaluation={evaluationForAnalysis}
                      evaluationStatus={santorini.evaluationStatus}
                      topMoves={topMovesForAnalysis}
                      calcOptionsBusy={santorini.calcOptionsBusy}
                      evaluationDepth={santorini.evaluationDepth}
                      optionsDepth={santorini.optionsDepth}
                      refreshEvaluation={santorini.controls.refreshEvaluation}
                      calculateOptions={santorini.controls.calculateOptions}
                      updateEvaluationDepth={santorini.controls.updateEvaluationDepth}
                      updateOptionsDepth={santorini.controls.updateOptionsDepth}
                    />

                    <Box>
                      <Heading size="sm" mb={3}>
                        Move history
                      </Heading>
                      <MoveHistoryList
                        items={moveHistoryItems}
                        currentIndex={currentIndex}
                        onSelectMove={(index) => void goToMove(index)}
                        disabled={replaying}
                        maxHeight="400px"
                        showPlayerTags={true}
                        showPreviewOnHover={true}
                        includeInitialPosition={true}
                        onSelectInitialPosition={goToStart}
                      />
                    </Box>
                  </Stack>
                </Box>
              </Flex>
            </CardBody>
          </Card>

          {(evaluationLoading || (evaluationSeries && evaluationSeries.length > 0)) && (
          <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder} ref={evaluationGraphCardRef}>
            <CardHeader>
              <Flex align="center" justify="space-between" gap={3}>
                <Heading size="sm">Evaluation graph</Heading>
                {shareGraphEnabled ? (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label="Share evaluation graph"
                    icon={<MdShare />}
                    onClick={handleShareEvaluationGraph}
                    isLoading={sharingGraph}
                    isDisabled={sharingGraph}
                    title="Export and share evaluation graph"
                  />
                ) : null}
              </Flex>
            </CardHeader>
              <CardBody>
                {evaluationLoading && (!evaluationSeries || evaluationSeries.length === 0) ? (
                  <Center py={8}>
                    <Stack spacing={3} align="center">
                      <Spinner size="lg" color="teal.400" />
                      <Text color={mutedText} fontSize="sm">
                        Computing evaluation for each move...
                      </Text>
                    </Stack>
                  </Center>
                ) : (
                  <Stack spacing={4}>
                    <Box w="100%" h={{ base: '260px', md: '320px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={evaluationChartData}
                          margin={{ top: 10, right: 16, bottom: 0, left: -10 }}
                          onClick={handleChartClick}
                        >
                          <CartesianGrid stroke={chartGridColor} strokeDasharray="4 4" />
                          <XAxis
                            dataKey="moveNumber"
                            stroke={chartAxisColor}
                            tickFormatter={(value) => (value === 0 ? 'Start' : String(value))}
                            tick={{ fill: chartAxisColor, fontSize: 12 }}
                            tickLine={{ stroke: chartAxisColor, strokeWidth: 1 }}
                            axisLine={{ stroke: chartAxisColor, strokeWidth: 1 }}
                            tickMargin={8}
                            minTickGap={12}
                          />
                          <YAxis
                            domain={evaluationDomain}
                            stroke={chartAxisColor}
                            tickFormatter={(value) => value.toFixed(2)}
                            width={48}
                            tick={{ fill: chartAxisColor, fontSize: 12 }}
                            tickLine={{ stroke: chartAxisColor, strokeWidth: 1 }}
                            axisLine={{ stroke: chartAxisColor, strokeWidth: 1 }}
                          />
                          <ReferenceLine y={0} stroke={chartReferenceColor} strokeWidth={1.5} strokeDasharray="6 6" />
                          <RechartsTooltip
                            content={renderEvaluationTooltip}
                            wrapperStyle={{ outline: 'none' }}
                          />
                          <Line
                            type="monotone"
                            dataKey="evaluation"
                            stroke={evaluationLineColor}
                            strokeWidth={2.5}
                            dot={{ r: 5, stroke: evaluationDotStroke, strokeWidth: 1.5, fill: evaluationLineColor }}
                            activeDot={{ r: 7, strokeWidth: 0, fill: evaluationLineColor }}
                            connectNulls
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </Box>
                    <Text fontSize="xs" color={mutedText}>
                      Evaluation depth: {evaluationDepthUsed ?? 'AI default'}
                    </Text>
                    <Text fontSize="xs" color={mutedText}>
                      Positive values indicate an advantage for {greenDescriptor}. Negative values favour {redDescriptor}.
                    </Text>
                  </Stack>
                )}
              </CardBody>
            </Card>
          )}

          {/* Keyboard shortcuts hint */}
          <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder}>
            <CardBody py={3}>
              <HStack spacing={6} fontSize="sm" color={mutedText} flexWrap="wrap">
                <HStack spacing={2}>
                  <Badge>←</Badge>
                  <Text>Previous</Text>
                </HStack>
                <HStack spacing={2}>
                  <Badge>→</Badge>
                  <Text>Next</Text>
                </HStack>
                <HStack spacing={2}>
                  <Badge>Home</Badge>
                  <Text>Start</Text>
                </HStack>
                <HStack spacing={2}>
                  <Badge>End</Badge>
                  <Text>End</Text>
                </HStack>
              </HStack>
            </CardBody>
          </Card>
        </Stack>
      )}
    </Stack>
    <Modal
      isOpen={evaluationDepthModal.isOpen}
      onClose={handleCloseDepthModal}
      isCentered
      size="lg"
      closeOnOverlayClick={!confirmingEvalDepth}
      closeOnEsc={!confirmingEvalDepth}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Configure evaluation depth</ModalHeader>
        <ModalCloseButton isDisabled={confirmingEvalDepth} />
        <ModalBody>
          <Stack spacing={5}>
            <Text fontSize="sm" color={mutedText}>
              Choose how deep the AI should search while generating the evaluation graph. Higher values are slower but
              more accurate.
            </Text>
            <FormControl isInvalid={Boolean(depthError)}>
              <FormLabel>Search depth (simulations)</FormLabel>
              <RadioGroup
                value={depthSelection}
                onChange={(value) => {
                  setDepthSelection(value);
                  setDepthError(null);
                }}
              >
                <Stack spacing={3}>
                  {EVALUATION_DEPTH_PRESETS.map((preset) => {
                    const isSelected = depthSelection === preset.value;
                    return (
                      <Box
                        key={preset.value}
                        borderWidth="1px"
                        borderRadius="md"
                        borderColor={isSelected ? highlightBorder : cardBorder}
                        bg={isSelected ? highlightBg : 'transparent'}
                        px={3}
                        py={2}
                      >
                        <HStack align="flex-start" spacing={3}>
                          <Radio value={preset.value}>{preset.label}</Radio>
                          <Text fontSize="sm" color={mutedText}>
                            {preset.description}
                          </Text>
                        </HStack>
                      </Box>
                    );
                  })}
                  <Box
                    borderWidth="1px"
                    borderRadius="md"
                    borderColor={depthSelection === 'custom' ? highlightBorder : cardBorder}
                    bg={depthSelection === 'custom' ? highlightBg : 'transparent'}
                    px={3}
                    py={2}
                  >
                    <Stack spacing={3}>
                      <HStack spacing={3} align="center" flexWrap="wrap">
                        <Radio value="custom">Custom</Radio>
                        {depthSelection === 'custom' && (
                          <NumberInput
                            size="sm"
                            min={1}
                            max={50000}
                            step={50}
                            w="140px"
                            value={customDepth}
                            onChange={(valueString) => setCustomDepth(valueString)}
                            clampValueOnBlur
                          >
                            <NumberInputField />
                            <NumberInputStepper>
                              <NumberIncrementStepper />
                              <NumberDecrementStepper />
                            </NumberInputStepper>
                          </NumberInput>
                        )}
                      </HStack>
                      <Text fontSize="sm" color={mutedText}>
                        Provide any positive number of simulations to match your preferred strength.
                      </Text>
                    </Stack>
                  </Box>
                </Stack>
              </RadioGroup>
              {depthError && <FormErrorMessage>{depthError}</FormErrorMessage>}
            </FormControl>
          </Stack>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" mr={3} onClick={handleCloseDepthModal} isDisabled={confirmingEvalDepth}>
            Cancel
          </Button>
          <Button colorScheme="teal" onClick={handleConfirmEvaluationDepth} isLoading={confirmingEvalDepth}>
            Set depth & generate
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
    </>
  );
}

export default AnalyzeWorkspace;
