// src/services/browser-pool.service.js
import puppeteer from 'puppeteer';

const ENV = {
  HEADFUL: process.env.PPTR_HEADFUL === 'true',
  SLOWMO: Number(process.env.PPTR_SLOWMO || 0),
  DEVTOOLS: process.env.PPTR_DEVTOOLS === 'true',
  DEBUG_PORT: Number(process.env.PPTR_DEBUG_PORT || 0),
  EXEC_PATH: process.env.PPTR_EXECUTABLE_PATH || undefined,
  BLOCK_DETECTION: process.env.PPTR_BLOCK_DETECTION === 'true',
};

const MAX_PAGES = Number(process.env.PPTR_MAX_PAGES ?? 1);
const LAUNCH_MAX_RETRIES = 3;
const NEWPAGE_TIMEOUT_MS = 10_000;
const NEWPAGE_RETRIES = 2;
const CLOSE_HARD_ON_FATAL = true;

let browser = null;
let launchingPromise = null;
let active = 0;
const queue = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildLaunchOpts() {
  const launchOpts = {
    headless: process.env.SERVER === "hml" ? false : true,
    devtools: !!ENV.DEVTOOLS,
    slowMo: ENV.SLOWMO || 0,
    executablePath: ENV.EXEC_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--lang=en-US,en',
      '--window-size=1366,900',
    ],
    defaultViewport: { width: 1366, height: 900 },
  };
  if (ENV.DEBUG_PORT) launchOpts.args.push(`--remote-debugging-port=${ENV.DEBUG_PORT}`);
  return launchOpts;
}

function isConnected(b) {
  // Em algumas versões, browser.isConnected existe
  try { return !!(b && b.isConnected && b.isConnected()); } catch { return false; }
}

function onBrowserEvents(b) {
  b.on('disconnected', () => {
    console.error('[pptr] browser disconnected');
    browser = null;
  });
  b.on('targetcreated', (t) => {
    const url = safe(() => t.url()) || '';
    if (!url.startsWith('devtools://')) {
    }
  });
  b.on('targetdestroyed', (t) => {
    const url = safe(() => t.url()) || '';
    if (!url.startsWith('devtools://')) {
    }
  });
}

function safe(fn) { try { return fn(); } catch { return undefined; } }

async function closeBrowserHard(reason = 'manual') {
  if (!browser) return;
  try {
    const proc = safe(() => browser.process && browser.process());
    try { await browser.close(); } catch {}
    if (proc && !proc.killed) {
      try { proc.kill('SIGKILL'); } catch {}
    }
  } catch (e) {
    console.error('[pptr] error on hard close:', e?.message || e);
  } finally {
    browser = null;
  }
}

async function launchBrowser() {
  const opts = buildLaunchOpts();
  for (let attempt = 1; attempt <= LAUNCH_MAX_RETRIES; attempt++) {
    try {
      const b = await puppeteer.launch(opts);
      onBrowserEvents(b);
      return b;
    } catch (e) {
      console.error(`[pptr] launch failed (attempt ${attempt}/${LAUNCH_MAX_RETRIES}):`, e?.message || e);
      if (attempt === LAUNCH_MAX_RETRIES) throw e;
      await sleep(400 * attempt);
    }
  }
  throw new Error('unreachable launch error');
}

/** Garante um browser ligado (com lock para evitar lançamentos concorrentes). */
export async function getBrowser() {
  if (browser && isConnected(browser)) return browser;
  if (launchingPromise) return launchingPromise;

  launchingPromise = (async () => {
    // fecha restos de instâncias ruins antes de lançar de novo
    if (browser && !isConnected(browser)) {
      await closeBrowserHard('prelaunch-disconnected');
    }
    const b = await launchBrowser();
    browser = b;
    return b;
  })();

  try {
    return await launchingPromise;
  } finally {
    launchingPromise = null;
  }
}

/** Cria página com timeout e retries; se falhar, relança o browser e tenta de novo. */
async function newPageSafe({ name = 'task', createTimeoutMs = NEWPAGE_TIMEOUT_MS, retries = NEWPAGE_RETRIES } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const b = await getBrowser();
    try {
      const page = await promiseWithTimeout(b.newPage(), createTimeoutMs, `newPage timeout after ${createTimeoutMs}ms`);
      return page;
    } catch (e) {
      lastErr = e;
      console.warn(`[pptr:${name}] newPage failed (attempt ${attempt}/${retries + 1}):`, e?.message || e);
      // Relaunch browser e tenta de novo
      await closeBrowserHard('newPage-failed');
      await sleep(300 * attempt);
    }
  }
  throw lastErr;
}

function promiseWithTimeout(promise, ms, message) {
  let t; const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(message)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

async function safePageDefaults(page) {
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  try { await page.emulateTimezone('UTC'); } catch {}
  if (ENV.BLOCK_DETECTION) {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
      window.chrome = { runtime: {} };
    });
  }
}

function attachDebugListeners(page, name) {
  page.on('console', (msg) => {
    const type = safe(() => msg.type && msg.type()) || 'log';
  });
  page.on('pageerror', (err) => console.error(`[pptr:${name}:pageerror]`, err));
  page.on('requestfailed', (req) => {
    console.warn(`[pptr:${name}:requestfailed]`, req.url(), req.failure()?.errorText);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) console.warn(`[pptr:${name}:response] ${res.status()} ${res.url()}`);
  });
}

function isFatal(err) {
  const m = (err?.message || '').toLowerCase();
  return (
    m.includes('target closed') ||
    m.includes('browser has disconnected') ||
    m.includes('protocol error') ||
    m.includes('socket hang up') ||
    m.includes('cannot find context with specified id')
  );
}

/**
 * Executa `fn(page)` controlando:
 * - limite de concorrência (MAX_PAGES)
 * - criação de página com retries/timeout
 * - logs & listeners
 * - reinício do browser em erros fatais
 * - fechamento da página SEMPRE
 */
export async function withPage(fn, { name = 'task', createTimeoutMs = NEWPAGE_TIMEOUT_MS, retries = NEWPAGE_RETRIES } = {}) {
  // fila de concorrência
  if (active >= MAX_PAGES) await new Promise((r) => queue.push(r));
  active += 1;

  let page = null;
  try {
    page = await newPageSafe({ name, createTimeoutMs, retries });
    attachDebugListeners(page, name);
    await safePageDefaults(page);

    const out = await fn(page);
    return out;
  } catch (err) {
    console.error(`[pptr:${name}] task error:`, err?.message || err);
    if (CLOSE_HARD_ON_FATAL && isFatal(err)) {
      await closeBrowserHard('fatal-task-error');
    }
    throw err;
  } finally {
    try { await page?.close(); } catch (e) { console.warn(`[pptr:${name}] page.close() error:`, e?.message || e); }
    active -= 1;
    const next = queue.shift();
    if (next) next();
  }
}

export async function closeBrowser() {
  await closeBrowserHard('closeBrowser-called');
}

/** Útil pra métricas/healthcheck */
export function stats() {
  return {
    active,
    queued: queue.length,
    hasBrowser: !!browser,
    isConnected: isConnected(browser),
  };
}

/** Fechamento limpo quando app recebe sinais (opcional) */
const signals = ['SIGINT', 'SIGTERM'];
for (const s of signals) {
  process.once(s, async () => {
    await closeBrowserHard(`signal-${s}`);
    process.exit(0);
  });
}
