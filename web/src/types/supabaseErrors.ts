/** Error shape returned by supabase.functions.invoke() on non-2xx responses. */
export interface FunctionInvokeErrorBody {
  error?: string;
  code?: string;
  activeMatchId?: string | null;
  retryAfterMs?: number;
  lastPingAt?: string | null;
}

interface FunctionInvokeErrorContext {
  status?: number;
  body?: FunctionInvokeErrorBody;
}

/** Extracts the response body from a Supabase FunctionInvokeError, if present. */
export function getFunctionErrorBody(error: unknown): FunctionInvokeErrorBody | undefined {
  if (error !== null && typeof error === 'object' && 'context' in error) {
    const ctx = (error as { context?: FunctionInvokeErrorContext }).context;
    return ctx?.body ?? undefined;
  }
  return undefined;
}

/** Custom error with a machine-readable code and optional metadata. */
export class CodedError extends Error {
  code: string;
  activeMatchId?: string | null;
  retryAfterMs?: number;
  lastPingAt?: string | null;

  constructor(message: string, code: string, meta?: { activeMatchId?: string | null; retryAfterMs?: number; lastPingAt?: string | null }) {
    super(message);
    this.name = 'CodedError';
    this.code = code;
    if (meta?.activeMatchId !== undefined) this.activeMatchId = meta.activeMatchId;
    if (meta?.retryAfterMs !== undefined) this.retryAfterMs = meta.retryAfterMs;
    if (meta?.lastPingAt !== undefined) this.lastPingAt = meta.lastPingAt;
  }
}
