import { fetchRollBlockHTML } from '../services/fetch-roll.adapter.js';
import {
  enqueueRoll,
  claimNextRolls,
  deleteFromQueue,
  markFailedOrRequeue,
  type RollType,
} from '../repositories/rolls.repo.js';
import { insertFetched } from '../repositories/fetched-rolls.repo.js';
import { ENV } from '../config/env.js';
import type { WsHub } from '../services/ws-hub.js';
import { triggerConsumption } from '../jobs/job-runner.js';

const DEFAULT_BATCH = ENV.JOBS_DEFAULT_BATCH;
const MAX_TRIES = ENV.JOBS_MAX_TRIES;

/** Mesmo limiar numérico do site (case: drop; upgrade: valor recebido). */
const MIN_PRICE_CASE_DROP = 5;
const MIN_PRICE_UPGRADE_RECEIVED = 5;

/** Extrai número de strings tipo "$ 12,34" / "12.34 USD". */
function parseMoneyLike(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().replace(/\s/g, ' ');
  const m = s.match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Case: drop > 5 e drop mais caro que a caixa. */
function isProfitableCaseRoll(data: unknown): boolean {
  if (data === null || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  const c = d.case as Record<string, unknown> | undefined;
  const dropObj = d.drop as Record<string, unknown> | undefined;
  const casePrice = Number(c?.price);
  const dropPrice = Number(dropObj?.price);
  if (!Number.isFinite(casePrice) || !Number.isFinite(dropPrice)) return false;
  return dropPrice > MIN_PRICE_CASE_DROP && dropPrice > casePrice;
}

/** Upgrade: valor do item ganho (receivedBalance) > 5. */
function isWorthwhileUpgradeRoll(data: unknown): boolean {
  if (data === null || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  const received = parseMoneyLike(d.receivedBalance);
  if (received === null) return false;
  return received > MIN_PRICE_UPGRADE_RECEIVED;
}

function shouldPersistFetched(jobType: RollType, data: unknown): boolean {
  if (jobType === 'case') return isProfitableCaseRoll(data);
  if (jobType === 'upgrade') return isWorthwhileUpgradeRoll(data);
  return false;
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

      const persist = shouldPersistFetched(job.type, data);

      // Garante que os campos de usuário no JSON batem com o job que originou o drop,
      // evitando que dados de scrape com race condition apareçam com o usuário errado.
      const sanitizedData = { ...data as object, userId: job.userId };

      if (persist) {
        await insertFetched({
          userId: job.userId,
          streamer: job.streamer,
          roll: job.roll,
          type: job.type,
          data: sanitizedData
        });

        try {
          wsHub?.broadcastFetchedRoll({
            userId: job.userId,
            streamer: job.streamer,
            roll: job.roll,
            type: job.type,
            data: sanitizedData,
            processedAt: new Date().toISOString()
          });
        } catch {}
      } else if (job.type === 'case') {
        console.info(
          '[rolls] case ignorado (regra: drop > 5 e drop > caixa):',
          job.roll,
          'casePrice=',
          (data as { case?: { price?: number } })?.case?.price,
          'dropPrice=',
          (data as { drop?: { price?: number } })?.drop?.price
        );
      } else {
        console.info(
          '[rolls] upgrade ignorado (regra: item > 5):',
          job.roll,
          'receivedBalance=',
          (data as { receivedBalance?: string })?.receivedBalance
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
