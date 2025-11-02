import { useCallback, useMemo, useRef, useState } from 'react';

type NotificationPermissionState = NotificationPermission | 'unsupported';

export interface BrowserNotificationOptions extends NotificationOptions {
  id?: string;
}

export interface UseBrowserNotificationsResult {
  permission: NotificationPermissionState;
  isSupported: boolean;
  requestPermission: () => Promise<NotificationPermissionState>;
  showNotification: (title: string, options?: BrowserNotificationOptions) => void;
}

const hasNotificationSupport = (): boolean => {
  return typeof window !== 'undefined' && 'Notification' in window;
};

export function useBrowserNotifications(): UseBrowserNotificationsResult {
  const isSupported = useMemo(() => hasNotificationSupport(), []);
  const [permission, setPermission] = useState<NotificationPermissionState>(() => {
    if (!isSupported) {
      return 'unsupported';
    }
    return Notification.permission;
  });
  const lastNotificationIdRef = useRef<string | null>(null);
  const serviceWorkerReadyRef = useRef<Promise<ServiceWorkerRegistration | null> | null>(null);

  const resolveServiceWorkerRegistration = useCallback(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return null;
    }
    if (!serviceWorkerReadyRef.current) {
      serviceWorkerReadyRef.current = navigator.serviceWorker.ready
        .then((registration) => registration)
        .catch((error) => {
          console.warn('Notification service worker not ready', error);
          return null;
        });
    }
    return serviceWorkerReadyRef.current;
  }, []);

  const requestPermission = useCallback(async (): Promise<NotificationPermissionState> => {
    if (!isSupported) {
      return 'unsupported';
    }
    if (permission !== 'default') {
      return permission;
    }
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    } catch (error) {
      console.warn('Notification permission request failed', error);
      setPermission('denied');
      return 'denied';
    }
  }, [isSupported, permission]);

  const showNotification = useCallback(
    (title: string, options?: BrowserNotificationOptions) => {
      if (!isSupported || permission !== 'granted') {
        return;
      }

      const tag = options?.id;
      const idChanged = Boolean(tag && lastNotificationIdRef.current !== tag);

      if (tag && !idChanged) {
        return;
      }

      const baseOptions = { ...(options ?? {}) };
      delete (baseOptions as Partial<BrowserNotificationOptions>).id;
      if (tag && !baseOptions.tag) {
        baseOptions.tag = tag;
      }

      const focusUrl =
        typeof window !== 'undefined'
          ? baseOptions?.data?.focusUrl ?? window.location.href
          : baseOptions?.data?.focusUrl;
      if (focusUrl) {
        baseOptions.data = { ...(baseOptions.data as Record<string, unknown>), focusUrl };
      }

      const showWithWindowNotification = () => {
        try {
          const notification = new Notification(title, baseOptions);
          notification.onclick = () => {
            try {
              window.focus();
            } catch (focusError) {
              console.warn('Unable to focus window from notification click', focusError);
            }
            notification.close();
          };
        } catch (error) {
          console.error('Failed to show notification', error);
        }
      };

      lastNotificationIdRef.current = tag ?? null;

      const registrationPromise = resolveServiceWorkerRegistration();
      if (registrationPromise) {
        registrationPromise
          .then((registration) => {
            if (!registration) {
              showWithWindowNotification();
              return;
            }
            registration.showNotification(title, baseOptions).catch((error) => {
              console.warn('Service worker notification failed, falling back to window Notification', error);
              showWithWindowNotification();
            });
          })
          .catch((error) => {
            console.warn('Unable to resolve service worker registration for notifications', error);
            showWithWindowNotification();
          });
      } else {
        showWithWindowNotification();
      }

      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate?.(50);
      }
    },
    [isSupported, permission, resolveServiceWorkerRegistration],
  );

  return {
    permission,
    isSupported,
    requestPermission,
    showNotification,
  };
}
