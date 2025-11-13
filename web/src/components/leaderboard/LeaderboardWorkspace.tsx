import { useMemo, useState } from 'react';
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  ButtonGroup,
  Card,
  CardBody,
  CardHeader,
  Flex,
  Heading,
  HStack,
  Spinner,
  Stack,
  Stat,
  StatLabel,
  StatNumber,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
  useColorModeValue,
  SimpleGrid,
} from '@chakra-ui/react';
import { ArrowUpIcon, RepeatIcon } from '@chakra-ui/icons';
import type { SupabaseAuthState } from '@hooks/useSupabaseAuth';
import { useLeaderboard } from '@hooks/useLeaderboard';

function formatRelativeTime(isoDate: string | null): string {
  if (!isoDate) {
    return 'Awaiting first results';
  }
  const timestamp = new Date(isoDate).getTime();
  if (Number.isNaN(timestamp)) {
    return 'Recently updated';
  }
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(0, Math.round(diffMs / (1000 * 60)));
  if (diffMinutes < 1) return 'moments ago';
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr${diffHours === 1 ? '' : 's'} ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  const diffWeeks = Math.round(diffDays / 7);
  if (diffWeeks < 5) return `${diffWeeks} wk${diffWeeks === 1 ? '' : 's'} ago`;
  return new Date(isoDate).toLocaleDateString();
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return value.toLocaleString();
}

function LeaderboardWorkspace({
  auth,
  onNavigateToPlay,
}: {
  auth: SupabaseAuthState;
  onNavigateToPlay: () => void;
}) {
  const [visibleCount, setVisibleCount] = useState<10 | 25>(10);
  const { entries, loading, error, refresh, source, lastUpdated } = useLeaderboard(visibleCount);
  const tableBg = useColorModeValue('white', 'whiteAlpha.100');
  const tableBorder = useColorModeValue('gray.200', 'whiteAlpha.200');
  const highlightBg = useColorModeValue('teal.50', 'teal.900');
  const highlightBorder = useColorModeValue('teal.200', 'teal.600');
  const mutedText = useColorModeValue('gray.600', 'whiteAlpha.700');
  const statBg = useColorModeValue('white', 'whiteAlpha.100');
  const statBorder = useColorModeValue('gray.200', 'whiteAlpha.200');
  const updatedBadgeText = useColorModeValue('gray.700', 'whiteAlpha.900');
  const updatedBadgeBg = useColorModeValue('whiteAlpha.900', 'whiteAlpha.200');
  const updatedBadgeBorder = useColorModeValue('gray.200', 'whiteAlpha.200');

  const stats = useMemo(() => {
    if (!entries.length) {
      return {
        topRating: null,
        averageRating: null,
        totalGames: null,
        userRank: null as number | null,
        userRating: auth.profile?.rating ?? null,
      };
    }
    const totalRating = entries.reduce((sum, item) => sum + item.rating, 0);
    const totalGames = entries.reduce((sum, item) => sum + item.games_played, 0);
    const userEntry = entries.find((entry) => entry.id === auth.profile?.id) ?? null;
    return {
      topRating: entries[0]?.rating ?? null,
      averageRating: Math.round(totalRating / entries.length),
      totalGames,
      userRank: userEntry?.rank ?? null,
      userRating: userEntry?.rating ?? auth.profile?.rating ?? null,
    };
  }, [entries, auth.profile]);

  const limitOptions: Array<{ label: string; value: 10 | 25 }> = [
    { label: 'Top 10', value: 10 },
    { label: 'Top 25', value: 25 },
  ];

  return (
    <Stack spacing={{ base: 6, md: 8 }} py={{ base: 6, md: 10 }}>
      <Card bgGradient={useColorModeValue('linear(to-r, purple.50, teal.100)', 'linear(to-r, purple.800, teal.700)')} borderWidth="1px" borderColor={useColorModeValue('purple.200', 'purple.500')}>
        <CardBody>
          <Stack spacing={5}>
            <Stack spacing={2}>
              <Badge colorScheme={source === 'live' ? 'purple' : 'orange'} w="fit-content" borderRadius="full" px={3} py={1} textTransform="uppercase" fontSize="xs">
                {source === 'live' ? 'Current rankings' : 'Sample snapshot'}
              </Badge>
              <Heading size={{ base: 'md', md: 'lg' }}>Player leaderboard</Heading>
              <Text color={mutedText} maxW="2xl">
                Ratings are updated after each rated match
              </Text>
            </Stack>
            <HStack spacing={3} flexWrap="wrap">
              <Button
                size="lg"
                colorScheme="teal"
                leftIcon={<ArrowUpIcon />}
                onClick={onNavigateToPlay}
              >
                Play rated match
              </Button>
              <Button
                size="lg"
                variant="outline"
                leftIcon={<RepeatIcon />}
                onClick={() => refresh()}
                isLoading={loading}
              >
                Refresh leaderboard
              </Button>
              <Badge color={updatedBadgeText} bg={updatedBadgeBg} borderColor={updatedBadgeBorder} borderWidth="1px">
                Updated {formatRelativeTime(lastUpdated)}
              </Badge>
            </HStack>
          </Stack>
        </CardBody>
      </Card>

      {error && (
        <Alert status={source === 'live' ? 'error' : 'warning'} variant="subtle" borderRadius="md">
          <AlertIcon />
          <Text>{error}</Text>
        </Alert>
      )}

      <SimpleGrid columns={{ base: 1, md: 2, lg: 4 }} spacing={{ base: 4, md: 6 }}>
        <Card bg={statBg} borderWidth="1px" borderColor={statBorder}>
          <CardBody>
            <Stat>
              <StatLabel>Top rating</StatLabel>
              <StatNumber>{formatNumber(stats.topRating)}</StatNumber>
            </Stat>
          </CardBody>
        </Card>
        <Card bg={statBg} borderWidth="1px" borderColor={statBorder}>
          <CardBody>
            <Stat>
              <StatLabel>Average rating ({entries.length})</StatLabel>
              <StatNumber>{formatNumber(stats.averageRating)}</StatNumber>
            </Stat>
          </CardBody>
        </Card>
        <Card bg={statBg} borderWidth="1px" borderColor={statBorder}>
          <CardBody>
            <Stat>
              <StatLabel>Total rated games</StatLabel>
              <StatNumber>{formatNumber(stats.totalGames)}</StatNumber>
            </Stat>
          </CardBody>
        </Card>
        <Card bg={statBg} borderWidth="1px" borderColor={statBorder}>
          <CardBody>
            <Stack spacing={2}>
              <Stat>
                <StatLabel>{auth.profile ? 'Your rating' : 'Track your rating'}</StatLabel>
                <StatNumber>{auth.profile ? formatNumber(stats.userRating) : '—'}</StatNumber>
              </Stat>
              <Text fontSize="sm" color={mutedText}>
                {auth.profile
                  ? stats.userRank
                    ? `Currently ranked #${stats.userRank}`
                    : 'Play a rated match to enter the leaderboard.'
                  : 'Sign in and play rated games to appear on the ladder.'}
              </Text>
            </Stack>
          </CardBody>
        </Card>
      </SimpleGrid>

      <Card bg={tableBg} borderWidth="1px" borderColor={tableBorder}>
        <CardHeader>
          <Flex justify="space-between" align={{ base: 'flex-start', md: 'center' }} direction={{ base: 'column', md: 'row' }} gap={{ base: 3, md: 4 }}>
            <Stack spacing={1}>
              <Heading size="md">Top Santorini competitors</Heading>
              <Text fontSize="sm" color={mutedText}>
                Ranked at {formatRelativeTime(lastUpdated)} · Rated ladder
              </Text>
            </Stack>
            <HStack spacing={3} align="center">
              <ButtonGroup size="sm" variant="ghost" colorScheme="teal">
                {limitOptions.map((option) => (
                  <Button
                    key={option.value}
                    onClick={() => setVisibleCount(option.value)}
                    variant={visibleCount === option.value ? 'solid' : 'ghost'}
                  >
                    {option.label}
                  </Button>
                ))}
              </ButtonGroup>
            </HStack>
          </Flex>
        </CardHeader>
        <CardBody>
          {loading ? (
            <Box py={10} display="flex" alignItems="center" justifyContent="center">
              <Spinner size="lg" color="teal.400" thickness="4px" />
            </Box>
          ) : entries.length === 0 ? (
            <Stack spacing={3} textAlign="center" py={6} color={mutedText}>
              <Heading size="sm">No data yet</Heading>
              <Text>Be the first to log a rated match and claim the #1 spot.</Text>
            </Stack>
          ) : (
            <Box overflowX="auto">
              <Table size="md" variant="simple">
                <Thead>
                  <Tr>
                    <Th>#</Th>
                    <Th>Player</Th>
                    <Th isNumeric>Rating</Th>
                    <Th isNumeric>Games</Th>
                    <Th>Last active</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {entries.map((entry) => {
                    const isCurrentUser = auth.profile?.id === entry.id;
                    const rankColor =
                      entry.rank === 1 ? 'yellow' : entry.rank <= 3 ? 'orange' : 'gray';
                    return (
                      <Tr
                        key={entry.id}
                        bg={isCurrentUser ? highlightBg : undefined}
                        borderLeftWidth={isCurrentUser ? '4px' : '0'}
                        borderLeftColor={isCurrentUser ? highlightBorder : 'transparent'}
                      >
                        <Td>
                          <Badge colorScheme={rankColor} variant="subtle" borderRadius="full" px={3}>
                            #{entry.rank}
                          </Badge>
                        </Td>
                        <Td>
                          <Stack spacing={1}>
                            <Text fontWeight={isCurrentUser ? 'bold' : 'semibold'}>
                              {entry.display_name}
                            </Text>
                            {isCurrentUser && (
                              <Badge colorScheme="teal" w="fit-content">
                                You
                              </Badge>
                            )}
                          </Stack>
                        </Td>
                        <Td isNumeric fontWeight="semibold">
                          {formatNumber(entry.rating)}
                        </Td>
                        <Td isNumeric>{formatNumber(entry.games_played)}</Td>
                        <Td>
                          <Tooltip label={new Date(entry.updated_at).toLocaleString()} hasArrow>
                            {formatRelativeTime(entry.updated_at)}
                          </Tooltip>
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            </Box>
          )}
        </CardBody>
      </Card>

    </Stack>
  );
}

export default LeaderboardWorkspace;
