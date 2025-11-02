import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  ButtonGroup,
  Card,
  CardBody,
  CardHeader,
  Center,
  Flex,
  Heading,
  HStack,
  IconButton,
  Input,
  Spinner,
  Stack,
  Text,
  Tooltip as ChakraTooltip,
  useColorModeValue,
  useToast,
  Divider,
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
import GameBoard from '@components/GameBoard';
import EvaluationPanel from '@components/EvaluationPanel';
import { supabase } from '@/lib/supabaseClient';
import { SantoriniEngine, type SantoriniSnapshot } from '@/lib/santoriniEngine';
import { useSantorini } from '@hooks/useSantorini';
import type { MatchMoveRecord, MatchRecord, SantoriniMoveAction, PlayerProfile, SantoriniStateSnapshot } from '@/types/match';
import type { SupabaseAuthState } from '@hooks/useSupabaseAuth';
import type { LobbyMatch } from '@hooks/useMatchLobby';

interface LoadedAnalysis {
  match: MatchRecord;
  moves: MatchMoveRecord<SantoriniMoveAction>[];
}

interface EvaluationSeriesPoint {
  moveIndex: number;
  moveNumber: number;
  evaluation: number;
  label: string;
  player: 'creator' | 'opponent' | null;
  timestamp?: string | null;
}

function describeMatch(match: LobbyMatch, profile: PlayerProfile | null) {
  const isCreator = profile ? match.creator_id === profile.id : false;
  if (isCreator) {
    const opponentName = match.opponent?.display_name ?? 'Unknown opponent';
    return `You vs ${opponentName}`;
  }
  if (profile && match.opponent_id === profile.id) {
    const creatorName = match.creator?.display_name ?? 'Unknown opponent';
    return `${creatorName} vs You`;
  }
  const creatorName = match.creator?.display_name ?? 'Player 1';
  const opponentName = match.opponent?.display_name ?? 'Player 2';
  return `${creatorName} vs ${opponentName}`;
}

interface AnalyzeWorkspaceProps {
  auth: SupabaseAuthState;
}

function AnalyzeWorkspace({ auth }: AnalyzeWorkspaceProps) {
  const toast = useToast();
  const santorini = useSantorini(); // AI engine for evaluation
  const initializeSantorini = santorini.initialize;
  const setSantoriniGameMode = santorini.controls.setGameMode;
  const [matchId, setMatchId] = useState(() => localStorage.getItem('santorini:lastAnalyzedMatch') ?? '');
  const [loaded, setLoaded] = useState<LoadedAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [myCompletedGames, setMyCompletedGames] = useState<LobbyMatch[]>([]);
  const [loadingMyGames, setLoadingMyGames] = useState(false);
  const [aiInitialized, setAiInitialized] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [isExploring, setIsExploring] = useState(false);
  const [evaluationSeries, setEvaluationSeries] = useState<EvaluationSeriesPoint[] | null>(null);
  const [evaluationLoading, setEvaluationLoading] = useState(false);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [evaluationDepthUsed, setEvaluationDepthUsed] = useState<number | null>(null);
  const MIN_EVAL_MOVE_INDEX = 3;

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
        const initialState = analysis.match.initial_state as SantoriniSnapshot;
        const playbackEngine = SantoriniEngine.fromSnapshot(initialState);

        if (index >= 0) {
          for (let i = 0; i <= index; i++) {
            const action = analysis.moves[i]?.action;
            if (action && action.kind === 'santorini.move' && typeof action.move === 'number') {
              try {
                playbackEngine.applyMove(action.move);
              } catch (moveError) {
                console.warn('Skipping invalid move during replay', { index: i, move: action.move }, moveError);
                break;
              }
            }
          }
        }

        await santorini.importState(playbackEngine.snapshot as SantoriniStateSnapshot, {
          waitForEvaluation: false,
        });
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
    if (!id.trim()) {
      toast({ title: 'Enter a match ID', status: 'info' });
      return;
    }

    setLoading(true);
    try {
      const [{ data: matchData, error: matchError }, { data: movesData, error: movesError }] = await Promise.all([
        supabase.from('matches').select('*').eq('id', id.trim()).maybeSingle(),
        supabase
          .from('match_moves')
          .select('*')
          .eq('match_id', id.trim())
          .order('move_index', { ascending: true }),
      ]);

      if (matchError) {
        throw matchError;
      }
      if (!matchData) {
        throw new Error('Match not found.');
      }
      if (movesError) {
        throw movesError;
      }

      const typedMoves: MatchMoveRecord<SantoriniMoveAction>[] = (movesData ?? []).map(
        (move: MatchMoveRecord) => ({
          ...move,
          action: move.action as SantoriniMoveAction,
        }),
      );

      const loadedData = { match: matchData as MatchRecord, moves: typedMoves };
      setLoaded(loadedData);
      
      // Start at the last move
      await replayToSnapshot(typedMoves.length - 1, loadedData);
      
      localStorage.setItem('santorini:lastAnalyzedMatch', id.trim());
      setMatchId(id.trim());
      
      toast({
        title: 'Match loaded',
        description: `${typedMoves.length} moves loaded successfully`,
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
    setEvaluationSeries(null);
    setEvaluationError(null);
    setEvaluationDepthUsed(null);
  }, [loaded?.match.id]);

  const loadMatch = useCallback(() => {
    loadMatchById(matchId);
  }, [loadMatchById, matchId]);

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

  const handleGenerateEvaluationGraph = useCallback(async () => {
    if (!loaded) {
      toast({
        title: 'Load a match first',
        description: 'Choose a game to analyze before generating the evaluation graph.',
        status: 'info',
      });
      return;
    }

    if (!aiInitialized) {
      toast({
        title: 'AI still loading',
        description: 'Evaluation tools are not ready yet. Please wait a moment and try again.',
        status: 'warning',
      });
      return;
    }

    const initialSnapshot = loaded.match.initial_state as SantoriniSnapshot | null;
    if (!initialSnapshot) {
      toast({
        title: 'Match snapshot unavailable',
        description: 'This match is missing its initial snapshot and cannot be analyzed.',
        status: 'error',
      });
      return;
    }

    setEvaluationLoading(true);
    setEvaluationError(null);

    const analysis = loaded;
    const restoreIndex = currentIndex;
    let computedSeries: EvaluationSeriesPoint[] | null = null;
    let failureMessage: string | null = null;
    let depthDetected: number | null = null;

    try {
      let playbackEngine = SantoriniEngine.fromSnapshot(initialSnapshot);
      const snapshots: Array<{
        snapshot: SantoriniSnapshot;
        moveIndex: number;
        action: SantoriniMoveAction | null;
        createdAt: string | null;
      }> = [
        {
          snapshot: playbackEngine.snapshot,
          moveIndex: -1,
          action: null,
          createdAt: analysis.match.created_at ?? null,
        },
      ];

      for (const move of analysis.moves) {
        const action = move.action;
        if (action && action.kind === 'santorini.move' && typeof action.move === 'number') {
          try {
            const result = playbackEngine.applyMove(action.move);
            snapshots.push({
              snapshot: result.snapshot,
              moveIndex: move.move_index,
              action,
              createdAt: move.created_at ?? null,
            });
            playbackEngine = SantoriniEngine.fromSnapshot(result.snapshot);
          } catch (moveError) {
            console.warn('Skipping move during evaluation replay', {
              moveIndex: move.move_index,
              action: action.move,
            }, moveError);
          }
        }
      }

      const filteredSnapshots = snapshots.filter((entry) => entry.moveIndex >= MIN_EVAL_MOVE_INDEX);

      if (filteredSnapshots.length === 0) {
        failureMessage = 'Not enough moves yet to build an evaluation graph.';
        return;
      }

      const points: EvaluationSeriesPoint[] = [];

      for (const entry of filteredSnapshots) {
        await santorini.importState(entry.snapshot as SantoriniStateSnapshot, { waitForEvaluation: false });
        const evaluation = await santorini.controls.refreshEvaluation();
        const value = evaluation?.value ?? 0;
        const label = evaluation?.label ?? (value >= 0 ? `+${value.toFixed(3)}` : value.toFixed(3));
        if (depthDetected === null) {
          depthDetected = santorini.evaluationDepth ?? null;
        }
        points.push({
          moveIndex: entry.moveIndex,
          moveNumber: entry.moveIndex === -1 ? 0 : entry.moveIndex + 1,
          evaluation: value,
          label,
          player: entry.action?.by ?? null,
          timestamp: entry.createdAt ?? null,
        });
      }

      computedSeries = points;
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to generate evaluation series', error);
    } finally {
      try {
        await replayToSnapshot(restoreIndex, analysis);
      } catch (restoreError) {
        console.warn('Failed to restore analysis position after evaluation calculation', restoreError);
      }
      setEvaluationLoading(false);
    }

    if (failureMessage) {
      setEvaluationError(failureMessage);
      setEvaluationSeries(null);
      setEvaluationDepthUsed(null);
      toast({
        title: 'Evaluation graph failed',
        status: 'error',
        description: failureMessage,
      });
      return;
    }

    if (computedSeries) {
      setEvaluationSeries(computedSeries);
      setEvaluationDepthUsed(depthDetected);
      toast({
        title: 'Evaluation graph ready',
        status: 'success',
        description: `Calculated ${computedSeries.length} positions`,
        duration: 4000,
      });
    }
  }, [aiInitialized, currentIndex, loaded, replayToSnapshot, santorini, toast]);

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
    return evaluationSeries.map((point) => ({
      ...point,
      moveLabel: point.moveIndex === -1 ? 'Start' : `${point.moveNumber}`,
      playerLabel:
        point.player === 'creator'
          ? 'Creator (Green)'
          : point.player === 'opponent'
            ? 'Opponent (Red)'
            : 'Initial position',
    }));
  }, [evaluationSeries]);

  const evaluationDomain = useMemo(() => {
    if (!evaluationSeries || evaluationSeries.length === 0) {
      return [-1, 1];
    }
    let min = Infinity;
    let max = -Infinity;
    for (const point of evaluationSeries) {
      min = Math.min(min, point.evaluation);
      max = Math.max(max, point.evaluation);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return [-1, 1];
    }
    const padding = Math.max(0.05, (max - min) * 0.1);
    return [Math.min(-1, min - padding), Math.max(1, max + padding)];
  }, [evaluationSeries]);

  const canStepBack = currentIndex > -1;
  const canStepForward = loaded ? currentIndex < loaded.moves.length - 1 : false;
  const cardBg = useColorModeValue('white', 'whiteAlpha.100');
  const cardBorder = useColorModeValue('gray.200', 'whiteAlpha.200');
  const mutedText = useColorModeValue('gray.600', 'whiteAlpha.700');
  const helperText = useColorModeValue('gray.500', 'whiteAlpha.600');
  const highlightBorder = useColorModeValue('teal.500', 'teal.300');
  const highlightBg = useColorModeValue('teal.50', 'teal.900');
  const badgeBorder = useColorModeValue('gray.200', 'whiteAlpha.200');
  const evaluationLineColor = useColorModeValue('teal.500', 'teal.200');
  const chartGridColor = useColorModeValue('gray.200', 'whiteAlpha.200');
  const chartAxisColor = useColorModeValue('gray.700', 'whiteAlpha.800');
  const chartReferenceColor = useColorModeValue('gray.500', 'whiteAlpha.500');
  const tooltipBg = useColorModeValue('white', 'gray.700');

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

      return (
        <Box
          bg={tooltipBg}
          borderRadius="md"
          px={3}
          py={2}
          borderWidth="1px"
          borderColor={cardBorder}
          boxShadow="md"
        >
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
      );
    },
    [cardBorder, evaluationLineColor, mutedText, tooltipBg],
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
    <Stack spacing={6} py={{ base: 6, md: 10 }}>
      <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder}>
        <CardHeader>
          <Flex align="center" justify="space-between" gap={3} flexWrap="wrap">
            <Heading size="md">Analyze a completed match</Heading>
            <Button
              size="sm"
              colorScheme="teal"
              onClick={handleGenerateEvaluationGraph}
              isLoading={evaluationLoading}
              isDisabled={!loaded || loading || !aiInitialized}
            >
              {evaluationSeries ? 'Recalculate eval graph' : 'Generate eval graph'}
            </Button>
          </Flex>
        </CardHeader>
        <CardBody as={Stack} spacing={4}>
          {evaluationError && (
            <Text color="red.400" fontSize="sm">
              {evaluationError}
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
                  <Stack spacing={2} maxH="300px" overflowY="auto">
                    {myCompletedGames.map((game) => {
                      const isCurrentlyLoaded = loaded?.match.id === game.id;
                      return (
                        <Box
                          key={game.id}
                          borderWidth="2px"
                          borderColor={isCurrentlyLoaded ? highlightBorder : cardBorder}
                          bg={isCurrentlyLoaded ? highlightBg : 'transparent'}
                          borderRadius="md"
                          px={3}
                          py={2}
                          cursor="pointer"
                          onClick={() => loadMatchById(game.id)}
                          transition="all 0.2s"
                          _hover={{ borderColor: highlightBorder }}
                        >
                          <Flex justify="space-between" align="center" gap={3}>
                            <Stack spacing={1} flex="1">
                              <Text fontWeight={isCurrentlyLoaded ? 'bold' : 'semibold'} fontSize="sm">
                                {describeMatch(game, auth?.profile ?? null)}
                              </Text>
                              <HStack spacing={2} flexWrap="wrap">
                                <Badge colorScheme={game.rated ? 'purple' : 'gray'} fontSize="xs">
                                  {game.rated ? 'Rated' : 'Casual'}
                                </Badge>
                                {game.clock_initial_seconds > 0 && (
                                  <Badge colorScheme="green" fontSize="xs">
                                    {Math.round(game.clock_initial_seconds / 60)}+{game.clock_increment_seconds}
                                  </Badge>
                                )}
                                <Text fontSize="xs" color={helperText}>
                                  {new Date(game.created_at).toLocaleDateString()}
                                </Text>
                              </HStack>
                            </Stack>
                            <Button
                              size="xs"
                              colorScheme="teal"
                              variant={isCurrentlyLoaded ? 'solid' : 'outline'}
                              onClick={(e) => {
                                e.stopPropagation();
                                loadMatchById(game.id);
                              }}
                              isLoading={loading && matchId === game.id}
                            >
                              {isCurrentlyLoaded ? 'Loaded' : 'Analyze'}
                            </Button>
                          </Flex>
                        </Box>
                      );
                    })}
                  </Stack>
                )}
              </Box>

              <Divider />
            </>
          )}

          {/* Manual Match ID Entry */}
          <Box>
            <Heading size="sm" mb={3}>Or enter a match ID</Heading>
            <Text color={mutedText} fontSize="sm" mb={3}>
              Paste any match ID to analyze games not in your history.
          </Text>
          <HStack spacing={3} align="center">
            <Input
                placeholder="Match ID (e.g., 2af5ce96-718b-4361-bb6c-b6c419f21010)"
              value={matchId}
              onChange={(event) => setMatchId(event.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    loadMatch();
                  }
                }}
            />
              <Button colorScheme="teal" onClick={loadMatch} isLoading={loading} minW="100px">
              Load
            </Button>
          </HStack>
          </Box>

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
                      evaluation={santorini.evaluation}
                      topMoves={santorini.topMoves}
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
                      <Stack spacing={2} maxH="400px" overflowY="auto" pr={2}>
                        {/* Initial position */}
                        <Box
                          borderWidth="2px"
                          borderColor={currentIndex === -1 ? highlightBorder : cardBorder}
                          bg={currentIndex === -1 ? highlightBg : 'transparent'}
                          borderRadius="md"
                          px={3}
                          py={2}
                          cursor={replaying ? 'not-allowed' : 'pointer'}
                          onClick={() => {
                            if (!replaying) {
                              goToStart();
                            }
                          }}
                          transition="all 0.2s"
                          _hover={{ borderColor: highlightBorder }}
                        >
                          <Text fontWeight={currentIndex === -1 ? 'bold' : 'semibold'} fontSize="sm">
                            0. Initial position
                          </Text>
                        </Box>

                        {/* Move list */}
                        {loaded.moves.map((move, index) => {
                          const isSelected = currentIndex === index;
                          return (
                            <Box
                              key={move.id}
                              borderWidth="2px"
                              borderColor={isSelected ? highlightBorder : cardBorder}
                              bg={isSelected ? highlightBg : 'transparent'}
                              borderRadius="md"
                              px={3}
                              py={2}
                              cursor={replaying ? 'not-allowed' : 'pointer'}
                              onClick={() => {
                                if (!replaying) {
                                  void goToMove(index);
                                }
                              }}
                              transition="all 0.2s"
                              _hover={{ borderColor: highlightBorder }}
                            >
                              <HStack justify="space-between" align="center">
                                <Text fontWeight={isSelected ? 'bold' : 'semibold'} fontSize="sm">
                                  {index + 1}. {move.action?.kind === 'santorini.move' ? `Move ${move.action.move}` : 'Move'}
                                </Text>
                                <Text fontSize="xs" color={helperText}>
                                  {new Date(move.created_at).toLocaleTimeString([], { 
                                    hour: '2-digit', 
                                    minute: '2-digit',
                                    second: '2-digit',
                                  })}
                                </Text>
                              </HStack>
                            </Box>
                          );
                        })}
                      </Stack>
                    </Box>
                  </Stack>
                </Box>
              </Flex>
            </CardBody>
          </Card>

          {(evaluationLoading || (evaluationSeries && evaluationSeries.length > 0)) && (
            <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder}>
              <CardHeader>
                <Heading size="sm">Evaluation graph</Heading>
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
                        >
                          <CartesianGrid stroke={chartGridColor} strokeDasharray="4 4" />
                          <XAxis
                            dataKey="moveNumber"
                            stroke={chartAxisColor}
                            tickFormatter={(value) => (value === 0 ? 'Start' : String(value))}
                            fontSize={12}
                            tickMargin={8}
                            minTickGap={12}
                          />
                          <YAxis
                            domain={evaluationDomain}
                            stroke={chartAxisColor}
                            tickFormatter={(value) => value.toFixed(2)}
                            width={48}
                            fontSize={12}
                          />
                          <ReferenceLine y={0} stroke={chartReferenceColor} strokeDasharray="4 4" />
                          <RechartsTooltip content={renderEvaluationTooltip} />
                          <Line
                            type="monotone"
                            dataKey="evaluation"
                            stroke={evaluationLineColor}
                            strokeWidth={2}
                            dot={{ r: 4, stroke: evaluationLineColor, strokeWidth: 1.5 }}
                            activeDot={{ r: 6 }}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </Box>
                    <Text fontSize="xs" color={mutedText}>
                      Evaluation depth: {evaluationDepthUsed ?? 'AI default'}
                    </Text>
                    <Text fontSize="xs" color={mutedText}>
                      Positive values indicate an advantage for Green (creator). Negative values favour Red (opponent).
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
  );
}

export default AnalyzeWorkspace;
