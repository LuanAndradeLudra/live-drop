// src/http/server.ts
import express from 'express';
import routes from './routes.js';
import path from 'node:path';
import cors from 'cors';

export function buildServer() {
  const app = express();
  app.disable('x-powered-by');

  const allowlist = new Set([
    'https://www.csgo.net',
    'https://csgo.net',
    // 'http://localhost:3000',
    // 'http://127.0.0.1:3000'
  ]);

  app.use(cors({
    origin(origin, cb) {
      console.log('[http] cors origin:', origin);
      // requests sem Origin (ex: curl, server-to-server) -> permitir
      if (!origin) return cb(null, true);
      if (allowlist.has(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true, // se for usar cookies/Authorization
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization']
  }));

  app.use(express.json({ limit: '1mb' }));

  // estáticos
  app.use(express.static(path.join(process.cwd(), 'public'), { index: false }));
  app.get('/viewer', (_req, res) =>
    res.sendFile(path.join(process.cwd(), 'public', 'viewer.html'))
  );

  // API
  app.use('/api', routes);

  // health
  app.get('/healthz', (_req, res) => res.json({ ok: true }));


  // live drop
  app.get('/live-drop', (_req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'live-drop.html'));
  });

   app.get('/live-drop-streammer', (_req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'live-drop-streammer.html'));
  });

  // erro genérico
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error('[http] error:', err);
    const isCors = /CORS/i.test(String(err?.message || ''));
    res.status(isCors ? 403 : 500).json({ error: isCors ? 'cors_denied' : 'internal_error' });
  });

  return app;
}
