import { fetchRollBlockHTML, type FetchOutput } from '../services/fetch-roll.adapter.js';
import {
  enqueueRoll, claimNextRolls, deleteFromQueue, markFailedOrRequeue, type RollType
} from '../repositories/rolls.repo.js';
import { insertFetched } from '../repositories/fetched-rolls.repo.js';
import { ENV } from '../config/env.js';
import type { WsHub } from '../services/ws-hub.js';
import { triggerConsumption } from '../jobs/job-runner.js';

const DEFAULT_BATCH = ENV.JOBS_DEFAULT_BATCH;
const MAX_TRIES = ENV.JOBS_MAX_TRIES;

function isProfit(data: FetchOutput): boolean {
  if (data.type === 'case') {
    const casePrice = data.case.price ?? 0;
    const dropPrice = data.drop.price ?? 0;
    // case value > 5 e profit item > case value
    return casePrice > 5 && dropPrice > casePrice;
  } else if (data.type === 'upgrade') {
    const firstValue = parseFloat(data.firstValue || '0');
    const secondValue = parseFloat(data.secondValue || '0');
    const receivedBalance = parseFloat(data.receivedBalance || '0');
    const totalUsed = firstValue + secondValue;
    // Todos os itens somados < profit e profit > 5
    return totalUsed < receivedBalance && receivedBalance > 5;
  }
  return false;
}

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

  await Promise.all(jobs.map(async (job: typeof jobs[0]) => {
    try {
      const data = await fetchRollBlockHTML({
        userId: job.user_id,
        rollId: job.roll,
        type: job.type,
        timeoutMs: 30_000
      });

      // Valida se é profit antes de salvar
      if (!isProfit(data)) {
        // Não é profit, remove da fila sem salvar
        await deleteFromQueue(job.id);
        return;
      }

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
