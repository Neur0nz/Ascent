export interface EvaluationSeriesPoint {
  moveIndex: number;
  moveNumber: number;
  evaluation: number;
  label: string;
  player: 'creator' | 'opponent' | null;
  timestamp?: string | null;
}

export type EvaluationJobStatus = 'queued' | 'running' | 'success' | 'error' | 'cancelled';

