import { ReactNode, useCallback, useEffect, useMemo, useRef, useState, forwardRef } from 'react';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Avatar,
  AvatarBadge,
  Badge,
  Box,
  Button,
  ButtonGroup,
  Card,
  CardBody,
  CardHeader,
  Center,
  CloseButton,
  Flex,
  Grid,
  GridItem,
  Heading,
  HStack,
  Spinner,
  Stack,
  Text,
  Tooltip,
  useBoolean,
  useColorModeValue,
  useBreakpointValue,
  useClipboard,
  useDisclosure,
  useToast,
  VStack,
  Wrap,
  WrapItem,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverArrow,
  PopoverBody,
} from '@chakra-ui/react';
import { MdShare } from 'react-icons/md';
import type { AlertProps } from '@chakra-ui/react';
import { AnimatePresence, motion } from 'framer-motion';
import type { SupabaseAuthState } from '@hooks/useSupabaseAuth';
import { MATCH_PING_COOLDOWN_MS } from '@hooks/useMatchLobby';
import type {
  EmojiReaction,
  LobbyMatch,
  PingOpponentResult,
  PlayerConnectionState,
  UndoRequestState,
  UseMatchLobbyReturn,
} from '@hooks/useMatchLobby';
import { useMatchLobbyContext } from '@hooks/matchLobbyContext';
import { useOnlineSantorini } from '@hooks/useOnlineSantorini';
import { SantoriniProvider } from '@hooks/useSantorini';
import { buildMatchJoinLink } from '@/utils/joinLinks';
import { scheduleAutoOpenCreate } from '@/utils/lobbyStorage';
import { useBrowserNotifications } from '@hooks/useBrowserNotifications';
import { usePushSubscription } from '@hooks/usePushSubscription';
import { useMatchVisibilityReporter } from '@hooks/useMatchVisibilityReporter';
import { useMatchChat } from '@hooks/useMatchChat';
import OnlineBoardSection from '@components/play/OnlineBoardSection';
import { MatchChatPanel } from '@components/play/MatchChatPanel';
import type { SantoriniMoveAction, MatchStatus, PlayerProfile, EnginePreference } from '@/types/match';
import { getMatchAiDepth, getOppositeRole, getPlayerZeroRole, isAiMatch as detectAiMatch } from '@/utils/matchAiDepth';
import { useSurfaceTokens } from '@/theme/useSurfaceTokens';
import { EMOJIS } from '@components/EmojiPicker';
import { deriveStartingRole } from '@/utils/matchStartingRole';
import { SantoriniWorkerClient } from '@/lib/runtime/santoriniWorkerClient';
import { SANTORINI_CONSTANTS, type SantoriniSnapshot } from '@/lib/santoriniEngine';
import { findWorkerPosition } from '@/lib/practice/practiceEngine';
import { useEvaluationJobs, type EvaluationJob } from '@hooks/useEvaluationJobs';
import type { LastMoveInfo } from '@components/GameBoard';
import { fetchMatchWithMoves, MIN_EVAL_MOVE_INDEX } from '@/lib/matchAnalysis';
import { describeMatch } from '@/utils/matchDescription';
import { supabase } from '@/lib/supabaseClient';
import { shareMatchInvite } from '@/utils/shareInvite';
import { showEvaluationStartedToast } from '@/utils/analysisNotifications';
import { rememberLastAnalyzedMatch } from '@/utils/analysisStorage';

const K_FACTOR = 32;
const NOTIFICATION_PROMPT_STORAGE_KEY = 'santorini:notificationsPrompted';
const PLAYER_REACTION_SCROLL_DEBOUNCE_MS = 250;
const MotionBox = motion.create(Box);

const formatNameWithRating = (profile: PlayerProfile | null | undefined, fallback: string): string => {
  if (profile?.display_name) {
    const rating = Number.isFinite(profile.rating) ? ` (${Math.round(profile.rating)})` : '';
    return `${profile.display_name}${rating}`;
  }
  return fallback;
};

const formatDelta = (value: number): string => (value >= 0 ? `+${value}` : `${value}`);

const computeEloDeltas = (playerRating: number, opponentRating: number) => {
  const expectedScore = 1 / (1 + 10 ** ((opponentRating - playerRating) / 400));
  const winDelta = Math.round(K_FACTOR * (1 - expectedScore));
  const lossDelta = Math.round(K_FACTOR * (0 - expectedScore));
  const drawDelta = Math.round(K_FACTOR * (0.5 - expectedScore));
  return { winDelta, lossDelta, drawDelta };
};

function ActiveMatchContent({
  match,
  role,
  moves,
  joinCode,
  onSubmitMove,
  onLeave,
  onGameComplete,
  undoState,
  onRequestUndo,
  onRespondUndo,
  onClearUndo,
  profileId,
  connectionStates,
  currentUserId,
  creatorReactions = [],
  opponentReactions = [],
  canSendEmoji = false,
  onSendEmoji,
  onPingOpponent,
  enginePreference,
  creatorCardRef,
  opponentCardRef,
}: {
  match: LobbyMatch | null;
  role: 'creator' | 'opponent' | null;
  moves: UseMatchLobbyReturn['moves'];
  joinCode: string | null;
  onSubmitMove: UseMatchLobbyReturn['submitMove'];
  onLeave: (matchId?: string | null) => Promise<void>;
  onGameComplete: (status: MatchStatus, payload?: { winner_id?: string | null }) => Promise<void>;
  undoState?: UndoRequestState;
  onRequestUndo: UseMatchLobbyReturn['requestUndo'];
  onRespondUndo: UseMatchLobbyReturn['respondUndo'];
  onClearUndo: () => void;
  profileId: string | null;
  connectionStates?: Record<string, PlayerConnectionState>;
  currentUserId: string | null;
  creatorReactions?: EmojiReaction[];
  opponentReactions?: EmojiReaction[];
  canSendEmoji?: boolean;
  onSendEmoji?: (emoji: string) => void;
  onPingOpponent?: () => Promise<PingOpponentResult>;
  enginePreference: EnginePreference;
  creatorCardRef: React.RefObject<HTMLDivElement>;
  opponentCardRef: React.RefObject<HTMLDivElement>;
}) {
  const toast = useToast();
  const [leaveBusy, setLeaveBusy] = useBoolean();
  const lobbyMatch = match ?? null;
  const isAiMatchFlag = detectAiMatch(lobbyMatch);
  const aiDepth = getMatchAiDepth(lobbyMatch);
  const normalizedAiDepth = aiDepth && Number.isFinite(aiDepth) ? aiDepth : 200;
  const { cardBg, cardBorder, mutedText, strongText, accentHeading, panelBg } = useSurfaceTokens();
  // Ensure connectionStates has a default value
  const safeConnectionStates = connectionStates ?? {};
  const typedMoves = useMemo(
    () =>
      moves
        .filter((move) => (move.action as SantoriniMoveAction | undefined)?.kind === 'santorini.move')
        .map((move) => ({
          ...move,
          action: move.action as SantoriniMoveAction,
        })),
    [moves],
  );
  const aiWorkerRef = useRef<SantoriniWorkerClient | null>(null);
  const aiInitPromiseRef = useRef<Promise<void> | null>(null);
  const aiPlannedMoveIndexRef = useRef<number | null>(null);
  const aiMoveInFlightRef = useRef<Promise<void> | null>(null);
  const autoUndoKeyRef = useRef<string | null>(null);
  const handleGameComplete = useCallback(
    async (winnerId: string | null) => {
      if (!lobbyMatch) return;

      try {
        // Update match status to completed with winner
        await onGameComplete('completed', { winner_id: winnerId });
      } catch (error) {
        console.error('Failed to complete game:', error);
        toast({
          title: 'Error completing game',
          status: 'error',
          description: 'Failed to update match status.',
        });
      }
    },
    [lobbyMatch, onGameComplete, toast],
  );

  // Use the shared Santorini instance from provider
  const santorini = useOnlineSantorini({
    match: lobbyMatch,
    role: role,
    moves: moves,
    onSubmitMove: onSubmitMove,
    onGameComplete: handleGameComplete,
  });

  // Compute last move info for visual indicator
  const lastMoveInfo: LastMoveInfo | null = useMemo(() => {
    if (typedMoves.length === 0) return null;
    const lastMoveRecord = typedMoves[typedMoves.length - 1];
    const action = lastMoveRecord.action;
    const moveValue = Array.isArray(action.move) ? action.move[0] : action.move;
    if (typeof moveValue !== 'number') return null;

    const { BOARD_SIZE, decodeAction, DIRECTIONS, NO_BUILD } = SANTORINI_CONSTANTS;
    const isPlacement = moveValue >= 0 && moveValue < BOARD_SIZE * BOARD_SIZE;
    // Creator is always player 0, opponent is always player 1
    const player = action.by === 'creator' ? 0 : 1;

    if (isPlacement) {
      // Placement move - only has "to" position
      const to: [number, number] = [Math.floor(moveValue / BOARD_SIZE), moveValue % BOARD_SIZE];
      return { from: null, to, build: null, player };
    }

    // Movement action - need previous board state to find origin
    const prevMoveRecord = typedMoves.length > 1 ? typedMoves[typedMoves.length - 2] : null;
    const boardBefore = prevMoveRecord?.state_snapshot?.board ?? lobbyMatch?.initial_state?.board ?? null;
    if (!boardBefore) return null;

    const [workerIndex, _power, moveDirection, buildDirection] = decodeAction(moveValue);
    const workerId = (workerIndex + 1) * (player === 0 ? 1 : -1);
    const origin = findWorkerPosition(boardBefore, workerId);
    if (!origin) return null;

    const from: [number, number] = origin;
    const moveDelta = DIRECTIONS[moveDirection];
    const to: [number, number] = [origin[0] + moveDelta[0], origin[1] + moveDelta[1]];
    const build: [number, number] | null = buildDirection === NO_BUILD
      ? null
      : [to[0] + DIRECTIONS[buildDirection][0], to[1] + DIRECTIONS[buildDirection][1]];

    return { from, to, build, player };
  }, [typedMoves, lobbyMatch?.initial_state?.board]);

  const ensureAiWorker = useCallback(async () => {
    if (!isAiMatchFlag) {
      return null;
    }
    if (typeof window === 'undefined') {
      return null;
    }
    if (aiWorkerRef.current) {
      return aiWorkerRef.current;
    }
    if (!aiInitPromiseRef.current) {
      aiInitPromiseRef.current = (async () => {
        const client = new SantoriniWorkerClient();
        await client.init(enginePreference);
        aiWorkerRef.current = client;
      })();
    }
    await aiInitPromiseRef.current;
    return aiWorkerRef.current;
  }, [enginePreference, isAiMatchFlag]);

  useEffect(() => {
    if (!isAiMatchFlag) {
      return;
    }
    let cancelled = false;
    (async () => {
      const client = await ensureAiWorker();
      if (!client || cancelled) {
        return;
      }
      await client.changeDifficulty(normalizedAiDepth);
    })();
    return () => {
      cancelled = true;
    };
  }, [ensureAiWorker, isAiMatchFlag, normalizedAiDepth]);

  useEffect(() => {
    if (!isAiMatchFlag) {
      return;
    }
    let cancelled = false;
    (async () => {
      const client = await ensureAiWorker();
      if (!client || cancelled) {
        return;
      }
      await client.syncSnapshot(santorini.snapshot as SantoriniSnapshot);
    })();
    return () => {
      cancelled = true;
    };
  }, [ensureAiWorker, isAiMatchFlag, santorini.snapshot]);

  useEffect(() => {
    return () => {
      aiWorkerRef.current?.destroy();
      aiWorkerRef.current = null;
      aiInitPromiseRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isAiMatchFlag && aiWorkerRef.current) {
      aiWorkerRef.current.destroy();
      aiWorkerRef.current = null;
      aiInitPromiseRef.current = null;
    }
  }, [isAiMatchFlag]);

  useEffect(() => {
    aiPlannedMoveIndexRef.current = null;
  }, [lobbyMatch?.id]);

  useEffect(() => {
    if (aiPlannedMoveIndexRef.current !== null && aiPlannedMoveIndexRef.current > moves.length) {
      aiPlannedMoveIndexRef.current = null;
    }
  }, [moves.length]);

  const triggerAiMove = useCallback(
    async (targetMoveIndex: number) => {
      const client = await ensureAiWorker();
      if (!client || !lobbyMatch) {
        throw new Error('AI opponent unavailable');
      }
      await client.syncSnapshot(santorini.snapshot as SantoriniSnapshot);
      const bestMove = await client.guessBestAction();
      if (typeof bestMove !== 'number') {
        throw new Error('AI could not determine a move');
      }
      await onSubmitMove(lobbyMatch, targetMoveIndex, {
        kind: 'santorini.move',
        move: bestMove,
        by: 'opponent',
      });
    },
    [ensureAiWorker, lobbyMatch, onSubmitMove, santorini.snapshot],
  );

  useEffect(() => {
    if (!isAiMatchFlag) {
      return;
    }
    if (!lobbyMatch || lobbyMatch.status !== 'in_progress') {
      aiPlannedMoveIndexRef.current = null;
      return;
    }
    if (santorini.isSyncing || santorini.pendingSubmissions > 0) {
      return;
    }
    if (santorini.currentTurn !== 'opponent') {
      return;
    }
    if (undoState?.status === 'pending') {
      return;
    }
    const lastMove = moves[moves.length - 1] ?? null;
    if (lastMove && typeof lastMove.id === 'string' && lastMove.id.startsWith('optimistic-')) {
      return;
    }
    const targetIndex = moves.length;
    if (aiPlannedMoveIndexRef.current === targetIndex || aiMoveInFlightRef.current) {
      return;
    }
    aiPlannedMoveIndexRef.current = targetIndex;
    aiMoveInFlightRef.current = triggerAiMove(targetIndex)
      .catch((error) => {
        aiPlannedMoveIndexRef.current = null;
        console.error('Failed to submit AI move', error);
        toast({
          title: 'AI move failed',
          status: 'error',
          description: error instanceof Error ? error.message : 'Unknown error',
        });
      })
      .finally(() => {
        aiMoveInFlightRef.current = null;
      });
  }, [isAiMatchFlag, lobbyMatch, moves, santorini.currentTurn, santorini.isSyncing, santorini.pendingSubmissions, triggerAiMove, undoState, toast]);

  const undoRequestedByMe = undoState && undoState.requestedBy === role;

  useEffect(() => {
    if (!isAiMatchFlag) {
      autoUndoKeyRef.current = null;
      return;
    }
    if (!undoState || undoState.status !== 'pending' || !undoRequestedByMe) {
      return;
    }
    const key = `${undoState.matchId}:${undoState.requestedAt}`;
    if (autoUndoKeyRef.current === key) {
      return;
    }
    autoUndoKeyRef.current = key;
    (async () => {
      try {
        await onRespondUndo(true);
        toast({ title: 'Undo granted', status: 'info', duration: 2000 });
      } catch (error) {
        console.error('Failed to auto-accept undo request', error);
        autoUndoKeyRef.current = null;
      }
    })();
  }, [isAiMatchFlag, onRespondUndo, toast, undoRequestedByMe, undoState]);

  useEffect(() => {
    if (!undoState || undoState.status !== 'pending') {
      autoUndoKeyRef.current = null;
    }
  }, [undoState]);
  const fallbackOpponentName = isAiMatchFlag ? 'Santorini AI' : 'Player 2';
  const creatorBaseName = lobbyMatch?.creator?.display_name ?? 'Player 1';
  const opponentBaseName = lobbyMatch?.opponent?.display_name ?? fallbackOpponentName;
  const creatorDisplayName = formatNameWithRating(lobbyMatch?.creator, creatorBaseName);
  const opponentDisplayName = formatNameWithRating(lobbyMatch?.opponent, opponentBaseName);
  const creatorClock = santorini.formatClock(santorini.creatorClockMs);
  const opponentClock = santorini.formatClock(santorini.opponentClockMs);
  const creatorTurnActive = santorini.currentTurn === 'creator';
  const opponentTurnActive = santorini.currentTurn === 'opponent';
  const playerZeroRole = getPlayerZeroRole(lobbyMatch);
  const greenRole = playerZeroRole;
  const redRole = getOppositeRole(playerZeroRole);
  const isMyTurn = role === 'creator' ? creatorTurnActive : role === 'opponent' ? opponentTurnActive : false;
  const turnGlowColor = role ? (role === greenRole ? 'green.400' : 'red.400') : undefined;
  const normalizeRating = (value: number | null | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
  const creatorRatingValue = normalizeRating(lobbyMatch?.creator?.rating);
  const opponentRatingValue = normalizeRating(lobbyMatch?.opponent?.rating);
  const formatClockLabel = (
    name: string,
    rating: number | null,
    colorName: 'Green' | 'Red',
    isSelf: boolean,
  ) => {
    const colorEmoji = colorName === 'Green' ? '🟢' : '🔴';
    const baseName = isSelf ? 'YOU' : name;
    const ratingLabel = rating !== null ? ` (${rating})` : '';
    return `${colorEmoji} ${baseName}${ratingLabel}`;
  };
  const creatorColorName = playerZeroRole === 'creator' ? 'Green' : 'Red';
  const opponentColorName = creatorColorName === 'Green' ? 'Red' : 'Green';
  const creatorClockLabel = formatClockLabel(creatorBaseName, creatorRatingValue, creatorColorName, role === 'creator');
  const opponentClockLabel = formatClockLabel(opponentBaseName, opponentRatingValue, opponentColorName, role === 'opponent');
  const notificationPromptBg = useColorModeValue('white', 'gray.800');
  const notificationPromptBorder = useColorModeValue('teal.400', 'teal.300');
  const [requestingUndo, setRequestingUndo] = useBoolean(false);
  const [respondingUndo, setRespondingUndo] = useBoolean(false);
  const [pingBusy, setPingBusy] = useBoolean(false);
  const [pingFeedback, setPingFeedback] = useState<{ recordedAt: string; delivered: number } | null>(null);
  const [pingCooldownUntil, setPingCooldownUntil] = useState<number | null>(null);
  const [pingCooldownTick, setPingCooldownTick] = useState(0);
  const myProfile = role === 'creator' ? lobbyMatch?.creator : role === 'opponent' ? lobbyMatch?.opponent : null;
  const opponentProfile = role === 'creator' ? lobbyMatch?.opponent : role === 'opponent' ? lobbyMatch?.creator : null;

  useEffect(() => {
    if (!pingCooldownUntil || typeof window === 'undefined') {
      return;
    }
    const timer = window.setInterval(() => {
      setPingCooldownTick((value) => value + 1);
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [pingCooldownUntil]);

  // Resolve connection states for creator and opponent
  const resolveConnectionState = useCallback(
    (playerId: string | null | undefined): PlayerConnectionState | null => {
      if (!playerId) return null;
      return safeConnectionStates[playerId] ?? null;
    },
    [safeConnectionStates],
  );

  const creatorConnection = useMemo(
    () => resolveConnectionState(lobbyMatch?.creator_id),
    [lobbyMatch?.creator_id, resolveConnectionState],
  );
  const opponentConnection = useMemo(
    () => resolveConnectionState(lobbyMatch?.opponent_id),
    [lobbyMatch?.opponent_id, resolveConnectionState],
  );

  const pingMenuEnabled = useMemo(
    () => Boolean(!isAiMatchFlag && onPingOpponent && opponentProfile && lobbyMatch?.status === 'in_progress'),
    [isAiMatchFlag, lobbyMatch?.status, onPingOpponent, opponentProfile],
  );
  const pingCooldownRemaining = useMemo(() => {
    if (!pingCooldownUntil) {
      return 0;
    }
    return Math.max(0, pingCooldownUntil - Date.now());
  }, [pingCooldownTick, pingCooldownUntil]);
  const opponentAppearsActive = opponentConnection ? opponentConnection.status !== 'offline' : false;
  const pingDisabled = !pingMenuEnabled || pingBusy || opponentAppearsActive || pingCooldownRemaining > 0;
  const pingHelperText = useMemo(() => {
    if (!pingMenuEnabled || !opponentProfile) {
      return null;
    }
    if (opponentAppearsActive) {
      return `${opponentProfile.display_name ?? 'Opponent'} is already viewing this match.`;
    }
    if (pingCooldownRemaining > 0) {
      return `Try again in ${Math.ceil(pingCooldownRemaining / 1000)}s.`;
    }
    if (pingFeedback) {
      const timestamp = new Date(pingFeedback.recordedAt);
      const timeLabel = Number.isNaN(timestamp.getTime())
        ? pingFeedback.recordedAt
        : timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return pingFeedback.delivered > 0
        ? `Last ping delivered at ${timeLabel}.`
        : `Last ping queued at ${timeLabel}.`;
    }
    return 'Send a push notification if they leave the game.';
  }, [pingMenuEnabled, opponentProfile, opponentAppearsActive, pingCooldownRemaining, pingFeedback]);

  const {
    permission: notificationPermission,
    isSupported: notificationsSupported,
    requestPermission,
    showNotification,
  } = useBrowserNotifications();
  usePushSubscription(myProfile ?? null, notificationPermission);
  const notificationToastIdRef = useRef<string | number | undefined>();
  const hasPromptedNotificationsRef = useRef(false);
  const lastOpponentIdRef = useRef<string | null>(lobbyMatch?.opponent_id ?? null);
  const opponentTrackerInitializedRef = useRef(false);
  const lastMoveCountRef = useRef<number>(moves.length);
  const movesHydratedRef = useRef(false);
  const isPageBackgrounded = useCallback(() => {
    if (typeof document === 'undefined') {
      return false;
    }
    if (document.visibilityState === 'hidden' || (typeof document.hidden === 'boolean' && document.hidden)) {
      return true;
    }
    if (typeof document.hasFocus === 'function') {
      try {
        if (!document.hasFocus()) {
          return true;
        }
      } catch (error) {
        console.warn('GamePlayWorkspace: document.hasFocus check failed', error);
      }
    }
    return false;
  }, []);
  const { isOpen: isResignOpen, onOpen: onResignOpen, onClose: onResignClose } = useDisclosure();
  const resignCancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    opponentTrackerInitializedRef.current = false;
    lastOpponentIdRef.current = lobbyMatch?.opponent_id ?? null;
  }, [lobbyMatch?.id, lobbyMatch?.opponent_id]);

  useEffect(() => {
    movesHydratedRef.current = false;
    lastMoveCountRef.current = moves.length;
  }, [lobbyMatch?.id]);
  const playerRating = myProfile?.rating;
  const opponentRating = opponentProfile?.rating;
  const [showRatingProjection, setShowRatingProjection] = useState(true);
  const ratingProjection = useMemo(() => {
    if (!lobbyMatch?.rated || !role || typedMoves.length > 0) {
      return null;
    }
    if (!Number.isFinite(playerRating) || !Number.isFinite(opponentRating)) {
      return null;
    }
    const { winDelta, lossDelta, drawDelta } = computeEloDeltas(playerRating as number, opponentRating as number);
    return {
      winDelta,
      lossDelta,
      drawDelta,
      playerRating: Math.round(playerRating as number),
      opponentRating: Math.round(opponentRating as number),
    };
  }, [lobbyMatch?.rated, role, typedMoves.length, playerRating, opponentRating]);

  const undoPending = undoState?.status === 'pending';
  const undoMoveNumber = undoState ? undoState.moveIndex + 1 : null;
  const seenUndoToastRef = useRef<string | null>(null);
  const canRequestUndo = Boolean(
    match?.status === 'in_progress' &&
      role &&
      moves.length > 0 &&
      (!undoState || undoState.status === 'rejected' || undoState.status === 'applied')
  );
  const undoDisabledOverride = !canRequestUndo || requestingUndo || undoPending;

  const chatAuthor = useMemo(() => {
    if (!myProfile) {
      return null;
    }
    return {
      id: myProfile.id ?? profileId ?? null,
      name: myProfile.display_name ?? 'You',
      avatarUrl: myProfile.avatar_url ?? null,
    };
  }, [myProfile, profileId]);
  const {
    messages: chatMessages,
    reactions: chatReactions,
    status: chatStatus,
    sendMessage: sendChatMessage,
    sendReaction: sendChatReaction,
    canSend: canSendChat,
    clearHistory: clearChatHistory,
    typingUsers: chatTypingUsers,
    notifyTyping: notifyChatTyping,
  } = useMatchChat({
    matchId: lobbyMatch?.id ?? null,
    author: chatAuthor,
  });
  const chatViewerId = myProfile?.id ?? profileId ?? currentUserId ?? null;

  useEffect(() => {
    if (!notificationsSupported) {
      return;
    }
    if (notificationPermission === 'default') {
      if (hasPromptedNotificationsRef.current) {
        return;
      }
      const alreadyPrompted = (() => {
        try {
          if (typeof window === 'undefined') {
            return false;
          }
          return window.localStorage.getItem(NOTIFICATION_PROMPT_STORAGE_KEY) === 'true';
        } catch (error) {
          console.warn('Unable to read notification prompt state', error);
          return false;
        }
      })();
      if (alreadyPrompted) {
        hasPromptedNotificationsRef.current = true;
        return;
      }
      hasPromptedNotificationsRef.current = true;
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(NOTIFICATION_PROMPT_STORAGE_KEY, 'true');
        } catch (error) {
          console.warn('Unable to persist notification prompt state', error);
        }
      }
      notificationToastIdRef.current = toast({
        duration: 10000,
        position: 'top',
        render: ({ onClose }) => (
          <Box
            bg={notificationPromptBg}
            borderRadius="lg"
            borderWidth="1px"
            borderColor={notificationPromptBorder}
            boxShadow="lg"
            px={4}
            py={3}
          >
            <Stack spacing={3}>
              <Heading size="sm">Enable game alerts</Heading>
              <Text fontSize="sm">
                Allow browser notifications so you know when opponents join or make a move while this tab is hidden.
              </Text>
              <HStack spacing={3} justify="flex-end">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onClose();
                  }}
                >
                  Not now
                </Button>
                <Button
                  size="sm"
                  colorScheme="teal"
                  onClick={async () => {
                    const result = await requestPermission();
                    if (result !== 'default') {
                      onClose();
                    }
                  }}
                >
                  Enable
                </Button>
              </HStack>
            </Stack>
          </Box>
        ),
      });
      return;
    }
    if (notificationToastIdRef.current) {
      toast.close(notificationToastIdRef.current);
      notificationToastIdRef.current = undefined;
    }
  }, [
    notificationsSupported,
    notificationPermission,
    toast,
    notificationPromptBg,
    notificationPromptBorder,
    requestPermission,
  ]);

  useEffect(() => {
    const opponentId = lobbyMatch?.opponent_id ?? null;
    if (!opponentTrackerInitializedRef.current) {
      opponentTrackerInitializedRef.current = true;
      lastOpponentIdRef.current = opponentId;
      return;
    }
    if (!lobbyMatch || !role) {
      lastOpponentIdRef.current = opponentId;
      return;
    }
    if (opponentId && opponentId !== lastOpponentIdRef.current) {
      const isCreator = lobbyMatch.creator_id === profileId;
      if (isCreator) {
        const opponentName = lobbyMatch.opponent?.display_name ?? 'Opponent';
        if (notificationsSupported && notificationPermission === 'granted' && isPageBackgrounded()) {
          showNotification('⚔️ Game On!', {
            body: `${opponentName} joined — your match is ready to play!`,
            id: `match-${lobbyMatch.id}-join`,
            renotify: true,
            requireInteraction: true,
          });
        } else {
          toast({
            title: 'Opponent joined',
            description: `${opponentName} is ready to play.`,
            status: 'success',
            duration: 4000,
          });
        }
      }
    }
    lastOpponentIdRef.current = opponentId;
  }, [
    lobbyMatch?.opponent_id,
    lobbyMatch?.opponent?.display_name,
    lobbyMatch?.creator_id,
    lobbyMatch?.id,
    role,
    profileId,
    notificationsSupported,
    notificationPermission,
    isPageBackgrounded,
    showNotification,
  ]);

  useEffect(() => {
    if (isAiMatchFlag) {
      return;
    }
    if (!lobbyMatch || !role) {
      lastMoveCountRef.current = moves.length;
      return;
    }
    if (!movesHydratedRef.current) {
      movesHydratedRef.current = true;
      lastMoveCountRef.current = moves.length;
      return;
    }
    if (moves.length <= lastMoveCountRef.current) {
      lastMoveCountRef.current = moves.length;
      return;
    }
    const latestMove = moves[moves.length - 1];
    lastMoveCountRef.current = moves.length;
    if (!latestMove) {
      return;
    }
    if (latestMove.player_id === profileId) {
      return;
    }
    if (lobbyMatch.status !== 'in_progress') {
      return;
    }
    const opponentName =
      latestMove.player_id === lobbyMatch.creator_id
        ? creatorDisplayName
        : latestMove.player_id === lobbyMatch.opponent_id
          ? opponentDisplayName
          : 'Opponent';
    if (notificationsSupported && notificationPermission === 'granted' && isPageBackgrounded()) {
      showNotification('🎯 Your Turn!', {
        body: `${opponentName} made a move — tap to play!`,
        id: `match-${lobbyMatch.id}-move`,
        renotify: true,
        requireInteraction: true,
      });
    }
  }, [
    isAiMatchFlag,
    lobbyMatch,
    moves,
    role,
    profileId,
    creatorDisplayName,
    opponentDisplayName,
    notificationsSupported,
    notificationPermission,
    isPageBackgrounded,
    showNotification,
    toast,
  ]);

  useEffect(() => {
    if (!undoState) {
      return undefined;
    }
    if (undoState.status === 'applied' || undoState.status === 'rejected') {
      const timer = setTimeout(() => {
        onClearUndo();
      }, 4000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [undoState, onClearUndo]);

  const handleRequestUndo = useCallback(async () => {
    setRequestingUndo.on();
    try {
      await onRequestUndo();
      toast({ title: 'Undo request sent', status: 'info', duration: 3000 });
    } catch (error) {
      toast({
        title: 'Unable to request undo',
        status: 'error',
        description: error instanceof Error ? error.message : 'Please try again in a moment.',
      });
    } finally {
      setRequestingUndo.off();
    }
  }, [onRequestUndo, setRequestingUndo, toast]);

  const handleRespondUndo = useCallback(async (accepted: boolean) => {
    setRespondingUndo.on();
    try {
      await onRespondUndo(accepted);
      toast({
        title: accepted ? 'Undo request accepted' : 'Undo request declined',
        status: accepted ? 'success' : 'info',
        duration: 3000,
      });
    } catch (error) {
      toast({
        title: 'Unable to respond to undo request',
        status: 'error',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setRespondingUndo.off();
    }
  }, [onRespondUndo, setRespondingUndo, toast]);

  useEffect(() => {
    if (isAiMatchFlag) {
      return;
    }
    if (!undoState || undoState.status !== 'pending' || undoRequestedByMe) {
      return;
    }
    const toastKey = `${undoState.matchId}:${undoState.requestedAt}`;
    if (seenUndoToastRef.current === toastKey) {
      return;
    }
    seenUndoToastRef.current = toastKey;
    toast({
      duration: null,
      position: 'top-right',
      render: ({ onClose }) => (
        <Box
          bg={notificationPromptBg}
          borderRadius="lg"
          borderWidth="1px"
          borderColor={notificationPromptBorder}
          boxShadow="lg"
          px={4}
          py={3}
        >
          <Stack spacing={2}>
            <Heading size="sm">Undo requested</Heading>
            <Text fontSize="sm">
              {undoMoveNumber !== null
                ? `Your opponent wants to undo move #${undoMoveNumber}.`
                : 'Your opponent requested an undo.'}
            </Text>
            <ButtonGroup size="sm" justifyContent="flex-end">
              <Button
                variant="ghost"
                onClick={() => {
                  onClose();
                }}
              >
                Later
              </Button>
              <Button
                variant="outline"
                colorScheme="red"
                onClick={() => {
                  void handleRespondUndo(false).finally(() => {
                    onClose();
                  });
                }}
                isDisabled={respondingUndo}
                isLoading={respondingUndo}
              >
                Decline
              </Button>
              <Button
                colorScheme="teal"
                onClick={() => {
                  void handleRespondUndo(true).finally(() => {
                    onClose();
                  });
                }}
                isDisabled={respondingUndo}
                isLoading={respondingUndo}
              >
                Accept
              </Button>
            </ButtonGroup>
          </Stack>
        </Box>
      ),
    });
  }, [
    isAiMatchFlag,
    toast,
    undoMoveNumber,
    undoRequestedByMe,
    undoState,
    handleRespondUndo,
    respondingUndo,
    notificationPromptBg,
    notificationPromptBorder,
  ]);

  const undoBanner = useMemo(() => {
    if (!undoState || undoMoveNumber === null) {
      return null;
    }

    const renderUndoBanner = (
      status: AlertProps['status'],
      content: ReactNode,
      actions?: ReactNode,
    ) => (
      <Alert
        status={status}
        variant="left-accent"
        borderRadius="md"
        mt={4}
        w="full"
        maxW="full"
        flexDirection={{ base: 'column', md: 'row' }}
        alignItems={{ base: 'flex-start', md: 'center' }}
        gap={{ base: 3, md: 0 }}
      >
        <Flex align={{ base: 'flex-start', md: 'center' }} gap={3} w="100%">
          <AlertIcon />
          <Stack spacing={1} flex="1" minW={0}>
            {content}
          </Stack>
        </Flex>
        {actions ? (
          <Stack
            direction={{ base: 'column', sm: 'row' }}
            spacing={2}
            w={{ base: '100%', md: 'auto' }}
            justifyContent={{ base: 'flex-start', md: 'flex-end' }}
            alignItems={{ base: 'stretch', sm: 'center' }}
          >
            {actions}
          </Stack>
        ) : null}
      </Alert>
    );

    if (undoState.status === 'pending') {
      if (undoRequestedByMe) {
        return renderUndoBanner(
          'info',
          <>
            <AlertTitle>Undo request sent</AlertTitle>
            <AlertDescription>Waiting for your opponent to respond…</AlertDescription>
          </>,
        );
      }
      return renderUndoBanner(
        'warning',
        <>
          <AlertTitle>Undo requested</AlertTitle>
          <AlertDescription>Opponent wants to undo move #{undoMoveNumber}.</AlertDescription>
        </>,
        <>
          <Button
            colorScheme="teal"
            onClick={() => handleRespondUndo(true)}
            isLoading={respondingUndo}
            isDisabled={respondingUndo}
            w={{ base: '100%', sm: 'auto' }}
          >
            Allow
          </Button>
          <Button
            variant="outline"
            onClick={() => handleRespondUndo(false)}
            isLoading={respondingUndo}
            isDisabled={respondingUndo}
            w={{ base: '100%', sm: 'auto' }}
          >
            Decline
          </Button>
        </>,
      );
    }

    if (undoState.status === 'accepted') {
      return renderUndoBanner(
        'info',
        <>
          <AlertTitle>Undo accepted</AlertTitle>
          <AlertDescription>Restoring position…</AlertDescription>
        </>,
      );
    }

    if (undoState.status === 'applied') {
      return renderUndoBanner(
        'success',
        <>
          <AlertTitle>Move undone</AlertTitle>
          <AlertDescription>Move #{undoMoveNumber} has been undone.</AlertDescription>
        </>,
        <Box display="flex" justifyContent={{ base: 'flex-start', md: 'flex-end' }} w="100%">
          <CloseButton position="relative" onClick={onClearUndo} />
        </Box>,
      );
    }

    if (undoState.status === 'rejected') {
      return renderUndoBanner(
        'warning',
        <>
          <AlertTitle>Undo declined</AlertTitle>
          <AlertDescription>Your opponent declined the undo request.</AlertDescription>
        </>,
        <Box display="flex" justifyContent={{ base: 'flex-start', md: 'flex-end' }} w="100%">
          <CloseButton position="relative" onClick={onClearUndo} />
        </Box>,
      );
    }

    return null;
  }, [undoState, undoMoveNumber, undoRequestedByMe, respondingUndo, handleRespondUndo, onClearUndo]);

  const handleConfirmResign = async () => {
    setLeaveBusy.on();
    try {
      await onLeave(match?.id);
      await santorini.resetMatch();
    } finally {
      setLeaveBusy.off();
      onResignClose();
    }
  };

  const handlePingOpponent = useCallback(async () => {
    if (!onPingOpponent || !pingMenuEnabled) {
      return;
    }
    if (pingBusy) {
      return;
    }
    if (opponentAppearsActive) {
      toast({
        title: `${opponentProfile?.display_name ?? 'Opponent'} is already here`,
        description: 'They are still connected to this match.',
        status: 'info',
        duration: 3000,
      });
      return;
    }
    if (pingCooldownRemaining > 0) {
      toast({
        title: 'Please wait',
        description: `You can ping again in ${Math.ceil(pingCooldownRemaining / 1000)}s.`,
        status: 'info',
        duration: 2500,
      });
      return;
    }
    setPingBusy.on();
    try {
      const result = await onPingOpponent();
      const recordedAtMs = Date.parse(result.recordedAt) || Date.now();
      setPingCooldownUntil(recordedAtMs + (result.cooldownMs ?? MATCH_PING_COOLDOWN_MS));
      setPingFeedback({
        recordedAt: result.recordedAt,
        delivered: result.notificationsDelivered,
      });
      toast({
        title: result.notificationsDelivered > 0 ? 'Opponent notified' : 'Ping recorded',
        description:
          result.notificationsDelivered > 0
            ? 'We sent a push notification to your opponent.'
            : 'We logged the ping, but they have no push targets right now.',
        status: result.notificationsDelivered > 0 ? 'success' : 'info',
        duration: 4000,
      });
    } catch (error) {
      const code =
        (error as { code?: string } | null)?.code ??
        ((error as { context?: { body?: { code?: string } } })?.context?.body?.code ?? null);
      if (code === 'PING_RATE_LIMIT') {
        const retryAfterMs =
          typeof (error as any)?.retryAfterMs === 'number'
            ? Math.max(0, (error as any).retryAfterMs)
            : MATCH_PING_COOLDOWN_MS;
        setPingCooldownUntil(Date.now() + retryAfterMs);
        toast({
          title: 'Slow down',
          description: `You can ping again in ${Math.ceil(retryAfterMs / 1000)}s.`,
          status: 'warning',
          duration: 4000,
        });
      } else {
        toast({
          title: 'Unable to ping opponent',
          status: 'error',
          description: error instanceof Error ? error.message : 'Please try again.',
        });
      }
    } finally {
      setPingBusy.off();
    }
  }, [
    onPingOpponent,
    opponentAppearsActive,
    opponentProfile?.display_name,
    pingBusy,
    pingCooldownRemaining,
    pingMenuEnabled,
    setPingBusy,
    toast,
  ]);

  return (
    <Stack spacing={6}>
      <Stack spacing={{ base: 5, md: 6 }} align="center">
        <Stack
          direction="row"
          spacing={{ base: 3, md: 6 }}
          w="100%"
          maxW="960px"
          flexWrap="wrap"
          justify="center"
          align="stretch"
        >
          <PlayerClockCard
            ref={creatorCardRef}
            label={creatorClockLabel}
            clock={creatorClock}
            active={creatorTurnActive}
            accentColor={accentHeading}
            profile={lobbyMatch?.creator}
            alignment="flex-start"
            reactions={creatorReactions}
            showEmojiPicker={Boolean(canSendEmoji && role === 'creator')}
            onSendEmoji={onSendEmoji}
            showPingMenu={Boolean(pingMenuEnabled && role === 'opponent')}
            onPingOpponent={role === 'opponent' ? handlePingOpponent : undefined}
            pingBusy={pingBusy}
            pingDisabled={pingDisabled}
            pingHelperText={role === 'opponent' ? pingHelperText : undefined}
            pingCooldownRemaining={pingCooldownRemaining}
          />
          <PlayerClockCard
            ref={opponentCardRef}
            label={opponentClockLabel}
            clock={opponentClock}
            active={opponentTurnActive}
            accentColor={accentHeading}
            profile={lobbyMatch?.opponent}
            alignment="flex-end"
            reactions={opponentReactions}
            showEmojiPicker={Boolean(canSendEmoji && role === 'opponent')}
            onSendEmoji={onSendEmoji}
            showPingMenu={Boolean(pingMenuEnabled && role === 'creator')}
            onPingOpponent={role === 'creator' ? handlePingOpponent : undefined}
            pingBusy={pingBusy}
            pingDisabled={pingDisabled}
            pingHelperText={role === 'creator' ? pingHelperText : undefined}
            pingCooldownRemaining={pingCooldownRemaining}
          />
        </Stack>
      </Stack>

      {ratingProjection && showRatingProjection && (
        <Alert status="info" variant="left-accent" borderRadius="md" w="full" maxW="full">
          <AlertIcon />
          <Flex
            flex="1"
            align={{ base: 'flex-start', md: 'center' }}
            gap={3}
            direction={{ base: 'column', md: 'row' }}
            flexWrap="wrap"
            w="100%"
          >
            <Stack spacing={1} flex="1">
              <AlertTitle>Rated stakes</AlertTitle>
              <AlertDescription fontSize="sm">
                Win: {formatDelta(ratingProjection.winDelta)} ELO · Draw: {formatDelta(ratingProjection.drawDelta)} ELO · Loss:{' '}
                {formatDelta(ratingProjection.lossDelta)} ELO
              </AlertDescription>
              <AlertDescription fontSize="xs" color={mutedText}>
                You: {ratingProjection.playerRating} · Opponent: {ratingProjection.opponentRating}
              </AlertDescription>
            </Stack>
            <CloseButton alignSelf={{ base: 'flex-start', md: 'center' }} onClick={() => setShowRatingProjection(false)} />
          </Flex>
        </Alert>
      )}

      {/* Game Board + Chat */}
      <Flex
        direction={{ base: 'column', lg: 'row' }}
        align={{ base: 'center', lg: 'flex-start' }}
        w="100%"
        maxW={{ base: '960px', lg: '1200px' }}
        mx="auto"
        gap={{ base: 6, lg: 4 }}
      >
        <Flex direction="column" align="center" flex="1" w="100%">
          <OnlineBoardSection
            variant="responsive"
            containerProps={{
              w: '100%',
              maxW: { base: '100%', md: '960px' },
              mx: 'auto',
              overflow: 'hidden',
            }}
            board={santorini.board}
            selectable={santorini.selectable}
            cancelSelectable={santorini.cancelSelectable}
            onCellClick={santorini.onCellClick}
            onCellHover={santorini.onCellHover}
            onCellLeave={santorini.onCellLeave}
            buttons={santorini.buttons}
            undo={handleRequestUndo}
            redo={santorini.redo}
            undoLabel="Request undo"
            hideRedoButton
            undoDisabledOverride={undoDisabledOverride}
            undoIsLoading={requestingUndo}
            isTurnActive={isMyTurn}
            turnHighlightColor={turnGlowColor}
            lastMove={lastMoveInfo}
          />

          {undoBanner}
        </Flex>

        {lobbyMatch ? (
          <Stack
            spacing={3}
            w={{ base: '100%', lg: '360px' }}
            flexShrink={0}
            alignSelf={{ base: 'stretch', lg: 'flex-start' }}
          >
            <MatchChatPanel
              matchId={lobbyMatch.id}
              messages={chatMessages}
              reactions={chatReactions}
              status={chatStatus}
              onSend={sendChatMessage}
              onReact={sendChatReaction}
              canSend={canSendChat}
              currentUserId={chatViewerId}
              typingUsers={chatTypingUsers}
              onTypingStatusChange={notifyChatTyping}
              onClearHistory={chatMessages.length > 0 ? clearChatHistory : undefined}
            />
            <Box display="flex" justifyContent={{ base: 'center', md: 'flex-end' }}>
              <Tooltip label="Resign and lose the game (affects rating if rated)" hasArrow>
                <Button colorScheme="red" variant="outline" onClick={onResignOpen} isLoading={leaveBusy}>
                  Resign
                </Button>
              </Tooltip>
            </Box>
          </Stack>
        ) : null}
      </Flex>

      <AlertDialog isOpen={isResignOpen} leastDestructiveRef={resignCancelRef} onClose={onResignClose}>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Confirm resignation
            </AlertDialogHeader>
            <AlertDialogBody>
              Resigning ends the game immediately and awards the win to your opponent. Are you sure you want to resign?
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={resignCancelRef} onClick={onResignClose} variant="ghost">
                Continue playing
              </Button>
              <Button colorScheme="red" onClick={handleConfirmResign} ml={3} isLoading={leaveBusy}>
                Resign game
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Stack>
  );
}

function CompletedMatchSummary({
  match,
  profileId,
  onRequestRematch,
  rematchLoading,
  onPrepareAnalyze,
}: {
  match: LobbyMatch;
  profileId: string | null;
  onRequestRematch: () => void;
  rematchLoading: boolean;
  onPrepareAnalyze: (match: LobbyMatch) => void;
}) {
  const { cardBg, cardBorder, mutedText, accentHeading } = useSurfaceTokens();

  const winnerProfile = match.winner_id
    ? match.winner_id === match.creator_id
      ? match.creator
      : match.opponent
    : null;
  const isDraw = !match.winner_id;
  const isWinnerUser = winnerProfile?.id && winnerProfile.id === profileId;

  const title = (() => {
    if (isDraw) {
      return 'Game drawn';
    }
    if (isWinnerUser) {
      return 'You win!';
    }
    return `${winnerProfile?.display_name ?? 'Opponent'} wins`;
  })();

  const description = (() => {
    if (match.status === 'abandoned') {
      if (isWinnerUser) {
        return 'Opponent resigned or ran out of time.';
      }
      if (winnerProfile) {
        return 'You resigned or ran out of time.';
      }
      return 'The game ended early.';
    }
    if (match.status === 'completed') {
      if (isDraw) {
        return 'Neither player could secure a win.';
      }
      if (isWinnerUser) {
        return 'Match completed. You won!';
      }
      if (winnerProfile) {
        return `${winnerProfile.display_name ?? 'Opponent'} won the match.`;
      }
      return 'The match has completed.';
    }
    if (isDraw) {
      return 'Neither player could secure a win.';
    }
    if (isWinnerUser) {
      return 'Your worker reached level 3.';
    }
    return `${winnerProfile?.display_name ?? 'Opponent'} reached level 3.`;
  })();

  return (
    <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder} shadow="md">
      <CardBody>
        <Stack spacing={4}>
          <Heading size="md" color={accentHeading}>
            {title}
          </Heading>
          <Text color={mutedText}>{description}</Text>
          <HStack spacing={2} flexWrap="wrap">
            {match.rated && <Badge colorScheme="purple">Rated match</Badge>}
            {match.clock_initial_seconds > 0 && (
              <Badge colorScheme="green">
                {Math.round(match.clock_initial_seconds / 60)}+{match.clock_increment_seconds}
              </Badge>
            )}
            {detectAiMatch(match) && (
              <Badge colorScheme="pink">Depth {getMatchAiDepth(match) ?? 200}</Badge>
            )}
          </HStack>
          <HStack spacing={3} flexWrap="wrap">
            <Button colorScheme="teal" onClick={onRequestRematch} isLoading={rematchLoading} isDisabled={rematchLoading}>
              Request rematch
            </Button>
            <Button variant="outline" onClick={() => onPrepareAnalyze(match)}>
              Review in Analysis
            </Button>
          </HStack>
          <Text fontSize="xs" color={mutedText}>
            Rematch invitations from your opponent will appear above. Share the join code if needed.
          </Text>
        </Stack>
      </CardBody>
    </Card>
  );
}

function AnalysisJobBanner({ job, onNavigateToAnalysis }: { job: EvaluationJob; onNavigateToAnalysis: (jobId?: string) => void }) {
  const isComplete = job.status === 'success';
  const isRunning = job.status === 'running' || job.status === 'queued';
  const depthLabel = job.depth ? `depth ${job.depth}` : 'default depth';
  const status: AlertProps['status'] = job.status === 'error' ? 'error' : isComplete ? 'success' : 'info';
  const title = isComplete ? 'Analysis ready' : isRunning ? 'Analysis running' : 'Analysis update';
  const description = isComplete
    ? `${job.matchLabel} is ready to review.`
    : `Analyzing ${job.matchLabel} at ${depthLabel}...`;

  return (
    <Alert
      status={status}
      variant="left-accent"
      borderRadius="md"
      alignItems={{ base: 'flex-start', md: 'center' }}
      flexDirection={{ base: 'column', md: 'row' }}
      gap={{ base: 2, md: 3 }}
      w="100%"
      maxW="100%"
    >
      <AlertIcon />
      <Stack spacing={1} flex="1" minW={0}>
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </Stack>
      <ButtonGroup size="sm" flexWrap="wrap" justifyContent="flex-end">
        <Button
          colorScheme="teal"
          variant={isComplete ? 'solid' : 'outline'}
          onClick={() => onNavigateToAnalysis(job.id)}
          isDisabled={!isComplete}
        >
          {isComplete ? 'View analysis' : 'Open analysis'}
        </Button>
      </ButtonGroup>
    </Alert>
  );
}

interface PlayerClockCardProps {
  label: string;
  clock: string;
  active: boolean;
  accentColor: string;
  profile: PlayerProfile | null | undefined;
  alignment: 'flex-start' | 'flex-end';
  reactions?: EmojiReaction[];
  showEmojiPicker?: boolean;
  onSendEmoji?: (emoji: string) => void;
  showPingMenu?: boolean;
  onPingOpponent?: () => void;
  pingBusy?: boolean;
  pingDisabled?: boolean;
  pingHelperText?: string | null;
  pingCooldownRemaining?: number;
}

const PlayerClockCard = forwardRef<HTMLDivElement, PlayerClockCardProps>(({
  label,
  clock,
  active,
  accentColor,
  profile,
  alignment,
  reactions,
  showEmojiPicker,
  onSendEmoji,
  showPingMenu,
  onPingOpponent,
  pingBusy,
  pingDisabled,
  pingHelperText,
  pingCooldownRemaining = 0,
}: PlayerClockCardProps, ref: React.Ref<HTMLDivElement>) => {
  const { cardBorder, mutedText, strongText } = useSurfaceTokens();
  const activeBg = useColorModeValue('teal.50', 'teal.900');
  const inactiveBg = useColorModeValue('white', 'whiteAlpha.100');
  const clockColor = active ? accentColor : strongText;
  const alignItems: 'flex-start' | 'flex-end' = alignment;
  const isRightAligned = alignment === 'flex-end';
  const textAlign = isRightAligned ? 'right' : 'left';
  const cardPadding = useBreakpointValue({ base: 3, md: 4 });
  const clockFontSize = useBreakpointValue({ base: '2xl', md: '3xl' });
  const labelFontSize = useBreakpointValue({ base: 'xs', md: 'sm' });
  const avatarSize = useBreakpointValue<'sm' | 'md' | 'lg'>({ base: 'md', md: 'lg' });
  const emojiFontSize = useBreakpointValue({ base: '3xl', md: '4xl' });
  const activeReactions = reactions ?? [];
  const layoutDirection = useBreakpointValue<'column' | 'row'>({ base: 'column', md: 'row' }) ?? 'column';
  const isColumnLayout = layoutDirection === 'column';
  const effectiveTextAlign = isColumnLayout ? 'left' : textAlign;
  const horizontalJustify = !isColumnLayout && isRightAligned ? 'flex-end' : 'flex-start';
  const nameJustify = isColumnLayout ? 'flex-start' : horizontalJustify;
  const clockTextAlign = isColumnLayout ? 'left' : effectiveTextAlign;

  const renderAvatarContent = () => (
    <Box position="relative" display="inline-flex" minH="60px">
      <Avatar
        size={avatarSize ?? 'md'}
        name={profile?.display_name ?? label}
        src={profile?.avatar_url ?? undefined}
      >
        {active ? <AvatarBadge boxSize="1.1em" bg={accentColor} borderColor="white" /> : null}
      </Avatar>
      <AnimatePresence initial={false}>
        {activeReactions.map((reaction, index) => {
          const normalized =
            typeof reaction.offset === 'number'
              ? Math.max(-0.6, Math.min(0.6, reaction.offset))
              : Math.max(
                  -0.6,
                  Math.min(0.6, (index / Math.max(activeReactions.length - 1, 1)) * 1.2 - 0.6),
                );
          const spread = isColumnLayout ? 14 : 24;
          const offsetPx = normalized * spread;
          const horizontalShift = !isColumnLayout && isRightAligned ? -offsetPx : offsetPx;
          const verticalTarget = isColumnLayout ? -60 : -70;
          const exitTarget = verticalTarget - 10;

          return (
            <MotionBox
              key={reaction.id}
              position="absolute"
              top={isColumnLayout ? undefined : '-12px'}
              bottom={isColumnLayout ? '8px' : undefined}
              left="50%"
              initial={{ opacity: 0, y: 0, scale: 0.9, x: -50 + horizontalShift }}
              animate={{
                opacity: [0, 1, 1, 0],
                y: verticalTarget,
                x: -50 + horizontalShift,
                scale: [1.15, 1, 1, 0.95],
              }}
              exit={{ opacity: 0, y: exitTarget, x: -50 + horizontalShift, scale: 0.8 }}
              transition={{ duration: 2.5, times: [0, 0.08, 0.82, 1], ease: 'easeOut' }}
              pointerEvents="none"
              zIndex={3}
            >
              <Text fontSize={emojiFontSize ?? '2xl'} textShadow="0 0 8px rgba(0,0,0,0.45)">
                {reaction.emoji}
              </Text>
            </MotionBox>
          );
        })}
      </AnimatePresence>
    </Box>
  );

  const shouldShowEmojiPicker = Boolean(showEmojiPicker && onSendEmoji);
  const shouldShowPingMenu = Boolean(showPingMenu && onPingOpponent);

  const avatarNode = shouldShowEmojiPicker ? (
    <Popover placement="bottom-start" closeOnBlur={false} closeOnEsc>
      <PopoverTrigger>
        <Box cursor="pointer">{renderAvatarContent()}</Box>
      </PopoverTrigger>
      <PopoverContent width="auto">
        <PopoverArrow />
        <PopoverBody px={2} py={2}>
          <Wrap spacing={1.5} justify="center" maxW="220px">
            {EMOJIS.map((emoji) => (
              <WrapItem key={emoji}>
                <Button
                  size="md"
                  variant="ghost"
                  fontSize="2xl"
                  px={2}
                  py={1}
                  onClick={() => {
                    onSendEmoji?.(emoji);
                  }}
                >
                  <span role="img" aria-label="emoji">
                    {emoji}
                  </span>
                </Button>
              </WrapItem>
            ))}
          </Wrap>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  ) : shouldShowPingMenu ? (
    <Popover placement="bottom-end" closeOnBlur closeOnEsc>
      <PopoverTrigger>
        <Box cursor={pingDisabled ? 'not-allowed' : 'pointer'} opacity={pingDisabled ? 0.75 : 1}>
          {renderAvatarContent()}
        </Box>
      </PopoverTrigger>
      <PopoverContent width="260px">
        <PopoverArrow />
        <PopoverBody px={3} py={3}>
          <Stack spacing={2}>
            <Text fontSize="sm" color={mutedText}>
              Send a gentle push notification if they left the game screen.
            </Text>
            <Button
              size="sm"
              colorScheme="teal"
              onClick={onPingOpponent}
              isDisabled={pingDisabled}
              isLoading={pingBusy}
            >
              {pingCooldownRemaining > 0 ? `Notify (${Math.ceil(pingCooldownRemaining / 1000)}s)` : 'Notify opponent'}
            </Button>
            {pingHelperText ? (
              <Text fontSize="xs" color={mutedText}>
                {pingHelperText}
              </Text>
            ) : null}
          </Stack>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  ) : (
    renderAvatarContent()
  );

  const nameRow = (
    <HStack spacing={1.5} align="center" justify={nameJustify} w="100%">
      <Text fontSize={labelFontSize ?? 'sm'} fontWeight="semibold" color={mutedText} noOfLines={1}>
        {label}
      </Text>
    </HStack>
  );

  const clockNode = (
    <Heading
      fontSize={clockFontSize ?? '2xl'}
      color={clockColor}
      fontFamily="mono"
      letterSpacing="tight"
      textAlign={clockTextAlign}
    >
      {clock}
    </Heading>
  );

  return (
    <Box
      ref={ref}
      flex="1 1 0"
      minW={{ base: '0', md: '220px' }}
      p={cardPadding ?? 3}
      borderRadius="xl"
      borderWidth="2px"
      borderColor={active ? accentColor : cardBorder}
      bg={active ? activeBg : inactiveBg}
      transition="all 0.3s ease"
      boxShadow={active ? `0 0 0 1px ${accentColor}` : 'none'}
      position="relative"
    >
      {isColumnLayout ? (
        <Stack spacing={2} w="100%" align="flex-start">
          <HStack spacing={3} align="center" justify="flex-start">
            {avatarNode}
            {clockNode}
          </HStack>
          {nameRow}
        </Stack>
      ) : (
        <Flex
          direction="row"
          align="center"
          justify="flex-start"
          gap={isRightAligned ? 2 : 3}
          w="100%"
          flexWrap="nowrap"
        >
          {avatarNode}
          <Stack spacing={1} align={alignItems} w="100%">
            {nameRow}
            {clockNode}
          </Stack>
        </Flex>
      )}
    </Box>
  );
}); // Closing for forwardRef

function NoActiveGamePrompt({ onNavigateToLobby }: { onNavigateToLobby?: () => void }) {
  const { cardBg, cardBorder, mutedText } = useSurfaceTokens();
  return (
    <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder} w="100%">
      <CardBody>
        <Center py={20}>
          <Stack spacing={4} align="center" textAlign="center">
            <Heading size="md">No active game</Heading>
            <Text color={mutedText}>Visit the Lobby tab to find or create a match.</Text>
            {onNavigateToLobby && (
              <Button colorScheme="teal" variant="solid" onClick={onNavigateToLobby}>
                Open lobby
              </Button>
            )}
          </Stack>
        </Center>
      </CardBody>
    </Card>
  );
}

function CancelledMatchPrompt({
  onCreateNewMatch,
  onNavigateToLobby,
}: {
  onCreateNewMatch: () => void;
  onNavigateToLobby: () => void;
}) {
  const { cardBg, cardBorder, mutedText, accentHeading } = useSurfaceTokens();
  return (
    <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder} w="100%">
      <CardBody>
        <Center py={20}>
          <Stack spacing={5} align="center" textAlign="center" maxW="lg">
            <Stack spacing={2}>
              <Heading size="md" color={accentHeading}>
                Match cancelled
              </Heading>
              <Text color={mutedText}>
                You’re back in the lobby. Create a fresh game or browse other matches when you’re ready.
              </Text>
            </Stack>
            <ButtonGroup size="sm" variant="solid">
              <Button colorScheme="teal" onClick={onCreateNewMatch}>
                Create new match
              </Button>
              <Button variant="outline" onClick={onNavigateToLobby}>
                Open lobby
              </Button>
            </ButtonGroup>
          </Stack>
        </Center>
      </CardBody>
    </Card>
  );
}

function WaitingForOpponentState({
  match,
  joinCode,
  canCancel = false,
  onCancel,
  isCancelling = false,
}: {
  match: LobbyMatch;
  joinCode: string | null;
  canCancel?: boolean;
  onCancel?: () => void;
  isCancelling?: boolean;
}) {
  const { cardBg, cardBorder, mutedText, accentHeading } = useSurfaceTokens();
  const codeHighlightBg = useColorModeValue('teal.50', 'teal.900');
  const codeHighlightBorder = useColorModeValue('teal.200', 'teal.700');
  const shareableJoinCode = match.private_join_code ?? joinCode ?? null;
  const joinKey = shareableJoinCode ?? match.id;
  const joinLink = joinKey ? buildMatchJoinLink(joinKey) : '';
  const { hasCopied: hasCopiedLink, onCopy: onCopyLink } = useClipboard(joinLink);
  const hasJoinCode = Boolean(shareableJoinCode);
  const hasJoinLink = Boolean(joinLink);
  const toast = useToast();
  const [sharing, setSharing] = useState(false);

  const handleShare = useCallback(async () => {
    if (!hasJoinLink) {
      return;
    }
    setSharing(true);
    await shareMatchInvite({
      joinLink,
      joinKey,
      toast,
      fallbackCopy: onCopyLink,
    });
    setSharing(false);
  }, [hasJoinLink, joinLink, joinKey, onCopyLink, toast]);

  // Build match badges
  const badges: Array<{ label: string; colorScheme: string; tooltip?: string }> = [
    {
      label: 'Pending',
      colorScheme: 'yellow',
      tooltip: 'Waiting for an opponent to join',
    },
    {
      label: match.rated ? 'Rated' : 'Casual',
      colorScheme: match.rated ? 'purple' : 'gray',
      tooltip: match.rated ? 'This match affects ladder ratings' : 'No rating impact',
    },
  ];

  if (match.clock_initial_seconds > 0 || match.clock_increment_seconds > 0) {
    const minutes = Math.max(1, Math.round(match.clock_initial_seconds / 60));
    badges.push({
      label: `${minutes}+${match.clock_increment_seconds}`,
      colorScheme: 'teal',
      tooltip: 'Time control (minutes + increment)',
    });
  } else {
    badges.push({
      label: 'No clock',
      colorScheme: 'gray',
      tooltip: 'Unlimited time',
    });
  }

  badges.push({
    label: match.visibility === 'public' ? 'Public' : 'Private',
    colorScheme: match.visibility === 'public' ? 'green' : 'orange',
    tooltip: match.visibility === 'public' ? 'Visible in public lobbies' : 'Invite only',
  });

  const hostName = match.creator?.display_name ?? 'You';
  const createdTime = match.created_at
    ? new Date(match.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  
  return (
    <Box
      borderWidth="1px"
      borderColor={cardBorder}
      borderRadius="xl"
      bg={cardBg}
      overflow="hidden"
      transition="border-color 0.2s ease, box-shadow 0.2s ease"
      _hover={{ borderColor: 'teal.400', boxShadow: 'lg' }}
    >
      {/* Header with spinner accent */}
      <Box
        px={5}
        py={4}
        borderBottomWidth="1px"
        borderBottomColor={cardBorder}
        position="relative"
        overflow="hidden"
      >
        <HStack spacing={4}>
          <Box position="relative">
            <Avatar
              name={hostName}
              src={match.creator?.avatar_url ?? undefined}
              size="lg"
              borderWidth="3px"
              borderColor="teal.400"
            />
            <Box
              position="absolute"
              bottom="-2px"
              right="-2px"
              bg={cardBg}
              borderRadius="full"
              p="2px"
            >
              <Spinner size="xs" color="teal.400" thickness="2px" speed="1s" />
            </Box>
          </Box>
          <Stack spacing={1} flex="1" minW={0}>
            <Text fontSize="xs" fontWeight="semibold" color={mutedText} textTransform="uppercase" letterSpacing="0.08em">
              Your Match
            </Text>
            <Heading size="md" color={accentHeading} isTruncated>
              Waiting for opponent
            </Heading>
            <Text fontSize="sm" color={mutedText}>
              {match.visibility === 'public'
                ? 'Listed in public lobbies — anyone can join'
                : 'Share the code below to invite a friend'}
            </Text>
          </Stack>
        </HStack>
      </Box>

      {/* Join Code Section */}
      {hasJoinCode && (
        <Box
          px={5}
          py={4}
          bg={codeHighlightBg}
          borderBottomWidth="1px"
          borderBottomColor={codeHighlightBorder}
        >
          <Flex
            direction={{ base: 'column', sm: 'row' }}
            align={{ base: 'stretch', sm: 'center' }}
            justify="space-between"
            gap={3}
          >
            <Stack spacing={0} flex="1">
              <Text fontSize="xs" fontWeight="semibold" color={mutedText} textTransform="uppercase" letterSpacing="0.05em">
                Join Code
              </Text>
              <Text
                fontSize="2xl"
                fontWeight="bold"
                fontFamily="mono"
                letterSpacing="0.15em"
                color={accentHeading}
              >
                {shareableJoinCode}
              </Text>
            </Stack>
            <Wrap spacing={2} justify={{ base: 'flex-start', sm: 'flex-end' }}>
              <WrapItem>
                <Tooltip label={hasCopiedLink ? 'Copied!' : 'Copy invite link to clipboard'} hasArrow>
                  <Button
                    size="sm"
                    variant="outline"
                    colorScheme={hasCopiedLink ? 'teal' : 'gray'}
                    onClick={onCopyLink}
                    isDisabled={!hasJoinLink}
                  >
                    {hasCopiedLink ? 'Link copied' : 'Copy link'}
                  </Button>
                </Tooltip>
              </WrapItem>
              <WrapItem>
                <Tooltip label="Share via system share sheet" hasArrow>
                  <Button
                    size="sm"
                    colorScheme="teal"
                    leftIcon={<MdShare />}
                    onClick={() => void handleShare()}
                    isLoading={sharing}
                    isDisabled={!hasJoinLink || sharing}
                  >
                    Share
                  </Button>
                </Tooltip>
              </WrapItem>
            </Wrap>
          </Flex>
        </Box>
      )}

      {/* Badges and Meta */}
      <Box px={5} py={4}>
        <Stack spacing={4}>
          <Wrap spacing={2}>
            {badges.map((badge, idx) => (
              <WrapItem key={idx}>
                <Tooltip label={badge.tooltip} hasArrow isDisabled={!badge.tooltip}>
                  <Badge
                    colorScheme={badge.colorScheme}
                    variant="subtle"
                    borderRadius="full"
                    px={3}
                    py={1}
                    fontSize="xs"
                    fontWeight="semibold"
                  >
                    {badge.label}
                  </Badge>
                </Tooltip>
              </WrapItem>
            ))}
          </Wrap>

          <Text fontSize="xs" color={mutedText}>
            Hosted by {hostName}
            {createdTime && ` • Created at ${createdTime}`}
          </Text>

          {canCancel && onCancel && (
            <Flex justify="flex-end">
              <Tooltip label="Cancel this match to create a new one" hasArrow>
                <Button
                  size="sm"
                  colorScheme="red"
                  variant="ghost"
                  onClick={onCancel}
                  isLoading={isCancelling}
                >
                  Cancel match
                </Button>
              </Tooltip>
            </Flex>
          )}
        </Stack>
      </Box>
    </Box>
  );
}

function GamePlayWorkspace({
  auth,
  onNavigateToLobby,
  onNavigateToAnalysis,
}: {
  auth: SupabaseAuthState;
  onNavigateToLobby: () => void;
  onNavigateToAnalysis: (jobId?: string) => void;
}) {
  const lobby = useMatchLobbyContext();
  const workspaceToast = useToast();
  const { cardBg, cardBorder, mutedText, accentHeading } = useSurfaceTokens();
  const currentProfileId = auth.profile?.id ?? null;
  const completionToastKeyRef = useRef<string | null>(null);
  const autoAnalysisMatchRef = useRef<string | null>(null);
  const creatorCardRef = useRef<HTMLDivElement>(null);
  const opponentCardRef = useRef<HTMLDivElement>(null);
  const { jobs, startJob } = useEvaluationJobs();
  const rematchOffers = useMemo(
    () =>
      Object.values(lobby.rematchOffers ?? {}).filter((offer): offer is LobbyMatch => Boolean(offer)),
    [lobby.rematchOffers],
  );
  const [joiningRematchId, setJoiningRematchId] = useState<string | null>(null);
  const [cancellingActiveMatch, setCancellingActiveMatch] = useBoolean(false);
  const [requestingSummaryRematch, setRequestingSummaryRematch] = useBoolean(false);
  const [showLocalMigrationNotice, setShowLocalMigrationNotice] = useState(false);
  const [lastCancelledMatchId, setLastCancelledMatchId] = useState<string | null>(null);
  const myRole = lobby.activeRole;
  const canSendEmoji = Boolean(lobby.activeMatch && lobby.sessionMode === 'online' && myRole);
  const activeMatchSummary = useMemo(() => {
    if (lobby.sessionMode !== 'online') {
      return null;
    }
    const match = lobby.activeMatch;
    if (!match) {
      return null;
    }
    const playerZeroRole = getPlayerZeroRole(match);
    const greenRole = playerZeroRole;
    const redRole = getOppositeRole(playerZeroRole);
    const summaryIsAiMatch = detectAiMatch(match);
    const fallbackOpponentName = summaryIsAiMatch ? 'Santorini AI' : 'Opponent';
    const creatorFallback = playerZeroRole === 'creator' ? 'Player 1 (Green)' : 'Player 1 (Red)';
    const opponentFallback = playerZeroRole === 'opponent' ? 'Player 2 (Green)' : 'Player 2 (Red)';
    const creatorLabel = formatNameWithRating(match.creator, match.creator?.display_name ?? creatorFallback);
    const opponentLabel = formatNameWithRating(match.opponent, match.opponent?.display_name ?? opponentFallback);
    const moveCount = lobby.moves.filter(
      (move) => (move.action as SantoriniMoveAction | undefined)?.kind === 'santorini.move',
    ).length;
    const clockLabel =
      match.clock_initial_seconds > 0
        ? `${Math.round(match.clock_initial_seconds / 60)}+${match.clock_increment_seconds}`
        : null;
    const startingRole = deriveStartingRole(match.initial_state);
    const greenName =
      greenRole === 'creator'
        ? match.creator?.display_name ?? 'Creator'
        : match.opponent?.display_name ?? fallbackOpponentName;
    const redName =
      redRole === 'creator'
        ? match.creator?.display_name ?? 'Creator'
        : match.opponent?.display_name ?? fallbackOpponentName;
    const startingLabel = startingRole
      ? `${startingRole === greenRole ? 'Green' : 'Red'} – ${startingRole === greenRole ? greenName : redName} moves first`
      : null;
    const aiDepth = summaryIsAiMatch ? getMatchAiDepth(match) ?? 200 : null;
    return {
      vsLabel: `${creatorLabel} vs ${opponentLabel}`,
      aiDepth,
      ratedLabel: match.rated ? 'Rated' : 'Casual',
      moveCount,
      clockLabel,
      joinCode: match.private_join_code ?? null,
      startingBadge: startingLabel && startingRole
        ? {
            label: startingLabel,
            colorScheme: startingRole === greenRole ? 'green' : 'red',
          }
        : null,
    };
  }, [lobby.activeMatch, lobby.moves, lobby.sessionMode]);
  const creatorReactions = useMemo(() => {
    const match = lobby.activeMatch;
    if (!match) {
      return [] as EmojiReaction[];
    }
    return lobby.emojiReactions.filter((reaction) => {
      if (reaction.matchId !== match.id) {
        return false;
      }
      if (reaction.role === 'creator') {
        return true;
      }
      if (!reaction.role) {
        return reaction.playerId === match.creator_id;
      }
      return false;
    });
  }, [lobby.activeMatch, lobby.emojiReactions]);

  const opponentReactions = useMemo(() => {
    const match = lobby.activeMatch;
    if (!match) {
      return [] as EmojiReaction[];
    }
    return lobby.emojiReactions.filter((reaction) => {
      if (reaction.matchId !== match.id) {
        return false;
      }
      if (reaction.role === 'opponent') {
        return true;
      }
      if (!reaction.role) {
        return reaction.playerId === match.opponent_id;
      }
      return false;
    });
  }, [lobby.activeMatch, lobby.emojiReactions]);

  const handleSendEmoji = useCallback(
    (emoji: string) => {
      void lobby.sendEmojiReaction(emoji);
    },
    [lobby],
  );

  const autoAnalyzeEnabled = auth.profile?.auto_analyze_games ?? false;
  const autoAnalyzeDepth = auth.profile?.auto_analyze_depth ?? 800;
  const resolvedAutoAnalyzeDepth = useMemo(
    () => Math.max(1, Math.round(Number(autoAnalyzeDepth) || 800)),
    [autoAnalyzeDepth],
  );

  useEffect(() => {
    if (!auth.profile) {
      return;
    }
    const hasOnlineActivity = lobby.myMatches.some(
      (match) => match.status === 'in_progress' || match.status === 'waiting_for_opponent',
    );
    if (hasOnlineActivity && lobby.sessionMode !== 'online') {
      lobby.enableOnline();
    }
  }, [auth.profile, lobby.enableOnline, lobby.myMatches, lobby.sessionMode]);

  const handleAcceptRematch = useCallback(
    async (matchId: string) => {
      setJoiningRematchId(matchId);
      try {
        await lobby.acceptRematch(matchId);
        workspaceToast({ title: 'Joined rematch', status: 'success', duration: 3000 });
      } catch (error) {
        workspaceToast({
          title: 'Unable to join rematch',
          status: 'error',
          description: error instanceof Error ? error.message : 'Please try again.',
        });
      } finally {
        setJoiningRematchId((current) => (current === matchId ? null : current));
      }
    },
    [lobby, workspaceToast],
  );

  const handleDismissRematch = useCallback(
    (matchId: string) => {
      lobby.dismissRematch(matchId);
    },
    [lobby],
  );

  useEffect(() => {
    if (lobby.activeMatch) {
      setLastCancelledMatchId(null);
    }
  }, [lobby.activeMatch]);

  const handleCancelWaitingMatch = useCallback(async () => {
    const match = lobby.activeMatch;
    if (!match || match.status !== 'waiting_for_opponent') {
      return;
    }
    setCancellingActiveMatch.on();
    try {
      await lobby.leaveMatch(match.id);
      setLastCancelledMatchId(match.id);
      workspaceToast({
        title: 'Match cancelled',
        status: 'info',
        description: 'The lobby is clear. Start a new game whenever you like.',
      });
    } catch (error) {
      workspaceToast({
        title: 'Unable to cancel match',
        status: 'error',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setCancellingActiveMatch.off();
    }
  }, [lobby, setCancellingActiveMatch, workspaceToast]);

  const handleNavigateToLobby = useCallback(() => {
    setLastCancelledMatchId(null);
    onNavigateToLobby();
  }, [onNavigateToLobby]);

  const handleCreateNewMatchFromPlay = useCallback(() => {
    setLastCancelledMatchId(null);
    scheduleAutoOpenCreate();
    onNavigateToLobby();
  }, [onNavigateToLobby]);
  const sessionMode = lobby.sessionMode ?? 'online';
  const activeOnlineMatchId = sessionMode === 'online' && lobby.activeMatch ? lobby.activeMatch.id : null;
  useMatchVisibilityReporter(activeOnlineMatchId);
  useEffect(() => {
    if (sessionMode !== 'online') {
      completionToastKeyRef.current = null;
      return;
    }
    const completed = lobby.lastCompletedMatch;
    if (!completed) {
      return;
    }
    if (completed.status !== 'completed' && completed.status !== 'abandoned') {
      return;
    }
    if (!currentProfileId) {
      return;
    }
    const key = `${completed.id}:${completed.status}:${completed.winner_id ?? 'null'}`;
    if (completionToastKeyRef.current === key) {
      return;
    }
    completionToastKeyRef.current = key;

    const isParticipant =
      currentProfileId === completed.creator_id || currentProfileId === completed.opponent_id;
    if (!isParticipant) {
      return;
    }

    const winnerId = completed.winner_id ?? null;
    const winnerName =
      winnerId === completed.creator_id
        ? completed.creator?.display_name ?? 'Player 1'
        : winnerId === completed.opponent_id
          ? completed.opponent?.display_name ?? 'Player 2'
          : null;
    const opponentId =
      currentProfileId === completed.creator_id ? completed.opponent_id : completed.creator_id;
    const opponentName =
      opponentId === completed.creator_id
        ? completed.creator?.display_name ?? 'Player 1'
        : opponentId === completed.opponent_id
          ? completed.opponent?.display_name ?? 'Player 2'
          : 'Opponent';

    if (completed.status === 'abandoned') {
      if (!winnerId) {
        return;
      }
      if (winnerId === currentProfileId) {
        workspaceToast({
          title: 'Win by resignation',
          description: opponentName ? `${opponentName} resigned.` : 'Your opponent resigned.',
          status: 'success',
          duration: 5000,
        });
      } else {
        workspaceToast({
          title: 'You resigned',
          description: winnerName
            ? `${winnerName} wins by resignation.`
            : 'Your opponent wins by resignation.',
          status: 'warning',
          duration: 5000,
        });
      }
      return;
    }

    if (!winnerId) {
      workspaceToast({
        title: 'Game drawn',
        description: 'The game ended in a draw.',
        status: 'info',
        duration: 5000,
      });
      return;
    }

    if (winnerId === currentProfileId) {
      workspaceToast({
        title: 'Victory!',
        description: opponentName ? `You defeated ${opponentName}.` : 'You won the game.',
        status: 'success',
        duration: 5000,
      });
    } else {
      workspaceToast({
        title: 'Defeat',
        description: winnerName ? `${winnerName} won the game.` : 'Your opponent won the game.',
        status: 'warning',
        duration: 5000,
      });
    }
  }, [currentProfileId, lobby.lastCompletedMatch, sessionMode, workspaceToast]);

  useEffect(() => {
    if (!autoAnalyzeEnabled) {
      return;
    }
    // Note: Don't gate on sessionMode here - when a game ends via resignation,
    // sessionMode may become null before this effect runs, but we still want
    // to trigger auto-analysis for the completed match.
    if (!supabase) {
      return;
    }
    const completed = lobby.lastCompletedMatch;
    if (!completed) {
      return;
    }
    const finished = completed.status === 'completed' || completed.status === 'abandoned';
    if (!finished) {
      return;
    }
    if (!currentProfileId) {
      return;
    }
    const participated =
      currentProfileId === completed.creator_id || currentProfileId === completed.opponent_id;
    if (!participated) {
      return;
    }
    const matchLabel = describeMatch(completed, auth.profile ?? null);
    const jobKey = `${completed.id}:${completed.updated_at ?? completed.status}`;
    if (autoAnalysisMatchRef.current === jobKey) {
      return;
    }
    const existingJob = Object.values(jobs).some(
      (job) =>
        job.matchId === completed.id &&
        (job.status === 'queued' || job.status === 'running' || job.status === 'success'),
    );
    if (existingJob) {
      autoAnalysisMatchRef.current = jobKey;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { match, moves } = await fetchMatchWithMoves(supabase, completed.id);
        if (cancelled) return;
        await startJob({
          match,
          moves,
          minMoveIndex: MIN_EVAL_MOVE_INDEX,
          depth: resolvedAutoAnalyzeDepth,
          enginePreference: auth.profile?.engine_preference ?? 'rust',
          matchLabel,
        });
        autoAnalysisMatchRef.current = jobKey;
        showEvaluationStartedToast(workspaceToast, {
          matchLabel,
          depth: resolvedAutoAnalyzeDepth,
          mode: 'auto',
          toastId: `auto-analysis-${completed.id}`,
        });
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to auto-start analysis', error);
        workspaceToast({
          title: 'Auto analysis failed',
          status: 'error',
          description: error instanceof Error ? error.message : 'Unable to start analysis automatically.',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    auth.profile,
    autoAnalyzeEnabled,
    currentProfileId,
    jobs,
    lobby.lastCompletedMatch,
    resolvedAutoAnalyzeDepth,
    supabase,
    startJob,
    workspaceToast,
  ]);
  const { activeMatchId, clearUndoRequest, undoRequests } = lobby;
  const activeUndoState = activeMatchId ? undoRequests[activeMatchId] : undefined;

  const handleClearUndoState = useCallback(() => {
    if (activeMatchId) {
      clearUndoRequest(activeMatchId);
    }
  }, [activeMatchId, clearUndoRequest]);

  useEffect(() => {
    if (lobby.sessionMode === 'local') {
      setShowLocalMigrationNotice(true);
      lobby.enableOnline();
    }
  }, [lobby.enableOnline, lobby.sessionMode]);

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const handleReaction = (
      reactions: EmojiReaction[],
      cardRef: React.RefObject<HTMLDivElement>,
      isSelf: boolean,
    ) => {
      // Only scroll if there's a new reaction and it's not from ourselves
      if (reactions.length > 0 && !isSelf) {
        // Debounce to prevent rapid scrolling if many emojis arrive at once
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          const cardElement = cardRef.current;
          if (cardElement) {
            const rect = cardElement.getBoundingClientRect();
            // Check if the element is outside the viewport vertically
            const isOutsideViewport = rect.top < 0 || rect.bottom > (window.innerHeight || document.documentElement.clientHeight);

            if (isOutsideViewport) {
              cardElement.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
              });
            }
          }
        }, PLAYER_REACTION_SCROLL_DEBOUNCE_MS);
      }
    };

    // Handle creator reactions (if current user is opponent)
    if (lobby.activeRole === 'opponent') {
      handleReaction(creatorReactions, creatorCardRef, false);
    }
    // Handle opponent reactions (if current user is creator)
    if (lobby.activeRole === 'creator') {
      handleReaction(opponentReactions, opponentCardRef, false);
    }

    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  }, [creatorReactions, opponentReactions, lobby.activeRole]);

  // Check if we have an active online game or waiting
  const hasActiveMatch = sessionMode === 'online' && lobby.activeMatch;
  const isWaitingForOpponent = hasActiveMatch && lobby.activeMatch?.status === 'waiting_for_opponent';
  const isInProgress = hasActiveMatch && lobby.activeMatch?.status === 'in_progress';
  const canCancelWaitingMatch = Boolean(
    isWaitingForOpponent &&
    lobby.activeRole === 'creator' &&
    lobby.activeMatch &&
    !lobby.activeMatch.opponent_id
  );

  const activeCompletedMatch =
    sessionMode === 'online' &&
    lobby.activeMatch &&
    (lobby.activeMatch.status === 'completed' || lobby.activeMatch.status === 'abandoned')
      ? lobby.activeMatch
      : null;

  const completedMatch =
    sessionMode === 'online' && !isInProgress
      ? activeCompletedMatch
        ?? (lobby.lastCompletedMatch &&
            (lobby.lastCompletedMatch.status === 'completed' || lobby.lastCompletedMatch.status === 'abandoned')
              ? lobby.lastCompletedMatch
              : null)
      : null;

  const latestAnalysisJobForCompletedMatch = useMemo(() => {
    if (!completedMatch) {
      return null;
    }
    const candidates = Object.values(jobs).filter((job) => job.matchId === completedMatch.id);
    if (candidates.length === 0) {
      return null;
    }
    return candidates.reduce((latest, job) => (job.updatedAt > latest.updatedAt ? job : latest));
  }, [completedMatch, jobs]);

  const handleRequestSummaryRematch = useCallback(async () => {
    setRequestingSummaryRematch.on();
    try {
      const rematch = await lobby.offerRematch();
      if (rematch) {
        workspaceToast({
          title: 'Rematch created',
          description: rematch.private_join_code
            ? `Share code ${rematch.private_join_code} if needed.`
            : 'Waiting for your opponent to join…',
          status: 'success',
          duration: 4000,
        });
      }
    } catch (error) {
      workspaceToast({
        title: 'Unable to create rematch',
        status: 'error',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setRequestingSummaryRematch.off();
    }
  }, [lobby, setRequestingSummaryRematch, workspaceToast]);

  const handlePrepareAnalyze = useCallback((match: LobbyMatch | null) => {
    if (!match) {
      return;
    }
    try {
      rememberLastAnalyzedMatch(match.id);
    } catch (error) {
      console.warn('Unable to store last analyzed match', error);
    }
    workspaceToast({
      title: 'Opening Analysis tab',
      description: 'Loading the completed game for review.',
      status: 'success',
      duration: 3000,
    });
    onNavigateToAnalysis();
  }, [onNavigateToAnalysis, workspaceToast]);

  const handleNavigateToAnalysisJob = useCallback(
    (job: EvaluationJob | null) => {
      if (!job) {
        return;
      }
      rememberLastAnalyzedMatch(job.matchId);
      onNavigateToAnalysis(job.id);
    },
    [onNavigateToAnalysis],
  );

  return (
    <Stack spacing={6} py={{ base: 6, md: 10 }}>
      {/* Active match summary */}
      <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder}>
        <CardBody py={3}>
          {activeMatchSummary ? (
            <Wrap
              spacing={3}
              align="center"
              justify={{ base: 'flex-start', md: 'flex-end' }}
              flex="1"
              w="100%"
            >
              <WrapItem>
                <Text fontSize="sm" fontWeight="semibold" color={accentHeading}>
                  {activeMatchSummary.vsLabel}
                </Text>
              </WrapItem>
              {activeMatchSummary.joinCode && (
                <WrapItem>
                  <Badge colorScheme="orange" fontSize="xs" wordBreak="break-word" whiteSpace="normal">
                    Code: {activeMatchSummary.joinCode}
                  </Badge>
                </WrapItem>
              )}
              {activeMatchSummary.aiDepth != null && (
                <WrapItem>
                  <Badge colorScheme="pink" fontSize="xs">
                    Depth {activeMatchSummary.aiDepth}
                  </Badge>
                </WrapItem>
              )}
              <WrapItem>
                <Badge colorScheme={activeMatchSummary.ratedLabel === 'Rated' ? 'purple' : 'gray'} fontSize="xs">
                  {activeMatchSummary.ratedLabel}
                </Badge>
              </WrapItem>
              {activeMatchSummary.clockLabel && (
                <WrapItem>
                  <Badge colorScheme="green" fontSize="xs">
                    {activeMatchSummary.clockLabel}
                  </Badge>
                </WrapItem>
              )}
              {activeMatchSummary.startingBadge && (
                <WrapItem>
                  <Badge colorScheme={activeMatchSummary.startingBadge.colorScheme} fontSize="xs">
                    {activeMatchSummary.startingBadge.label}
                  </Badge>
                </WrapItem>
              )}
              <WrapItem>
                <Text fontSize="xs" color={mutedText}>
                  {activeMatchSummary.moveCount} moves
                </Text>
              </WrapItem>
            </Wrap>
          ) : (
            !auth.profile && (
              <Text fontSize="xs" color="orange.500">
                Sign in to play online
              </Text>
            )
          )}
        </CardBody>
      </Card>

      {sessionMode === 'online' && rematchOffers.map((offer) => {
        const opponentName = offer.creator?.display_name ?? 'Opponent';
        const joinCode = offer.private_join_code;
        return (
          <Alert
            key={offer.id}
            status="info"
            variant="left-accent"
            borderRadius="md"
            alignItems="center"
            w="full"
            maxW="full"
          >
            <AlertIcon />
            <Flex
              direction={{ base: 'column', md: 'row' }}
              gap={{ base: 3, md: 4 }}
              flex="1"
              align={{ base: 'flex-start', md: 'center' }}
              flexWrap="wrap"
              w="100%"
            >
              <Stack spacing={1} flex="1">
                <AlertTitle>Rematch available</AlertTitle>
                <AlertDescription>
                  {opponentName} created a rematch{joinCode ? ` • Join code ${joinCode}` : ''}.
                </AlertDescription>
              </Stack>
              <ButtonGroup size="sm" alignSelf={{ base: 'stretch', md: 'center' }} flexWrap="wrap" justifyContent="flex-end">
                <Button
                  colorScheme="teal"
                  onClick={() => handleAcceptRematch(offer.id)}
                  isLoading={joiningRematchId === offer.id}
                >
                  Join rematch
                </Button>
                <Button variant="outline" onClick={() => handleDismissRematch(offer.id)}>
                  Dismiss
                </Button>
              </ButtonGroup>
            </Flex>
          </Alert>
        );
      })}

      {sessionMode === 'online' && latestAnalysisJobForCompletedMatch && (
        <AnalysisJobBanner
          job={latestAnalysisJobForCompletedMatch}
          onNavigateToAnalysis={() => handleNavigateToAnalysisJob(latestAnalysisJobForCompletedMatch)}
        />
      )}

      {sessionMode === 'online' && completedMatch && (
        <CompletedMatchSummary
          match={completedMatch}
          profileId={auth.profile?.id ?? null}
          onRequestRematch={handleRequestSummaryRematch}
          rematchLoading={requestingSummaryRematch}
          onPrepareAnalyze={handlePrepareAnalyze}
        />
      )}

      {/* Local mode deprecated */}
      {showLocalMigrationNotice && (
        <Alert
          status="info"
          borderRadius="md"
          variant="left-accent"
          position="relative"
          pr={8}
          w="full"
          maxW="full"
        >
          <AlertIcon />
          <Flex align={{ base: 'flex-start', md: 'center' }} direction={{ base: 'column', md: 'row' }} gap={4} w="100%">
            <Stack spacing={1} flex="1">
              <AlertTitle>Local games moved</AlertTitle>
              <AlertDescription>
                Use the Practice tab and set the opponent to Human vs Human for same-device play. Your current
                local session has been paused.
              </AlertDescription>
            </Stack>
            <CloseButton
              size="sm"
              position="absolute"
              top={2}
              right={2}
              onClick={() => setShowLocalMigrationNotice(false)}
            />
          </Flex>
        </Alert>
      )}

      {/* Waiting for Opponent State */}
      {sessionMode === 'online' && isWaitingForOpponent && lobby.activeMatch && (
        <WaitingForOpponentState 
          match={lobby.activeMatch}
          joinCode={lobby.joinCode}
          canCancel={canCancelWaitingMatch}
          onCancel={canCancelWaitingMatch ? handleCancelWaitingMatch : undefined}
          isCancelling={cancellingActiveMatch}
        />
      )}

      {/* Active Game In Progress */}
      {sessionMode === 'online' && isInProgress && (
        <SantoriniProvider
          evaluationEnabled={false}
          enginePreference={auth.profile?.engine_preference ?? 'rust'}
          persistState={false}
        >
          <ActiveMatchContent
            match={lobby.activeMatch}
            role={lobby.activeRole}
            moves={lobby.moves}
            joinCode={lobby.joinCode}
            onSubmitMove={lobby.submitMove}
            onLeave={lobby.leaveMatch}
            onGameComplete={lobby.updateMatchStatus}
            undoState={activeUndoState}
            onRequestUndo={lobby.requestUndo}
          onRespondUndo={lobby.respondUndo}
          onClearUndo={handleClearUndoState}
          profileId={auth.profile?.id ?? null}
          connectionStates={lobby.connectionStates}
          currentUserId={auth.profile?.id ?? null}
          creatorReactions={creatorReactions}
          opponentReactions={opponentReactions}
          canSendEmoji={canSendEmoji}
          onSendEmoji={handleSendEmoji}
          onPingOpponent={lobby.pingOpponent}
          enginePreference={auth.profile?.engine_preference ?? 'rust'}
          creatorCardRef={creatorCardRef}
          opponentCardRef={opponentCardRef}
        />
        </SantoriniProvider>
      )}

      {/* No Active Game */}
      {sessionMode === 'online' && !hasActiveMatch && (
        lastCancelledMatchId ? (
          <CancelledMatchPrompt
            onCreateNewMatch={handleCreateNewMatchFromPlay}
            onNavigateToLobby={handleNavigateToLobby}
          />
        ) : (
          <NoActiveGamePrompt onNavigateToLobby={handleNavigateToLobby} />
        )
      )}
    </Stack>
  );
}

export default GamePlayWorkspace;
