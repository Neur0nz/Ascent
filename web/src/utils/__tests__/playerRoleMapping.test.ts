import { describe, expect, it } from 'vitest';
import { getStartingPlayerIndex, mapPlayerIndexToRole } from '../playerRoleMapping';

describe('getStartingPlayerIndex', () => {
  it('returns 0 when creator starts', () => {
    expect(getStartingPlayerIndex('creator')).toBe(0);
  });

  it('returns 1 when opponent starts', () => {
    expect(getStartingPlayerIndex('opponent')).toBe(1);
  });
});

describe('mapPlayerIndexToRole', () => {
  it('maps player indices correctly when creator starts', () => {
    expect(mapPlayerIndexToRole(0, 'creator')).toBe('creator');
    expect(mapPlayerIndexToRole(1, 'creator')).toBe('opponent');
  });

  it('maps player indices correctly when opponent starts', () => {
    expect(mapPlayerIndexToRole(1, 'opponent')).toBe('opponent');
    expect(mapPlayerIndexToRole(0, 'opponent')).toBe('creator');
  });

  it('falls back gracefully for unexpected indices', () => {
    expect(mapPlayerIndexToRole(3, 'creator')).toBe('creator');
  });
});
