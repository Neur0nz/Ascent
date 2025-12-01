import {
  Box,
  Button,
  Container,
  Flex,
  IconButton,
  Link,
  Spinner,
  Stack,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  Tooltip,
  useDisclosure,
  useColorModeValue,
  useToast,
} from '@chakra-ui/react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { SearchIcon, TimeIcon } from '@chakra-ui/icons';
import { SantoriniProvider, useSantorini } from '@hooks/useSantorini';
import { useSupabaseAuth } from '@hooks/useSupabaseAuth';
import HeaderBar, { type AppTab, NAV_TABS } from '@components/HeaderBar';
import GameBoard from '@components/GameBoard';
import EvaluationPanel from '@components/EvaluationPanel';
import HistoryModal from '@components/HistoryModal';
import PracticeToolbar from '@components/PracticeToolbar';
import LobbyWorkspace from '@components/play/LobbyWorkspace';
import GamePlayWorkspace from '@components/play/GamePlayWorkspace';
import AnalyzeWorkspace from '@components/analyze/AnalyzeWorkspace';
import ProfileWorkspace from '@components/profile/ProfileWorkspace';
import LeaderboardWorkspace from '@components/leaderboard/LeaderboardWorkspace';
import { MatchLobbyProvider, useMatchLobbyContext } from '@hooks/matchLobbyContext';
import { BoardPreferencesProvider } from '@hooks/useBoardPreferences';
import { AuthLoadingScreen } from '@components/auth/AuthLoadingScreen';
import EvaluationJobToasts from '@components/analyze/EvaluationJobToasts';

const TAB_STORAGE_KEY = 'santorini:lastTab';

/**
 * Normalizes a tab key by resolving aliases.
 * This allows for flexible URLs, e.g., mapping 'analyze' to 'analysis'.
 * @param value The raw tab key from a URL hash or storage.
 * @returns The normalized AppTab or the original value if no alias is found.
 */
const TAB_ALIASES: Record<string, AppTab> = {
  analyze: 'analysis',
  // Future aliases can be added here, e.g., 'board': 'practice'
};

function normalizeTabKey(value: string | null): AppTab | null {
  if (!value) return null;
  return TAB_ALIASES[value] || (value as AppTab);
}

/**
 * Determines the initial tab for the application, updating the URL hash as a side effect.
 * The priority for determining the tab is:
 * 1. A valid tab name from the URL hash (`#tabname`).
 * 2. A valid tab name from localStorage (`santorini:lastTab`).
 * 3. The default tab, 'lobby'.
 *
 * The function ensures the URL hash is synchronized with the resolved tab.
 * @param tabOrder A read-only array of available tab keys.
 * @returns The resolved application tab.
 */
function resolveInitialTab(tabOrder: readonly AppTab[]): AppTab {
  if (typeof window === 'undefined') {
    return 'lobby'; // Default for server-side rendering
  }

  const { hash, pathname, search } = window.location;
  const defaultTab: AppTab = 'lobby';

  // Helper to update the URL hash without triggering a page reload.
  const updateHash = (newTab: AppTab) => {
    try {
      const newHash = `#${newTab}`;
      if (window.location.hash !== newHash) {
        window.history.replaceState(null, '', `${pathname}${search}${newHash}`);
      }
    } catch (error) {
      console.error(`Failed to update URL hash to #${newTab}`, error);
    }
  };

  // 1. Check URL hash for a valid tab. This is the highest priority.
  const hashTab = normalizeTabKey(hash.slice(1));
  if (hashTab && tabOrder.includes(hashTab)) {
    return hashTab;
  }

  // 2. If hash is invalid or missing, check localStorage for the last used tab.
  try {
    const storedTab = normalizeTabKey(window.localStorage.getItem(TAB_STORAGE_KEY));
    if (storedTab && tabOrder.includes(storedTab)) {
      updateHash(storedTab); // Sync URL hash with the stored tab
      return storedTab;
    }
  } catch (error) {
    console.error('Failed to restore last active tab', error);
  }

  // 3. As a fallback, use the default tab and update the URL.
  updateHash(defaultTab);
  return defaultTab;
}

const MotionPanel = motion.div;

function PracticeTabContent({ onShowHistory }: { onShowHistory: () => void }) {
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
    evaluation,
    evaluationStatus,
    topMoves,
    controls,
    redo,
    undo,
    calcOptionsBusy,
    evaluationDepth,
    optionsDepth,
    gameMode,
    difficulty,
    nextPlayer,
    history,
  } = useSantorini();
  const [, startInitializeTransition] = useTransition();
  const creditColor = useColorModeValue('gray.600', 'whiteAlpha.700');
  const isHumanTurn = (() => {
    if (gameMode === 'AI') {
      return false;
    }
    if (gameMode === 'Human') {
      return true;
    }
    if (gameMode === 'P0') {
      return nextPlayer === 0;
    }
    if (gameMode === 'P1') {
      return nextPlayer === 1;
    }
    return false;
  })();
  const practiceTurnColor = nextPlayer === 0 ? 'green.400' : 'red.400';

  // Memoize last move info for visual indicator
  const lastMoveInfo = useMemo(() => {
    if (history.length === 0) return null;
    const last = history[history.length - 1];
    return {
      from: last.from ?? null,
      to: last.to ?? null,
      build: last.build ?? null,
      player: last.player,
    };
  }, [history]);

  useEffect(() => {
    // Initialize game engine in background without blocking urgent UI updates
    startInitializeTransition(() => {
      initialize().catch(console.error);
    });
  }, [initialize, startInitializeTransition]);

  return (
    <Flex direction="column" gap={{ base: 6, md: 8 }}>
      <PracticeToolbar
        controls={controls}
        onReset={controls.reset}
        onShowHistory={onShowHistory}
        buttons={buttons}
        engineLoading={loading}
        currentMode={gameMode}
        currentDifficulty={difficulty}
      />
      <Flex
        direction={{ base: 'column', lg: 'row' }}
        align={{ base: 'center', lg: 'flex-start' }}
        justify={{ base: 'center', lg: 'space-between' }}
        gap={{ base: 6, lg: 8 }}
        flexWrap="nowrap"
        w="100%"
      >
        <Box
          flex="1 1 auto"
          display="flex"
          justifyContent="center"
          w="100%"
          maxW={{ base: '100%', md: '960px' }}
          minW={{ base: '280px', sm: '320px', md: 0 }}
          overflow="visible"
        >
          {loading ? (
            <Flex
              align="center"
              justify="center"
              h={{ base: '300px', sm: '400px', md: '500px', lg: '600px' }}
              w="100%"
              maxW={{ base: '100%', md: '960px' }}
              minH={{ base: '280px', sm: '360px' }}
            >
              <Spinner size="xl" color="teal.300" thickness="4px" />
            </Flex>
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
              isTurnActive={isHumanTurn}
              turnHighlightColor={practiceTurnColor}
              lastMove={lastMoveInfo}
            />
          )}
        </Box>
        <Box
          flex={{ base: '0 0 auto', lg: '0 0 auto' }}
          minW={{ base: '100%', lg: '320px' }}
          maxW={{ base: '100%', lg: '420px' }}
          width={{ base: '100%', lg: '420px' }}
          order={{ base: -1, lg: 0 }}
        >
          <EvaluationPanel
            loading={loading}
            evaluation={evaluation}
            evaluationStatus={evaluationStatus}
            topMoves={topMoves}
            calcOptionsBusy={calcOptionsBusy}
            evaluationDepth={evaluationDepth}
            optionsDepth={optionsDepth}
            refreshEvaluation={controls.refreshEvaluation}
            calculateOptions={controls.calculateOptions}
            updateEvaluationDepth={controls.updateEvaluationDepth}
            updateOptionsDepth={controls.updateOptionsDepth}
          />
        </Box>
      </Flex>
      <Text fontSize="sm" color={creditColor} textAlign="center" mt={4}>
        AI engine by{' '}
        <Link
          href="https://github.com/cestpasphoto/alpha-zero-general"
          isExternal
          color="teal.500"
          fontWeight="medium"
          _hover={{ textDecoration: 'underline' }}
        >
          cestpasphoto
        </Link>
      </Text>
    </Flex>
  );
}

function PracticeHistoryModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { history, controls } = useSantorini();
  return (
    <HistoryModal
      isOpen={isOpen}
      onClose={onClose}
      history={history}
      jumpToMove={controls.jumpToMove}
    />
  );
}

function MatchLobbySideEffects({
  profileId,
  onNavigateToPlay,
}: {
  profileId: string | null;
  onNavigateToPlay: () => void;
}) {
  const lobby = useMatchLobbyContext();
  const toast = useToast();
  const toastBg = useColorModeValue('white', 'gray.700');
  const toastColor = useColorModeValue('gray.800', 'whiteAlpha.900');
  const toastBorder = useColorModeValue('teal.200', 'teal.500');
  const previousOpponentsRef = useRef(new Map<string, string | null>());

  useEffect(() => {
    const previous = previousOpponentsRef.current;
    if (!profileId) {
      previous.clear();
      return;
    }

    if (lobby.sessionMode === 'local') {
      return;
    }

    const relevantMatches = lobby.myMatches.filter(
      (match) =>
        match.creator_id === profileId &&
        match.id !== 'local:match' &&
        (match.status === 'in_progress' || match.status === 'waiting_for_opponent'),
    );

    const activeIds = new Set<string>(relevantMatches.map((match) => match.id));

    for (const match of relevantMatches) {
      const prevOpponent = previous.get(match.id) ?? null;
      const currentOpponent = match.opponent_id ?? null;

      if (!prevOpponent && currentOpponent) {
        const toastId = `opponent-joined-${match.id}`;
        if (!toast.isActive(toastId)) {
          const opponentName = match.opponent?.display_name ?? 'Opponent';
          toast({
            id: toastId,
            position: 'top-right',
            duration: 9000,
            isClosable: true,
            render: () => (
              <Box
                bg={toastBg}
                color={toastColor}
                px={4}
                py={3}
                borderRadius="md"
                boxShadow="lg"
                borderWidth="1px"
                borderColor={toastBorder}
                maxW="420px"
                w="min(100vw - 32px, 420px)"
                mx="auto"
              >
                <Stack spacing={2}>
                  <Text fontWeight="semibold">Opponent joined!</Text>
                  <Text fontSize="sm">{opponentName} just joined your game.</Text>
                  <Button
                    size="sm"
                    colorScheme="teal"
                    alignSelf="flex-start"
                    onClick={() => {
                      lobby.setActiveMatch(match.id);
                      onNavigateToPlay();
                      toast.close(toastId);
                    }}
                  >
                    Go to game
                  </Button>
                </Stack>
              </Box>
            ),
          });
        }
      }

      previous.set(match.id, currentOpponent);
    }

    // Clean up matches that no longer exist in the list
    for (const id of Array.from(previous.keys())) {
      if (!activeIds.has(id)) {
        previous.delete(id);
      }
    }
  }, [
    lobby.myMatches,
    lobby.sessionMode,
    lobby.setActiveMatch,
    onNavigateToPlay,
    profileId,
    toast,
    toastBg,
    toastBorder,
    toastColor,
  ]);

  return null;
}

function App() {
  const { isOpen: isHistoryOpen, onOpen: openHistory, onClose: closeHistory } = useDisclosure();
  const tabOrder = useMemo<AppTab[]>(() => NAV_TABS.map((tab) => tab.key), []);
  const [activeTab, setActiveTab] = useState<AppTab>(() => resolveInitialTab(tabOrder));
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const activeIndex = Math.max(0, tabOrder.indexOf(activeTab));
  const auth = useSupabaseAuth();

  // Update URL hash and localStorage when tab changes
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const { pathname, search, hash } = window.location;
      const nextHash = `#${activeTab}`;
      if (hash !== nextHash) {
        window.history.replaceState(null, '', `${pathname}${search}${nextHash}`);
      }
      window.localStorage.setItem(TAB_STORAGE_KEY, activeTab);
    } catch (error) {
      console.error('Failed to persist last active tab', error);
    }
  }, [activeTab]);

  // Listen for browser back/forward navigation
  useEffect(() => {
    const handleHashChange = () => {
      const hash = normalizeTabKey(window.location.hash.slice(1));
      if (hash && tabOrder.includes(hash)) {
        setActiveTab(hash);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [tabOrder]);

  const tabActions = useMemo(() => {
    switch (activeTab) {
      case 'lobby':
        return null;
      case 'play':
        return null;
      case 'leaderboard':
        return null;
      case 'practice':
        return null;
      case 'analysis':
        return null;
      case 'profile':
        return null;
      default:
        return null;
    }
  }, [activeTab, openHistory]);

  const navigateToAnalysis = useCallback((jobId?: string) => {
    if (jobId) {
      setPendingJobId(jobId);
    }
    setActiveTab('analysis');
  }, []);

  const handleTabChange = (index: number) => {
    const nextTab = tabOrder[index];
    if (!nextTab) {
      return;
    }
    setActiveTab(nextTab);
  };

  const appBg = useColorModeValue('linear(to-br, gray.50, gray.100)', 'linear(to-br, gray.900, gray.800)');
  const appColor = useColorModeValue('gray.900', 'whiteAlpha.900');
  const panelMotionProps = {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8 },
    transition: { duration: 0.32, ease: 'easeOut' },
  };

  // Show loading screen during initial authentication
  if (auth.loading) {
    const isTemporary = auth.profile?.id.startsWith('temp_');
    const message = auth.error ?? (isTemporary ? 'Almost there...' : 'Signing you in...');

    return <AuthLoadingScreen message={message} isTemporary={isTemporary} />;
  }

  return (
    <BoardPreferencesProvider value={{
      showCoordinateLabels: auth.profile?.show_coordinate_labels ?? true,
      showLastMoveIndicator: auth.profile?.show_last_move_indicator ?? false,
    }}>
      <MatchLobbyProvider profile={auth.profile}>
      <MatchLobbySideEffects
        profileId={auth.profile?.id ?? null}
        onNavigateToPlay={() => setActiveTab('play')}
      />
      <EvaluationJobToasts onNavigateToAnalysis={navigateToAnalysis} />
      <Tabs
        index={activeIndex}
        onChange={handleTabChange}
        isLazy
        variant="line"
        h="100%"
        display="flex"
        flexDirection="column"
        minH="100vh"
      >
        <Flex direction="column" flex="1" minH="100vh" bgGradient={appBg} color={appColor} overflowX="hidden">
          <HeaderBar
            activeTab={activeTab}
            actions={tabActions}
            auth={auth}
            onNavigateToProfile={() => setActiveTab('profile')}
            onTabChange={handleTabChange}
          />
          <Flex flex="1" py={{ base: 6, md: 8 }}>
            <Container maxW="7xl" flex="1" px={{ base: 3, md: 6 }}>
              <TabPanels flex="1">
                <TabPanel px={0}>
                  <AnimatePresence mode="wait">
                    {activeTab === 'lobby' && (
                      <MotionPanel key="panel-lobby" {...panelMotionProps} style={{ width: '100%', height: '100%' }}>
                        <LobbyWorkspace
                          auth={auth}
                          onNavigateToPlay={() => setActiveTab('play')}
                          onNavigateToPractice={() => setActiveTab('practice')}
                          onNavigateToAnalysis={() => navigateToAnalysis()}
                          onNavigateToLeaderboard={() => setActiveTab('leaderboard')}
                        />
                      </MotionPanel>
                    )}
                  </AnimatePresence>
                </TabPanel>
                <TabPanel px={0}>
                  <AnimatePresence mode="wait">
                    {activeTab === 'play' && (
                      <MotionPanel key="panel-play" {...panelMotionProps} style={{ width: '100%', height: '100%' }}>
                        <GamePlayWorkspace
                          auth={auth}
                          onNavigateToLobby={() => setActiveTab('lobby')}
                          onNavigateToAnalysis={navigateToAnalysis}
                        />
                      </MotionPanel>
                    )}
                  </AnimatePresence>
                </TabPanel>
                <TabPanel px={0}>
                  <AnimatePresence mode="wait">
                    {activeTab === 'leaderboard' && (
                      <MotionPanel key="panel-leaderboard" {...panelMotionProps} style={{ width: '100%', height: '100%' }}>
                        <LeaderboardWorkspace auth={auth} onNavigateToPlay={() => setActiveTab('play')} />
                      </MotionPanel>
                    )}
                  </AnimatePresence>
                </TabPanel>
                <TabPanel px={0}>
                  <AnimatePresence mode="wait">
                    {activeTab === 'practice' && (
                      <MotionPanel key="panel-practice" {...panelMotionProps} style={{ width: '100%', height: '100%' }}>
                        <SantoriniProvider enginePreference={auth.profile?.engine_preference ?? 'rust'}>
                          <PracticeTabContent onShowHistory={openHistory} />
                          <PracticeHistoryModal isOpen={isHistoryOpen} onClose={closeHistory} />
                        </SantoriniProvider>
                      </MotionPanel>
                    )}
                  </AnimatePresence>
                </TabPanel>
                <TabPanel px={0}>
                  <AnimatePresence mode="wait">
                    {activeTab === 'analysis' && (
                      <MotionPanel key="panel-analysis" {...panelMotionProps} style={{ width: '100%', height: '100%' }}>
                        <SantoriniProvider
                          evaluationEnabled={true}
                          enginePreference={auth.profile?.engine_preference ?? 'rust'}
                          persistState
                          storageNamespace="analysis"
                        >
                          <AnalyzeWorkspace
                            auth={auth}
                            pendingJobId={pendingJobId}
                            onPendingJobConsumed={() => setPendingJobId(null)}
                          />
                        </SantoriniProvider>
                      </MotionPanel>
                    )}
                  </AnimatePresence>
                </TabPanel>
                <TabPanel px={0}>
                  <AnimatePresence mode="wait">
                    {activeTab === 'profile' && (
                      <MotionPanel key="panel-profile" {...panelMotionProps} style={{ width: '100%', height: '100%' }}>
                        <ProfileWorkspace auth={auth} />
                      </MotionPanel>
                    )}
                  </AnimatePresence>
                </TabPanel>
              </TabPanels>
            </Container>
          </Flex>
        </Flex>
      </Tabs>
      </MatchLobbyProvider>
    </BoardPreferencesProvider>
  );
}

export default App;
