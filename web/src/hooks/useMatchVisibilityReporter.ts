import { useEffect, useRef } from 'react';

interface MatchVisibilityMessage {
  type: 'santorini:match-visibility';
  matchId: string | null;
  visible: boolean;
  focused: boolean;
  timestamp: number;
}

const postMatchVisibilityMessage = async (message: MatchVisibilityMessage): Promise<void> => {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return;
  }
  if (!('serviceWorker' in navigator)) {
    return;
  }

  const sendTo = (worker: ServiceWorker | null | undefined) => {
    if (!worker) {
      return;
    }
    try {
      worker.postMessage(message);
    } catch (error) {
      console.warn('useMatchVisibilityReporter: failed to post message to service worker', error);
    }
  };

  try {
    const registration = await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) {
      sendTo(navigator.serviceWorker.controller);
      return;
    }
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
        resolve();
      }, 5000);
      function handleControllerChange() {
        clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
        resolve();
      }
      navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange, { once: true });
    });
    if (navigator.serviceWorker.controller) {
      sendTo(navigator.serviceWorker.controller);
      return;
    }
    sendTo(registration?.active ?? null);
  } catch (error) {
    console.warn('useMatchVisibilityReporter: unable to resolve service worker registration', error);
  }
};

const computeVisibility = (): boolean => {
  if (typeof document === 'undefined') {
    return false;
  }
  const visibilityState = typeof document.visibilityState === 'string' ? document.visibilityState : 'visible';
  if (visibilityState === 'hidden') {
    return false;
  }
  if (typeof document.hasFocus === 'function') {
    try {
      if (document.hasFocus()) {
        return true;
      }
    } catch (error) {
      console.warn('useMatchVisibilityReporter: document.hasFocus check failed', error);
    }
  }
  return true;
};

const computeFocus = (): boolean => {
  if (typeof document === 'undefined') {
    return false;
  }
  if (typeof document.hasFocus !== 'function') {
    return false;
  }
  try {
    return document.hasFocus();
  } catch (error) {
    console.warn('useMatchVisibilityReporter: document.hasFocus check failed', error);
    return false;
  }
};

export const useMatchVisibilityReporter = (matchId: string | null): void => {
  const previousMatchIdRef = useRef<string | null>(null);
  const lastVisibilityRef = useRef<{ visible: boolean; focused: boolean } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }
    if (!('serviceWorker' in navigator)) {
      return;
    }

    const previousMatchId = previousMatchIdRef.current;
    previousMatchIdRef.current = matchId ?? null;

    if (previousMatchId && previousMatchId !== matchId) {
      void postMatchVisibilityMessage({
        type: 'santorini:match-visibility',
        matchId: previousMatchId,
        visible: false,
        focused: false,
        timestamp: Date.now(),
      });
      lastVisibilityRef.current = null;
    }

    if (!matchId) {
      void postMatchVisibilityMessage({
        type: 'santorini:match-visibility',
        matchId: null,
        visible: false,
        focused: false,
        timestamp: Date.now(),
      });
      return () => {
        void postMatchVisibilityMessage({
          type: 'santorini:match-visibility',
          matchId: null,
          visible: false,
          focused: false,
          timestamp: Date.now(),
        });
      };
    }

    let cancelled = false;

    const sendVisibility = (visible: boolean, focused: boolean) => {
      if (cancelled) {
        return;
      }
      if (
        lastVisibilityRef.current &&
        lastVisibilityRef.current.visible === visible &&
        lastVisibilityRef.current.focused === focused
      ) {
        return;
      }
      lastVisibilityRef.current = { visible, focused };
      void postMatchVisibilityMessage({
        type: 'santorini:match-visibility',
        matchId,
        visible,
        focused,
        timestamp: Date.now(),
      });
    };

    const handleVisibilityChange = () => {
      const visible = computeVisibility();
      const focused = computeFocus();
      sendVisibility(visible, focused);
    };

    handleVisibilityChange();
    window.addEventListener('focus', handleVisibilityChange);
    window.addEventListener('blur', handleVisibilityChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', handleVisibilityChange);
      window.removeEventListener('blur', handleVisibilityChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      lastVisibilityRef.current = null;
      void postMatchVisibilityMessage({
        type: 'santorini:match-visibility',
        matchId,
        visible: false,
        focused: false,
        timestamp: Date.now(),
      });
    };
  }, [matchId]);
};
