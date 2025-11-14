import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SantoriniEngine, type SantoriniSnapshot } from '@/lib/santoriniEngine';
import { SantoriniWorkerClient } from '@/lib/runtime/santoriniWorkerClient';
import type { EvaluationSeriesPoint, EvaluationJobStatus } from '@/types/evaluation';
import type {
  EnginePreference,
  MatchMoveRecord,
  MatchRecord,
  SantoriniMoveAction,
  SantoriniStateSnapshot,
} from '@/types/match';

type SnapshotEntry = {
  snapshot: SantoriniSnapshot;
  moveIndex: number;
  action: SantoriniMoveAction | null;
  createdAt: string | null;
};

export interface EvaluationJob {
  id: string;
  matchId: string;
  matchLabel: string;
  depth: number | null;
  status: EvaluationJobStatus;
  createdAt: number;
  updatedAt: number;
  totalPositions: number;
  evaluatedCount: number;
  progress: number;
  points: EvaluationSeriesPoint[];
  error?: string;
}

export type StartEvaluationJobArgs = {
  match: MatchRecord;
  moves: MatchMoveRecord<SantoriniMoveAction>[];
  minMoveIndex: number;
  depth: number | null;
  enginePreference: EnginePreference;
  matchLabel: string;
};

type EvaluationJobsContextValue = {
  jobs: Record<string, EvaluationJob>;
  startJob: (args: StartEvaluationJobArgs) => Promise<EvaluationJob>;
  cancelJob: (jobId: string) => void;
};

type JobController = {
  cancelled: boolean;
  client?: SantoriniWorkerClient;
};

const EvaluationJobsContext = createContext<EvaluationJobsContextValue | null>(null);

const yieldToMainThread = () =>
  new Promise<void>((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(() => resolve(), 0);
  });

const createJobId = () => `eval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const buildSnapshotSequence = (
  match: MatchRecord,
  moves: MatchMoveRecord<SantoriniMoveAction>[],
): SnapshotEntry[] => {
  const initialSnapshot = match.initial_state as SantoriniSnapshot | null;
  if (!initialSnapshot) {
    throw new Error('Match snapshot unavailable');
  }

  let playbackEngine = SantoriniEngine.fromSnapshot(initialSnapshot);
  const snapshots: SnapshotEntry[] = [
    {
      snapshot: playbackEngine.snapshot,
      moveIndex: -1,
      action: null,
      createdAt: match.created_at ?? null,
    },
  ];

  for (const move of moves) {
    const action = move.action;
    if (!action || action.kind !== 'santorini.move' || typeof action.move !== 'number') {
      continue;
    }

    const recordedSnapshot = move.state_snapshot as SantoriniSnapshot | null;
    if (recordedSnapshot) {
      snapshots.push({
        snapshot: recordedSnapshot,
        moveIndex: move.move_index,
        action,
        createdAt: move.created_at ?? null,
      });
      try {
        playbackEngine = SantoriniEngine.fromSnapshot(recordedSnapshot);
      } catch (error) {
        console.warn('Failed to restore recorded snapshot during evaluation replay', {
          moveIndex: move.move_index,
          error,
        });
      }
      continue;
    }

    try {
      const result = playbackEngine.applyMove(action.move);
      snapshots.push({
        snapshot: result.snapshot,
        moveIndex: move.move_index,
        action,
        createdAt: move.created_at ?? null,
      });
      playbackEngine = SantoriniEngine.fromSnapshot(result.snapshot);
    } catch (error) {
      console.warn('Skipping move during evaluation replay', {
        moveIndex: move.move_index,
        action: action.move,
        error,
      });
    }
  }

  return snapshots;
};

const toEvaluationPoint = (
  entry: SnapshotEntry,
  value: number | null,
): EvaluationSeriesPoint => {
  const safeValue = Number.isFinite(value) && value != null ? value : 0;
  const label = safeValue >= 0 ? `+${safeValue.toFixed(3)}` : safeValue.toFixed(3);
  return {
    moveIndex: entry.moveIndex,
    moveNumber: entry.moveIndex === -1 ? 0 : entry.moveIndex + 1,
    evaluation: safeValue,
    label,
    player: entry.action?.by ?? null,
    timestamp: entry.createdAt ?? null,
  };
};

export function EvaluationJobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Record<string, EvaluationJob>>({});
  const jobsRef = useRef(jobs);
  const controllersRef = useRef<Map<string, JobController>>(new Map());

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const updateJob = useCallback(
    (jobId: string, updater: (job: EvaluationJob) => EvaluationJob) => {
      setJobs((prev) => {
        const current = prev[jobId];
        if (!current) {
          return prev;
        }
        return {
          ...prev,
          [jobId]: updater(current),
        };
      });
    },
    [],
  );

  const runJob = useCallback(
    async (
      jobId: string,
      entries: SnapshotEntry[],
      depth: number | null,
      enginePreference: EnginePreference,
    ) => {
      const controller = controllersRef.current.get(jobId);
      if (!controller) {
        return;
      }

      const client = new SantoriniWorkerClient();
      controller.client = client;

      try {
        await client.init(enginePreference);
      } catch (error) {
        console.error('Failed to initialize evaluation runtime', error);
        updateJob(jobId, (job) => ({
          ...job,
          status: 'error',
          error: error instanceof Error ? error.message : 'Failed to initialize evaluation runtime',
          updatedAt: Date.now(),
        }));
        controllersRef.current.delete(jobId);
        client.destroy();
        return;
      }

      const totalPositions = entries.length;

      try {
        for (const entry of entries) {
          if (controller.cancelled) {
            break;
          }

          await client.syncSnapshot(entry.snapshot as unknown as SantoriniStateSnapshot);
          if (controller.cancelled) {
            break;
          }

          const evaluation = await client.calculateEvaluation(depth ?? null);
          if (controller.cancelled) {
            break;
          }

          const valueArray = evaluation?.value;
          const rawValue = Array.isArray(valueArray) && valueArray.length > 0 ? Number(valueArray[0]) : null;
          const point = toEvaluationPoint(entry, rawValue);

          updateJob(jobId, (job) => {
            const evaluatedCount = Math.min(job.totalPositions, job.evaluatedCount + 1);
            return {
              ...job,
              status: 'running',
              points: [...job.points, point],
              evaluatedCount,
              progress: job.totalPositions === 0 ? 0 : evaluatedCount / job.totalPositions,
              updatedAt: Date.now(),
            };
          });

          await yieldToMainThread();
        }

        const finalStatus: EvaluationJobStatus = controller.cancelled ? 'cancelled' : 'success';
        updateJob(jobId, (job) => ({
          ...job,
          status: finalStatus,
          evaluatedCount: controller.cancelled ? job.evaluatedCount : totalPositions,
          progress: controller.cancelled ? job.progress : 1,
          updatedAt: Date.now(),
        }));
      } catch (error) {
        console.error('Evaluation job failed', error);
        updateJob(jobId, (job) => ({
          ...job,
          status: 'error',
          error: error instanceof Error ? error.message : 'Evaluation failed',
          updatedAt: Date.now(),
        }));
      } finally {
        controllersRef.current.delete(jobId);
        client.destroy();
      }
    },
    [updateJob],
  );

  const startJob = useCallback(
    async (args: StartEvaluationJobArgs): Promise<EvaluationJob> => {
      const snapshots = buildSnapshotSequence(args.match, args.moves);
      const filteredEntries = snapshots.filter((entry) => entry.moveIndex >= args.minMoveIndex);

      if (filteredEntries.length === 0) {
        throw new Error('Not enough moves yet to build an evaluation graph.');
      }

      // Cancel any existing running job for this match
      for (const job of Object.values(jobsRef.current)) {
        if (
          job.matchId === args.match.id &&
          (job.status === 'running' || job.status === 'queued')
        ) {
          const controller = controllersRef.current.get(job.id);
          if (controller) {
            controller.cancelled = true;
            controller.client?.cancelEvaluation().catch(() => undefined);
          }
          updateJob(job.id, (current) => ({
            ...current,
            status: 'cancelled',
            updatedAt: Date.now(),
          }));
        }
      }

      const jobId = createJobId();
      const createdAt = Date.now();
      const job: EvaluationJob = {
        id: jobId,
        matchId: args.match.id,
        matchLabel: args.matchLabel,
        depth: args.depth,
        status: 'queued',
        createdAt,
        updatedAt: createdAt,
        totalPositions: filteredEntries.length,
        evaluatedCount: 0,
        progress: 0,
        points: [],
      };

      controllersRef.current.set(jobId, { cancelled: false });
      setJobs((prev) => ({ ...prev, [jobId]: job }));

      void runJob(jobId, filteredEntries, args.depth, args.enginePreference);

      return job;
    },
    [runJob, updateJob],
  );

  const cancelJob = useCallback((jobId: string) => {
    const controller = controllersRef.current.get(jobId);
    if (controller) {
      controller.cancelled = true;
      controller.client?.cancelEvaluation().catch(() => undefined);
    }
    updateJob(jobId, (job) => ({
      ...job,
      status: 'cancelled',
      updatedAt: Date.now(),
    }));
  }, [updateJob]);

  const contextValue = useMemo(
    () => ({
      jobs,
      startJob,
      cancelJob,
    }),
    [jobs, startJob, cancelJob],
  );

  return <EvaluationJobsContext.Provider value={contextValue}>{children}</EvaluationJobsContext.Provider>;
}

export function useEvaluationJobs(): EvaluationJobsContextValue {
  const context = useContext(EvaluationJobsContext);
  if (!context) {
    throw new Error('useEvaluationJobs must be used within an EvaluationJobsProvider');
  }
  return context;
}
