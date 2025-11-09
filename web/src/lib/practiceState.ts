import type { SantoriniStateSnapshot } from '@/types/match';

export type PracticeGameMode = 'P0' | 'P1' | 'Human' | 'AI';

export const PRACTICE_STATE_KEY = 'santorini:practiceState:v3';
export const PRACTICE_MODE_KEY = 'santorini:practiceGameMode';
export const PRACTICE_DIFFICULTY_KEY = 'santorini:practiceDifficulty';
export const DEFAULT_PRACTICE_MODE: PracticeGameMode = 'P0';
export const DEFAULT_PRACTICE_DIFFICULTY = 50;

const VALID_PRACTICE_MODES: PracticeGameMode[] = ['P0', 'P1', 'Human', 'AI'];
const DEFAULT_NAMESPACE = 'practice';

const isBrowser = () => typeof window !== 'undefined';

const normalizeNamespace = (namespace?: string): string => {
  if (!namespace) return DEFAULT_NAMESPACE;
  const trimmed = namespace.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : DEFAULT_NAMESPACE;
};

const snapshotKeyFor = (namespace?: string) => {
  const ns = normalizeNamespace(namespace);
  return ns === DEFAULT_NAMESPACE ? PRACTICE_STATE_KEY : `santorini:${ns}State:v1`;
};

const modeKeyFor = (namespace?: string) => {
  const ns = normalizeNamespace(namespace);
  return ns === DEFAULT_NAMESPACE ? PRACTICE_MODE_KEY : `santorini:${ns}Mode`;
};

const difficultyKeyFor = (namespace?: string) => {
  const ns = normalizeNamespace(namespace);
  return ns === DEFAULT_NAMESPACE ? PRACTICE_DIFFICULTY_KEY : `santorini:${ns}Difficulty`;
};

export function readPracticeSettings(namespace?: string): { mode: PracticeGameMode; difficulty: number } {
  let mode: PracticeGameMode = DEFAULT_PRACTICE_MODE;
  let difficulty = DEFAULT_PRACTICE_DIFFICULTY;
  const modeKey = modeKeyFor(namespace);
  const difficultyKey = difficultyKeyFor(namespace);

  if (!isBrowser()) {
    return { mode, difficulty };
  }

  try {
    const storedMode = window.localStorage.getItem(modeKey) as PracticeGameMode | null;
    if (storedMode && VALID_PRACTICE_MODES.includes(storedMode)) {
      mode = storedMode;
    }
  } catch (error) {
    console.warn('Unable to read practice mode from storage', error);
  }

  try {
    const storedDifficulty = window.localStorage.getItem(difficultyKey);
    if (storedDifficulty !== null) {
      const parsed = Number(storedDifficulty);
      if (Number.isFinite(parsed) && parsed > 0) {
        difficulty = parsed;
      } else {
        window.localStorage.removeItem(difficultyKey);
      }
    }
  } catch (error) {
    console.warn('Unable to read practice difficulty from storage', error);
  }

  return { mode, difficulty };
}

export function persistPracticeMode(mode: PracticeGameMode, namespace?: string): void {
  if (!isBrowser()) return;
  if (!VALID_PRACTICE_MODES.includes(mode)) return;
  try {
    window.localStorage.setItem(modeKeyFor(namespace), mode);
  } catch (error) {
    console.warn('Unable to persist practice mode', error);
  }
}

export function persistPracticeDifficulty(value: number, namespace?: string): void {
  if (!isBrowser()) return;
  if (!Number.isFinite(value) || value <= 0) return;
  try {
    window.localStorage.setItem(difficultyKeyFor(namespace), String(value));
  } catch (error) {
    console.warn('Unable to persist practice difficulty', error);
  }
}

export function writePracticeSnapshot(snapshot: SantoriniStateSnapshot, namespace?: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(snapshotKeyFor(namespace), JSON.stringify(snapshot));
  } catch (error) {
    console.warn('Unable to persist practice snapshot', error);
  }
}

export function readPracticeSnapshot(namespace?: string): SantoriniStateSnapshot | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(snapshotKeyFor(namespace));
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

export function clearPracticeSnapshot(namespace?: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(snapshotKeyFor(namespace));
  } catch (error) {
    console.warn('Unable to clear practice snapshot', error);
  }
}
