import { useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Card,
  CardBody,
  CardHeader,
  Flex,
  Heading,
  HStack,
  IconButton,
  Stack,
  Text,
  Tooltip,
  useColorModeValue,
  useToast,
} from '@chakra-ui/react';
import { ArrowForwardIcon, CloseIcon } from '@chakra-ui/icons';
import type { LobbyMatch } from '@hooks/useMatchLobby';
import type { PlayerProfile } from '@/types/match';
import { describeMatch } from '@/utils/matchDescription';

type MyMatchesPanelProps = {
  matches: LobbyMatch[];
  activeMatchId: string | null;
  profile: PlayerProfile | null;
  onSelect: (matchId: string) => void;
  onLeave: (matchId: string) => Promise<void>;
};

function formatStatus(match: LobbyMatch) {
  switch (match.status) {
    case 'in_progress':
      return { label: 'In progress', colorScheme: 'green' as const };
    case 'waiting_for_opponent':
      return { label: 'Waiting', colorScheme: 'orange' as const };
    default:
      return { label: match.status.replaceAll('_', ' '), colorScheme: 'gray' as const };
  }
}

function MyMatchesPanel({ matches, activeMatchId, profile, onSelect, onLeave }: MyMatchesPanelProps) {
  const cardBg = useColorModeValue('white', 'whiteAlpha.100');
  const cardBorder = useColorModeValue('gray.200', 'whiteAlpha.200');
  const mutedText = useColorModeValue('gray.600', 'whiteAlpha.700');
  const activeBg = useColorModeValue('teal.50', 'whiteAlpha.200');
  const toast = useToast();
  const [busyMatchId, setBusyMatchId] = useState<string | null>(null);

  const handleLeave = async (matchId: string) => {
    setBusyMatchId(matchId);
    try {
      await onLeave(matchId);
      toast({ title: 'Match updated', status: 'info', description: 'The match was closed.' });
    } catch (error) {
      toast({
        title: 'Unable to update match',
        status: 'error',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setBusyMatchId((current) => (current === matchId ? null : current));
    }
  };

  return (
    <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder}>
      <CardHeader>
        <Heading size="md">Your games</Heading>
      </CardHeader>
      <CardBody>
        {matches.length === 0 ? (
          <Text color={mutedText} fontSize="sm">
            You have no in-progress games yet. Create a match or join a lobby to get started.
          </Text>
        ) : (
          <Stack spacing={4}>
            {matches.map((match) => {
              const isActive = match.id === activeMatchId;
              const { label: statusLabel, colorScheme } = formatStatus(match);
              const primaryLabel = isActive ? 'Active' : match.status === 'in_progress' ? 'Resume' : 'View';
              const leaveLabel = match.status === 'waiting_for_opponent' ? 'Cancel match' : 'Leave match';
              const isCreator = profile ? match.creator_id === profile.id : false;
              return (
                <Box
                  key={match.id}
                  borderWidth="1px"
                  borderColor={isActive ? 'teal.400' : cardBorder}
                  borderRadius="lg"
                  p={4}
                  bg={isActive ? activeBg : 'transparent'}
                  transition="border-color 0.2s ease"
                >
                  <Stack spacing={3}>
                    <Flex justify="space-between" align={{ base: 'flex-start', sm: 'center' }} direction={{ base: 'column', sm: 'row' }} gap={2}>
                      <Stack spacing={1}>
                        <Heading size="sm">{describeMatch(match, profile)}</Heading>
                        <Text fontSize="sm" color={mutedText}>
                          {isCreator ? 'You created this game' : 'Joined game'} ·{' '}
                          {match.rated ? 'Rated' : 'Casual'}
                          {match.clock_initial_seconds > 0
                            ? ` · ${Math.round(match.clock_initial_seconds / 60)}+${match.clock_increment_seconds}`
                            : ''}
                        </Text>
                      </Stack>
                      <HStack spacing={2}>
                        <Badge colorScheme={colorScheme}>{statusLabel}</Badge>
                        {match.visibility === 'private' && <Badge colorScheme="orange">Private</Badge>}
                      </HStack>
                    </Flex>
                    <HStack spacing={3} justify="flex-end">
                      <Tooltip label={isActive ? 'This match is currently active' : 'Switch to this match'}>
                        <Button
                          size="sm"
                          colorScheme="teal"
                          variant={isActive ? 'solid' : 'outline'}
                          leftIcon={!isActive ? <ArrowForwardIcon /> : undefined}
                          onClick={() => onSelect(match.id)}
                          isDisabled={isActive}
                        >
                          {primaryLabel}
                        </Button>
                      </Tooltip>
                      <Tooltip label={leaveLabel}>
                        <IconButton
                          aria-label={leaveLabel}
                          icon={<CloseIcon boxSize={3} />}
                          size="sm"
                          variant="ghost"
                          colorScheme="red"
                          onClick={() => handleLeave(match.id)}
                          isLoading={busyMatchId === match.id}
                        />
                      </Tooltip>
                    </HStack>
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        )}
      </CardBody>
    </Card>
  );
}

export default MyMatchesPanel;
