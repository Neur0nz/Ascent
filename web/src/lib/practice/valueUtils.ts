import type { PracticeTopMove } from './types';

const stripAnsi = (value: string) => value.replace(/\u001b\[[0-9;]*m/g, '').trim();

export const toPlainValue = (value: unknown): unknown => {
  if (value && typeof value === 'object') {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (value instanceof Map) {
      const plainObject: Record<string, unknown> = {};
      for (const [key, mapValue] of value.entries()) {
        plainObject[String(key)] = toPlainValue(mapValue);
      }
      return plainObject;
    }
    if (value instanceof Set) {
      return Array.from(value).map((item) => toPlainValue(item));
    }
    if (Array.isArray(value)) {
      return value.map((item) => toPlainValue(item));
    }
    if (typeof (value as { toJs?: (options?: { create_proxies?: boolean }) => unknown }).toJs === 'function') {
      const proxy = value as { toJs: (options?: { create_proxies?: boolean }) => unknown; destroy?: () => void };
      const plain = proxy.toJs({ create_proxies: false });
      proxy.destroy?.();
      return toPlainValue(plain);
    }
    const plainObject = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(plainObject).map(([k, v]) => [k, toPlainValue(v)]));
  }
  return value;
};

export const toFiniteNumber = (value: unknown): number | null => {
  const plain = toPlainValue(value);
  if (typeof plain === 'number') {
    return Number.isFinite(plain) ? plain : null;
  }
  if (typeof plain === 'bigint') {
    return Number(plain);
  }
  if (typeof plain === 'string') {
    const cleaned = plain.trim().replace(/,/g, '.').replace(/[^0-9.+\-eE]/g, '');
    if (!cleaned) {
      return null;
    }
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (plain !== value) {
    return toFiniteNumber(plain);
  }
  return null;
};

export const normalizeTopMoves = (rawMoves: unknown): PracticeTopMove[] => {
  if (!Array.isArray(rawMoves)) {
    return [];
  }

  return rawMoves.map((entry) => {
    const move = toPlainValue(entry) as Record<string, unknown>;

    const actionValue = toFiniteNumber(move?.action);
    const rawProb = move?.prob;
    const probValue = toFiniteNumber(rawProb);
    const textValue = toPlainValue(move?.text);

    const normalized: PracticeTopMove = {
      action: actionValue != null ? Math.trunc(actionValue) : -1,
      prob:
        probValue != null
          ? (() => {
              const base = (() => {
                if (typeof rawProb === 'string' && rawProb.includes('%')) {
                  return probValue / 100;
                }
                if (probValue > 1) {
                  return probValue / 100;
                }
                return probValue;
              })();
              return Math.min(Math.max(base, 0), 1);
            })()
          : 0,
      text:
        typeof textValue === 'string'
          ? stripAnsi(textValue)
          : textValue != null
          ? stripAnsi(String(toPlainValue(textValue)))
          : '',
    };

    if (move.eval !== undefined) {
      const evalValue = toFiniteNumber(move.eval);
      if (evalValue != null) {
        normalized.eval = evalValue;
      }
    }

    if (move.delta !== undefined) {
      const deltaValue = toFiniteNumber(move.delta);
      if (deltaValue != null) {
        normalized.delta = deltaValue;
      }
    }

    return normalized;
  });
};
