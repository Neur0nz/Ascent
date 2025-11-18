import { ReactNode, useMemo } from 'react';
import {
  Box,
  Flex,
  Heading,
  HStack,
  IconButton,
  Spacer,
  Tab,
  TabList,
  Text,
  Tooltip,
  VStack,
  useColorMode,
  useColorModeValue,
} from '@chakra-ui/react';
import { MoonIcon, SunIcon } from '@chakra-ui/icons';
import { LayoutGroup, motion } from 'framer-motion';
import AuthJourney from '@components/auth/AuthJourney';
import { useSurfaceTokens } from '@/theme/useSurfaceTokens';
import type { SupabaseAuthState } from '@hooks/useSupabaseAuth';

export type AppTab = 'lobby' | 'play' | 'leaderboard' | 'practice' | 'analysis' | 'profile';

interface HeaderBarProps {
  activeTab: AppTab;
  actions?: ReactNode;
  auth: SupabaseAuthState;
  onNavigateToProfile: () => void;
}

export const NAV_TABS: ReadonlyArray<{ key: AppTab; label: string; helper: string }> = [
  { key: 'lobby', label: 'Lobby', helper: 'Find & join games' },
  { key: 'play', label: 'Play', helper: 'Your active game' },
  { key: 'leaderboard', label: 'Leaderboard', helper: 'Player rankings' },
  { key: 'practice', label: 'Practice', helper: 'Play vs AI' },
  { key: 'analysis', label: 'Analysis', helper: 'Review games' },
  { key: 'profile', label: 'Profile', helper: 'Your stats' },
];

function HeaderBar({ activeTab, actions, auth, onNavigateToProfile }: HeaderBarProps) {
  const { colorMode, toggleColorMode } = useColorMode();
  const headingColor = useColorModeValue('gray.900', 'white');
  const descriptionColor = useColorModeValue('gray.600', 'whiteAlpha.700');
  const helperMuted = useColorModeValue('gray.600', 'whiteAlpha.700');
  const tabBg = useColorModeValue('gray.50', 'whiteAlpha.100');
  const tabHover = useColorModeValue('white', 'whiteAlpha.200');
  const tabSelected = useColorModeValue('teal.50', 'teal.900');
  const tabSelectedColor = useColorModeValue('teal.800', 'teal.100');
  const tabHelperColor = useColorModeValue('gray.600', 'whiteAlpha.700');
  const { headerGradient, headerBorder, headerAccent } = useSurfaceTokens();
  const MotionBox = motion(Box);

  const activeTabDetails = useMemo(() => NAV_TABS.find((tab) => tab.key === activeTab), [activeTab]);

  return (
    <Box
      as="header"
      role="banner"
      bgGradient={headerGradient}
      borderBottomWidth="1px"
      borderColor={headerBorder}
      px={{ base: 3, md: 8 }}
      py={{ base: 4, md: 5 }}
      boxShadow={{ base: 'sm', md: 'none' }}
    >
      <Flex direction="column" gap={{ base: 3, md: 4 }}>
        <Flex
          direction={{ base: 'column', lg: 'row' }}
          align={{ base: 'flex-start', lg: 'center' }}
          gap={{ base: 2, md: 4 }}
        >
          <VStack align="flex-start" spacing={1}>
            <Heading 
              as="h1" 
              size={{ base: 'md', md: 'lg' }} 
              letterSpacing="tight" 
              color={headingColor}
            >
              Ascent
            </Heading>
            <Text fontSize={{ base: 'sm', md: 'md' }} color={helperMuted}>
              Play Santorini online or practice against AI
            </Text>
          </VStack>
          <Spacer display={{ base: 'none', md: 'block' }} />
          <HStack
            spacing={3}
            align="center"
            w={{ base: '100%', lg: 'auto' }}
            justify={{ base: 'flex-end', lg: 'flex-end' }}
          >
            {actions && <Box display={{ base: 'flex', md: 'none' }}>{actions}</Box>}
            <AuthJourney auth={auth} onNavigateToProfile={onNavigateToProfile} />
            <Tooltip label="Toggle color mode" hasArrow>
              <IconButton
                aria-label="Toggle color mode"
                icon={colorMode === 'dark' ? <SunIcon /> : <MoonIcon />}
                size="sm"
                variant="outline"
                onClick={toggleColorMode}
              />
            </Tooltip>
          </HStack>
        </Flex>
        <Flex
          direction={{ base: 'column-reverse', md: 'row' }}
          align={{ base: 'stretch', md: 'center' }}
          gap={{ base: 3, md: 4 }}
        >
          <LayoutGroup>
            <TabList
              as="nav"
              aria-label="Main navigation"
              display="flex"
              flexWrap="wrap"
              gap={{ base: 1, md: 2 }}
              borderBottom="none"
              justifyContent={{ base: 'center', md: 'flex-start' }}
              w="100%"
              sx={{ 
                button: { 
                  fontWeight: 'semibold',
                  '&:focus-visible': {
                    outline: '2px solid',
                    outlineColor: 'teal.500',
                    outlineOffset: '2px',
                  }
                } 
              }}
            >
              {NAV_TABS.map((tab) => {
                const hidden = tab.key === 'profile';
                return (
                  <Tab
                    key={tab.key}
                    aria-label={`${tab.label}: ${tab.helper}`}
                    aria-current={activeTab === tab.key ? 'page' : undefined}
                    px={{ base: 3, md: 4 }}
                    py={{ base: 2, md: 3 }}
                    borderRadius="lg"
                    bg={tabBg}
                    color={descriptionColor}
                    transition="all 0.15s ease-in-out"
                    _hover={{ bg: tabHover, color: headingColor, transform: 'translateY(-1px)' }}
                    _selected={{
                      bg: tabSelected,
                      color: tabSelectedColor,
                      boxShadow: 'md',
                      transform: 'translateY(-1px)',
                    }}
                    _focusVisible={{
                      outline: '2px solid',
                      outlineColor: 'teal.500',
                      outlineOffset: '2px',
                    }}
                    display={hidden ? 'none' : undefined}
                    position="relative"
                  >
                    <VStack spacing={0} align="flex-start">
                      <Text fontWeight="semibold">{tab.label}</Text>
                      <Text fontSize="xs" color={tabHelperColor}>
                        {tab.helper}
                      </Text>
                    </VStack>
                    {activeTab === tab.key && (
                      <MotionBox
                        layoutId="tab-indicator"
                        position="absolute"
                        insetX={2}
                        bottom="2px"
                        height="3px"
                        borderRadius="full"
                        bg={headerAccent}
                        pointerEvents="none"
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      />
                    )}
                  </Tab>
                );
              })}
            </TabList>
          </LayoutGroup>
          <Spacer />
          <HStack spacing={3} align="center">
            {actions && <HStack spacing={2} display={{ base: 'none', md: 'flex' }}>{actions}</HStack>}
          </HStack>
        </Flex>
      </Flex>
    </Box>
  );
}

export default HeaderBar;
