import { fetchRollBlockHTML } from '../services/fetch-roll.service';
import {
  enqueueRoll, claimNextRolls, deleteFromQueue, markFailedOrRequeue, type RollType
} from '../repositories/rolls.repo';
import { insertFetched } from '../repositories/fetched-rolls.repo';
import { ENV } from '../config/env';
import type { WsHub } from '../services/ws-hub';
import { triggerConsumption } from '../jobs/job-runner';

const DEFAULT_BATCH = ENV.JOBS_DEFAULT_BATCH;
const MAX_TRIES = ENV.JOBS_MAX_TRIES;

let wsHub: WsHub | null = null;
export function setRollsWsHub(h: WsHub) { wsHub = h; }

// enqueue + WS + listener imediato
export async function enqueue(params: { userId: string; rollId: string; type: RollType }) {
  await enqueueRoll({ userId: params.userId, roll: params.rollId, type: params.type });

  // opcional: WS de "queued"
  try {
    wsHub?.broadcastQueuedRoll({
      id: 0,
      userId: params.userId,
      roll: params.rollId,
      type: params.type,
      createdAt: new Date().toISOString()
    });
  } catch {}
  // tenta consumir imediatamente (com debounce/controle do runner)
  triggerConsumption().catch(() => {});
}

export async function consumeBatch({ batch = DEFAULT_BATCH } = {}) {
  const jobs = await claimNextRolls({ batch, maxTries: MAX_TRIES });
  if (!jobs.length) return { claimed: 0, done: 0, requeued: 0 };

  let done = 0;
  let requeued = 0;

  await Promise.all(jobs.map(async (job) => {
    try {
      const data = await fetchRollBlockHTML({
        userId: job.user_id,
        rollId: job.roll,
        type: job.type,
        timeoutMs: 30_000
      });

      await insertFetched({
        userId: job.user_id,
        roll: job.roll,
        type: job.type,
        data
      });

      await deleteFromQueue(job.id);
      done += 1;

      try {
        wsHub?.broadcastFetchedRoll({
          userId: job.user_id,
          roll: job.roll,
          type: job.type,
          data,
          processedAt: new Date().toISOString()
        });
      } catch {}
    } catch (err) {
      await markFailedOrRequeue(job.id, MAX_TRIES);
      requeued += 1;
    }
  }));

  return { claimed: jobs.length, done, requeued };
}
