import { ReactNode, useMemo } from 'react';
import {
  Box,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  DrawerOverlay,
  Flex,
  Heading,
  HStack,
  IconButton,
  Spacer,
  Tab,
  TabList,
  Text,
  Tooltip,
  useDisclosure,
  VStack,
  useColorMode,
  useColorModeValue,
} from '@chakra-ui/react';
import { HamburgerIcon, MoonIcon, SunIcon } from '@chakra-ui/icons';
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
  onTabChange?: (index: number) => void;
}

export const NAV_TABS: ReadonlyArray<{ key: AppTab; label: string; helper: string }> = [
  { key: 'lobby', label: 'Lobby', helper: 'Find & join games' },
  { key: 'play', label: 'Play', helper: 'Your active game' },
  { key: 'leaderboard', label: 'Leaderboard', helper: 'Player rankings' },
  { key: 'practice', label: 'Practice', helper: 'Play vs AI' },
  { key: 'analysis', label: 'Analysis', helper: 'Review games' },
  { key: 'profile', label: 'Profile', helper: 'Your stats' },
];

function HeaderBar({ activeTab, actions, auth, onNavigateToProfile, onTabChange }: HeaderBarProps) {
  const { colorMode, toggleColorMode } = useColorMode();
  const { isOpen: isDrawerOpen, onOpen: openDrawer, onClose: closeDrawer } = useDisclosure();
  const headingColor = useColorModeValue('gray.900', 'white');
  const descriptionColor = useColorModeValue('gray.600', 'whiteAlpha.700');
  const helperMuted = useColorModeValue('gray.600', 'whiteAlpha.700');
  const tabBg = useColorModeValue('gray.50', 'whiteAlpha.100');
  const tabHover = useColorModeValue('white', 'whiteAlpha.200');
  const tabSelected = useColorModeValue('teal.50', 'teal.900');
  const tabSelectedColor = useColorModeValue('teal.800', 'teal.100');
  const tabHelperColor = useColorModeValue('gray.600', 'whiteAlpha.700');
  const drawerBg = useColorModeValue('white', 'gray.800');
  const drawerItemBg = useColorModeValue('gray.50', 'whiteAlpha.100');
  const drawerItemHover = useColorModeValue('teal.50', 'teal.900');
  const { headerGradient, headerBorder, headerAccent } = useSurfaceTokens();
  const MotionBox = motion.create(Box);

  const handleMobileNavClick = (index: number) => {
    onTabChange?.(index);
    closeDrawer();
  };

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
          <HStack spacing={3} align="center" w={{ base: '100%', lg: 'auto' }}>
            {/* Hamburger menu for mobile */}
            <Tooltip label="Menu" hasArrow display={{ base: 'block', md: 'none' }}>
              <IconButton
                aria-label="Open navigation menu"
                icon={<HamburgerIcon />}
                size="sm"
                variant="ghost"
                onClick={openDrawer}
                display={{ base: 'flex', md: 'none' }}
              />
            </Tooltip>
            <VStack align="flex-start" spacing={1} flex="1">
              <Heading 
                as="h1" 
                size={{ base: 'md', md: 'lg' }} 
                letterSpacing="tight" 
                color={headingColor}
              >
                Ascent
              </Heading>
              <Text fontSize={{ base: 'sm', md: 'md' }} color={helperMuted} display={{ base: 'none', sm: 'block' }}>
                Play Santorini online or practice against AI
              </Text>
            </VStack>
          </HStack>
          <Spacer display={{ base: 'none', md: 'block' }} />
          <HStack
            spacing={3}
            align="center"
            w={{ base: 'auto', lg: 'auto' }}
            justify="flex-end"
            position={{ base: 'absolute', lg: 'relative' }}
            right={{ base: 3, lg: 'auto' }}
            top={{ base: 4, lg: 'auto' }}
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
        {/* Desktop TabList - hidden on mobile */}
        <Flex
          direction={{ base: 'column-reverse', md: 'row' }}
          align={{ base: 'stretch', md: 'center' }}
          gap={{ base: 3, md: 4 }}
          display={{ base: 'none', md: 'flex' }}
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

        {/* Mobile: Current tab indicator */}
        <Box display={{ base: 'block', md: 'none' }} mt={1}>
          <Text fontSize="sm" fontWeight="medium" color={tabSelectedColor}>
            {activeTabDetails?.label}
          </Text>
        </Box>

        {/* Mobile Navigation Drawer */}
        <Drawer isOpen={isDrawerOpen} placement="left" onClose={closeDrawer}>
          <DrawerOverlay />
          <DrawerContent bg={drawerBg}>
            <DrawerCloseButton />
            <DrawerHeader borderBottomWidth="1px">
              <Heading size="md" color={headingColor}>Navigation</Heading>
            </DrawerHeader>
            <DrawerBody p={0}>
              <VStack spacing={0} align="stretch">
                {NAV_TABS.map((tab, index) => {
                  const hidden = tab.key === 'profile';
                  const isActive = activeTab === tab.key;
                  if (hidden) return null;
                  return (
                    <Box
                      key={tab.key}
                      as="button"
                      w="100%"
                      textAlign="left"
                      px={4}
                      py={4}
                      bg={isActive ? drawerItemHover : 'transparent'}
                      color={isActive ? tabSelectedColor : descriptionColor}
                      borderLeftWidth="4px"
                      borderLeftColor={isActive ? headerAccent : 'transparent'}
                      transition="all 0.15s ease-in-out"
                      _hover={{ bg: drawerItemBg }}
                      onClick={() => handleMobileNavClick(index)}
                    >
                      <Text fontWeight="semibold" fontSize="md">{tab.label}</Text>
                      <Text fontSize="sm" color={tabHelperColor} mt={0.5}>
                        {tab.helper}
                      </Text>
                    </Box>
                  );
                })}
              </VStack>
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      </Flex>
    </Box>
  );
}

export default HeaderBar;
