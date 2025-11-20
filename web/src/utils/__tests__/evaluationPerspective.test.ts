import { describe, expect, it } from 'vitest';
import { orientEvaluationToCreator } from '../evaluationPerspective';

describe('orientEvaluationToCreator', () => {
  it('keeps sign when creator is player 0', () => {
    expect(orientEvaluationToCreator(0.42, 'creator')).toBeCloseTo(0.42);
    expect(orientEvaluationToCreator(-0.3, 'creator')).toBeCloseTo(-0.3);
  });

  it('flips sign when creator is player 1', () => {
    expect(orientEvaluationToCreator(0.5, 'opponent')).toBeCloseTo(-0.5);
    expect(orientEvaluationToCreator(-0.75, 'opponent')).toBeCloseTo(0.75);
  });

  it('returns null for non-finite inputs', () => {
    expect(orientEvaluationToCreator(undefined, 'creator')).toBeNull();
    expect(orientEvaluationToCreator(NaN, 'opponent')).toBeNull();
  });
});

