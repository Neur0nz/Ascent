import { describe, expect, it, beforeEach, beforeAll } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import type { PlayerProfile } from '@/types/match';
import { __TESTING__ } from '../useSupabaseAuth';

const {
  getErrorMessage,
  isNetworkError,
  isInvalidSessionError,
  isPostgrestUnauthorizedError,
  cacheAuthState,
  getCachedAuthState,
} = __TESTING__;

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  } satisfies Storage;
}

const mockSession = {
  access_token: 'access',
  refresh_token: 'refresh',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: {
    id: 'user-id',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
    last_sign_in_at: new Date().toISOString(),
    factors: [],
    identities: [],
  },
  provider_token: null,
  provider_refresh_token: null,
} as unknown as Session;

const mockProfile: PlayerProfile = {
  id: 'profile-id',
  auth_user_id: 'user-id',
  avatar_url: null,
  display_name: 'TestUser',
  rating: 1500,
  games_played: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  engine_preference: 'python',
  show_coordinate_labels: true,
  auto_analyze_games: false,
  auto_analyze_depth: 800,
};

describe('useSupabaseAuth helpers', () => {
  beforeAll(() => {
    const storage = createMemoryStorage();
    Object.defineProperty(globalThis, 'localStorage', {
      value: storage,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: { localStorage: storage },
      configurable: true,
    });
  });

  beforeEach(() => {
    localStorage.clear();
  });

  it('normalizes error messages correctly', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
    expect(getErrorMessage('plain string')).toBe('plain string');
    expect(getErrorMessage(undefined)).toBe('');
  });

  it('detects network related errors', () => {
    expect(isNetworkError(new Error('Network request failed'))).toBe(true);
    expect(isNetworkError('timeout while fetching')).toBe(true);
    expect(isNetworkError(new Error('something else'))).toBe(false);
  });

  it('detects invalid session errors', () => {
    expect(isInvalidSessionError(new Error('Invalid refresh token'))).toBe(true);
    expect(isInvalidSessionError('refresh token not found')).toBe(true);
    expect(isInvalidSessionError('permission denied')).toBe(false);
  });

  it('detects PostgREST unauthorized scenarios', () => {
    expect(
      isPostgrestUnauthorizedError({
        code: '42501',
        message: 'permission denied',
      }),
    ).toBe(true);

    expect(
      isPostgrestUnauthorizedError({
        code: 'PGRST302',
        message: 'JWT expired',
      }),
    ).toBe(true);

    expect(isPostgrestUnauthorizedError('invalid refresh token')).toBe(true);
    expect(isPostgrestUnauthorizedError({ code: '200', message: 'ok' })).toBe(false);
  });

  it('caches and restores auth state within the freshness window', () => {
    cacheAuthState(mockSession, mockProfile);
    const cached = getCachedAuthState();
    expect(cached?.session).toBeTruthy();
    expect(cached?.profile.display_name).toBe('TestUser');
  });

  it('expires cached auth state after one hour', () => {
    const stalePayload = {
      session: mockSession,
      profile: mockProfile,
      timestamp: Date.now() - 2 * 60 * 60 * 1000,
    };
    localStorage.setItem('santorini-auth-cache', JSON.stringify(stalePayload));

    expect(getCachedAuthState()).toBeNull();
    expect(localStorage.getItem('santorini-auth-cache')).toBeNull();
  });

  it('removes cached data when session or profile missing', () => {
    cacheAuthState(mockSession, mockProfile);
    expect(localStorage.getItem('santorini-auth-cache')).not.toBeNull();

    cacheAuthState(null, null);
    expect(localStorage.getItem('santorini-auth-cache')).toBeNull();
  });
});
