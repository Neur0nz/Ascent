import { Box, Icon, Spinner, Tooltip } from '@chakra-ui/react';
import { useMemo } from 'react';
import type { ConnectionQuality } from '@hooks/useMatchLobby';

const STATUS_LABELS: Record<ConnectionQuality, string> = {
  connecting: 'Connecting',
  offline: 'Offline',
  weak: 'Weak',
  moderate: 'Moderate',
  strong: 'Strong',
};

const STATUS_COLORS: Record<ConnectionQuality, string> = {
  connecting: 'blue.400',
  offline: 'red.500',
  weak: 'orange.400',
  moderate: 'yellow.400',
  strong: 'green.400',
};

const INACTIVE_BAR_COLOR = 'gray.400';

const BAR_COUNT: Record<ConnectionQuality, 0 | 1 | 2 | 3 | null> = {
  connecting: null,
  offline: 0,
  weak: 1,
  moderate: 2,
  strong: 3,
};

const SIZE_TO_BOX: Record<'xs' | 'sm', string> = {
  xs: '0.7rem',
  sm: '0.85rem',
};

function WifiBarsIcon({ bars, color, boxSize }: { bars: 0 | 1 | 2 | 3; color: string; boxSize: string }) {
  return (
    <Icon viewBox="0 0 16 12" boxSize={boxSize} aria-hidden>
      <rect x="1" y="8" width="3" height="4" rx="1" fill={bars >= 1 ? color : INACTIVE_BAR_COLOR} />
      <rect x="6.5" y="5" width="3" height="7" rx="1" fill={bars >= 2 ? color : INACTIVE_BAR_COLOR} />
      <rect x="12" y="1" width="3" height="11" rx="1" fill={bars >= 3 ? color : INACTIVE_BAR_COLOR} />
    </Icon>
  );
}

function OfflineIcon({ color, boxSize }: { color: string; boxSize: string }) {
  return (
    <Icon viewBox="0 0 16 12" boxSize={boxSize} aria-hidden>
      <rect x="1" y="8" width="3" height="4" rx="1" fill={INACTIVE_BAR_COLOR} />
      <rect x="6.5" y="5" width="3" height="7" rx="1" fill={INACTIVE_BAR_COLOR} />
      <rect x="12" y="1" width="3" height="11" rx="1" fill={INACTIVE_BAR_COLOR} />
      <path d="M2 2 L14 10" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
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
  const color = STATUS_COLORS[status];
  const bars = BAR_COUNT[status];

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
          <Spinner size={size} color={color} thickness="2px" speed="0.9s" />
        ) : status === 'offline' ? (
          <OfflineIcon color={color} boxSize={boxSize} />
        ) : bars !== null ? (
          <WifiBarsIcon bars={bars} color={color} boxSize={boxSize} />
        ) : null}
      </Box>
    </Tooltip>
  );
}

export default ConnectionIndicator;
