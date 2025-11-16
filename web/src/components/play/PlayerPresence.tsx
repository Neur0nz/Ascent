import ConnectionIndicator from '@components/play/ConnectionIndicator';
import type { PlayerConnectionState } from '@hooks/useMatchLobby';

export interface PlayerPresenceProps {
  connectionState?: PlayerConnectionState | null;
  size?: 'xs' | 'sm';
}

export function PlayerPresence({ connectionState, size = 'xs' }: PlayerPresenceProps) {
  if (!connectionState) {
    return null;
  }
  return (
    <ConnectionIndicator
      status={connectionState.status}
      lastSeen={connectionState.lastSeen}
      isSelf={connectionState.isSelf}
      activity={connectionState.activity}
      size={size}
    />
  );
}

export default PlayerPresence;
