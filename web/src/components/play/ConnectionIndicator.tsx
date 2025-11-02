import { Box, Icon, Spinner, Tooltip, useColorModeValue } from '@chakra-ui/react';
import { useMemo } from 'react';
import type { ConnectionQuality } from '@hooks/useMatchLobby';

const STATUS_LABELS: Record<ConnectionQuality, string> = {
  connecting: 'Connecting',
  offline: 'Offline',
  weak: 'Weak',
  moderate: 'Moderate',
  strong: 'Strong',
};

const BAR_COUNT: Record<ConnectionQuality, 0 | 1 | 2 | 3 | null> = {
  connecting: null,
  offline: 0,
  weak: 1,
  moderate: 2,
  strong: 3,
};

const SIZE_TO_BOX: Record<'xs' | 'sm', string> = {
  xs: '0.9rem',
  sm: '1.1rem',
};

interface WifiBarsIconProps {
  bars: 0 | 1 | 2 | 3;
  activeColor: string;
  inactiveColor: string;
  boxSize: string;
}

function WifiBarsIcon({ bars, activeColor, inactiveColor, boxSize }: WifiBarsIconProps) {
  return (
    <Icon viewBox="0 0 16 12" boxSize={boxSize} color={activeColor} aria-hidden>
      <rect x="1" y="8" width="3" height="4" rx="1" fill="currentColor" opacity={bars >= 1 ? 1 : 0.3} />
      <rect x="6.5" y="5" width="3" height="7" rx="1" fill="currentColor" opacity={bars >= 2 ? 1 : 0.3} />
      <rect x="12" y="1" width="3" height="11" rx="1" fill="currentColor" opacity={bars >= 3 ? 1 : 0.3} />
    </Icon>
  );
}

interface OfflineIconProps {
  color: string;
  boxSize: string;
}

function OfflineIcon({ color, boxSize }: OfflineIconProps) {
  return (
    <Icon viewBox="0 0 16 12" boxSize={boxSize} color={color} aria-hidden>
      <rect x="1" y="8" width="3" height="4" rx="1" fill="currentColor" opacity="0.3" />
      <rect x="6.5" y="5" width="3" height="7" rx="1" fill="currentColor" opacity="0.3" />
      <rect x="12" y="1" width="3" height="11" rx="1" fill="currentColor" opacity="0.3" />
      <path d="M2 2 L14 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </Icon>
  );
}

export interface ConnectionIndicatorProps {
  status: ConnectionQuality;
  lastSeen: number | null;
  isSelf?: boolean;
  size?: 'xs' | 'sm';
}

export function ConnectionIndicator({ status, lastSeen, isSelf = false, size = 'sm' }: ConnectionIndicatorProps) {
  const boxSize = SIZE_TO_BOX[size];
  const bars = BAR_COUNT[status];

  // Use Chakra UI color tokens directly - they'll be resolved by the Icon component's color prop
  const colorScheme = useMemo(() => {
    switch (status) {
      case 'weak':
        return 'orange.400';
      case 'moderate':
        return 'yellow.400';
      case 'strong':
        return 'green.400';
      case 'offline':
        return 'red.500';
      default:
        return 'blue.400';
    }
  }, [status]);

  const tooltipLabel = useMemo(() => {
    const baseLabel = STATUS_LABELS[status];
    const owner = isSelf ? 'Your connection' : 'Connection';
    if (!lastSeen || status === 'connecting') {
      return `${owner}: ${baseLabel}`;
    }
    const deltaMs = Date.now() - lastSeen;
    const deltaSeconds = Math.max(0, Math.round(deltaMs / 1000));
    const freshness = deltaSeconds <= 3 ? 'just now' : `${deltaSeconds}s ago`;
    return `${owner}: ${baseLabel} · updated ${freshness}`;
  }, [isSelf, lastSeen, status]);

  return (
    <Tooltip label={tooltipLabel} openDelay={150} closeDelay={100} gutter={6}>
      <Box as="span" display="inline-flex" alignItems="center" justifyContent="center" aria-label={tooltipLabel}>
        {status === 'connecting' ? (
          <Spinner size={size} color={colorScheme} thickness="2.5px" speed="0.9s" />
        ) : status === 'offline' ? (
          <OfflineIcon color={colorScheme} boxSize={boxSize} />
        ) : bars !== null ? (
          <WifiBarsIcon bars={bars} activeColor={colorScheme} inactiveColor="gray.400" boxSize={boxSize} />
        ) : null}
      </Box>
    </Tooltip>
  );
}

export default ConnectionIndicator;
