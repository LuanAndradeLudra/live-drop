import express from 'express';
import routes from './routes';

export function buildServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', routes);

  // healthcheck
  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // erro genérico
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error('[http] error:', err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
