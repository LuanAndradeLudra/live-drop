// src/services/fetch-roll.service.js
import * as browserPool from './browser-pool.service.js';

const OPEN_TAB_MAX_ATTEMPTS = 5;
const JOB_TIMEOUT_MS = 30_000;
const LOAD_MORE_MAX_CLICKS = 3;

function waitMs(page, ms) {
  if (page && typeof page.waitForTimeout === 'function') {
    return page.waitForTimeout(ms);
  }
  if (page && typeof page.waitFor === 'function') {
    return page.waitFor(ms);
  }
  return new Promise((res) => setTimeout(res, ms));
}

function withTimeout(promiseFactory, ms) {
  let timer;
  const ko = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`Timeout after ${ms}ms`)), ms);
  });
  return {
    run: async () => {
      try {
        return await Promise.race([promiseFactory(), ko]);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

/* =========================
 * HELPERS COMUNS
 * =======================*/
async function hideMobileNav(page) {
  await page.evaluate(() => {
    const nav = document.querySelector('.mobile-nav');
    if (nav) nav.style.display = 'none';
  });
}

async function clickLoadMoreOnce(page) {
  return page.evaluate(() => {
    const byAttr = document.querySelector('button[action="loadMore"], .action[action="loadMore"]');
    if (byAttr) { byAttr.click(); return true; }

    const buttons = Array.from(document.querySelectorAll('button, .action'));
    const btn = buttons.find(el => /load\s*more|carregar\s+mais/i.test((el.textContent || '').replace(/\s+/g, ' ')));
    if (btn) { btn.click(); return true; }

    return false;
  });
}

async function waitMoreBlocks(page, prevCount, timeout = 5000) {
  try {
    await page.waitForFunction((prev) => {
      const curr = document.querySelectorAll('.skins-block, .skin').length;
      return curr > prev;
    }, { timeout, polling: 'mutation' }, prevCount);
  } catch (err) { 
    console.log(err)
   }
}

/* =========================
 * UPGRADE FLOW
 * =======================*/
async function openUpgradesWithRetry(page, maxAttempts = OPEN_TAB_MAX_ATTEMPTS) {
  const selector =
    'button.tabs__tab.js-user-items-tab[selectblock="upgrades"], [selectblock="upgrades"].js-user-items-tab';

  for (let i = 1; i <= maxAttempts; i++) {
    const state = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return 'no-element';
      if (!el.classList.contains('active')) el.click();
      return el.classList.contains('active') ? 'active' : 'clicked';
    }, selector);

    if (state === 'active' || state === 'clicked') {
      try {
        await page.waitForSelector('.skins-block', { timeout: 1200 });
        return;
      } catch {}
    }
    await waitMs(page, 250);
  }
  throw new Error('Não foi possível abrir a aba "Aprimoramentos"');
}

async function parseUpgradeBlock(page, rollId) {
  return page.evaluate((wanted) => {
    const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : s);

    const blocks = Array.from(document.querySelectorAll('.skins-block'));
    for (const block of blocks) {
      const a = block.querySelector('a.skins-block__item-pf[href*="rollID="]');
      if (!a) continue;

      const href = a.getAttribute('href') || '';
      const m = href.match(/rollID=([^&]+)/);
      const found = m && m[1];
      if (found !== wanted) continue;

      const headCols = block.querySelectorAll('.skins-block__head-column');

      const usedValue = headCols[0];
      const skinsBalance = clean(usedValue?.querySelectorAll('.price')[0]?.textContent || '');
      const balance      = clean(usedValue?.querySelectorAll('.price')[1]?.textContent || '');

      const receivedValue   = headCols[1];
      const chance          = clean(receivedValue?.querySelectorAll('.action_lighten-border')[0]?.textContent || '');
      const receivedBalance = clean(receivedValue?.querySelectorAll('.action_lighten-border')[1]?.textContent || '');

      const usedSkins = block.querySelectorAll('.skins-block__item_left > .skins-block__item-data');
      const usedSkinsFormatted = [];
      usedSkins.forEach((skin) => {
        const formatedSkin = {
          name:   clean(skin.querySelector('.skins-block__name')?.textContent || ''),
          type:   clean(skin.querySelector('.skins-block__type')?.textContent || ''),
          image:  clean(skin.querySelector('.skins-block__item-img')?.src || ''),
          rarity: clean((skin.classList && skin.classList[skin.classList.length - 1]) || ''),
        };
        usedSkinsFormatted.push(formatedSkin);
      });

      const receivedSkin = block.querySelector('.skins-block__item_right > .skins-block__item-data');
      const receivedSkinsFormatted = receivedSkin ? {
        name:   clean(receivedSkin.querySelector('.skins-block__name')?.textContent || ''),
        type:   clean(receivedSkin.querySelector('.skins-block__type')?.textContent || ''),
        image:  clean(receivedSkin.querySelector('.skins-block__item-img')?.src || ''),
        rarity: clean((receivedSkin.classList && receivedSkin.classList[receivedSkin.classList.length - 1]) || ''),
      } : null;

      return {
        type: 'upgrade',
        rollId: found,
        skinsBalance,
        balance,
        chance,
        receivedBalance,
        usedSkinsFormatted,
        receivedSkinsFormatted,
        // html: block.outerHTML,
      };
    }
    return null;
  }, rollId);
}

async function findUpgradeWithLoadMore(page, rollId, maxClicks = LOAD_MORE_MAX_CLICKS) {
  try {
    let data = await parseUpgradeBlock(page, rollId);
  if (data) return data;

  for (let i = 0; i < maxClicks; i++) {
    const before = await page.evaluate(() => document.querySelectorAll('.skins-block').length);

    const clicked = await clickLoadMoreOnce(page);
    
    if (!clicked) break;
    await waitMoreBlocks(page, before, 5000);
    await waitMs(page, 250);
    data = await parseUpgradeBlock(page, rollId);
    if (data) return data;
  }
  return null;
  } catch (err) {
    console.log(err)
  }
}

/* =========================
 * CASE FLOW
 * =======================*/
async function openCaseGridWithRetry(page, maxAttempts = OPEN_TAB_MAX_ATTEMPTS) {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      await page.waitForSelector('.grid_drops', { timeout: 1200 });
      return;
    } catch {}
    await waitMs(page, 250);
  }
  throw new Error('Grid de cases (.grid_drops) não encontrada');
}

async function hasCaseAnchor(page, rollId) {
  return page.evaluate((wanted) => {
    const grid = document.querySelector('.grid_drops');
    if (!grid) return false;
    const anchors = grid.querySelectorAll('a.skin__state.skin__state_provably[href*="rollID="]');
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/rollID=([^&]+)/);
      const found = m && m[1];
      if (found === wanted) return true;
    }
    return false;
  }, rollId);
}

async function clickCaseAnchor(page, rollId) {
  // clica e espera navegação
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 12000 }),
    page.evaluate((wanted) => {
      const grid = document.querySelector('.grid_drops');
      if (!grid) return;
      const anchors = grid.querySelectorAll('a.skin__state.skin__state_provably[href*="rollID="]');
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        const m = href.match(/rollID=([^&]+)/);
        const found = m && m[1];
        if (found === wanted) {
          a.click();
          return;
        }
      }
    }, rollId),
  ]);
}

async function parseProvablyCasePage(page, rollId) {
  // garante que a página carregou os elementos alvo
  await page.waitForSelector('.layout-provably-fair__title', { timeout: 10000 });

  const provablyUrl = page.url();

  return page.evaluate((wanted, provablyUrl) => {
    const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : s);
    const parseNum = (s) => {
      if (!s) return null;
      const t = String(s).replace(/[^\d.,-]/g, '').replace(',', '.').trim();
      const n = parseFloat(t);
      return Number.isFinite(n) ? n : null;
    };
    const currencyFrom = (el) => {
      if (!el) return null;
      const cls = el.className || '';
      const m = cls.match(/price-(USD|EUR|BRL)/i);
      return m ? m[1].toUpperCase() : null;
    };

    // Roll number
    const rollTitle = document.querySelector('.layout-provably-fair__title');
    const rollNumber = (() => {
      const m = (rollTitle?.textContent || '').match(/Roll:\s*([\d.,]+)/i);
      return m ? parseNum(m[1]) : null;
    })();

    // Case info
    const caseImgEl   = document.querySelector('img.layout-provably-fair__type-img');
    const caseNameEl  = document.querySelector('.layout-provably-fair__type-title');
    const casePriceEl = document.querySelector('.layout-provably-fair__type-value.price');

    const caseImage = clean(caseImgEl?.src || '');
    const caseName  = clean(caseNameEl?.textContent || '');
    const casePrice = parseNum(casePriceEl?.textContent || '');
    const caseCurrency = currencyFrom(casePriceEl);

    // Drop atual
    const row = document.querySelector('tr.current-roll-drop');
    const dropImg   = row?.querySelector('.table-big__item-img')?.src || '';
    const dropName  = row?.querySelector('.table-big__first-name')?.textContent || '';
    const dropPriceEl = row?.querySelector('.table-big__accent.price');
    const dropPrice = parseNum(dropPriceEl?.textContent || '');
    const dropCurrency = currencyFrom(dropPriceEl);

    // odds e range (se existirem nessas colunas)
    let oddsPercent = null;
    let range = null;
    if (row) {
      const tds = Array.from(row.querySelectorAll('td'));
      if (tds[3]) {
        const m = (tds[3].textContent || '').match(/([\d.,]+)\s*%/);
        oddsPercent = m ? parseNum(m[1]) : null;
      }
      if (tds[2]) range = clean(tds[2].textContent || '');
    }

    return {
      type: 'case',
      rollId: wanted,
      provablyUrl,
      rollNumber,
      case: {
        name: caseName,
        image: caseImage,
        price: casePrice,
        currency: caseCurrency,
      },
      drop: {
        name: clean(dropName),
        image: clean(dropImg),
        price: dropPrice,
        currency: dropCurrency,
        oddsPercent,
        range,
      },
    };
  }, rollId, provablyUrl);
}

async function findCaseAndOpenProvably(page, rollId, maxClicks = LOAD_MORE_MAX_CLICKS) {
  // tenta direto
  if (await hasCaseAnchor(page, rollId)) {
    await clickCaseAnchor(page, rollId);
    return true;
  }

  // clica Load more até maxClicks
  for (let i = 0; i < maxClicks; i++) {
    const before = await page.evaluate(() =>
      document.querySelectorAll('.grid_drops .skin').length
    );
    const clicked = await clickLoadMoreOnce(page);
    if (!clicked) break;

    await waitMs(page, 250);
    try {
      await page.waitForFunction((prev) => {
        const curr = document.querySelectorAll('.grid_drops .skin').length;
        return curr > prev;
      }, { timeout: 5000, polling: 'mutation' }, before);
    } catch { /* ignore */ }

    if (await hasCaseAnchor(page, rollId)) {
      await clickCaseAnchor(page, rollId);
      return true;
    }
  }
  return false;
}

/* =========================
 * API PRINCIPAL
 * =======================*/
/**
 * Para type='upgrade': retorna objeto com balances, chance e itens (mantém html do bloco).
 * Para type='case': vai até a página Provably Fair e retorna case/drop + rollNumber.
 */
export async function fetchRollBlockHTML({ userId, rollId, type = 'upgrade', timeoutMs = JOB_TIMEOUT_MS }) {
  const browser = await browserPool.getBrowser();
  let page;

  const job = async () => {
    page = await browser.newPage();
    page.on('console', (msg) => console.log('[page]', msg.text()));
    page.setDefaultTimeout(12_000);
    page.setDefaultNavigationTimeout(20_000);

    const url = `https://csgo.net/user/${encodeURIComponent(userId)}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });
    await hideMobileNav(page);

    if (type === 'upgrade') {
      await openUpgradesWithRetry(page);
      await page.waitForSelector('.skins-block', { timeout: 10_000 });
      const data = await findUpgradeWithLoadMore(page, rollId, LOAD_MORE_MAX_CLICKS);
      if (!data) throw new Error(`RollID ${rollId} não encontrado (upgrade)`);
      return data;
    }

    // type === 'case'
    await openCaseGridWithRetry(page);
    const opened = await findCaseAndOpenProvably(page, rollId, LOAD_MORE_MAX_CLICKS);
    if (!opened) throw new Error(`RollID ${rollId} não encontrado (case)`);

    const data = await parseProvablyCasePage(page, rollId);
    if (!data) throw new Error(`Falha ao parsear Provably Fair (case)`);
    return data;
  };

  try {
    const runner = withTimeout(job, timeoutMs);
    return await runner.run();
  } finally {
    try { await page?.close(); } catch {}
  }
}
