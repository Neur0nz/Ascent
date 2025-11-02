import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Badge,
  Box,
  Button,
  ButtonGroup,
  Card,
  CardBody,
  CardHeader,
  Center,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  GridItem,
  Heading,
  HStack,
  Input,
  List,
  ListItem,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  Radio,
  RadioGroup,
  Spinner,
  Stack,
  Switch,
  Text,
  Tooltip,
  VStack,
  useBoolean,
  useColorModeValue,
  useDisclosure,
  useToast,
} from '@chakra-ui/react';
import { AddIcon } from '@chakra-ui/icons';
import type { SupabaseAuthState } from '@hooks/useSupabaseAuth';
import {
  useMatchLobby,
  type CreateMatchPayload,
  type LobbyMatch,
  type StartingPlayer,
  type PlayerConnectionState,
  type ConnectionQuality,
} from '@hooks/useMatchLobby';
import { useOnlineSantorini } from '@hooks/useOnlineSantorini';
import { SantoriniProvider, useSantorini } from '@hooks/useSantorini';
import { useLocalSantorini } from '@hooks/useLocalSantorini';
import GameBoard from '@components/GameBoard';
import GoogleIcon from '@components/auth/GoogleIcon';
import ConnectionIndicator from '@components/play/ConnectionIndicator';
import type { SantoriniMoveAction, MatchStatus } from '@/types/match';
import MyMatchesPanel from './MyMatchesPanel';
import { useSurfaceTokens } from '@/theme/useSurfaceTokens';

function formatDate(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
  const [minutes, setMinutes] = useState(10);
  const [increment, setIncrement] = useState(5);
  const [startingPlayer, setStartingPlayer] = useState<StartingPlayer>('random');
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();
  const { mutedText } = useSurfaceTokens();

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onCreate({
        visibility,
        rated,
        hasClock,
        clockInitialMinutes: minutes,
        clockIncrementSeconds: increment,
        startingPlayer,
      });
      toast({ title: 'Match created successfully!', status: 'success' });
      onClose();
    } catch (error) {
      toast({
        title: 'Unable to create match',
        status: 'error',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setSubmitting(false);
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
          <FormLabel fontSize="sm">Visibility</FormLabel>
          <RadioGroup value={visibility} onChange={(value) => setVisibility(value as 'public' | 'private')}>
            <HStack spacing={4}>
              <Radio value="public">Public lobby</Radio>
              <Radio value="private">Private code</Radio>
            </HStack>
          </RadioGroup>
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
        <FormControl display="flex" alignItems="center" justifyContent="space-between">
          <FormLabel htmlFor="rated-switch" mb="0">
            Rated game (affects ELO)
          </FormLabel>
          <Switch id="rated-switch" isChecked={rated} onChange={(event) => setRated(event.target.checked)} />
        </FormControl>
        <FormControl display="flex" flexDir="column" gap={3}>
          <HStack justify="space-between">
            <FormLabel htmlFor="clock-switch" mb="0">
              Enable clock
            </FormLabel>
            <Switch id="clock-switch" isChecked={hasClock} onChange={(event) => setHasClock(event.target.checked)} />
          </HStack>
          {hasClock && (
            <Stack direction={{ base: 'column', md: 'row' }} spacing={3}>
              <FormControl>
                <FormLabel fontSize="sm">Initial time (minutes)</FormLabel>
                <Input
                  type="number"
                  min={1}
                  value={minutes}
                  onChange={(event) => setMinutes(Number(event.target.value))}
                />
              </FormControl>
              <FormControl>
                <FormLabel fontSize="sm">Increment (seconds)</FormLabel>
                <Input
                  type="number"
                  min={0}
                  value={increment}
                  onChange={(event) => setIncrement(Number(event.target.value))}
                />
              </FormControl>
            </Stack>
          )}
        </FormControl>
        <Button
          colorScheme="teal"
          onClick={handleSubmit}
          isDisabled={loading || submitting}
          isLoading={loading || submitting}
          w="full"
        >
          Create Match
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
}: {
  matches: LobbyMatch[];
  loading: boolean;
  onJoin: (id: string) => Promise<LobbyMatch>;
}) {
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const toast = useToast();
  const { cardBg, cardBorder, mutedText } = useSurfaceTokens();

  const handleJoin = async (id: string) => {
    setJoiningId(id);
    try {
      await onJoin(id);
      toast({ title: 'Joined match', status: 'success' });
    } catch (error) {
      toast({
        title: 'Failed to join match',
        status: 'error',
        description: error instanceof Error ? error.message : 'Unknown error',
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
          <List spacing={3}>
            {matches.map((match) => (
              <ListItem
                key={match.id}
                borderWidth="1px"
                borderColor={cardBorder}
                borderRadius="md"
                px={4}
                py={3}
                display="flex"
                alignItems="center"
                justifyContent="space-between"
                gap={4}
              >
                <Box>
                  <HStack spacing={3} align="center">
                    <Heading size="sm">{match.creator?.display_name ?? 'Unknown player'}</Heading>
                    <Badge colorScheme={match.rated ? 'purple' : 'gray'}>{match.rated ? 'Rated' : 'Casual'}</Badge>
                    {match.clock_initial_seconds > 0 && (
                      <Badge colorScheme="blue">
                        {Math.round(match.clock_initial_seconds / 60)}+{match.clock_increment_seconds}
                      </Badge>
                    )}
                  </HStack>
                  <Text fontSize="sm" color={mutedText}>
                    {match.opponent ? `Facing ${match.opponent.display_name}` : 'Waiting for an opponent'} ·
                    {' '}
                    {match.visibility === 'public' ? 'Public lobby' : 'Private code'} · Created {formatDate(match.created_at)}
                  </Text>
                </Box>
                <Button
                  size="sm"
                  colorScheme="teal"
                  onClick={() => handleJoin(match.id)}
                  isLoading={joiningId === match.id}
                >
                  Join
                </Button>
              </ListItem>
            ))}
          </List>
        )}
      </CardBody>
    </Card>
  );
}

function MatchModeSelector({
  mode,
  onSelectLocal,
  onSelectOnline,
  onlineAvailable,
}: {
  mode: 'local' | 'online';
  onSelectLocal: () => void;
  onSelectOnline: () => void;
  onlineAvailable: boolean;
}) {
  return (
    <Card>
      <CardBody>
        <Stack direction={{ base: 'column', md: 'row' }} justify="space-between" align={{ base: 'stretch', md: 'center' }} spacing={4}>
          <Stack spacing={1}>
            <Heading size="sm">Choose how to play</Heading>
            <Text fontSize="sm" color="gray.500">
              Join online matchmaking or start a local game on this device.
            </Text>
          </Stack>
          <ButtonGroup isAttached variant="outline">
            <Tooltip
              label={onlineAvailable ? undefined : 'Sign in to play rated games and join online lobbies'}
              isDisabled={onlineAvailable}
            >
              <Button
                colorScheme={mode === 'online' ? 'teal' : undefined}
                variant={mode === 'online' ? 'solid' : 'outline'}
                onClick={onSelectOnline}
              >
                Online lobby
              </Button>
            </Tooltip>
            <Button
              colorScheme={mode === 'local' ? 'teal' : undefined}
              variant={mode === 'local' ? 'solid' : 'outline'}
              onClick={onSelectLocal}
            >
              Local match
            </Button>
          </ButtonGroup>
        </Stack>
      </CardBody>
    </Card>
  );
}

function LocalMatchPanel({ onExit }: { onExit: () => void }) {
  const { cardBg, cardBorder, mutedText } = useSurfaceTokens();
  return <LocalMatchContent onExit={onExit} cardBg={cardBg} cardBorder={cardBorder} mutedText={mutedText} />;
}

function LocalMatchContent({
  onExit,
  cardBg,
  cardBorder,
  mutedText,
}: {
  onExit: () => void;
  cardBg: string;
  cardBorder: string;
  mutedText: string;
}) {
  const {
    loading,
    initialize,
    board,
    selectable,
    cancelSelectable,
    onCellClick,
    onCellHover,
    onCellLeave,
    buttons,
    undo,
    redo,
    nextPlayer,
    controls,
  } = useLocalSantorini();
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await initialize();
        if (!cancelled) {
          await controls.setGameMode('Human');
          setInitialized(true);
        }
      } catch (error) {
        console.error('Failed to initialize local match engine', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [controls, initialize]);

  const currentPlayer = nextPlayer === 0 ? 'Blue (Player 1)' : 'Red (Player 2)';

  return (
    <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder} w="100%">
      <CardHeader>
        <Flex justify="space-between" align={{ base: 'flex-start', md: 'center' }} direction={{ base: 'column', md: 'row' }} gap={3}>
          <Stack spacing={1}>
            <Heading size="md">Local match</Heading>
            <Text fontSize="sm" color={mutedText}>
              Pass the device between players. {initialized ? `Current turn: ${currentPlayer}` : 'Preparing board...'}
            </Text>
          </Stack>
          <Button variant="outline" size="sm" onClick={onExit}>
            End local match
          </Button>
        </Flex>
      </CardHeader>
      <CardBody>
        <Stack spacing={6}>
          <Box display="flex" justifyContent="center">
            {loading ? (
              <Center py={8} w="100%">
                <Spinner />
              </Center>
            ) : (
              <GameBoard
                board={board}
                selectable={selectable}
                cancelSelectable={cancelSelectable}
                onCellClick={onCellClick}
                onCellHover={onCellHover}
                onCellLeave={onCellLeave}
                buttons={buttons}
                undo={undo}
                redo={redo}
              />
            )}
          </Box>
          <HStack spacing={3} justify="center" wrap="wrap">
            <Button colorScheme="teal" onClick={() => controls.reset()} isDisabled={loading}>
              Reset board
            </Button>
            <Button variant="outline" onClick={undo} isDisabled={loading || !buttons.canUndo}>
              Undo
            </Button>
            <Button variant="outline" onClick={redo} isDisabled={loading || !buttons.canRedo}>
              Redo
            </Button>
            <Badge colorScheme={nextPlayer === 0 ? 'blue' : 'red'}>{currentPlayer}</Badge>
          </HStack>
        </Stack>
      </CardBody>
    </Card>
  );
}

function ActiveMatchPanel({
  sessionMode,
  match,
  role,
  moves,
  joinCode,
  onSubmitMove,
  onLeave,
  onOfferRematch,
  onGameComplete,
  onStopLocal,
  connectionStates,
  currentUserId,
  onlineEnabled,
}: {
  sessionMode: ReturnType<typeof useMatchLobby>['sessionMode'];
  match: LobbyMatch | null;
  role: 'creator' | 'opponent' | null;
  moves: ReturnType<typeof useMatchLobby>['moves'];
  joinCode: string | null;
  onSubmitMove: ReturnType<typeof useMatchLobby>['submitMove'];
  onLeave: (matchId?: string | null) => Promise<void>;
  onOfferRematch: ReturnType<typeof useMatchLobby>['offerRematch'];
  onGameComplete: (status: MatchStatus, payload?: { winner_id?: string | null }) => Promise<void>;
  onStopLocal: () => void;
  connectionStates: ReturnType<typeof useMatchLobby>['connectionStates'];
  currentUserId: string | null;
  onlineEnabled: boolean;
}) {
  if (sessionMode === 'local') {
    return <LocalMatchPanel onExit={onStopLocal} />;
  }

  if (sessionMode === 'online') {
    return (
      <SantoriniProvider evaluationEnabled={false}>
        <ActiveMatchContent
          match={match}
          role={role}
          moves={moves}
          joinCode={joinCode}
          onSubmitMove={onSubmitMove}
          onLeave={onLeave}
          onOfferRematch={onOfferRematch}
          onGameComplete={onGameComplete}
          connectionStates={connectionStates}
          currentUserId={currentUserId}
          onlineEnabled={onlineEnabled}
        />
      </SantoriniProvider>
    );
  }

  const { cardBg, cardBorder, mutedText } = useSurfaceTokens();
  return (
    <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder} w="100%">
      <CardBody>
        <Center py={10}>
          <Stack spacing={3} textAlign="center">
            <Heading size="md">Start playing</Heading>
            <Text color={mutedText}>Select a mode above to begin a new Santorini match.</Text>
          </Stack>
        </Center>
      </CardBody>
    </Card>
  );
}

function ActiveMatchContent({
  match,
  role,
  moves,
  joinCode,
  onSubmitMove,
  onLeave,
  onOfferRematch,
  onGameComplete,
  connectionStates,
  currentUserId,
  onlineEnabled,
}: {
  match: LobbyMatch | null;
  role: 'creator' | 'opponent' | null;
  moves: ReturnType<typeof useMatchLobby>['moves'];
  joinCode: string | null;
  onSubmitMove: ReturnType<typeof useMatchLobby>['submitMove'];
  onLeave: (matchId?: string | null) => Promise<void>;
  onOfferRematch: ReturnType<typeof useMatchLobby>['offerRematch'];
  onGameComplete: (status: MatchStatus, payload?: { winner_id?: string | null}) => Promise<void>;
  connectionStates: ReturnType<typeof useMatchLobby>['connectionStates'];
  currentUserId: string | null;
  onlineEnabled: boolean;
}) {
  const toast = useToast();
  const [offerBusy, setOfferBusy] = useBoolean();
  const [leaveBusy, setLeaveBusy] = useBoolean();
  const lobbyMatch = match ?? null;
  const { cardBg, cardBorder, mutedText, helperText, strongText, accentHeading, panelBg } = useSurfaceTokens();
  const googleHoverBg = useColorModeValue('gray.100', 'whiteAlpha.300');
  const googleActiveBg = useColorModeValue('gray.200', 'whiteAlpha.200');
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
  const handleGameComplete = useCallback(async (winnerId: string | null) => {
    if (!lobbyMatch) return;
    
    try {
      // Update match status to completed with winner
      await onGameComplete('completed', { winner_id: winnerId });
      
      // Show completion toast
      if (winnerId) {
        const winnerName = winnerId === lobbyMatch.creator_id 
          ? lobbyMatch.creator?.display_name ?? 'Player 1'
          : lobbyMatch.opponent?.display_name ?? 'Player 2';
        toast({
          title: 'Game completed!',
          description: `${winnerName} wins!`,
          status: 'success',
          duration: 5000,
        });
      } else {
        toast({
          title: 'Game completed!',
          description: 'The game ended in a draw.',
          status: 'info',
          duration: 5000,
        });
      }
    } catch (error) {
      console.error('Failed to complete game:', error);
      toast({
        title: 'Error completing game',
        status: 'error',
        description: 'Failed to update match status.',
      });
    }
  }, [lobbyMatch, onGameComplete, toast]);

  // Use the shared Santorini instance from provider
  const santorini = useOnlineSantorini({
    match: lobbyMatch,
    role: role,
    moves: moves,
    onSubmitMove: onSubmitMove,
    onGameComplete: handleGameComplete,
  });
  const creatorName = lobbyMatch?.creator?.display_name ?? 'Player 1 (Blue)';
  const opponentName = lobbyMatch?.opponent?.display_name ?? 'Player 2 (Red)';
  const creatorClock = santorini.formatClock(santorini.creatorClockMs);
  const opponentClock = santorini.formatClock(santorini.opponentClockMs);
  const creatorTurnActive = santorini.currentTurn === 'creator';
  const opponentTurnActive = santorini.currentTurn === 'opponent';

  const handleLeave = async () => {
    setLeaveBusy.on();
    try {
      await onLeave(match?.id);
      await santorini.resetMatch();
    } finally {
      setLeaveBusy.off();
    }
  };

  const handleOfferRematch = async () => {
    if (!lobbyMatch) return;
    setOfferBusy.on();
    try {
      const result = await onOfferRematch();
      if (result) {
        toast({
          title: 'Rematch created',
          description: `Share code ${result.private_join_code ?? result.id.slice(0, 8)}`,
          status: 'success',
        });
      }
    } catch (error) {
      toast({
        title: 'Failed to create rematch',
        status: 'error',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setOfferBusy.off();
    }
  };

  const resolveConnectionState = useCallback(
    (playerId: string | null | undefined, fallbackStatus: ConnectionQuality = 'offline'): PlayerConnectionState | null => {
      if (!playerId) return null;
      const existing = connectionStates[playerId];
      if (existing) return existing;
      const resolvedRole =
        lobbyMatch?.creator_id === playerId
          ? 'creator'
          : lobbyMatch?.opponent_id === playerId
            ? 'opponent'
            : null;
      const isSelf = currentUserId === playerId;
      const status: ConnectionQuality = isSelf && onlineEnabled ? 'connecting' : fallbackStatus;
      return {
        playerId,
        role: resolvedRole,
        status,
        lastSeen: null,
        isSelf,
      };
    },
    [connectionStates, currentUserId, lobbyMatch, onlineEnabled],
  );

  const creatorConnection = useMemo(
    () => resolveConnectionState(lobbyMatch?.creator_id),
    [lobbyMatch?.creator_id, resolveConnectionState],
  );
  const opponentConnection = useMemo(
    () => resolveConnectionState(lobbyMatch?.opponent_id),
    [lobbyMatch?.opponent_id, resolveConnectionState],
  );

  // Note: Abort feature hooks are available but UI implementation is minimal for now
  // Full implementation with request/response flow can be added later

  const showJoinCode = lobbyMatch?.visibility === 'private' && joinCode;

  return (
    <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder} w="100%">
      <CardHeader>
        <Flex justify="space-between" align="center">
          <Stack spacing={1}>
            <Heading size="md">Active match</Heading>
            {lobbyMatch && (
              <HStack spacing={2} fontSize="sm" color={mutedText} align="center" flexWrap="wrap">
                <HStack spacing={1} align="center">
                  <Text>{creatorName}</Text>
                  {creatorConnection && (
                    <ConnectionIndicator
                      status={creatorConnection.status}
                      lastSeen={creatorConnection.lastSeen}
                      isSelf={creatorConnection.isSelf}
                      size="xs"
                    />
                  )}
                </HStack>
                <Text>vs</Text>
                <HStack spacing={1} align="center">
                  <Text>{lobbyMatch.opponent ? opponentName : 'Waiting for opponent'}</Text>
                  {lobbyMatch.opponent && opponentConnection && (
                    <ConnectionIndicator
                      status={opponentConnection.status}
                      lastSeen={opponentConnection.lastSeen}
                      isSelf={opponentConnection.isSelf}
                      size="xs"
                    />
                  )}
                </HStack>
              </HStack>
            )}
          </Stack>
          <HStack spacing={3}>
            {showJoinCode && (
              <Badge colorScheme="orange" fontSize="0.8rem">
                Code: {joinCode}
              </Badge>
            )}
            <Badge colorScheme={lobbyMatch?.rated ? 'purple' : 'gray'}>
              {lobbyMatch?.rated ? 'Rated' : 'Casual'}
            </Badge>
            {lobbyMatch && lobbyMatch.clock_initial_seconds > 0 && (
              <Badge colorScheme="blue">
                {Math.round(lobbyMatch.clock_initial_seconds / 60)}+{lobbyMatch.clock_increment_seconds}
              </Badge>
            )}
          </HStack>
        </Flex>
      </CardHeader>
      <CardBody>
        {!lobbyMatch ? (
          <Center py={10}>
            <Text color={mutedText}>Select or create a match to begin.</Text>
          </Center>
        ) : (
          <Grid templateColumns={{ base: '1fr', xl: '1.2fr 0.8fr' }} gap={8} alignItems="flex-start">
            <GridItem>
              <VStack spacing={4} align="stretch">
                <Box
                  bg={panelBg}
                  borderRadius="xl"
                  borderWidth="1px"
                  borderColor={cardBorder}
                  p={{ base: 2, md: 3 }}
                  display="flex"
                  justifyContent="center"
                >
                  {/* TODO: Implement online undo request flow */}
                  <GameBoard
                    board={santorini.board}
                    selectable={santorini.selectable}
                    cancelSelectable={santorini.cancelSelectable}
                    onCellClick={santorini.onCellClick}
                    onCellHover={santorini.onCellHover}
                    onCellLeave={santorini.onCellLeave}
                    buttons={santorini.buttons}
                    undo={santorini.undo}
                    redo={santorini.redo}
                    undoLabel="Request undo"
                    hideRedoButton
                    undoDisabledOverride
                  />
                </Box>
                <Stack
                  direction={{ base: 'column', sm: 'row' }}
                  spacing={{ base: 3, sm: 4 }}
                  justify="space-between"
                  w="100%"
                  align={{ base: 'stretch', sm: 'center' }}
                >
                  <VStack spacing={1} align={{ base: 'center', sm: 'flex-start' }} w="100%">
                    <Text fontSize="sm" color={mutedText}>
                      {role === 'creator' ? 'Your clock' : 'Player 1 (Blue)'}
                    </Text>
                    <Heading size="lg" color={creatorTurnActive ? accentHeading : strongText}>
                      {creatorClock}
                    </Heading>
                    <HStack spacing={1} justify={{ base: 'center', sm: 'flex-start' }}>
                      <Text fontSize="xs" color={helperText}>
                        {creatorName}
                      </Text>
                      {creatorConnection && (
                        <ConnectionIndicator
                          status={creatorConnection.status}
                          lastSeen={creatorConnection.lastSeen}
                          isSelf={creatorConnection.isSelf}
                          size="xs"
                        />
                      )}
                    </HStack>
                  </VStack>
                  <VStack spacing={1} align={{ base: 'center', sm: 'flex-end' }} w="100%">
                    <Text fontSize="sm" color={mutedText} textAlign={{ base: 'center', sm: 'right' }}>
                      {role === 'opponent' ? 'Your clock' : 'Player 2 (Red)'}
                    </Text>
                    <Heading size="lg" color={opponentTurnActive ? accentHeading : strongText}>
                      {opponentClock}
                    </Heading>
                    <HStack spacing={1} justify={{ base: 'center', sm: 'flex-end' }}>
                      <Text fontSize="xs" color={helperText}>
                        {opponentName}
                      </Text>
                      {opponentConnection && (
                        <ConnectionIndicator
                          status={opponentConnection.status}
                          lastSeen={opponentConnection.lastSeen}
                          isSelf={opponentConnection.isSelf}
                          size="xs"
                        />
                      )}
                    </HStack>
                  </VStack>
                </Stack>
              </VStack>
            </GridItem>
            <GridItem>
              <Stack spacing={6}>
                <Box>
                  <Heading size="sm" mb={3}>
                    Match status
                  </Heading>
                  <Text fontSize="sm" color={strongText}>
                    {role === 'creator'
                      ? 'You are playing as Player 1 (Blue)'
                      : role === 'opponent'
                      ? 'You are playing as Player 2 (Red)'
                      : 'Spectating this match'}
                  </Text>
                  <Text fontSize="sm" color={helperText}>
                    {typedMoves.length} moves played · Turn:{' '}
                    {santorini.currentTurn === 'creator'
                      ? `Player 1 (Blue) – ${creatorName}`
                      : `Player 2 (Red) – ${opponentName}`}
                  </Text>
                </Box>
                <Box>
                  <Heading size="sm" mb={3}>
                    Recent moves
                  </Heading>
                  {santorini.history.length === 0 ? (
                    <Text color={mutedText} fontSize="sm">
                      No moves yet. Use the board to make the first move.
                    </Text>
                  ) : (
                    <Stack spacing={2} maxH="220px" overflowY="auto">
                      {[...santorini.history]
                        .slice()
                        .reverse()
                        .map((entry, index) => (
                          <Box key={`${entry.action}-${index}`} borderBottomWidth="1px" borderColor={cardBorder} pb={2}>
                            <Text fontWeight="semibold" fontSize="sm">
                              Move {santorini.history.length - index}
                            </Text>
                            <Text fontSize="sm" color={mutedText}>
                              {entry.description || `Action ${entry.action}`}
                            </Text>
                          </Box>
                        ))}
                    </Stack>
                  )}
                </Box>
                <Box>
                  <Heading size="sm" mb={3}>
                    Actions
                  </Heading>
                  <ButtonGroup size="sm" variant="outline" spacing={3} flexWrap="wrap">
                    <Tooltip label="Resign and lose the game (affects rating if rated)" hasArrow>
                      <Button colorScheme="red" onClick={handleLeave} isLoading={leaveBusy}>
                        Resign
                      </Button>
                    </Tooltip>
                    <Tooltip label="Offer a new game with the same settings" hasArrow>
                      <Button colorScheme="teal" onClick={handleOfferRematch} isLoading={offerBusy} isDisabled={!role || offerBusy}>
                        Offer rematch
                      </Button>
                    </Tooltip>
                    <Tooltip label="Review this game from the Analyze tab" hasArrow>
                      <Button
                        onClick={() => {
                          if (!lobbyMatch) return;
                          localStorage.setItem('santorini:lastAnalyzedMatch', lobbyMatch.id);
                          toast({
                            title: 'Ready for analysis',
                            description: 'Open the Analyze tab to review this game.',
                            status: 'success',
                          });
                        }}
                      >
                        Analyze game
                      </Button>
                    </Tooltip>
                  </ButtonGroup>
                </Box>
              </Stack>
            </GridItem>
          </Grid>
        )}
      </CardBody>
    </Card>
  );
}

function PlaySignInGate({ auth }: { auth: SupabaseAuthState }) {
  const {
    profile,
    session,
    loading,
    error,
    isConfigured,
    signInWithGoogle,
    signOut,
    refreshProfile,
  } = auth;
  const [startingGoogle, setStartingGoogle] = useBoolean(false);
  const [retrying, setRetrying] = useBoolean(false);
  const [signingOut, setSigningOut] = useBoolean(false);
  const toast = useToast();
  const googleHoverBg = useColorModeValue('gray.100', 'whiteAlpha.300');
  const googleActiveBg = useColorModeValue('gray.200', 'whiteAlpha.200');
  const { cardBg, cardBorder, mutedText } = useSurfaceTokens();

  const handleGoogleSignIn = async () => {
    try {
      setStartingGoogle.on();
      await signInWithGoogle();
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

  const handleRetry = async () => {
    setRetrying.on();
    try {
      await refreshProfile();
    } catch (retryError) {
      toast({
        title: 'Unable to refresh',
        status: 'error',
        description: retryError instanceof Error ? retryError.message : 'Please try again later.',
      });
    } finally {
      setRetrying.off();
    }
  };

  const handleSignOut = async () => {
    setSigningOut.on();
    try {
      await signOut();
      toast({ title: 'Signed out', status: 'info' });
    } catch (signOutError) {
      toast({
        title: 'Sign-out failed',
        status: 'error',
        description: signOutError instanceof Error ? signOutError.message : 'Unable to sign out right now.',
      });
    } finally {
      setSigningOut.off();
    }
  };

  if (loading) {
    return (
      <Center py={20}>
        <Spinner size="lg" />
      </Center>
    );
  }

  if (!isConfigured) {
    return (
      <Alert status="warning" borderRadius="md">
        <AlertIcon />
        <Box>
          <AlertTitle>Supabase not configured</AlertTitle>
          <AlertDescription>
            Online play and authentication are disabled. Follow SUPABASE_SETUP.md to configure Supabase before signing in.
          </AlertDescription>
        </Box>
      </Alert>
    );
  }

  if (error) {
    return (
      <Alert status="error" borderRadius="md" alignItems="flex-start">
        <AlertIcon />
        <Box flex="1">
          <AlertTitle>Authentication issue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <Stack direction={{ base: 'column', sm: 'row' }} spacing={3} mt={4}>
            <Button size="sm" colorScheme="teal" onClick={handleRetry} isLoading={retrying}>
              Try again
            </Button>
            {session && (
              <Button size="sm" variant="outline" onClick={handleSignOut} isLoading={signingOut}>
                Sign out
              </Button>
            )}
          </Stack>
        </Box>
      </Alert>
    );
  }

  if (!profile) {
    return (
      <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder} w="100%">
        <CardBody as={Stack} spacing={6} align="center" textAlign="center" py={{ base: 8, md: 10 }}>
          <Stack spacing={2} maxW="lg">
            <Heading size="md">Sign in with Google to play online</Heading>
            <Text color={mutedText}>
              Challenge real opponents, protect your rating, and sync your Santorini journey across every device.
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
          <Text fontSize="sm" color={mutedText} maxW="md">
            Customize your profile from the Profile tab after connecting.
          </Text>
        </CardBody>
      </Card>
    );
  }

  return null;
}

function PlayWorkspace({ auth }: { auth: SupabaseAuthState }) {
  const lobby = useMatchLobby(auth.profile);
  const [joiningCode, setJoiningCode] = useState('');
  const { isOpen: isCreateOpen, onOpen: onCreateOpen, onClose: onCreateClose } = useDisclosure();
  const { isOpen: isJoinOpen, onOpen: onJoinOpen, onClose: onJoinClose } = useDisclosure();
  const toast = useToast();
  const { cardBg, cardBorder, mutedText, accentHeading } = useSurfaceTokens();
  
  // Theme-aware colors for active game cards - MUST be at component top level!
  const activeGameBg = useColorModeValue('teal.50', 'teal.900');
  const activeGameBorder = useColorModeValue('teal.200', 'teal.600');
  const activeGameHoverBorder = useColorModeValue('teal.300', 'teal.500');

  const initializedOnlineRef = useRef(false);
  const sessionMode = lobby.sessionMode ?? 'online';
  const inProgressMatches = useMemo(
    () => lobby.myMatches.filter((match) => match.status === 'in_progress'),
    [lobby.myMatches],
  );
  const activeOpponentName = useMemo(() => {
    if (!auth.profile || !lobby.activeMatch || lobby.activeMatch.status !== 'in_progress') {
      return null;
    }
    const isCreator = lobby.activeMatch.creator_id === auth.profile.id;
    const opponent = isCreator ? lobby.activeMatch.opponent : lobby.activeMatch.creator;
    return opponent?.display_name ?? 'Opponent';
  }, [auth.profile, lobby.activeMatch]);
  const showActiveStatusBanner = Boolean(auth.profile) && sessionMode === 'online' && inProgressMatches.length > 0;

  useEffect(() => {
    // Auto-enable online mode by default
    if (!initializedOnlineRef.current && !lobby.sessionMode) {
      lobby.enableOnline();
      initializedOnlineRef.current = true;
    }
  }, [lobby.sessionMode, lobby.enableOnline]);

  const handleCreate = async (payload: CreateMatchPayload) => {
    await lobby.createMatch(payload);
  };

  const handleJoinByCode = async () => {
    if (!joiningCode) return;
    try {
      await lobby.joinMatch(joiningCode.trim());
      toast({ title: 'Match joined successfully!', status: 'success' });
      setJoiningCode('');
      onJoinClose();
    } catch (error: any) {
      if (error.code === 'ACTIVE_GAME_EXISTS') {
        toast({
          title: 'Active game exists',
          description: error.message,
          status: 'warning',
          duration: 5000,
        });
        onJoinClose();
        // The user is already on the Play tab, so no navigation needed
      } else {
        toast({
          title: 'Unable to join',
          status: 'error',
          description: error instanceof Error ? error.message : 'Invalid code or match unavailable.',
        });
      }
    }
  };

  return (
    <Stack spacing={6} py={{ base: 6, md: 10 }}>
      <PlaySignInGate auth={auth} />
      
      {/* Combined Mode Selector + Action Buttons */}
      {auth.profile && (
        <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder}>
          <CardBody>
            <Flex justify="space-between" align="center" flexWrap="wrap" gap={4}>
              {/* Mode Selector */}
              <ButtonGroup size="md" isAttached variant="outline">
                <Button
                  colorScheme={sessionMode === 'online' ? 'teal' : undefined}
                  variant={sessionMode === 'online' ? 'solid' : 'outline'}
                  onClick={() => {
                    if (sessionMode !== 'online') {
                      lobby.enableOnline();
                    }
                  }}
                >
                  Online lobby
                </Button>
                <Button
                  colorScheme={sessionMode === 'local' ? 'teal' : undefined}
                  variant={sessionMode === 'local' ? 'solid' : 'outline'}
                  onClick={() => {
                    if (sessionMode !== 'local') {
                      lobby.startLocalMatch();
                    }
                  }}
                >
                  Local match
                </Button>
              </ButtonGroup>

              {/* Action Buttons (only for online mode) */}
              {sessionMode === 'online' && (
                <HStack spacing={3}>
                  <Button
                    leftIcon={<AddIcon />}
                    colorScheme="teal"
                    onClick={onCreateOpen}
                    size="md"
                  >
                    Create Match
                  </Button>
                  <Button
                    variant="outline"
                    colorScheme="teal"
                    onClick={onJoinOpen}
                    size="md"
                  >
                    Join by Code
                  </Button>
                </HStack>
              )}
            </Flex>
          </CardBody>
        </Card>
      )}

      {showActiveStatusBanner && (
        <Alert status="info" variant="left-accent" borderRadius="md" alignItems="flex-start">
          <AlertIcon />
          <Stack spacing={0} fontSize="sm">
            <AlertTitle fontSize="sm">
              {inProgressMatches.length === 1
                ? 'You have 1 active game'
                : `You have ${inProgressMatches.length} active games`}
            </AlertTitle>
            <AlertDescription>
              {activeOpponentName
                ? `Currently playing vs ${activeOpponentName}. Use the My Matches panel to switch between games.`
                : 'Use the My Matches panel to jump between in-progress matches.'}
            </AlertDescription>
          </Stack>
        </Alert>
      )}

      {!auth.profile && (
        <MatchModeSelector
          mode={sessionMode}
          onSelectLocal={() => {
            if (sessionMode !== 'local') {
              lobby.startLocalMatch();
            }
          }}
          onSelectOnline={() => {
            if (sessionMode !== 'online') {
              lobby.enableOnline();
            }
          }}
          onlineAvailable={Boolean(auth.profile)}
        />
      )}
      {sessionMode === 'online' && !auth.profile && (
        <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder}>
          <CardBody>
            <Stack spacing={3} textAlign="center">
              <Heading size="sm">Sign in to join the lobby</Heading>
              <Text fontSize="sm" color={mutedText}>
                Connect your account to challenge other players, save match history, and compete on the leaderboard.
              </Text>
            </Stack>
          </CardBody>
        </Card>
      )}
      
      {/* Match Creation Modal */}
      <MatchCreationModal
        isOpen={isCreateOpen}
        onClose={onCreateClose}
        onCreate={handleCreate}
        loading={lobby.loading}
      />
      
      {/* Join by Code Modal */}
      <Modal isOpen={isJoinOpen} onClose={onJoinClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Join by Code</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Stack spacing={3}>
              <Text fontSize="sm" color={mutedText}>
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
      
      {sessionMode === 'online' && auth.profile && (
        <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder}>
          <CardHeader>
            <Heading size="md" color={accentHeading}>
              Games
            </Heading>
          </CardHeader>
          <CardBody as={Stack} spacing={6}>
            {/* Your Active Matches First */}
            {lobby.myMatches && lobby.myMatches.length > 0 && (
              <Stack spacing={3}>
                <Heading size="sm" color={mutedText}>
                  Your Games
                </Heading>
                <Stack spacing={2}>
                  {lobby.myMatches.map((m) => {
                    const isActive = m.id === lobby.activeMatchId;
                    const isCreator = m.creator_id === auth.profile?.id;
                    const opponentName = isCreator ? m.opponent?.display_name : m.creator?.display_name;
                    const status = m.status === 'waiting_for_opponent' ? 'Waiting...' : 
                                   m.status === 'completed' ? 'Finished' : 'In Progress';
                    
                    return (
                      <Card
                        key={m.id}
                        variant="outline"
                        bg={isActive ? activeGameBg : undefined}
                        borderColor={isActive ? activeGameBorder : cardBorder}
                        cursor="pointer"
                        onClick={() => lobby.setActiveMatch(m.id)}
                        _hover={{ borderColor: activeGameHoverBorder }}
                      >
                        <CardBody py={3}>
                          <Flex justify="space-between" align="center">
                            <Stack spacing={0}>
                              <HStack spacing={2}>
                                <Text fontWeight="semibold" fontSize="sm">
                                  {opponentName || 'Waiting for opponent...'}
                                </Text>
                                <Badge colorScheme={
                                  m.status === 'in_progress' ? 'green' :
                                  m.status === 'waiting_for_opponent' ? 'yellow' : 'gray'
                                } size="sm">
                                  {status}
                                </Badge>
                              </HStack>
                              <Text fontSize="xs" color={mutedText}>
                                {m.created_at ? formatDate(m.created_at) : ''}
                              </Text>
                            </Stack>
                            {m.status === 'waiting_for_opponent' && (
                              <Button
                                size="xs"
                                colorScheme="red"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  lobby.leaveMatch(m.id);
                                }}
                              >
                                Cancel
                              </Button>
                            )}
                          </Flex>
                        </CardBody>
                      </Card>
                    );
                  })}
                </Stack>
              </Stack>
            )}

            {/* Open Public Games */}
            <Stack spacing={3}>
              <Heading size="sm" color={mutedText}>
                Open Games
              </Heading>
              {lobby.loading ? (
                <Center py={8}>
                  <Spinner />
                </Center>
              ) : lobby.matches && lobby.matches.length > 0 ? (
                <Stack spacing={2}>
                  {lobby.matches.map((m) => {
                    const creatorName = m.creator?.display_name || 'Anonymous';
                    const clockInfo = m.clock_initial_seconds > 0
                      ? `${Math.floor(m.clock_initial_seconds / 60)}+${m.clock_increment_seconds}`
                      : 'No clock';

                    return (
                      <Card key={m.id} variant="outline" borderColor={cardBorder}>
                        <CardBody py={3}>
                          <Flex justify="space-between" align="center">
                            <Stack spacing={0}>
                              <HStack spacing={2}>
                                <Text fontWeight="semibold" fontSize="sm">
                                  {creatorName}
                                </Text>
                                {m.rated && <Badge colorScheme="purple" size="sm">Rated</Badge>}
                              </HStack>
                              <Text fontSize="xs" color={mutedText}>
                                {clockInfo} • {formatDate(m.created_at)}
                              </Text>
                            </Stack>
                            <Button
                              size="sm"
                              colorScheme="teal"
                              onClick={() => lobby.joinMatch(m.id)}
                            >
                              Join
                            </Button>
                          </Flex>
                        </CardBody>
                      </Card>
                    );
                  })}
                </Stack>
              ) : (
                <Text fontSize="sm" color={mutedText} py={4} textAlign="center">
                  No open games available. Create one to get started!
                </Text>
              )}
            </Stack>
          </CardBody>
        </Card>
      )}
      <ActiveMatchPanel
        sessionMode={sessionMode}
        match={lobby.activeMatch}
        role={lobby.activeRole}
        moves={lobby.moves}
        joinCode={lobby.joinCode}
        onSubmitMove={lobby.submitMove}
        onLeave={lobby.leaveMatch}
        onOfferRematch={lobby.offerRematch}
        onGameComplete={lobby.updateMatchStatus}
        onStopLocal={lobby.stopLocalMatch}
        connectionStates={lobby.connectionStates}
        currentUserId={auth.profile?.id ?? null}
        onlineEnabled={lobby.onlineEnabled}
      />
    </Stack>
  );
}

export default PlayWorkspace;
