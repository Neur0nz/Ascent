import {
  ElementType,
  ReactNode,
  ButtonHTMLAttributes,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Avatar,
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
  FormControl,
  FormLabel,
  FormHelperText,
  Heading,
  HStack,
  Icon,
  Input,
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
  Spinner,
  Stack,
  Switch,
  Tag,
  Text,
  Tooltip,
  Wrap,
  WrapItem,
  useDisclosure,
  useToast,
  useBoolean,
  useClipboard,
  useColorModeValue,
} from '@chakra-ui/react';
import type { TagProps } from '@chakra-ui/react';
import { motion } from 'framer-motion';
import { AddIcon, ArrowForwardIcon, LockIcon, RepeatIcon, SearchIcon, StarIcon, TimeIcon, ViewIcon } from '@chakra-ui/icons';
import type { SupabaseAuthState } from '@hooks/useSupabaseAuth';
import type { CreateMatchPayload, LobbyMatch, StartingPlayer, MatchOpponentType } from '@hooks/useMatchLobby';
import type { MatchStatus } from '@/types/match';
import { useMatchLobbyContext } from '@hooks/matchLobbyContext';
import GoogleIcon from '@components/auth/GoogleIcon';
import { useSurfaceTokens } from '@/theme/useSurfaceTokens';
import { buildMatchJoinLink } from '@/utils/joinLinks';
import { PENDING_JOIN_STORAGE_KEY, consumeAutoOpenCreateFlag } from '@/utils/lobbyStorage';
import { useBrowserNotifications } from '@hooks/useBrowserNotifications';
import { usePushSubscription } from '@hooks/usePushSubscription';

const ALLOW_ONLINE_AI_MATCHES = false;
const MotionCard = motion(Card);
const MotionButton = motion(Button);
const MotionTag = motion(
  forwardRef<HTMLButtonElement, TagProps & ButtonHTMLAttributes<HTMLButtonElement>>((props, ref) => (
    <Tag ref={ref} {...props} />
  )),
);
const heroEntrance = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, ease: 'easeOut' },
};
const heroButtonSpring = { type: 'spring', stiffness: 280, damping: 28 };

function formatDate(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const NOTIFICATION_PROMPT_STORAGE_KEY = 'santorini:notificationsPrompted';

function ActiveGameNotice({ 
  match, 
  onNavigateToPlay 
}: { 
  match: LobbyMatch; 
  onNavigateToPlay: () => void;
}) {
  const { cardBorder } = useSurfaceTokens();
  const isWaiting = match.status === 'waiting_for_opponent';
  const joinKey = match.private_join_code ?? match.id;
  const joinLink = buildMatchJoinLink(joinKey);
  const { hasCopied, onCopy } = useClipboard(joinLink);
  const hasShareLink = isWaiting && Boolean(joinKey);
  
  const opponentName = match.opponent?.display_name || 'an opponent';
  
  return (
    <Alert 
      status="info" 
      variant="left-accent" 
      borderRadius="md"
      borderWidth="1px"
      borderColor={cardBorder}
    >
      <AlertIcon />
      <Stack spacing={1} flex="1">
        <AlertTitle>
          {isWaiting ? 'Waiting for opponent' : 'Game in progress'}
        </AlertTitle>
        <AlertDescription>
          {isWaiting 
            ? 'Your game is waiting for an opponent to join. You cannot create new games until this one starts or is cancelled.'
            : `You're playing against ${opponentName}. Finish this game before starting a new one.`
          }
        </AlertDescription>
      </Stack>
      <ButtonGroup size="sm" variant="solid">
        {hasShareLink && (
          <Tooltip label="Copy a link to share with your opponent" hasArrow>
            <Button
              variant="outline"
              onClick={onCopy}
              colorScheme={hasCopied ? 'teal' : 'gray'}
            >
              {hasCopied ? 'Link copied' : 'Copy invite link'}
            </Button>
          </Tooltip>
        )}
        <Button 
          colorScheme="teal" 
          onClick={onNavigateToPlay}
          rightIcon={<ArrowForwardIcon />}
        >
          {isWaiting ? 'View game' : 'Continue game'}
        </Button>
      </ButtonGroup>
    </Alert>
  );
}

function LobbyHero({
  onQuickMatch,
  quickMatchLoading,
  onOpenCreate,
  onOpenJoin,
  onNavigateToPractice,
  onNavigateToAnalysis,
  onNavigateToLeaderboard,
  hasActiveGame,
}: {
  onQuickMatch: () => Promise<void>;
  quickMatchLoading: boolean;
  onOpenCreate: () => void;
  onOpenJoin: () => void;
  onNavigateToPractice?: () => void;
  onNavigateToAnalysis?: () => void;
  onNavigateToLeaderboard?: () => void;
  hasActiveGame: boolean;
}) {
  const gradientBg = useColorModeValue('linear(to-r, teal.100, teal.300)', 'linear(to-r, teal.700, teal.500)');
  const frameBorder = useColorModeValue('teal.200', 'teal.500');
  const bodyColor = useColorModeValue('gray.900', 'whiteAlpha.900');
  const helperText = useColorModeValue('teal.900', 'teal.50');
  const secondaryTagColor = useColorModeValue('teal.800', 'teal.100');
  const secondaryTagBg = useColorModeValue('whiteAlpha.900', 'whiteAlpha.150');
  const secondaryTagBorder = useColorModeValue('gray.200', 'whiteAlpha.300');
  const secondaryActions = [
    onNavigateToPractice && {
      label: 'Practice vs AI',
      icon: RepeatIcon,
      onClick: onNavigateToPractice,
    },
    onNavigateToAnalysis && {
      label: 'Analysis',
      icon: SearchIcon,
      onClick: onNavigateToAnalysis,
    },
    onNavigateToLeaderboard && {
      label: 'View rankings',
      icon: StarIcon,
      onClick: onNavigateToLeaderboard,
    },
  ].filter(Boolean) as Array<{ label: string; icon: ElementType; onClick: () => void }>;

  return (
    <MotionCard
      {...heroEntrance}
      bgGradient={gradientBg}
      borderWidth="1px"
      borderColor={frameBorder}
      color={bodyColor}
      shadow="lg"
    >
      <CardBody>
        <Stack spacing={6}>
          <Stack spacing={2}>
            <Badge colorScheme="teal" w="fit-content" borderRadius="full" px={3} py={1} fontSize="xs" textTransform="uppercase">
              Online play
            </Badge>
            <Heading size={{ base: 'md', md: 'lg' }}>Jump into a Santorini match</Heading>
            <Text fontSize={{ base: 'sm', md: 'md' }} color={helperText}>
              Play rated matches, create custom games, or join with a friend's code
            </Text>
          </Stack>
          <Stack
            spacing={4}
          >
            <Wrap spacing={{ base: 2, sm: 3 }} align="center">
              <WrapItem>
                <Tooltip 
                  label={hasActiveGame ? "Finish your current game first" : undefined} 
                  isDisabled={!hasActiveGame}
                  hasArrow
                  placement="top"
                >
                  <MotionButton
                    size="lg"
                    colorScheme="teal"
                    rightIcon={<ArrowForwardIcon />}
                    onClick={onQuickMatch}
                    isLoading={quickMatchLoading}
                    isDisabled={hasActiveGame || quickMatchLoading}
                    w={{ base: '100%', sm: 'auto' }}
                    whiteSpace="normal"
                    minH="58px"
                    textAlign="center"
                    px={{ base: 4, sm: 6 }}
                    fontSize="md"
                    fontWeight="semibold"
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.96 }}
                    transition={heroButtonSpring}
                  >
                    Start quick match
                  </MotionButton>
                </Tooltip>
              </WrapItem>
              <WrapItem>
                <Tooltip 
                  label={hasActiveGame ? "Finish your current game first" : undefined} 
                  isDisabled={!hasActiveGame}
                  hasArrow
                  placement="top"
                >
                  <MotionButton
                    size="lg"
                    variant="outline"
                    leftIcon={<AddIcon />}
                    onClick={onOpenCreate}
                    isDisabled={hasActiveGame}
                    w={{ base: '100%', sm: 'auto' }}
                    whiteSpace="normal"
                    minH="58px"
                    textAlign="center"
                    px={{ base: 4, sm: 6 }}
                    fontSize="md"
                    fontWeight="semibold"
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.96 }}
                    transition={heroButtonSpring}
                  >
                    Custom match
                  </MotionButton>
                </Tooltip>
              </WrapItem>
              <WrapItem>
                <MotionButton
                  size="lg"
                  variant="ghost"
                  onClick={onOpenJoin}
                  w={{ base: '100%', sm: 'auto' }}
                  whiteSpace="normal"
                  height="auto"
                  textAlign="center"
                  px={{ base: 4, sm: 6 }}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.96 }}
                  transition={heroButtonSpring}
                >
                  Join by code
                </MotionButton>
              </WrapItem>
            </Wrap>
          </Stack>
          {secondaryActions.length > 0 && (
            <Wrap spacing={2} shouldWrapChildren>
              {secondaryActions.map((action) => (
                <MotionTag
                  key={action.label}
                  size="lg"
                  variant="subtle"
                  px={3}
                  py={2}
                  borderRadius="full"
                  as="button"
                  type="button"
                  onClick={action.onClick}
                  display="inline-flex"
                  alignItems="center"
                  gap={2}
                  cursor="pointer"
                  bg={secondaryTagBg}
                  color={secondaryTagColor}
                  borderColor={secondaryTagBorder}
                  borderWidth="1px"
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  transition={heroButtonSpring}
                >
                  <Icon as={action.icon} boxSize={4} color={secondaryTagColor} />
                  <Text fontSize="sm" fontWeight="semibold">
                    {action.label}
                  </Text>
                </MotionTag>
              ))}
            </Wrap>
          )}
        </Stack>
      </CardBody>
    </MotionCard>
  );
}

interface MatchBadgeConfig {
  label: ReactNode;
  colorScheme?: string;
  icon?: ElementType;
  tooltip?: ReactNode;
}

function buildMatchSettingsBadges(match: LobbyMatch): MatchBadgeConfig[] {
  const badges: MatchBadgeConfig[] = [];

  badges.push({
    label: match.rated ? 'Rated' : 'Casual',
    colorScheme: match.rated ? 'purple' : 'gray',
    icon: match.rated ? StarIcon : undefined,
    tooltip: match.rated ? 'This match affects ladder ratings.' : 'No rating impact — perfect for practice.',
  });

  if (match.clock_initial_seconds > 0 || match.clock_increment_seconds > 0) {
    const minutes = Math.max(1, Math.round(match.clock_initial_seconds / 60));
    badges.push({
      label: `${minutes}+${match.clock_increment_seconds}`,
      colorScheme: 'teal',
      icon: TimeIcon,
      tooltip: 'Time control (minutes + increment seconds).',
    });
  } else {
    badges.push({
      label: 'No clock',
      colorScheme: 'gray',
      icon: TimeIcon,
      tooltip: 'Unlimited time — no clock is running.',
    });
  }

  badges.push(
    match.visibility === 'public'
      ? {
          label: 'Public',
          colorScheme: 'green',
          icon: ViewIcon,
          tooltip: 'Visible to everyone browsing the lobby.',
        }
      : {
          label: 'Private',
          colorScheme: 'orange',
          icon: LockIcon,
          tooltip: match.private_join_code ? `Join code ${match.private_join_code}` : 'Requires an invite code.',
        },
  );

  if (match.is_ai_match) {
    badges.push({
      label: `AI depth ${match.ai_depth ?? '—'}`,
      colorScheme: 'pink',
      icon: RepeatIcon,
      tooltip: 'Practice game versus the built-in AI.',
    });
  }

  return badges;
}



function MatchListCard({
  title,
  subtitle,
  badges = [],
  description,
  meta,
  actions,
  avatarUrl,
  avatarLabel,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: MatchBadgeConfig[];
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  avatarUrl?: string | null;
  avatarLabel?: string;
}) {
  const { cardBg, cardBorder, mutedText } = useSurfaceTokens();
  const resolvedAvatarLabel = avatarLabel ?? (typeof title === 'string' ? title : undefined);

  return (
    <Box
      borderWidth="1px"
      borderColor={cardBorder}
      borderRadius="xl"
      px={4}
      py={4}
      bg={cardBg}
      transition="border-color 0.2s ease, box-shadow 0.2s ease"
      _hover={{ borderColor: 'teal.400', boxShadow: 'xl' }}
    >
      <Flex direction={{ base: 'column', md: 'row' }} gap={4} align={{ base: 'flex-start', md: 'stretch' }}>
        <HStack align="flex-start" spacing={4} flex="1">
          <Avatar
            name={resolvedAvatarLabel}
            src={avatarUrl ?? undefined}
            size="md"
            borderWidth="2px"
            borderColor="teal.500"
            boxShadow="sm"
          />
          <Stack spacing={2} flex="1">
            <Stack spacing={0}>
              {subtitle && (
                <Text fontSize="xs" fontWeight="semibold" color={mutedText} textTransform="uppercase" letterSpacing="0.08em">
                  {subtitle}
                </Text>
              )}
              <Heading size="sm">{title}</Heading>
            </Stack>
            {description && (
              <Text fontSize="sm" color={mutedText}>
                {description}
              </Text>
            )}
            {badges.length > 0 && (
              <Wrap spacing={2} pt={1}>
                {badges.map((badge, index) => {
                  const tag = (
                    <Tag
                      colorScheme={badge.colorScheme ?? 'gray'}
                      variant="subtle"
                      borderRadius="full"
                      px={3}
                      py={1}
                      display="inline-flex"
                      alignItems="center"
                      gap={2}
                    >
                      {badge.icon && <Icon as={badge.icon} boxSize={3} />}
                      <Text fontSize="xs" fontWeight="semibold">
                        {badge.label}
                      </Text>
                    </Tag>
                  );
                  return (
                    <WrapItem key={`badge-${index}`}>
                      {badge.tooltip ? (
                        <Tooltip label={badge.tooltip} hasArrow>{tag}</Tooltip>
                      ) : (
                        tag
                      )}
                    </WrapItem>
                  );
                })}
              </Wrap>
            )}
            {meta && (
              <Text fontSize="xs" color={mutedText}>
                {meta}
              </Text>
            )}
          </Stack>
        </HStack>
        {actions && (
          <Flex align="center" justify={{ base: 'flex-start', md: 'flex-end' }} w={{ base: '100%', md: 'auto' }}>
            {actions}
          </Flex>
        )}
      </Flex>
    </Box>
  );
}

function PendingMatchActions({
  match,
  onSelect,
  onCancel,
  isCancelling,
}: {
  match: LobbyMatch;
  onSelect: () => void;
  onCancel: () => void;
  isCancelling: boolean;
}) {
  const joinKey = match.private_join_code ?? match.id;
  const joinLink = buildMatchJoinLink(joinKey);
  const { hasCopied, onCopy } = useClipboard(joinLink);
  const hasJoinLink = Boolean(joinKey);

  return (
    <ButtonGroup size="sm" variant="outline" spacing={2}>
      <Button variant="outline" onClick={onSelect}>
        View
      </Button>
      <Tooltip
        label="Copy a link your friend can use to join this match"
        hasArrow
        isDisabled={!hasJoinLink}
      >
        <Button
          variant="outline"
          colorScheme={hasCopied ? 'teal' : 'gray'}
          onClick={onCopy}
          isDisabled={!hasJoinLink}
        >
          {hasCopied ? 'Link copied' : 'Copy invite link'}
        </Button>
      </Tooltip>
      <Button
        colorScheme="red"
        variant="ghost"
        onClick={onCancel}
        isLoading={isCancelling}
      >
        Cancel
      </Button>
    </ButtonGroup>
  );
}

function MatchCreationModal({
  isOpen,
  onClose,
  onCreate,
  loading,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (payload: CreateMatchPayload) => Promise<void>;
  loading: boolean;
}) {
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [rated, setRated] = useState(true);
  const [hasClock, setHasClock] = useState(true);
  const [minutes, setMinutes] = useState('10');
  const [increment, setIncrement] = useState('5');
  const [startingPlayer, setStartingPlayer] = useState<StartingPlayer>('random');
  const [opponentType, setOpponentType] = useState<MatchOpponentType>('human');
  const [aiDepth, setAiDepth] = useState(200);
  const [isSubmitting, setIsSubmitting] = useBoolean(false);
  const isAiMatch = opponentType === 'ai';
  const MIN_AI_DEPTH = 10;
  const MAX_AI_DEPTH = 5000;
  const toast = useToast();
  const { mutedText } = useSurfaceTokens();

  useEffect(() => {
    if (!ALLOW_ONLINE_AI_MATCHES && opponentType === 'ai') {
      setOpponentType('human');
      return;
    }
    if (isAiMatch) {
      setRated(false);
      setHasClock(false);
    }
  }, [isAiMatch, opponentType]);

  const handleSubmit = async () => {
    setIsSubmitting.on();
    try {
      const clampedDepth = Math.max(MIN_AI_DEPTH, Math.min(MAX_AI_DEPTH, Math.round(aiDepth)));
      const resolvedMinutes = Math.max(1, Math.round(Number(minutes) || 0));
      const resolvedIncrement = Math.max(0, Math.round(Number(increment) || 0));
      await onCreate({
        visibility: isAiMatch ? 'private' : visibility,
        rated: isAiMatch ? false : rated,
        hasClock: isAiMatch ? false : hasClock,
        clockInitialMinutes: isAiMatch ? 0 : resolvedMinutes,
        clockIncrementSeconds: isAiMatch ? 0 : resolvedIncrement,
        startingPlayer,
        opponentType,
        aiDepth: isAiMatch ? clampedDepth : undefined,
      });
      toast({ title: isAiMatch ? 'AI match started!' : 'Match created successfully!', status: 'success' });
      onClose();
    } catch (error) {
      toast({
        title: 'Unable to create match',
        status: 'error',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsSubmitting.off();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Create New Match</ModalHeader>
        <ModalCloseButton />
        <ModalBody as={Stack} spacing={4}>
          <FormControl as={Stack} spacing={2}>
            <FormLabel fontSize="sm">Opponent</FormLabel>
            <RadioGroup value={opponentType} onChange={(value) => setOpponentType(value as MatchOpponentType)}>
              <HStack spacing={4}>
                <Radio value="human">Real player</Radio>
                <Tooltip
                  label="Online AI matches are temporarily offline. Visit the Practice tab for AI opponents."
                  hasArrow
                  isDisabled={ALLOW_ONLINE_AI_MATCHES}
                >
                  <Radio value="ai" isDisabled={!ALLOW_ONLINE_AI_MATCHES}>
                    Santorini AI
                  </Radio>
                </Tooltip>
              </HStack>
            </RadioGroup>
          </FormControl>
          {!ALLOW_ONLINE_AI_MATCHES && (
            <Alert status="warning" borderRadius="md">
              <AlertIcon />
              <Text fontSize="sm">
                AI opponents for online matches are disabled while we fix some issues. Try the Practice tab for AI play.
              </Text>
            </Alert>
          )}
          {ALLOW_ONLINE_AI_MATCHES && isAiMatch && (
            <Alert status="info" borderRadius="md">
              <AlertIcon />
              <Text fontSize="sm">AI matches are unrated, have no clock, and let you pick the search depth.</Text>
            </Alert>
          )}
          <FormControl as={Stack} spacing={2} isDisabled={isAiMatch}>
            <FormLabel fontSize="sm">Visibility</FormLabel>
            <RadioGroup value={visibility} onChange={(value) => setVisibility(value as 'public' | 'private')}>
              <HStack spacing={4}>
                <Radio value="public">Public lobby</Radio>
                <Radio value="private">Private code</Radio>
              </HStack>
            </RadioGroup>
            {isAiMatch && <FormHelperText>AI games always use a private slot.</FormHelperText>}
          </FormControl>
          <FormControl as={Stack} spacing={2}>
            <FormLabel fontSize="sm">Starting player</FormLabel>
            <RadioGroup value={startingPlayer} onChange={(value) => setStartingPlayer(value as StartingPlayer)}>
              <HStack spacing={4}>
                <Radio value="creator">You</Radio>
                <Radio value="opponent">Opponent</Radio>
                <Radio value="random">Random</Radio>
              </HStack>
            </RadioGroup>
          </FormControl>
          <FormControl display="flex" alignItems="center" justifyContent="space-between" isDisabled={isAiMatch}>
            <FormLabel htmlFor="rated-switch" mb="0">
              Rated game (affects ELO)
            </FormLabel>
            <Switch id="rated-switch" isChecked={rated} onChange={(event) => setRated(event.target.checked)} />
            {isAiMatch && <FormHelperText>AI matches never change rating.</FormHelperText>}
          </FormControl>
          <FormControl display="flex" flexDir="column" gap={3} isDisabled={isAiMatch}>
            <HStack justify="space-between">
              <FormLabel htmlFor="clock-switch" mb="0">
                Enable clock
              </FormLabel>
              <Switch id="clock-switch" isChecked={hasClock} onChange={(event) => setHasClock(event.target.checked)} />
            </HStack>
            {hasClock && !isAiMatch && (
              <Stack direction={{ base: 'column', md: 'row' }} spacing={3}>
                <FormControl>
                  <FormLabel fontSize="sm">Initial time (minutes)</FormLabel>
                  <NumberInput
                    min={1}
                    precision={0}
                    step={1}
                    clampValueOnBlur
                    value={minutes}
                    onChange={(valueString) => setMinutes(valueString)}
                  >
                    <NumberInputField inputMode="numeric" />
                    <NumberInputStepper>
                      <NumberIncrementStepper />
                      <NumberDecrementStepper />
                    </NumberInputStepper>
                  </NumberInput>
                </FormControl>
                <FormControl>
                  <FormLabel fontSize="sm">Increment (seconds)</FormLabel>
                  <NumberInput
                    min={0}
                    precision={0}
                    step={1}
                    clampValueOnBlur
                    value={increment}
                    onChange={(valueString) => setIncrement(valueString)}
                  >
                    <NumberInputField inputMode="numeric" />
                    <NumberInputStepper>
                      <NumberIncrementStepper />
                      <NumberDecrementStepper />
                    </NumberInputStepper>
                  </NumberInput>
                </FormControl>
              </Stack>
            )}
            {isAiMatch && <FormHelperText>Clocks are disabled when playing against the AI.</FormHelperText>}
          </FormControl>
          {isAiMatch && (
            <FormControl>
              <FormLabel fontSize="sm">AI depth (simulations)</FormLabel>
              <NumberInput
                value={aiDepth}
                min={MIN_AI_DEPTH}
                max={MAX_AI_DEPTH}
                step={10}
                onChange={(_, valueNumber) => {
                  if (Number.isFinite(valueNumber)) {
                    setAiDepth(Math.round(valueNumber));
                  }
                }}
              >
                <NumberInputField />
                <NumberInputStepper>
                  <NumberIncrementStepper />
                  <NumberDecrementStepper />
                </NumberInputStepper>
              </NumberInput>
              <FormHelperText>Higher values make the AI slower but stronger. 200 is a good starting point.</FormHelperText>
            </FormControl>
          )}
          <Button
            colorScheme="teal"
            onClick={handleSubmit}
            isDisabled={loading || isSubmitting}
            isLoading={loading || isSubmitting}
            w="full"
            loadingText={isAiMatch ? 'Starting…' : 'Creating…'}
          >
            {isAiMatch ? 'Start AI Match' : 'Create Match'}
          </Button>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={onClose} w="full">
            Cancel
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function PublicLobbies({
  matches,
  loading,
  onJoin,
  onAfterJoin,
}: {
  matches: LobbyMatch[];
  loading: boolean;
  onJoin: (id: string) => Promise<LobbyMatch>;
  onAfterJoin?: () => void;
}) {
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ status: 'success' | 'error'; message: string } | null>(null);
  const { cardBg, cardBorder, mutedText } = useSurfaceTokens();

  const handleJoin = async (id: string) => {
    setJoiningId(id);
    setFeedback(null);
    try {
      await onJoin(id);
      setFeedback({ status: 'success', message: 'Joined match. Loading the game board…' });
      onAfterJoin?.();
    } catch (error) {
      setFeedback({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unable to join this match right now.',
      });
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder}>
      <CardHeader>
        <Heading size="md">Public games</Heading>
      </CardHeader>
      <CardBody>
        {loading ? (
          <Center py={8}>
            <Spinner />
          </Center>
        ) : matches.length === 0 ? (
          <Text color={mutedText}>No public games are waiting right now.</Text>
        ) : (
          <Stack spacing={3}>
            {feedback && (
              <Alert status={feedback.status} variant="left-accent" borderRadius="md" alignItems="center">
                <AlertIcon />
                <AlertDescription flex="1">{feedback.message}</AlertDescription>
                <CloseButton position="relative" onClick={() => setFeedback(null)} />
              </Alert>
            )}
            {matches.map((match) => {
              const hostName = match.creator?.display_name ?? 'Unknown player';
              const visibilityLabel = match.visibility === 'public' ? 'Open lobby' : 'Invite only';
              const statusBadge: MatchBadgeConfig =
                match.status === 'waiting_for_opponent'
                  ? {
                      label: 'Waiting',
                      colorScheme: 'yellow',
                      icon: TimeIcon,
                      tooltip: 'The host is waiting for someone to join.',
                    }
                  : {
                      label: 'In progress',
                      colorScheme: 'blue',
                      icon: TimeIcon,
                      tooltip: 'This match has already started.',
                    };
              const badges = [statusBadge, ...buildMatchSettingsBadges(match)];
              const description = match.opponent
                ? `Facing ${match.opponent.display_name}`
                : 'Waiting for an opponent';
              const meta = `${visibilityLabel} • Created ${formatDate(match.created_at)}`;
              const joinAction = (
                <MotionButton
                  colorScheme="teal"
                  bgGradient="linear(to-r, teal.400, teal.500)"
                  color="white"
                  size="md"
                  borderRadius="full"
                  px={6}
                  rightIcon={<ArrowForwardIcon />}
                  onClick={() => handleJoin(match.id)}
                  isLoading={joiningId === match.id}
                  loadingText="Joining"
                  whileHover={{ y: -2, boxShadow: 'lg' }}
                  whileTap={{ scale: 0.97 }}
                  shadow="md"
                >
                  Join match
                </MotionButton>
              );

              return (
                <MatchListCard
                  key={match.id}
                  title={hostName}
                  subtitle="Host"
                  badges={badges}
                  description={description}
                  meta={meta}
                  avatarUrl={match.creator?.avatar_url ?? null}
                  avatarLabel={hostName}
                  actions={joinAction}
                />
              );
            })}
          </Stack>
        )}
      </CardBody>
    </Card>
  );
}

function PendingMatches({
  matches,
  profile,
  onSelect,
  onCancel,
  onAfterSelect,
}: {
  matches: LobbyMatch[];
  profile: any;
  onSelect: (matchId: string) => void;
  onCancel: (matchId: string) => Promise<void>;
  onAfterSelect?: () => void;
}) {
  const { cardBg, cardBorder, mutedText } = useSurfaceTokens();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ status: 'success' | 'error'; message: string } | null>(null);

  const handleSelect = (matchId: string) => {
    setFeedback(null);
    onSelect(matchId);
    onAfterSelect?.();
  };

  const pendingMatches = matches.filter((m) => m.status === 'waiting_for_opponent');

  if (pendingMatches.length === 0) {
    return null;
  }

  const handleCancel = async (matchId: string) => {
    setCancellingId(matchId);
    setFeedback(null);
    try {
      await onCancel(matchId);
      setFeedback({ status: 'success', message: 'Match cancelled. You can create a new game whenever you’re ready.' });
    } catch (error) {
      setFeedback({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unable to cancel this match right now.',
      });
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder}>
      <CardHeader>
        <Heading size="md">Your pending matches</Heading>
      </CardHeader>
      <CardBody>
        <Stack spacing={3}>
          {feedback && (
            <Alert status={feedback.status} variant="left-accent" borderRadius="md" alignItems="center">
              <AlertIcon />
              <AlertDescription flex="1">{feedback.message}</AlertDescription>
              <CloseButton position="relative" onClick={() => setFeedback(null)} />
            </Alert>
          )}
          {pendingMatches.map((match) => {
            const isCreator = profile ? match.creator_id === profile.id : false;
            const badges: MatchBadgeConfig[] = [
              {
                label: 'Pending',
                colorScheme: 'yellow',
                icon: TimeIcon,
                tooltip: 'Waiting for an opponent to join.',
              },
              ...buildMatchSettingsBadges(match),
            ];

            const description = isCreator
              ? 'Share the invite link or code while you wait for an opponent.'
              : 'Waiting for the host to start the match.';
            const metaParts: string[] = [];
            if (match.visibility === 'private' && match.private_join_code) {
              metaParts.push(`Code: ${match.private_join_code}`);
            }
            metaParts.push(`Created ${formatDate(match.created_at)}`);
            const meta = metaParts.join(' • ');
            const hostName = match.creator?.display_name ?? 'Match host';

            return (
              <MatchListCard
                key={match.id}
                title={hostName}
                subtitle={isCreator ? 'You' : 'Host'}
                badges={badges}
                description={description}
                meta={meta}
                avatarUrl={match.creator?.avatar_url ?? null}
                avatarLabel={hostName}
                actions={(
                  <PendingMatchActions
                    match={match}
                    onSelect={() => handleSelect(match.id)}
                    onCancel={() => handleCancel(match.id)}
                    isCancelling={cancellingId === match.id}
                  />
                )}
              />
            );
          })}
        </Stack>
      </CardBody>
    </Card>
  );
}

function SignInPrompt({ auth }: { auth: SupabaseAuthState }) {
  const [startingGoogle, setStartingGoogle] = useBoolean(false);
  const toast = useToast();
  const googleHoverBg = useColorModeValue('gray.100', 'whiteAlpha.300');
  const googleActiveBg = useColorModeValue('gray.200', 'whiteAlpha.200');
  const { cardBg, cardBorder, mutedText } = useSurfaceTokens();

  const handleGoogleSignIn = async () => {
    try {
      setStartingGoogle.on();
      await auth.signInWithGoogle();
      toast({ title: 'Redirecting to Google', status: 'info' });
    } catch (oauthError) {
      toast({
        title: 'Google sign-in failed',
        status: 'error',
        description: oauthError instanceof Error ? oauthError.message : 'Unable to start Google sign-in.',
      });
    } finally {
      setStartingGoogle.off();
    }
  };

  return (
    <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder} w="100%">
      <CardBody as={Stack} spacing={6} align="center" textAlign="center" py={{ base: 8, md: 10 }}>
        <Stack spacing={2} maxW="lg">
          <Heading size="md">Sign in to join online lobbies</Heading>
          <Text color={mutedText}>
            Challenge real opponents, protect your rating, and sync your Santorini journey across every device.
          </Text>
          <Text color={mutedText}>
            Unlock practice tools, deep analysis, and the global leaderboard to track your climb.
          </Text>
        </Stack>
        <HStack spacing={2} flexWrap="wrap" justify="center">
          <Badge colorScheme="teal" px={3} py={1} borderRadius="full">
            Keep your rating
          </Badge>
          <Badge colorScheme="purple" px={3} py={1} borderRadius="full">
            Save match history
          </Badge>
          <Badge colorScheme="orange" px={3} py={1} borderRadius="full">
            Challenge friends
          </Badge>
        </HStack>
        <Button
          size="lg"
          bg="white"
          color="gray.800"
          leftIcon={<GoogleIcon boxSize={5} />}
          onClick={handleGoogleSignIn}
          isLoading={startingGoogle}
          isDisabled={startingGoogle}
          _hover={{ bg: googleHoverBg, transform: 'translateY(-1px)', boxShadow: '2xl' }}
          _active={{ bg: googleActiveBg }}
        >
          Continue with Google
        </Button>
      </CardBody>
    </Card>
  );
}

function LobbyWorkspace({
  auth,
  onNavigateToPlay,
  onNavigateToPractice,
  onNavigateToAnalysis,
  onNavigateToLeaderboard,
}: {
  auth: SupabaseAuthState;
  onNavigateToPlay: () => void;
  onNavigateToPractice: () => void;
  onNavigateToAnalysis: () => void;
  onNavigateToLeaderboard: () => void;
}) {
  const lobby = useMatchLobbyContext();
  const { joinMatch, setActiveMatch } = lobby;
  const [joiningCode, setJoiningCode] = useState('');
  const [pendingJoinKey, setPendingJoinKey] = useState<string | null>(null);
  const { isOpen: isCreateOpen, onOpen: onCreateOpen, onClose: onCreateClose } = useDisclosure();
  const { isOpen: isJoinOpen, onOpen: onJoinOpen, onClose: onJoinClose } = useDisclosure();
  const toast = useToast();
  const [creatingQuickMatch, setCreatingQuickMatch] = useBoolean(false);
  const [inlineNotice, setInlineNotice] = useState<{ status: 'success' | 'error'; message: string } | null>(null);
  const previousStatusesRef = useRef<Record<string, MatchStatus>>({});
  const joinToastBg = useColorModeValue('white', 'gray.800');
  const joinToastBorder = useColorModeValue('teal.400', 'teal.300');
  const notificationPromptBg = useColorModeValue('white', 'gray.800');
  const notificationPromptBorder = useColorModeValue('teal.400', 'teal.300');
  const {
    permission: notificationPermission,
    isSupported: notificationsSupported,
    requestPermission: requestNotificationPermission,
  } = useBrowserNotifications();
  usePushSubscription(auth.profile ?? null, notificationPermission);
  const notificationsPromptedRef = useRef(false);
  const matchesHydratedRef = useRef(false);

  const clearPendingJoinKey = useCallback(() => {
    setPendingJoinKey(null);
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.removeItem(PENDING_JOIN_STORAGE_KEY);
      } catch (storageError) {
        console.error('Failed to clear pending join key', storageError);
      }
    }
  }, []);

  const promptNotificationPermission = useCallback(() => {
    if (!notificationsSupported) {
      return;
    }
    if (notificationPermission !== 'default') {
      return;
    }
    if (notificationsPromptedRef.current) {
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
      notificationsPromptedRef.current = true;
      return;
    }
    notificationsPromptedRef.current = true;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(NOTIFICATION_PROMPT_STORAGE_KEY, 'true');
      } catch (error) {
        console.warn('Unable to persist notification prompt state', error);
      }
    }
    toast({
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
            <Heading size="sm">Enable notifications</Heading>
            <Text fontSize="sm">
              Stay informed when opponents join or move while you&apos;re away from this tab.
            </Text>
            <ButtonGroup size="sm" justifyContent="flex-end">
              <Button
                variant="ghost"
                onClick={() => {
                  onClose();
                }}
              >
                Not now
              </Button>
              <Button
                colorScheme="teal"
                onClick={async () => {
                  const result = await requestNotificationPermission();
                  if (result !== 'default') {
                    onClose();
                  }
                }}
              >
                Enable
              </Button>
            </ButtonGroup>
          </Stack>
        </Box>
      ),
    });
  }, [
    notificationsSupported,
    notificationPermission,
    toast,
    notificationPromptBg,
    notificationPromptBorder,
    requestNotificationPermission,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const url = new URL(window.location.href);
      const joinParam = url.searchParams.get('join');

      if (joinParam) {
        setPendingJoinKey(joinParam);
        setJoiningCode((current) => (current ? current : joinParam));
        try {
          window.sessionStorage.setItem(PENDING_JOIN_STORAGE_KEY, joinParam);
        } catch (storageError) {
          console.error('Failed to persist pending join key', storageError);
        }

        url.searchParams.delete('join');
        window.history.replaceState(null, '', url.toString());
        return;
      }

      const stored = window.sessionStorage.getItem(PENDING_JOIN_STORAGE_KEY);
      if (stored) {
        setPendingJoinKey(stored);
        setJoiningCode((current) => (current ? current : stored));
      }
    } catch (error) {
      console.error('Failed to initialize join parameter', error);
    }
  }, []);

  useEffect(() => {
    if (!pendingJoinKey) {
      return;
    }
    if (!auth.profile) {
      return;
    }

    let isActive = true;

    const attemptJoin = async () => {
      try {
        await joinMatch(pendingJoinKey);
        if (!isActive) {
          return;
        }
        toast({ title: 'Joined match', status: 'success' });
        clearPendingJoinKey();
        setJoiningCode('');
        onNavigateToPlay();
      } catch (error: any) {
        if (!isActive) {
          return;
        }

        if (error?.code === 'ACTIVE_GAME_EXISTS') {
          toast({
            title: 'Active game exists',
            description: error.message,
            status: 'warning',
            duration: 5000,
          });
          if (error.activeMatchId) {
            setActiveMatch(error.activeMatchId);
            onNavigateToPlay();
          }
        } else {
          toast({
            title: 'Unable to join match',
            status: 'error',
            description: error instanceof Error ? error.message : 'Please try again or create a new game.',
          });
          setJoiningCode((current) => (current ? current : pendingJoinKey));
        }
        clearPendingJoinKey();
      }
    };

    attemptJoin();

    return () => {
      isActive = false;
    };
  }, [pendingJoinKey, auth.profile, joinMatch, toast, clearPendingJoinKey, onNavigateToPlay, setActiveMatch]);

  useEffect(() => {
    if (isCreateOpen) {
      return;
    }
    if (consumeAutoOpenCreateFlag()) {
      onCreateOpen();
    }
  }, [isCreateOpen, onCreateOpen]);

  useEffect(() => {
    if (!auth.profile) {
      return;
    }
    if (lobby.sessionMode !== 'online') {
      lobby.enableOnline();
    }
  }, [auth.profile, lobby.enableOnline, lobby.sessionMode]);

  useEffect(() => {
    const previous = previousStatusesRef.current;
    const next: Record<string, MatchStatus> = {};
    let shouldSkipToasts = false;
    if (!matchesHydratedRef.current) {
      shouldSkipToasts = true;
      matchesHydratedRef.current = true;
    }
    lobby.myMatches.forEach((match) => {
      next[match.id] = match.status;
      const prevStatus = previous[match.id];
      if (
        !shouldSkipToasts &&
        prevStatus === 'waiting_for_opponent' &&
        match.status === 'in_progress' &&
        match.creator_id === auth.profile?.id
      ) {
        const opponentName = match.opponent?.display_name ?? 'Opponent';
        toast({
          duration: 7000,
          position: 'top',
          render: ({ onClose }) => (
        <Box
          bg={joinToastBg}
          borderRadius="lg"
          borderWidth="1px"
          borderColor={joinToastBorder}
          boxShadow="lg"
          px={4}
          py={3}
          w="min(100vw - 32px, 420px)"
          maxW="420px"
          mx="auto"
          overflow="hidden"
        >
          <Stack spacing={2}>
            <Heading size="sm">Opponent joined!</Heading>
            <Text fontSize="sm">
              {opponentName} joined your game. Jump in to start playing.
            </Text>
            <Stack direction={{ base: 'column', sm: 'row' }} spacing={2} alignSelf="flex-end">
              <Button variant="ghost" onClick={() => onClose()}>
                Later
              </Button>
              <Button
                colorScheme="teal"
                onClick={() => {
                  onNavigateToPlay();
                  onClose();
                }}
              >
                Open game
              </Button>
            </Stack>
          </Stack>
        </Box>
          ),
        });
      }
    });
    previousStatusesRef.current = next;
  }, [lobby.myMatches, auth.profile?.id, toast, joinToastBg, joinToastBorder, onNavigateToPlay]);

  const handleCreate = async (payload: CreateMatchPayload) => {
    try {
      await lobby.createMatch(payload);
      // Navigate to Play tab after creating match
      onNavigateToPlay();
      promptNotificationPermission();
    } catch (error: any) {
      // Re-throw to be caught by the modal's error handling
      if (error.code === 'ACTIVE_GAME_EXISTS') {
        toast({
          title: 'Active game exists',
          description: error.message,
          status: 'warning',
          duration: 5000,
        });
        onCreateClose();
        // Navigate to the active game
        if (error.activeMatchId) {
          lobby.setActiveMatch(error.activeMatchId);
          onNavigateToPlay();
        }
      }
      throw error;
    }
  };

  const handleJoinByCode = async () => {
    if (!joiningCode) return;
    try {
      await lobby.joinMatch(joiningCode.trim());
      toast({ title: 'Match joined successfully!', status: 'success' });
      setJoiningCode('');
      onJoinClose();
      // Navigate to Play tab after joining match
      onNavigateToPlay();
    } catch (error: any) {
      if (error.code === 'ACTIVE_GAME_EXISTS') {
        toast({
          title: 'Active game exists',
          description: error.message,
          status: 'warning',
          duration: 5000,
        });
        onJoinClose();
        // Navigate to the active game
        if (error.activeMatchId) {
          lobby.setActiveMatch(error.activeMatchId);
          onNavigateToPlay();
        }
      } else {
        toast({
          title: 'Unable to join',
          status: 'error',
          description: error instanceof Error ? error.message : 'Invalid code or match unavailable.',
        });
      }
    }
  };

  const handleQuickMatch = async () => {
    setCreatingQuickMatch.on();
    setInlineNotice(null);
    try {
      await handleCreate({
        visibility: 'public',
        rated: false,
        hasClock: false,
        clockInitialMinutes: 0,
        clockIncrementSeconds: 0,
        startingPlayer: 'random',
      });
      setInlineNotice({ status: 'success', message: 'Casual game posted to the lobby. Waiting for an opponent to join…' });
    } catch (error: any) {
      if (error?.code === 'ACTIVE_GAME_EXISTS') {
        return;
      }
      setInlineNotice({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unable to start a new match right now.',
      });
    } finally {
      setCreatingQuickMatch.off();
    }
  };

  if (!auth.profile) {
    return (
      <Stack spacing={6} py={{ base: 6, md: 10 }}>
        <SignInPrompt auth={auth} />
      </Stack>
    );
  }

  // Find the active game (if any)
  const activeGame = lobby.myMatches.find(m => 
    m.status === 'waiting_for_opponent' || m.status === 'in_progress'
  );

  return (
    <Stack spacing={{ base: 6, md: 8 }} py={{ base: 6, md: 10 }}>
      {/* Show active game notice if user has an active game */}
      {activeGame && (
        <ActiveGameNotice 
          match={activeGame} 
          onNavigateToPlay={onNavigateToPlay}
        />
      )}

      {inlineNotice && (
        <Alert status={inlineNotice.status} variant="left-accent" borderRadius="md" alignItems="center">
          <AlertIcon />
          <AlertDescription flex="1">{inlineNotice.message}</AlertDescription>
          <CloseButton position="relative" onClick={() => setInlineNotice(null)} />
        </Alert>
      )}
      
      <LobbyHero
        onQuickMatch={handleQuickMatch}
        quickMatchLoading={creatingQuickMatch}
        onOpenCreate={onCreateOpen}
        onOpenJoin={onJoinOpen}
        onNavigateToPractice={onNavigateToPractice}
        onNavigateToAnalysis={onNavigateToAnalysis}
        onNavigateToLeaderboard={onNavigateToLeaderboard}
        hasActiveGame={lobby.hasActiveGame}
      />
      {/* Your Pending Matches */}
      {lobby.myMatches && (
        <PendingMatches
          matches={lobby.myMatches}
          profile={auth.profile}
          onSelect={lobby.setActiveMatch}
          onCancel={lobby.leaveMatch}
          onAfterSelect={onNavigateToPlay}
        />
      )}

      {/* Public Lobbies */}
      <PublicLobbies matches={lobby.matches} loading={lobby.loading} onJoin={lobby.joinMatch} onAfterJoin={onNavigateToPlay} />

      {/* Match Creation Modal */}
      <MatchCreationModal isOpen={isCreateOpen} onClose={onCreateClose} onCreate={handleCreate} loading={lobby.loading} />

      {/* Join by Code Modal */}
      <Modal isOpen={isJoinOpen} onClose={onJoinClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Join by Code</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Stack spacing={3}>
              <Text fontSize="sm" color="gray.500">
                Enter a private join code or match ID to join a friend's game.
              </Text>
              <Input
                placeholder="ABC123"
                value={joiningCode}
                onChange={(event) => setJoiningCode(event.target.value.toUpperCase())}
                onKeyPress={(e) => e.key === 'Enter' && handleJoinByCode()}
                autoFocus
              />
            </Stack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onJoinClose}>
              Cancel
            </Button>
            <Button colorScheme="teal" onClick={handleJoinByCode} isDisabled={!joiningCode}>
              Join Match
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Stack>
  );
}

export default LobbyWorkspace;
