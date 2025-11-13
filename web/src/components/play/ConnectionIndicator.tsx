import { Box, HStack, Spinner, Text, Tooltip, useColorModeValue } from '@chakra-ui/react';
import { useMemo } from 'react';
import type { ConnectionQuality, PresenceActivity } from '@hooks/useMatchLobby';

interface StatusDescriptor {
  label: string;
  detail: string;
  color: string;
}

interface SizeStyles {
  fontSize: string;
  px: string;
  py: string;
  dot: string;
  spinnerSize: 'xs' | 'sm';
}

const SIZE_STYLES: Record<'xs' | 'sm', SizeStyles> = {
  xs: {
    fontSize: '0.65rem',
    px: '0.35rem',
    py: '0.15rem',
    dot: '0.35rem',
    spinnerSize: 'xs',
  },
  sm: {
    fontSize: '0.75rem',
    px: '0.45rem',
    py: '0.2rem',
    dot: '0.4rem',
    spinnerSize: 'sm',
  },
};

const formatFreshness = (lastSeen: number | null): string => {
  if (!lastSeen) {
    return 'waiting for heartbeat';
  }
  const deltaSeconds = Math.max(0, Math.round((Date.now() - lastSeen) / 1000));
  if (deltaSeconds <= 1) return 'updated just now';
  if (deltaSeconds < 60) return `updated ${deltaSeconds}s ago`;
  const minutes = Math.round(deltaSeconds / 60);
  return `updated ${minutes}m ago`;
};

const buildStatusDescriptor = (
  status: ConnectionQuality,
  activity: PresenceActivity,
  isSelf: boolean,
): StatusDescriptor => {
  if (activity === 'offline' || status === 'offline') {
    return {
      label: 'Offline',
      color: 'red.400',
      detail: isSelf ? 'You are disconnected from realtime' : 'Player is disconnected from realtime',
    };
  }
  if (activity === 'away' && status !== 'connecting') {
    return {
      label: 'Away',
      color: 'yellow.400',
      detail: 'App is in the background',
    };
  }
  switch (status) {
    case 'connecting':
      return {
        label: 'Connecting',
        color: 'blue.400',
        detail: 'Waiting for realtime subscription',
      };
    case 'weak':
      return {
        label: 'Laggy',
        color: 'orange.400',
        detail: 'Heartbeats are delayed',
      };
    case 'moderate':
      return {
        label: 'Unstable',
        color: 'yellow.400',
        detail: 'Heartbeat is slowing down',
      };
    case 'strong':
    default:
      return {
        label: 'Active',
        color: 'green.400',
        detail: 'Receiving live updates',
      };
  }
};

export interface ConnectionIndicatorProps {
  status: ConnectionQuality;
  lastSeen: number | null;
  isSelf?: boolean;
  size?: 'xs' | 'sm';
  activity?: PresenceActivity;
}

export function ConnectionIndicator({
  status,
  lastSeen,
  isSelf = false,
  size = 'sm',
  activity = 'active',
}: ConnectionIndicatorProps) {
  const descriptor = useMemo(() => buildStatusDescriptor(status, activity, isSelf), [activity, isSelf, status]);
  const freshness = useMemo(() => formatFreshness(lastSeen), [lastSeen]);
  const owner = isSelf ? 'Your connection' : 'Player connection';
  const tooltipLabel = `${owner}: ${descriptor.label} — ${descriptor.detail} · ${freshness}`;

  const pillBg = useColorModeValue('gray.100', 'gray.700');
  const pillBorder = useColorModeValue('gray.200', 'gray.600');
  const textColor = useColorModeValue('gray.800', 'gray.100');
  const sizeStyle = SIZE_STYLES[size];

  return (
    <Tooltip label={tooltipLabel} openDelay={120} closeDelay={80} gutter={6}>
      <HStack
        as="span"
        spacing={1.5}
        px={sizeStyle.px}
        py={sizeStyle.py}
        borderRadius="full"
        borderWidth="1px"
        borderColor={pillBorder}
        bg={pillBg}
        color={textColor}
        fontSize={sizeStyle.fontSize}
        fontWeight="medium"
        lineHeight="1"
        aria-label={tooltipLabel}
      >
        {status === 'connecting' ? (
          <Spinner size={sizeStyle.spinnerSize} color={descriptor.color} thickness="2px" speed="0.8s" />
        ) : (
          <Box boxSize={sizeStyle.dot} borderRadius="full" bg={descriptor.color} />
        )}
        <Text as="span">{descriptor.label}</Text>
      </HStack>
    </Tooltip>
  );
}

export default ConnectionIndicator;
