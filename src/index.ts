import { ENV } from './config/env';
import { buildServer } from './http/server';
import http from 'node:http';
import { createWsHub } from './services/ws-hub';
import { setRollsWsHub } from './managers/rolls.manager';

async function main() {
  const app = buildServer();
  const server = http.createServer(app);

  // WebSocket
  const hub = createWsHub(server, { path: '/ws' });
  setRollsWsHub(hub);

  server.listen(ENV.PORT, () => {
    console.log(`[live-drop] http/ws on :${ENV.PORT} (ws path: /ws)`);
  });
}

main().catch((e) => {
  console.error('[live-drop] fatal:', e);
  process.exit(1);
});
