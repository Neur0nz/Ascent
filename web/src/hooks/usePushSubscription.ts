import { useEffect, useRef } from 'react';
import type { PlayerProfile } from '@/types/match';
import { removePushSubscription, syncPushSubscription } from '@/lib/pushNotifications';

export type PushPermissionState = NotificationPermission | 'unsupported';

const PUSH_SUBSCRIPTION_CHANGED_EVENT = 'santorini:push-subscription-changed';

export const usePushSubscription = (profile: PlayerProfile | null, permission: PushPermissionState): void => {
  const previousProfileRef = useRef<PlayerProfile | null>(profile);

  useEffect(() => {
    const previousProfile = previousProfileRef.current;
    if (previousProfile && (!profile || previousProfile.auth_user_id !== profile.auth_user_id)) {
      void removePushSubscription(previousProfile).catch((error) => {
        console.warn('usePushSubscription: failed to clear subscription after logout', error);
      });
    }
    previousProfileRef.current = profile;
  }, [profile]);

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

  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') {
        return;
      }
      if (data.type !== PUSH_SUBSCRIPTION_CHANGED_EVENT) {
        return;
      }
      if (permission === 'unsupported') {
        return;
      }
      void (async () => {
        try {
          await syncPushSubscription({ profile, permission });
        } catch (error) {
          console.warn('usePushSubscription: failed to refresh subscription after worker change', error);
        }
      })();
    };
    navigator.serviceWorker.addEventListener('message', handleMessage as EventListener);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleMessage as EventListener);
    };
  }, [profile?.id, profile?.auth_user_id, permission]);
};
