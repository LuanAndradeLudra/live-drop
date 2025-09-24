import { ENV } from './config/env';
import { buildServer } from './http/server';
import http from 'node:http';
import { createWsHub } from './services/ws-hub';
import { setRollsWsHub } from './managers/rolls.manager';
import { startCron } from './jobs/job-runner';

async function main() {
  const app = buildServer();
  const server = http.createServer(app);

  const hub = createWsHub(server, { path: '/ws' });
  setRollsWsHub(hub);

  // cron de 30s
  startCron();

  server.listen(ENV.PORT, () => {
    console.log(`[live-drop] http/ws on :${ENV.PORT} (cron: 30s)`);
  });
}

main().catch((e) => {
  console.error('[live-drop] fatal:', e);
  process.exit(1);
});
