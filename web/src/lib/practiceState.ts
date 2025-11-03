import type { SantoriniStateSnapshot } from '@/types/match';

export type PracticeGameMode = 'P0' | 'P1' | 'Human' | 'AI';

export const PRACTICE_STATE_KEY = 'santorini:practiceState:v3';
export const PRACTICE_MODE_KEY = 'santorini:practiceGameMode';
export const PRACTICE_DIFFICULTY_KEY = 'santorini:practiceDifficulty';
export const DEFAULT_PRACTICE_MODE: PracticeGameMode = 'P0';
export const DEFAULT_PRACTICE_DIFFICULTY = 50;

const VALID_PRACTICE_MODES: PracticeGameMode[] = ['P0', 'P1', 'Human', 'AI'];

const isBrowser = () => typeof window !== 'undefined';

export function readPracticeSettings(): { mode: PracticeGameMode; difficulty: number } {
  let mode: PracticeGameMode = DEFAULT_PRACTICE_MODE;
  let difficulty = DEFAULT_PRACTICE_DIFFICULTY;

  if (!isBrowser()) {
    return { mode, difficulty };
  }

  try {
    const storedMode = window.localStorage.getItem(PRACTICE_MODE_KEY) as PracticeGameMode | null;
    if (storedMode && VALID_PRACTICE_MODES.includes(storedMode)) {
      mode = storedMode;
    }
  } catch (error) {
    console.warn('Unable to read practice mode from storage', error);
  }

  try {
    const storedDifficulty = window.localStorage.getItem(PRACTICE_DIFFICULTY_KEY);
    if (storedDifficulty !== null) {
      const parsed = Number(storedDifficulty);
      if (Number.isFinite(parsed) && parsed > 0) {
        difficulty = parsed;
      } else {
        window.localStorage.removeItem(PRACTICE_DIFFICULTY_KEY);
      }
    }
  } catch (error) {
    console.warn('Unable to read practice difficulty from storage', error);
  }

  return { mode, difficulty };
}

export function persistPracticeMode(mode: PracticeGameMode): void {
  if (!isBrowser()) return;
  if (!VALID_PRACTICE_MODES.includes(mode)) return;
  try {
    window.localStorage.setItem(PRACTICE_MODE_KEY, mode);
  } catch (error) {
    console.warn('Unable to persist practice mode', error);
  }
}

export function persistPracticeDifficulty(value: number): void {
  if (!isBrowser()) return;
  if (!Number.isFinite(value) || value <= 0) return;
  try {
    window.localStorage.setItem(PRACTICE_DIFFICULTY_KEY, String(value));
  } catch (error) {
    console.warn('Unable to persist practice difficulty', error);
  }
}

export function writePracticeSnapshot(snapshot: SantoriniStateSnapshot): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(PRACTICE_STATE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn('Unable to persist practice snapshot', error);
  }
}

export function readPracticeSnapshot(): SantoriniStateSnapshot | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(PRACTICE_STATE_KEY);
    if (!raw) {
      return null;
    }
    const snapshot = JSON.parse(raw) as SantoriniStateSnapshot;
    return snapshot?.version === 1 ? snapshot : null;
  } catch (error) {
    console.warn('Unable to read practice snapshot', error);
    return null;
  }
}

export function clearPracticeSnapshot(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(PRACTICE_STATE_KEY);
  } catch (error) {
    console.warn('Unable to clear practice snapshot', error);
  }
}
