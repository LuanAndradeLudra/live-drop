import { consumeBatch } from '../managers/rolls.manager';
import * as browserPool from '../services/browser-pool.service.js'; // seu pool atual

let running = false;

/**
 * Tenta consumir respeitando a capacidade livre do BrowserPool.
 * Evita rodadas concorrentes com a flag `running`.
 */
export async function triggerConsumption() {
  if (running) return;
  running = true;
  try {
    while (true) {
      const stat = browserPool.stats(); // { active, queued, hasBrowser, isConnected }
      const MAX_PAGES = Number(process.env.PPTR_MAX_PAGES || 5);
      const free = Math.max(0, MAX_PAGES - (stat.active || 0));
      if (free <= 0) break;

      // pede no máximo o que cabe agora
      const out = await consumeBatch({ batch: free });
      // se não conseguimos “claimar” nada, não há mais o que fazer agora
      if (!out.claimed) break;

      // se ainda tem espaço, loop tenta mais uma rodada;
      // caso tenha pegado tudo mas encheu a capacidade, o while encerra naturalmente.
    }
  } catch (e) {
    console.error('[job-runner] triggerConsumption error:', (e as any)?.message || e);
  } finally {
    running = false;
  }
}

/** Cron simples a cada 30s */
export function startCron() {
  setInterval(() => {
    triggerConsumption().catch(() => {});
  }, 30_000);
}
