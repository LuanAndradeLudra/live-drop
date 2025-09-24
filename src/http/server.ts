import express from 'express';
import routes from './routes';
import path from 'node:path';

export function buildServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // servir /public como estático (sem index automático)
  app.use(express.static(path.join(process.cwd(), 'public'), { index: false }));

  app.use('/api', routes);

  // healthcheck
  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // live drop
  app.get('/live-drop', (_req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'live-drop.html'));
  });

  // erro genérico
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error('[http] error:', err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
