import { useEffect } from 'react';
import type { PlayerProfile } from '@/types/match';
import { syncPushSubscription } from '@/lib/pushNotifications';

export type PushPermissionState = NotificationPermission | 'unsupported';

export const usePushSubscription = (profile: PlayerProfile | null, permission: PushPermissionState): void => {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (permission === 'unsupported') {
      return;
    }
    void (async () => {
      try {
        await syncPushSubscription({ profile, permission });
      } catch (error) {
        console.warn('usePushSubscription: failed to sync push subscription', error);
      }
    })();
  }, [profile?.id, profile?.auth_user_id, permission]);
};
