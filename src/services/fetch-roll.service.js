// src/services/fetch-roll.service.js
import * as browserPool from './browser-pool.service.js';

const OPEN_TAB_MAX_ATTEMPTS = 5;
const JOB_TIMEOUT_MS = 30_000;
const LOAD_MORE_MAX_CLICKS = 3;

let userData = {};

const RARITY_HINTS = [
  'covert','classified','restricted','mil-spec','milspec','rare','uncommon','common',
  'legendary','epic','mythical','ancient','immortal','arcana','contraband'
];

function pickRarityFromClasses(classListLike) {
  if (!classListLike) return '';
  const classes = Array.from(classListLike).map(c => String(c).toLowerCase());
  // tenta por hints conhecidas
  const found = RARITY_HINTS.find(h => classes.some(c => c.includes(h)));
  if (found) return found;
  // fallback: algumas UIs usam "rarity-*" ou "quality-*"
  const rx = /(?:rarity|quality)[-_]([a-z0-9]+)/i;
  for (const c of classes) {
    const m = c.match(rx);
    if (m && m[1]) return m[1].toLowerCase();
  }
  return classes[classes.length - 1] || '';
}

async function getCaseRarityFromProfile(page, rollId) {
  return page.evaluate(({ wanted, RARITY_HINTS }) => {
    const pickRarityFromClasses = (cl) => {
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

    // âncora com rollID
    const anchors = grid.querySelectorAll('a.skin__state.skin__state_provably[href*="rollID="]');
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/rollID=([^&]+)/);
      const found = m && m[1];
      if (found !== wanted) continue;

      // sobe pro card .skin (ou contêiner principal)
      const card = a.closest('.skin') || a.closest('.grid_drops-item') || a.parentElement;
      if (!card) return { rarity: '', rarityClassSource: '' };

      // tenta em diferentes níveis
      const candidates = [
        card,
        card.querySelector('.skin__name'),
        card.querySelector('.skin__title'),
        card.querySelector('.skin__img'),
        card.querySelector('[class*="rarity"], [class*="quality"]'),
      ].filter(Boolean);

      for (const el of candidates) {
        const r = pickRarityFromClasses(el.classList);
        if (r) return { rarity: r, rarityClassSource: el.className || '' };
      }

      return { rarity: '', rarityClassSource: card.className || '' };
    }
    return { rarity: '', rarityClassSource: '' };
  }, { wanted: rollId, RARITY_HINTS });
}

async function getUserData(page) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const data = await page.evaluate(() => {
      const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : s);
      return {
        userId:   clean(document.querySelector(".user__id")?.textContent.replace("ID: ", "") || ''),
        userName: clean(document.querySelector(".user__name")?.textContent || ''),
        userImage: clean(document.querySelector(".user__img > img")?.src || ''),
      };
    });
    if (data.userId && data.userName && data.userImage) {
      return data;
    }
    await waitMs(page, 1000);
  }
  return { userId: '', userName: '', userImage: '' };
}

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

async function parseUpgradeBlock(page, rollId, baseUser) {
  return page.evaluate((wanted, baseUser) => {
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
          rarity: clean((skin.classList && skin.classList[skin.classList.length - 1]) || ''),
        });
      });

      const receivedSkin = block.querySelector('.skins-block__item_right > .skins-block__item-data');
      const receivedSkinsFormatted = receivedSkin ? {
        name:   clean(receivedSkin.querySelector('.skins-block__name')?.textContent || ''),
        type:   clean(receivedSkin.querySelector('.skins-block__type')?.textContent || ''),
        image:  clean(receivedSkin.querySelector('.skins-block__item-img')?.src || ''),
        rarity: clean((receivedSkin.classList && receivedSkin.classList[receivedSkin.classList.length - 1]) || ''),
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
  }, rollId, baseUser);
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
    console.log(err);
    return null;
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

async function parseProvablyCasePage(page, rollId, baseUser) {
  await page.waitForSelector('.layout-provably-fair__title', { timeout: 10000 });
  const provablyUrl = page.url();

  return page.evaluate((wanted, provablyUrl, baseUser) => {
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

    // ====== DROP ATUAL (robusto) ======
    // 1) acha a row "atual" com vários fallbacks
    let row =
      document.querySelector('tr.current-roll-drop, tr.current-drop, tr.is-current, tr.table-big__row_current') ||
      document.querySelector('.table-big tbody tr');

    // 2) pega imagem e ALT (fallback pro nome)
    const imgEl = row?.querySelector('img.table-big__item-img, .table-big__item-img img');
    const dropImg = imgEl?.src || '';
    const imgAlt  = clean(imgEl?.alt || '');

    // 3) pega "type" e "name" com múltiplos seletores
    const dropType = row ? qText(row, `
      .table-big__first-type,
      .table-big__type,
      .table-big__first .type
    `) : '';

    let dropNameMain = row ? qText(row, `
      .table-big__first-name,
      .table-big__name,
      .table-big__first-title,
      .table-big__first .name
    `) : '';

    // 4) fallback total: se nada deu, usa o bloco inteiro ou o alt
    if (!dropType && !dropNameMain && row) {
      dropNameMain = qText(row, '.table-big__first, .table-big__title, .table-big__col_first') || imgAlt;
    }

    // 5) monta o nome final
    let resolvedName = dropNameMain;
    if (dropType && dropNameMain) resolvedName = `${dropType} | ${dropNameMain}`;
    if (!resolvedName) resolvedName = imgAlt; // último recurso

    // preço e moeda
    const dropPriceEl = row?.querySelector('.table-big__accent.price, .price.table-big__accent');
    const dropPrice = parseNum(dropPriceEl?.textContent || '');
    const dropCurrency = currencyFrom(dropPriceEl);

    // odds e range
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
        range,
      },
    };
  }, rollId, provablyUrl, baseUser);
}


async function findCaseAndOpenProvably(page, rollId, maxClicks = LOAD_MORE_MAX_CLICKS) {
  // tenta direto no grid atual
  const initialInfo = await getCaseRarityFromProfile(page, rollId);
  if (await hasCaseAnchor(page, rollId)) {
    // já temos rarity do perfil — agora clica
    await clickCaseAnchor(page, rollId);
    return { opened: true, rarityInfo: initialInfo };
  }

  // precisa carregar mais
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

    // tenta pegar rarity após carregar mais itens
    const rarityInfo = await getCaseRarityFromProfile(page, rollId);
    if (await hasCaseAnchor(page, rollId)) {
      await clickCaseAnchor(page, rollId);
      return { opened: true, rarityInfo };
    }
  }

  return { opened: false, rarityInfo: { rarity: '', rarityClassSource: '' } };
}

/* =========================
 * API PRINCIPAL
 * =======================*/
/**
 * Para type='upgrade': retorna objeto com balances, chance e itens (mantém html do bloco).
 * Para type='case': vai até a página Provably Fair e retorna case/drop + rollNumber.
 */
export async function fetchRollBlockHTML({
  userId,
  rollId,
  type = 'upgrade',
  timeoutMs = JOB_TIMEOUT_MS,
}) {
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

    // Captura dados do usuário ainda no perfil
    userData = await getUserData(page);

    if (type === 'upgrade') {
      await openUpgradesWithRetry(page);
      await page.waitForSelector('.skins-block', { timeout: 10_000 });

      const data = await findUpgradeWithLoadMore(page, rollId, LOAD_MORE_MAX_CLICKS, userData);
      if (!data) throw new Error(`RollID ${rollId} não encontrado (upgrade)`);
      return data;
    }

    // === type === 'case' ===
    await openCaseGridWithRetry(page);

    // Coleta rarity no grid do perfil ANTES de ir para o Provably
    const { opened, rarityInfo } = await findCaseAndOpenProvably(
      page,
      rollId,
      LOAD_MORE_MAX_CLICKS
    );
    if (!opened) throw new Error(`RollID ${rollId} não encontrado (case)`);

    // Agora estamos na página Provably; parse detalhado
    const data = await parseProvablyCasePage(page, rollId, userData);
    if (!data) throw new Error('Falha ao parsear Provably Fair (case)');

    // Injeta rarity coletada do perfil (mantém a do Provably se existir)
    return {
      ...data,
      drop: {
        ...data.drop,
        rarity: rarityInfo?.rarity || data.drop?.rarity || '',
      },
      _raritySource: rarityInfo?.rarity ? 'profile_grid' : (data.drop?.rarity ? 'provably' : ''),
      _rarityClassSource: rarityInfo?.rarityClassSource || '',
    };
  };

  try {
    const runner = withTimeout(job, timeoutMs);
    return await runner.run();
  } finally {
    try { await page?.close(); } catch {}
  }
}
