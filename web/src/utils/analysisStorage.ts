export const LAST_ANALYZED_MATCH_KEY = 'santorini:lastAnalyzedMatch';

export function rememberLastAnalyzedMatch(matchId: string) {
  if (!matchId) return;
  try {
    localStorage.setItem(LAST_ANALYZED_MATCH_KEY, matchId);
  } catch (error) {
    console.warn('Unable to store last analyzed match id', error);
  }
}

export function getLastAnalyzedMatch(): string {
  try {
    return localStorage.getItem(LAST_ANALYZED_MATCH_KEY) ?? '';
  } catch {
    return '';
  }
}
