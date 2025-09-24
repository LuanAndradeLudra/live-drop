import { consumeBatch } from '../managers/rolls.manager';
import * as browserPool from '../services/browser-pool.service.js';

let running = false;
let scheduled = false;

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
        const MAX_PAGES = Number(process.env.PPTR_MAX_PAGES || 5);
        const free = Math.max(0, MAX_PAGES - (stat.active || 0));
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
}