import { consumeBatch } from '../managers/rolls.manager.js';
import * as browserPool from '../services/browser-pool.service.js';
import { releaseStaleProcessing } from '../repositories/rolls.repo.js';
import { ENV } from '../config/env.js';

let running = false;
let scheduled = false;

async function runStaleProcessingSweep() {
  if (ENV.STALE_PROCESSING_MINUTES <= 0) return;
  try {
    const n = await releaseStaleProcessing(ENV.STALE_PROCESSING_MINUTES);
    if (n > 0) {
      console.info(
        `[job-runner] ${n} roll(s) processing → queued (sem atualização há > ${ENV.STALE_PROCESSING_MINUTES} min)`
      );
      triggerConsumption().catch(() => {});
    }
  } catch (e) {
    console.error('[job-runner] releaseStaleProcessing:', e);
  }
}

export async function triggerConsumption() {
  if (running) { 
    // já tem execução em curso; marcar para rodar mais uma vez ao final
    scheduled = true; 
    return;
  }

  running = true;
  try {
    do {
      scheduled = false;
      while (true) {
        const stat = browserPool.stats(); // { active, ... }
        const free = Math.max(0, ENV.PPTR_MAX_PAGES - (stat.active || 0));
        if (free <= 0) break;

        const out = await consumeBatch({ batch: free });
        if (!out.claimed) break;
      }
      // se alguém marcou "scheduled" enquanto rodávamos, roda mais uma passada
    } while (scheduled);
  } catch (e) {
    console.error('[job-runner] triggerConsumption error:', (e as any)?.message || e);
  } finally {
    running = false;
  }
}

export function startCron() {
  setInterval(() => { triggerConsumption().catch(() => {}); }, 30_000);

  // Cron: processing preso (sem heartbeat em updated_at) → volta pra queued e dispara consumo
  setInterval(() => {
    runStaleProcessingSweep().catch(() => {});
  }, ENV.STALE_PROCESSING_INTERVAL_MS);

  setTimeout(() => {
    runStaleProcessingSweep().catch(() => {});
  }, 5_000);
}