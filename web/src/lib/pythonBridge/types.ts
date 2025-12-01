import type { SantoriniStateSnapshot } from '@/types/match';

export interface PythonEvalResult {
  value: number[];
}

export interface PythonMoveSummary {
  action: number;
  prob: number;
  text: string;
  eval?: number;
  delta?: number;
}

export interface PracticeSnapshotPayload {
  snapshot: SantoriniStateSnapshot;
}

export interface HistorySnapshotEntry {
  player?: number;
  action?: number | null;
  /** Board state BEFORE this move was made */
  board?: number[][][] | null;
  phase?: 'placement' | 'move' | 'unknown';
  description?: string;
}

export interface SantoriniPythonHandle {
  py: Record<string, any> | null;
  getBoardState: () => number[][][];
}
