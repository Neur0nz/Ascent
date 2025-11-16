# Android Push Notifications & Supabase Presence Analysis

## Android Push Notification Issues

### Current Problems

Based on your experience with missed notifications on Android, here are the likely causes:

#### 1. **Service Worker Lifecycle on Android**
**Issue**: Android aggressively terminates service workers to save battery, especially when:
- Browser is completely closed (not just backgrounded)
- Device is in battery saver mode
- App hasn't been used recently
- Device manufacturer has aggressive battery optimization (Xiaomi, OPPO, Vivo, Huawei)

**Current Implementation**: 
- Service worker is registered but may be terminated
- No mechanism to keep service worker alive
- No fallback when service worker is terminated

**Impact**: Notifications won't be delivered if the service worker is terminated.

#### 2. **Notification Suppression Logic May Be Too Aggressive**
**Issue**: The `shouldSuppressNotification` function in `web/src/service-worker.ts` (compiled to `/service-worker.js` via the PWA build) checks if the user is viewing the match. On Android, this check might incorrectly suppress notifications even when the browser is backgrounded.

**Current Logic**:
```javascript
const shouldSuppressNotification = async (matchId) => {
  // Checks if any client is viewing the match
  // If match is visible, suppresses notification
}
```

**Problem**: On Android, when the browser is backgrounded:
- `client.visibilityState` might still be `'visible'` briefly
- `client.focused` might be `false` but visibility state hasn't updated
- The suppression check might incorrectly suppress the notification

#### 3. **No Retry Mechanism**
**Issue**: If a push notification fails to deliver (network issue, service worker terminated), there's no retry mechanism.

**Current Implementation**: 
- Server sends notification once
- If it fails, subscription is marked as expired (404/410) and deleted
- No retry for transient failures

#### 4. **Missing PWA Installation Requirements**
**Issue**: For reliable delivery on Android, the app should be installed as a PWA. The current implementation doesn't check if the app is installed or guide users to install it.

**Impact**: Notifications are less reliable when the app is not installed as a PWA.

### Recommended Fixes for Android

#### 1. **Improve Service Worker Reliability**
```javascript
// In web/src/service-worker.ts - Add background sync or periodic sync
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    event.waitUntil(doBackgroundWork());
  }
});

// Keep service worker alive with periodic wake-ups
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'KEEP_ALIVE') {
    // Service worker stays alive
  }
});
```

#### 2. **Fix Notification Suppression Logic**
```javascript
// More conservative suppression - only suppress if client is actually focused
const shouldSuppressNotification = async (matchId) => {
  if (!matchId) return false;
  
  const allClients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  
  for (const client of allClients) {
    const state = clientMatchState.get(client.id);
    if (!state || state.matchId !== matchId) continue;
    
    // Only suppress if BOTH conditions are true:
    // 1. Client explicitly reported as visible
    // 2. Client is actually focused
    const isVisible = state.visible === true;
    const isFocused = client.focused === true;
    const visibilityState = client.visibilityState;
    
    // More conservative: only suppress if definitely visible AND focused
    if (isVisible && isFocused && visibilityState === 'visible') {
      return true;
    }
  }
  
  return false;
};
```

#### 3. **Add Retry Logic with Exponential Backoff**
```typescript
// In supabase/functions/_shared/push.ts
export const sendPushNotificationWithRetry = async (
  subscription: StoredPushSubscription,
  payload: PushPayload,
  maxRetries = 3,
): Promise<PushSendResult> => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await sendPushNotification(subscription, payload);
    
    if (result.delivered) {
      return result;
    }
    
    // Don't retry if subscription is gone or unauthorized
    if (result.reason === 'gone' || result.reason === 'unauthorized') {
      return result;
    }
    
    // Retry with exponential backoff for transient errors
    if (attempt < maxRetries - 1) {
      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  return { delivered: false, reason: 'error', error: 'Max retries exceeded' };
};
```

#### 4. **Add PWA Installation Check and Guidance**
```typescript
// In web/src/lib/pushNotifications.ts
export const checkPWAInstallation = (): boolean => {
  if (typeof window === 'undefined') return false;
  
  // Check if running as standalone (installed PWA)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
  const isIOSStandalone = (window.navigator as any).standalone === true;
  
  return isStandalone || isIOSStandalone;
};

// Show installation prompt if not installed
export const promptPWAInstallation = async (): Promise<boolean> => {
  if (checkPWAInstallation()) return true;
  
  // Check if browser supports installation
  if ('serviceWorker' in navigator && 'BeforeInstallPromptEvent' in window) {
    // Chrome/Edge PWA install prompt
    // Show custom UI to guide user
  }
  
  return false;
};
```

#### 5. **Add Notification Delivery Tracking**
```typescript
// Track notification delivery success/failure
// Store in database for analytics
interface NotificationDelivery {
  subscription_id: string;
  match_id: string;
  delivered: boolean;
  failure_reason?: string;
  device_type?: string;
  user_agent?: string;
  timestamp: string;
}
```

## Supabase Presence Implementation Analysis

### Current Implementation

Your presence implementation uses:
- **Heartbeat interval**: 5000ms (5 seconds) ✅ Good
- **Connection monitor interval**: 6000ms (6 seconds) ✅ Good
- **Connection thresholds**: 
  - Strong: ≤ 6 seconds
  - Moderate: ≤ 12 seconds  
  - Weak: ≤ 20 seconds
  - Offline: > 20 seconds

### Issues Found

#### 1. **Presence Heartbeat vs Connection Monitor Timing**
**Issue**: The heartbeat sends presence updates every 5 seconds, but the connection monitor checks every 6 seconds. This creates a 1-second gap where presence might not be detected.

**Current**:
```typescript
PRESENCE_HEARTBEAT_INTERVAL = 5000;  // 5 seconds
CONNECTION_MONITOR_INTERVAL = 6000;  // 6 seconds
```

**Problem**: 
- If a presence update is sent at t=0, the next check is at t=6
- But the next presence update is at t=5
- The monitor might miss the update if there's network delay

**Recommendation**: Make the monitor interval slightly shorter than heartbeat interval:
```typescript
PRESENCE_HEARTBEAT_INTERVAL = 5000;  // 5 seconds
CONNECTION_MONITOR_INTERVAL = 4500;  // 4.5 seconds (check more frequently)
```

#### 2. **Missing Presence State on Initial Load**
**Issue**: When a user first joins, `updateConnectionStatesFromPresence()` is called, but if the presence state hasn't synced yet, the user might appear offline.

**Current Flow**:
1. Channel subscribes
2. `sendPresenceUpdate('subscribed')` is called
3. `updateConnectionStatesFromPresence()` is called immediately

**Problem**: The presence state might not be synced yet when `updateConnectionStatesFromPresence()` is called.

**Recommendation**: Wait for presence sync event before initial update:
```typescript
channel
  .on('presence', { event: 'sync' }, () => {
    // This fires when presence state is initially synced
    updateConnectionStatesFromPresence();
  })
  .on('presence', { event: 'join' }, () => {
    updateConnectionStatesFromPresence();
  })
  .on('presence', { event: 'leave' }, () => {
    updateConnectionStatesFromPresence();
  });
```

#### 3. **No Handling of Presence State Expiration**
**Issue**: Supabase presence state can become stale if a user's connection drops without a proper "leave" event. Your code handles this with the connection thresholds, but there's no explicit cleanup of stale presence entries.

**Current**: Uses `last_seen` timestamp to determine connection quality.

**Recommendation**: This is actually handled well! The connection thresholds (6s, 12s, 20s) effectively handle stale presence. However, consider adding explicit cleanup:
```typescript
// In updateConnectionStatesFromPresence
const STALE_PRESENCE_THRESHOLD = 30000; // 30 seconds
const now = Date.now();

Object.values(presenceState).forEach((entries) => {
  entries.forEach((entry) => {
    const lastSeen = entry?.last_seen;
    if (lastSeen && (now - lastSeen) > STALE_PRESENCE_THRESHOLD) {
      // Entry is stale, but Supabase should handle this
      // Just log for debugging
      console.warn('Stale presence entry detected', entry);
    }
  });
});
```

#### 4. **Presence Update on Every Heartbeat**
**Issue**: You're calling `sendPresenceUpdate('heartbeat')` every 5 seconds, which updates `last_seen`. This is correct, but if the channel is not subscribed, these updates are wasted.

**Current**: 
```typescript
if (!presenceHeartbeatRef.current) {
  presenceHeartbeatRef.current = setInterval(() => {
    void sendPresenceUpdate('heartbeat');
  }, PRESENCE_HEARTBEAT_INTERVAL);
}
```

**Recommendation**: Check channel status before sending:
```typescript
if (!presenceHeartbeatRef.current) {
  presenceHeartbeatRef.current = setInterval(() => {
    if (channelStatusRef.current === 'SUBSCRIBED') {
      void sendPresenceUpdate('heartbeat');
    }
  }, PRESENCE_HEARTBEAT_INTERVAL);
}
```

### Supabase Best Practices Compliance

According to Supabase documentation, your implementation is **mostly correct**, but here are some improvements:

#### ✅ What You're Doing Right:
1. Using `track()` to send presence updates
2. Using `untrack()` on cleanup
3. Listening to 'sync', 'join', 'leave' events
4. Using heartbeat to keep presence fresh
5. Handling connection quality based on `last_seen`

#### ⚠️ What Could Be Improved:

1. **Presence State Initialization**: Wait for 'sync' event before assuming presence state
2. **Error Handling**: Add retry logic if `track()` fails
3. **Presence Metadata**: Consider adding more metadata (device type, connection type) for better debugging
4. **Channel Reconnection**: Your code handles reconnection, but consider adding exponential backoff

### Recommended Changes

#### 1. Fix Connection Monitor Timing
```typescript
const PRESENCE_HEARTBEAT_INTERVAL = 5000;  // 5 seconds
const CONNECTION_MONITOR_INTERVAL = 4500;  // 4.5 seconds (check more frequently)
```

#### 2. Improve Presence Update Logic
```typescript
const sendPresenceUpdate = async (reason: string) => {
  if (!profile) return;
  
  // Don't send if channel is not subscribed
  if (channelStatusRef.current !== 'SUBSCRIBED') {
    console.warn('useMatchLobby: Skipping presence update, channel not subscribed', { reason });
    return;
  }
  
  const role = /* ... */;
  try {
    await channel.track({
      user_id: profile.id,
      role,
      last_seen: Date.now(),
      // Add more metadata for debugging
      device_type: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    });
  } catch (error) {
    console.warn('useMatchLobby: Failed to track presence', { matchId, reason, error });
    // Consider retry logic here
  } finally {
    updateConnectionStatesFromPresence();
  }
};
```

#### 3. Wait for Presence Sync
```typescript
channel
  .on('presence', { event: 'sync' }, () => {
    console.log('useMatchLobby: Presence state synced', { matchId });
    updateConnectionStatesFromPresence();
    // Now that we're synced, start the heartbeat
    if (!presenceHeartbeatRef.current) {
      presenceHeartbeatRef.current = setInterval(() => {
        void sendPresenceUpdate('heartbeat');
      }, PRESENCE_HEARTBEAT_INTERVAL);
    }
  })
  .on('presence', { event: 'join' }, () => {
    updateConnectionStatesFromPresence();
  })
  .on('presence', { event: 'leave' }, () => {
    updateConnectionStatesFromPresence();
  });
```

## Summary

### Android Push Notifications
**Status**: ⚠️ **Needs Improvement**

**Main Issues**:
1. Service worker can be terminated by Android
2. Notification suppression might be too aggressive
3. No retry mechanism for failed deliveries
4. No PWA installation guidance

**Priority Fixes**:
1. Improve notification suppression logic (more conservative)
2. Add retry mechanism with exponential backoff
3. Add PWA installation check and guidance
4. Add notification delivery tracking

### Supabase Presence
**Status**: ✅ **Mostly Good, Minor Improvements Needed**

**Main Issues**:
1. Connection monitor timing slightly off (6s vs 5s heartbeat)
2. Presence updates sent even when channel not subscribed
3. Could wait for 'sync' event before initial presence update

**Priority Fixes**:
1. Adjust connection monitor interval to 4.5s
2. Check channel status before sending presence updates
3. Wait for 'sync' event before initial presence state

Both implementations are solid but have room for improvement, especially for Android reliability.
