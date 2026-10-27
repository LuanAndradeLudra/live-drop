// src/services/fetch-roll.service.js
import * as browserPool from './browser-pool.service.js';

/** =========================
 *  CONFIG
 * ======================= */
const OPEN_TAB_MAX_ATTEMPTS = 5;
const JOB_TIMEOUT_MS = 30_000;
const LOAD_MORE_MAX_CLICKS = 3;

const RARITY_HINTS = [
  'covert', 'classified', 'restricted', 'mil-spec', 'milspec',
  'rare', 'uncommon', 'common', 'legendary', 'epic', 'mythical',
  'ancient', 'immortal', 'arcana', 'contraband'
];

/** =========================
 *  UTILS
 * ======================= */
function waitMs(page, ms) {
  if (page && typeof page.waitForTimeout === 'function') {
    return page.waitForTimeout(ms);
  }
  if (page && typeof page.waitFor === 'function') {
    return page.waitFor(ms);
  }
  return new Promise((res) => setTimeout(res, ms));
}

function logStep(rollId, step, extra) {
  const detail = extra === undefined
    ? ''
    : ' ' + (typeof extra === 'string' ? extra : JSON.stringify(extra));
  console.log(`[roll:${rollId}] ${step}${detail}`);
}

async function logPageSnapshot(page, rollId, reason) {
  try {
    const info = await page.evaluate(() => {
      const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500);
      const selectors = [
        '.provably-fair-roll__number-value',
        '.provably-fair-roll',
        '.layout-provably-fair',
        '.layout-provably-fair__title',
        '.provably-fair-roll__game',
        '.provably-fair-roll__result',
        '.provably-fair-progress__marker',
        '.layout-provably-fair__type',
        '.grid_drops',
        '.skins-block',
      ];
      const counts = Object.fromEntries(selectors.map((sel) => [sel, document.querySelectorAll(sel).length]));
      return { title: document.title || '', ready: document.readyState, counts, text };
    });
    console.log(`[roll:${rollId}] snapshot (${reason}) url=${page.url()} title=${JSON.stringify(info.title)} ready=${info.ready} counts=${JSON.stringify(info.counts)}`);
    console.log(`[roll:${rollId}] snapshot text: ${info.text}`);
  } catch (err) {
    console.log(`[roll:${rollId}] snapshot failed (${reason}) url=${page.url()} err=${err?.message || err}`);
  }
}

const PROVABLY_READY = [
  '.provably-fair-roll__number-value',
  '.layout-provably-fair__title',
  '.provably-fair-progress__marker',
].join(', ');

async function waitForProvablyReady(page, rollId) {
  logStep(rollId, 'wait-provably', { url: page.url(), selector: PROVABLY_READY });
  try {
    await page.waitForSelector(PROVABLY_READY, { timeout: 10000 });
    logStep(rollId, 'wait-provably.ok', { url: page.url() });
  } catch (err) {
    await logPageSnapshot(page, rollId, 'wait-provably timeout');
    throw err;
  }
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
    console.log('[waitMoreBlocks]', err);
  }
}

/** =========================
 *  USER DATA (ROBUST)
 * ======================= */
async function getUserDataRobust(page, {
  maxTries = 12,
  intervalMs = 300,
  waitSelectorTimeout = 800
} = {}) {
  const tryOnce = async () => page.evaluate(() => {
    const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : s);

    const idText =
      document.querySelector('.user__id')?.textContent ||
      document.querySelector('[data-user-id]')?.getAttribute('data-user-id') ||
      '';

    const userId = clean(idText.replace(/^ID:\s*/i, '') || '');

    const userName =
      clean(document.querySelector('.user__name')?.textContent || '') ||
      clean(document.querySelector('.user__nickname')?.textContent || '');

    const userImage =
      clean(document.querySelector('.user__img > img')?.src || '') ||
      clean(document.querySelector('img.avatar, img.user-avatar')?.src || '');

    return { userId, userName, userImage };
  });

  const waitAnyProfileMarker = async () => {
    const candidates = ['.user__id', '.user__name', '.user__img img', '.grid_drops'];
    for (const sel of candidates) {
      try { await page.waitForSelector(sel, { timeout: waitSelectorTimeout }); return; } catch {}
    }
  };

  let last = { userId: '', userName: '', userImage: '' };
  for (let i = 1; i <= maxTries; i++) {
    await waitAnyProfileMarker();
    last = await tryOnce();

    if (last.userId || (last.userName && last.userImage)) {
      return { ...last, _status: `ok@try${i}` };
    }

    try {
      await page.evaluate(() => {
        window.scrollBy({ top: 200, behavior: 'instant' });
        window.scrollBy({ top: -200, behavior: 'instant' });
      });
    } catch {}

    await waitMs(page, intervalMs);
  }

  return { ...last, _status: 'partial-or-empty' };
}

async function maybeRefetchUserData(page, prevUserData) {
  const isGood = (u) => !!(u && (u.userId || (u.userName && u.userImage)));
  if (isGood(prevUserData)) return prevUserData;

  const fresh = await getUserDataRobust(page, { maxTries: 6, intervalMs: 250 });
  return isGood(fresh) ? fresh : prevUserData;
}

/** =========================
 *  UPGRADE FLOW
 * ======================= */
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

async function parseUpgradeBlock(page, rollId, baseUser) {
  return page.evaluate((wanted, baseUser, RARITY_HINTS) => {
    const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : s);

    // helper local (vive dentro do evaluate)
    const pickRarity = (el) => {
      if (!el) return '';
      const classes = Array.from(el.classList || []).map(c => String(c).toLowerCase());

      // 1) tenta por hints conhecidas
      const found = RARITY_HINTS.find(h => classes.some(c => c.includes(h)));
      if (found) return found;

      // 2) tenta padrões "rarity-*" / "quality-*"
      const rx = /(?:rarity|quality)[-_]([a-z0-9]+)/i;
      for (const c of classes) {
        const m = c.match(rx);
        if (m && m[1]) return m[1].toLowerCase();
      }

      // 3) fallback: última classe
      return classes[classes.length - 1] || '';
    };

    const blocks = Array.from(document.querySelectorAll('.skins-block'));
    for (const block of blocks) {
      const a = block.querySelector('a.skins-block__item-pf[href*="rollID="]');
      if (!a) continue;

      const href = a.getAttribute('href') || '';
      const m = href.match(/rollID=([^&]+)/);
      const found = m && m[1];
      if (found !== wanted) continue;

      const headCols = block.querySelectorAll('.skins-block__head-column');

      const usedValue   = headCols[0];
      const firstValue  = clean(usedValue?.querySelectorAll('.price')[0]?.textContent || '');
      const secondValue = clean(usedValue?.querySelectorAll('.price')[1]?.textContent || '');

      const receivedValue   = headCols[1];
      const chance          = clean(receivedValue?.querySelectorAll('.action_lighten-border')[0]?.textContent || '');
      const receivedBalance = clean(receivedValue?.querySelectorAll('.action_lighten-border')[1]?.textContent || '');

      const usedSkins = block.querySelectorAll('.skins-block__item_left > .skins-block__item-data');
      const usedSkinsFormatted = [];
      usedSkins.forEach((skin) => {
        usedSkinsFormatted.push({
          name:   clean(skin.querySelector('.skins-block__name')?.textContent || ''),
          type:   clean(skin.querySelector('.skins-block__type')?.textContent || ''),
          image:  clean(skin.querySelector('.skins-block__item-img')?.src || ''),
          rarity: pickRarity(skin),
        });
      });

      const receivedSkin = block.querySelector('.skins-block__item_right > .skins-block__item-data');
      const receivedSkinsFormatted = receivedSkin ? {
        name:   clean(receivedSkin.querySelector('.skins-block__name')?.textContent || ''),
        type:   clean(receivedSkin.querySelector('.skins-block__type')?.textContent || ''),
        image:  clean(receivedSkin.querySelector('.skins-block__item-img')?.src || ''),
        rarity: pickRarity(receivedSkin),
      } : null;

      return {
        ...(baseUser || {}),
        type: 'upgrade',
        rollId: found,
        firstValue,
        secondValue,
        chance,
        receivedBalance,
        usedSkinsFormatted,
        receivedSkinsFormatted,
      };
    }
    return null;
  }, rollId, baseUser, RARITY_HINTS);
}

async function findUpgradeWithLoadMore(page, rollId, maxClicks = LOAD_MORE_MAX_CLICKS, baseUser = {}) {
  try {
    let data = await parseUpgradeBlock(page, rollId, baseUser);
    if (data) return data;

    for (let i = 0; i < maxClicks; i++) {
      const before = await page.evaluate(() => document.querySelectorAll('.skins-block').length);
      const clicked = await clickLoadMoreOnce(page);
      if (!clicked) break;

      await waitMoreBlocks(page, before, 5000);
      await waitMs(page, 250);

      data = await parseUpgradeBlock(page, rollId, baseUser);
      if (data) return data;
    }
    return null;
  } catch (err) {
    console.log('[findUpgradeWithLoadMore]', err);
    return null;
  }
}

// Navega para o Provably a partir do bloco de upgrade
async function openUpgradeProvably(page, rollId) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 12000 }),
    page.evaluate((wanted) => {
      const anchors = document.querySelectorAll('a.skins-block__item-pf[href*="rollID="]');
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

/** =========================
 *  CASE FLOW
 * ======================= */
async function openCaseGridWithRetry(page, maxAttempts = OPEN_TAB_MAX_ATTEMPTS) {
  const hasGrid = async () => {
    try {
      await page.waitForSelector('.grid_drops', { timeout: 800 });
      return true;
    } catch { return false; }
  };

  const tryClickToShowGrid = async () => {
    return page.evaluate(() => {
      const click = (el) => { if (el) { el.click(); return true; } return false; };

      const selectors = [
        'button[selectblock="drops"]',
        '[selectblock="drops"].js-user-items-tab',
        'a[href*="#drops"]',
        'a[data-target="drops"]',
        'button[data-target="drops"]',
        '.user__tab[data-tab="drops"]',
        '.tabs__tab[href*="drops"]',
        '.tabs__tab[data-tab="drops"]',
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          el.scrollIntoView({ block: 'center' });
          if (click(el)) return 'clicked-selector';
        }
      }

      const textHints = [
        /(?:drops|recent drops|case drops|my drops)/i,
        /(?:meus ganhos|histórico|quedas|resultados)/i,
      ];

      const candidates = Array.from(document.querySelectorAll('a, button, .tabs__tab, .action'));
      for (const el of candidates) {
        const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!txt) continue;
        if (textHints.some((rx) => rx.test(txt))) {
          el.scrollIntoView({ block: 'center' });
          if (click(el)) return 'clicked-text';
        }
      }

      const activeTab = document.querySelector('.tabs__tab.active, .js-user-items-tab.active');
      if (activeTab) {
        activeTab.scrollIntoView({ block: 'center' });
        if (click(activeTab)) return 'clicked-active';
      }

      return 'no-click';
    });
  };

  const nudgeScroll = async () => {
    try {
      await page.evaluate(async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        window.scrollBy({ top: 200, behavior: 'instant' });
        await sleep(50);
        window.scrollBy({ top: -200, behavior: 'instant' });
      });
    } catch {}
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await hasGrid()) {
      console.log(`[roll] grid de cases visível (tentativa ${attempt})`);
      return;
    }

    const clickState = await tryClickToShowGrid();
    console.log(`[roll] grid ausente, tentativa ${attempt}/${maxAttempts}, click=${clickState}`);

    await waitMs(page, 250);
    if (await hasGrid()) return;

    await nudgeScroll();
    await waitMs(page, 250);
    if (await hasGrid()) return;
  }

  throw new Error('Grid de cases (.grid_drops) não encontrada após múltiplas tentativas');
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

async function getCaseRarityFromProfile(page, rollId) {
  return page.evaluate(({ wanted, RARITY_HINTS }) => {
    const pickFrom = (cl) => {
      const classes = Array.from(cl || []).map(c => String(c).toLowerCase());
      const found = RARITY_HINTS.find(h => classes.some(c => c.includes(h)));
      if (found) return found;
      const rx = /(?:rarity|quality)[-_]([a-z0-9]+)/i;
      for (const c of classes) {
        const m = c.match(rx);
        if (m && m[1]) return m[1].toLowerCase();
      }
      return classes[classes.length - 1] || '';
    };

    const grid = document.querySelector('.grid_drops');
    if (!grid) return { rarity: '', rarityClassSource: '' };

    const anchors = grid.querySelectorAll('a.skin__state.skin__state_provably[href*="rollID="]');
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/rollID=([^&]+)/);
      const found = m && m[1];
      if (found !== wanted) continue;

      const card = a.closest('.skin') || a.closest('.grid_drops-item') || a.parentElement;
      if (!card) return { rarity: '', rarityClassSource: '' };

      const candidates = [
        card,
        card.querySelector('.skin__name'),
        card.querySelector('.skin__title'),
        card.querySelector('.skin__img'),
        card.querySelector('[class*="rarity"], [class*="quality"]'),
      ].filter(Boolean);

      for (const el of candidates) {
        const r = pickFrom(el.classList);
        if (r) return { rarity: r, rarityClassSource: el.className || '' };
      }

      return { rarity: '', rarityClassSource: card.className || '' };
    }
    return { rarity: '', rarityClassSource: '' };
  }, { wanted: rollId, RARITY_HINTS });
}

async function findCaseAndOpenProvably(page, rollId, maxClicks = LOAD_MORE_MAX_CLICKS) {
  const initialInfo = await getCaseRarityFromProfile(page, rollId);
  const foundNow = await hasCaseAnchor(page, rollId);
  logStep(rollId, 'case-anchor', { found: foundNow, rarity: initialInfo?.rarity || '' });
  if (foundNow) {
    logStep(rollId, 'case-anchor.click', { url: page.url() });
    await clickCaseAnchor(page, rollId);
    logStep(rollId, 'case-anchor.opened', { url: page.url() });
    return { opened: true, rarityInfo: initialInfo };
  }

  for (let i = 0; i < maxClicks; i++) {
    const before = await page.evaluate(() =>
      document.querySelectorAll('.grid_drops .skin').length
    );
    logStep(rollId, 'case-load-more', { click: i + 1, skins: before });
    const clicked = await clickLoadMoreOnce(page);
    if (!clicked) {
      logStep(rollId, 'case-load-more.stop', 'botão não encontrado');
      break;
    }

    await waitMs(page, 250);
    try {
      await page.waitForFunction((prev) => {
        const curr = document.querySelectorAll('.grid_drops .skin').length;
        return curr > prev;
      }, { timeout: 5000, polling: 'mutation' }, before);
    } catch {}

    const rarityInfo = await getCaseRarityFromProfile(page, rollId);
    if (await hasCaseAnchor(page, rollId)) {
      logStep(rollId, 'case-anchor.click-after-load-more', { url: page.url() });
      await clickCaseAnchor(page, rollId);
      logStep(rollId, 'case-anchor.opened', { url: page.url() });
      return { opened: true, rarityInfo };
    }
  }

  logStep(rollId, 'case-anchor.missing');
  return { opened: false, rarityInfo: { rarity: '', rarityClassSource: '' } };
}

/** =========================
 *  PROVABLY (COMUM)
 * ======================= */
async function getRollNumberFromProvably(page, rollId = '') {
  await waitForProvablyReady(page, rollId);
  const provablyUrl = page.url();

  const rollNumber = await page.evaluate(() => {
    const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : s);
    const parseNum = (s) => {
      if (!s) return null;
      const t = String(s).replace(/[^\d.,-]/g, '').replace(',', '.').trim();
      const n = parseFloat(t);
      return Number.isFinite(n) ? n : null;
    };

    const direct = clean(document.querySelector('.provably-fair-roll__number-value')?.textContent || '');
    if (direct) return parseNum(direct);

    const upgradeMarker = clean(document.querySelector('.provably-fair-progress__marker')?.textContent || '');
    const upgradeMatch = upgradeMarker.match(/roll\s+([\d.,]+)/i);
    if (upgradeMatch) return parseNum(upgradeMatch[1]);

    const marker = clean(document.querySelector('.provably-fair-line__marker-label')?.textContent || '');
    const markerMatch = marker.match(/([\d][\d.,]*)/);
    if (markerMatch) return parseNum(markerMatch[1]);

    const rows = document.querySelectorAll('.table-big_kv tr');
    for (const tr of rows) {
      const label = clean(tr.querySelector('td, th')?.textContent || '');
      if (!/^roll$/i.test(label)) continue;
      const value = clean(tr.querySelector('td:last-child')?.textContent || '');
      const n = parseNum(value);
      if (n !== null) return n;
    }

    const title = clean(document.querySelector('.layout-provably-fair__title')?.textContent || '');
    const patterns = [
      /roll\s*[:\-–]\s*([\d.,]+)/i,
      /resultado\s*[:\-–]\s*([\d.,]+)/i,
      /jogada\s*[:\-–]\s*([\d.,]+)/i,
    ];
    for (const rx of patterns) {
      const m = title.match(rx);
      if (m) return parseNum(m[1]);
    }

    const anyNum = title.match(/([\d][\d.,]+)/);
    return anyNum ? parseNum(anyNum[1]) : null;
  });

  return { rollNumber, provablyUrl };
}

/** =========================
 *  PARSE PROVABLY (CASE)
 * ======================= */
async function parseProvablyCasePage(page, rollId, baseUser) {
  await waitForProvablyReady(page, rollId);
  const provablyUrl = page.url();

  return page.evaluate((wanted, provablyUrl, baseUser, RARITY_HINTS) => {
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
    const qText = (root, selectors) => {
      for (const sel of selectors.split(',')) {
        const el = root.querySelector(sel.trim());
        if (el && clean(el.textContent)) return clean(el.textContent);
      }
      return '';
    };
    const pickRarity = (el) => {
      if (!el) return '';
      const classes = Array.from(el.classList || []).map((c) => String(c).toLowerCase());
      const found = RARITY_HINTS.find((h) => classes.some((c) => c === h || c.includes(h)));
      return found || '';
    };
    const joinItemName = (weapon, skin) => {
      const left = clean(weapon || '');
      const right = clean(skin || '');
      if (left && right) return `${left} | ${right}`;
      return left || right;
    };

    const rollNumber = (() => {
      const direct = clean(document.querySelector('.provably-fair-roll__number-value')?.textContent || '');
      if (direct) return parseNum(direct);

      const marker = clean(document.querySelector('.provably-fair-line__marker-label')?.textContent || '');
      const markerMatch = marker.match(/([\d][\d.,]*)/);
      if (markerMatch) return parseNum(markerMatch[1]);

      const title = clean(document.querySelector('.layout-provably-fair__title')?.textContent || '');
      const m = title.match(/Roll\s*[:\-–]\s*([\d.,]+)/i);
      return m ? parseNum(m[1]) : null;
    })();

    const game = document.querySelector('.provably-fair-roll__game');
    const caseImgEl = game
      ? game.querySelector('img.provably-fair-roll__game-img')
      : document.querySelector('img.layout-provably-fair__type-img');
    const caseNameEl = game
      ? game.querySelector('.provably-fair-roll__title')
      : document.querySelector('.layout-provably-fair__type-title');
    const casePriceEl = game
      ? game.querySelector('.price')
      : document.querySelector('.layout-provably-fair__type-value.price');

    const caseImage = clean(caseImgEl?.src || '');
    const caseName = clean(caseNameEl?.textContent || '');
    const casePrice = parseNum(casePriceEl?.textContent || '');
    const caseCurrency = currencyFrom(casePriceEl);

    const result = document.querySelector('.provably-fair-roll__result');
    let resolvedName = '';
    let dropImg = '';
    let dropPrice = null;
    let dropCurrency = null;
    let oddsPercent = null;
    let range = null;
    let rarity = '';
    let rarityClassSource = '';

    if (result) {
      const weapon = clean(result.querySelector('.provably-fair-roll__title')?.textContent || '');
      const skin = clean(result.querySelector('.provably-fair-roll__subtitle')?.textContent || '');
      resolvedName = joinItemName(weapon, skin);
      dropImg = result.querySelector('img.provably-fair-roll__result-img')?.src || '';

      const dropPriceEl = result.querySelector('.price');
      dropPrice = parseNum(dropPriceEl?.textContent || '');
      dropCurrency = currencyFrom(dropPriceEl);

      const oddsText = clean(result.querySelector('.provably-fair-roll__odds')?.textContent || '');
      const oddsMatch = oddsText.match(/([\d.,]+)\s*%/);
      oddsPercent = oddsMatch ? parseNum(oddsMatch[1]) : null;

      const rarityEl =
        result.querySelector('.provably-fair-roll__result-img-wrap') ||
        result.querySelector('.provably-fair-roll__column') ||
        result;
      rarity = pickRarity(rarityEl);
      rarityClassSource = rarity ? (rarityEl.className || '') : '';

      const rows = Array.from(document.querySelectorAll('tr.table-big__item-row'));
      const wonRow =
        document.querySelector('tr.table-big__item-row_won') ||
        rows.find((tr) => {
          const first = clean(tr.querySelector('.table-big__first-name')?.textContent || '');
          const second = clean(tr.querySelector('.table-big__second-name')?.textContent || '');
          return first === weapon && (!skin || second === skin);
        });

      if (wonRow) {
        range = clean(wonRow.querySelector('.table-big__range-value')?.textContent || '');
        if (!range) {
          const cells = Array.from(wonRow.querySelectorAll('td'));
          range = clean(cells[2]?.textContent || '');
        }
        if (oddsPercent === null) {
          const oddsEl = wonRow.querySelector('.provably-fair-odds__value');
          const m = clean(oddsEl?.textContent || '').match(/([\d.,]+)\s*%/);
          oddsPercent = m ? parseNum(m[1]) : null;
        }
        if (!rarity) {
          rarity = pickRarity(wonRow);
          rarityClassSource = rarity ? (wonRow.className || '') : '';
        }
        if (!resolvedName) {
          resolvedName = joinItemName(
            wonRow.querySelector('.table-big__first-name')?.textContent,
            wonRow.querySelector('.table-big__second-name')?.textContent
          );
        }
        if (!dropImg) {
          dropImg = wonRow.querySelector('img.table-big__item-img')?.src || '';
        }
      }
    } else {
      const row =
        document.querySelector('tr.table-big__item-row_won, tr.current-roll-drop, tr.current-drop, tr.is-current, tr.table-big__row_current') ||
        document.querySelector('.table-big tbody tr, tr.table-big__item-row');

      const imgEl = row?.querySelector('img.table-big__item-img, .table-big__item-img img');
      dropImg = imgEl?.src || '';
      const imgAlt = clean(imgEl?.alt || '');

      const dropType = row ? qText(row, `
        .table-big__first-type,
        .table-big__type,
        .table-big__first .type
      `) : '';

      const weapon = row ? qText(row, `
        .table-big__first-name,
        .table-big__name,
        .table-big__first-title,
        .table-big__first .name
      `) : '';
      const skin = row ? qText(row, '.table-big__second-name, .table-big__subtitle') : '';

      resolvedName = dropType && weapon
        ? `${dropType} | ${weapon}`
        : joinItemName(weapon, skin);
      if (!resolvedName && row) {
        resolvedName = qText(row, '.table-big__first, .table-big__title, .table-big__col_first') || imgAlt;
      }
      if (!resolvedName) resolvedName = imgAlt;

      const dropPriceEl = row?.querySelector('.table-big__accent.price, .price.table-big__accent, .table-big__cell_price .price');
      dropPrice = parseNum(dropPriceEl?.textContent || '');
      dropCurrency = currencyFrom(dropPriceEl);

      if (row) {
        const oddsEl = row.querySelector('.provably-fair-odds__value');
        const oddsText = clean(oddsEl?.textContent || '');
        const oddsMatch = oddsText.match(/([\d.,]+)\s*%/);
        if (oddsMatch) oddsPercent = parseNum(oddsMatch[1]);

        range = clean(row.querySelector('.table-big__range-value')?.textContent || '');
        if (oddsPercent === null || !range) {
          const tds = Array.from(row.querySelectorAll('td'));
          if (oddsPercent === null && tds[3]) {
            const m = (tds[3].textContent || '').match(/([\d.,]+)\s*%/);
            oddsPercent = m ? parseNum(m[1]) : null;
          }
          if (!range && tds[2]) range = clean(tds[2].textContent || '');
        }

        rarity = pickRarity(row);
        rarityClassSource = rarity ? (row.className || '') : '';
      }
    }

    return {
      ...(baseUser || {}),
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
        name: resolvedName,
        image: clean(dropImg),
        price: dropPrice,
        currency: dropCurrency,
        oddsPercent,
        range: range || null,
        rarity,
      },
      _rarityClassSource: rarityClassSource,
    };
  }, rollId, provablyUrl, baseUser, RARITY_HINTS);
}

async function gotoWithRetry(page, url, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      return;
    } catch (e) {
      lastErr = e;
      await waitMs(page, 500 + i * 500);
    }
  }
  throw lastErr;
}

/** =========================
 *  API PRINCIPAL
 * ======================= */
/**
 * Para type='upgrade': pega dados no perfil e, em seguida, entra no Provably para capturar rollNumber/URL.
 * Para type='case': passa no grid do perfil (pega rarity), navega ao Provably e parseia case/drop + rollNumber.
 */
export async function fetchRollBlockHTML({
  userId,
  rollId,
  type = 'upgrade',
  timeoutMs = JOB_TIMEOUT_MS,
}) {
  logStep(rollId, 'start', { userId, type, timeoutMs });
  return browserPool.withPage(async (page) => {
    page.on('console', (msg) => console.log('[page]', msg.text()));
    page.setDefaultTimeout(12_000);
    page.setDefaultNavigationTimeout(20_000);

    const url = `https://csgo.net/user/${encodeURIComponent(userId)}`;
    logStep(rollId, 'profile.goto', url);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });
    logStep(rollId, 'profile.loaded', { url: page.url() });
    await hideMobileNav(page);

    // Captura robusta no perfil (variável local — evita race condition entre jobs paralelos)
    let userData = await getUserDataRobust(page);
    logStep(rollId, 'profile.user', {
      status: userData?._status || '',
      userId: userData?.userId || '',
      userName: userData?.userName || '',
    });

    if (type === 'upgrade') {
      logStep(rollId, 'upgrade.open-tab');
      await openUpgradesWithRetry(page);
      await page.waitForSelector('.skins-block', { timeout: 10_000 });
      logStep(rollId, 'upgrade.tab-ready');

      userData = await maybeRefetchUserData(page, userData);

      const data = await findUpgradeWithLoadMore(page, rollId, LOAD_MORE_MAX_CLICKS, userData);
      if (!data) {
        await logPageSnapshot(page, rollId, 'upgrade não encontrado');
        throw new Error(`RollID ${rollId} não encontrado (upgrade)`);
      }
      logStep(rollId, 'upgrade.found', {
        chance: data.chance,
        receivedBalance: data.receivedBalance,
      });

      logStep(rollId, 'upgrade.open-provably');
      await openUpgradeProvably(page, rollId);
      logStep(rollId, 'upgrade.provably-navigated', { url: page.url() });
      const { rollNumber, provablyUrl } = await getRollNumberFromProvably(page, rollId);
      logStep(rollId, 'upgrade.done', { rollNumber, provablyUrl });

      return {
        ...data,
        rollNumber: rollNumber ?? null,
        provablyUrl: provablyUrl || null,
        _provablyFetched: true,
      };
    }

    // === type === 'case' ===
    logStep(rollId, 'case.open-grid');
    await openCaseGridWithRetry(page);
    logStep(rollId, 'case.grid-ready', { url: page.url() });

    userData = await maybeRefetchUserData(page, userData);

    const { opened, rarityInfo } = await findCaseAndOpenProvably(page, rollId, LOAD_MORE_MAX_CLICKS);
    if (!opened) {
      await logPageSnapshot(page, rollId, 'case não encontrado');
      throw new Error(`RollID ${rollId} não encontrado (case)`);
    }
    logStep(rollId, 'case.opened', { url: page.url(), rarity: rarityInfo?.rarity || '' });

    const data = await parseProvablyCasePage(page, rollId, userData);
    if (!data) throw new Error('Falha ao parsear Provably Fair (case)');

    const pageRarity = data.drop?.rarity || '';
    logStep(rollId, 'case.parsed', {
      rollNumber: data.rollNumber,
      caseName: data.case?.name,
      casePrice: data.case?.price,
      dropName: data.drop?.name,
      dropPrice: data.drop?.price,
      oddsPercent: data.drop?.oddsPercent,
      range: data.drop?.range,
      rarity: pageRarity || rarityInfo?.rarity || '',
    });
    return {
      ...data,
      drop: {
        ...data.drop,
        rarity: pageRarity || rarityInfo?.rarity || '',
      },
      _raritySource: pageRarity ? 'provably' : (rarityInfo?.rarity ? 'profile_grid' : ''),
      _rarityClassSource: data._rarityClassSource || rarityInfo?.rarityClassSource || '',
      _userDataStatus: userData?._status || 'unknown',
    };
  }, { name: `roll-${rollId}`, createTimeoutMs: timeoutMs });
}
