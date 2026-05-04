import { fetchRollBlockHTML } from '../services/fetch-roll.adapter.js';
import {
  enqueueRoll, claimNextRolls, deleteFromQueue, markFailedOrRequeue, type RollType
} from '../repositories/rolls.repo.js';
import { insertFetched } from '../repositories/fetched-rolls.repo.js';
import { ENV } from '../config/env.js';
import type { WsHub } from '../services/ws-hub.js';
import { triggerConsumption } from '../jobs/job-runner.js';

const DEFAULT_BATCH = ENV.JOBS_DEFAULT_BATCH;
const MAX_TRIES = ENV.JOBS_MAX_TRIES;

/** Só persiste case no banco/WS se: drop > $5 e drop mais caro que a caixa. */
const MIN_DROP_PRICE_FOR_PROFIT = 5;

function isProfitableCaseRoll(data: unknown): boolean {
  if (data === null || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  const c = d.case as Record<string, unknown> | undefined;
  const dropObj = d.drop as Record<string, unknown> | undefined;
  const casePrice = Number(c?.price);
  const dropPrice = Number(dropObj?.price);
  if (!Number.isFinite(casePrice) || !Number.isFinite(dropPrice)) return false;
  return dropPrice > MIN_DROP_PRICE_FOR_PROFIT && dropPrice > casePrice;
}

let wsHub: WsHub | null = null;
export function setRollsWsHub(h: WsHub) { wsHub = h; }

// enqueue + WS + listener imediato
export async function enqueue(params: { userId: string; streamer: string; rollId: string; type: RollType }) {
  await enqueueRoll({ userId: params.userId, streamer: params.streamer, roll: params.rollId, type: params.type });

  // opcional: WS de "queued"
  try {
    wsHub?.broadcastQueuedRoll({
      id: 0,
      userId: params.userId,
      streamer: params.streamer,
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

  await Promise.all(jobs.map(async (job: typeof jobs[0]) => {
    try {
      const data = await fetchRollBlockHTML({
        userId: job.userId,
        rollId: job.roll,
        type: job.type,
        timeoutMs: 30_000
      });

      const persistCase =
        job.type !== 'case' || isProfitableCaseRoll(data);

      if (persistCase) {
        await insertFetched({
          userId: job.userId,
          streamer: job.streamer,
          roll: job.roll,
          type: job.type,
          data
        });

        try {
          wsHub?.broadcastFetchedRoll({
            userId: job.userId,
            streamer: job.streamer,
            roll: job.roll,
            type: job.type,
            data,
            processedAt: new Date().toISOString()
          });
        } catch {}
      } else {
        console.info(
          '[rolls] case roll ignorado (sem profit):',
          job.roll,
          'casePrice=',
          (data as { case?: { price?: number } })?.case?.price,
          'dropPrice=',
          (data as { drop?: { price?: number } })?.drop?.price
        );
      }

      await deleteFromQueue(job.id);
      done += 1;
    } catch (err) {
      await markFailedOrRequeue(job.id, MAX_TRIES);
      requeued += 1;
    }
  }));

  return { claimed: jobs.length, done, requeued };
}
