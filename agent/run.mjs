// FlowDesk agent. Runs once per day in GitHub Actions (Node 20+, no dependencies).
//   1. Pulls ETF flows, FOMC odds, market overview, featured news and corporate BTC
//      purchases from the SoSoValue API.
//   2. Turns them into explained signals (src/signals.js).
//   3. Optionally asks a model (GitHub Models, free with the workflow token) to write a
//      short brief, and REJECTS it if it contains any number the data doesn't contain.
//   4. Writes docs/data/latest.json, a dated copy, an index and an RSS feed.
// Without SOSOVALUE_API_KEY it runs on fixtures/sample.json and labels everything SAMPLE.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { buildBrief, fmtUsd } from '../src/signals.js';
import { sampleData } from '../fixtures/sample.mjs';
import { groundedNumbers } from '../src/guard.js';

const ROOT = new URL('..', import.meta.url);
const path = (p) => new URL(p, ROOT);
const BASE = 'https://openapi.sosovalue.com/openapi/v1';
const KEY = process.env.SOSOVALUE_API_KEY || '';
const SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP'];
const WATCH_TICKERS = ['MSTR', 'MARA', 'TSLA', 'COIN', 'RIOT', 'CLSK', 'HUT', 'SMLR'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 20 requests per minute per key: space calls 3.2 s apart and retry once on 429.
let lastCall = 0;
async function api(pathAndQuery) {
  const wait = lastCall + 3200 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(BASE + pathAndQuery, { headers: { 'x-soso-api-key': KEY, accept: 'application/json' } });
    if (res.status === 429 && attempt === 0) { const j = await res.json().catch(() => ({})); await sleep(((j?.details?.retry_after) || 30) * 1000); continue; }
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.code !== 0) throw new Error(`${pathAndQuery}: HTTP ${res.status} code ${body?.code} ${body?.message || ''}`);
    return body.data;
  }
  throw new Error(`${pathAndQuery}: rate limited twice`);
}

async function readJson(p, fallback = null) {
  try { return JSON.parse(await readFile(path(p), 'utf8')); } catch { return fallback; }
}

async function collectLive(asOf) {
  const errors = [];
  const safe = async (label, fn, fallback) => { try { return await fn(); } catch (e) { errors.push(`${label}: ${e.message}`); return fallback; } };
  const etfBySymbol = {};
  for (const s of SYMBOLS) etfBySymbol[s] = await safe(`ETF ${s}`, () => api(`/etfs/summary-history?symbol=${s}&country_code=US&limit=40`), []);
  const fomc = await safe('FOMC', () => api('/macro/fomc-probabilities'), null);
  const market = await safe('market', () => api('/market/overview'), null);
  const news = await safe('news', async () => (await api('/news/pick?page=1&page_size=50'))?.list || [], []);
  const listed = await safe('treasuries', () => api('/btc-treasuries'), []);
  const tickers = WATCH_TICKERS.filter((t) => (listed || []).some((x) => x.ticker === t)).slice(0, 5);
  const start = new Date(new Date(asOf).getTime() - 30 * 864e5).toISOString().slice(0, 10);
  const purchases = [];
  for (const t of tickers) purchases.push(...(await safe(`purchases ${t}`, () => api(`/btc-treasuries/${t}/purchase-history?start_date=${start}&limit=20`), [])));
  return { etfBySymbol, fomc, market, news, purchases, errors };
}

async function aiBrief(brief) {
  const token = process.env.GITHUB_TOKEN;
  if (!token || process.env.FLOWDESK_AI === 'off') return { text: null, note: 'AI brief disabled' };
  const facts = {
    headline: brief.headline,
    views: brief.views.map((v) => ({ symbol: v.symbol, stance: v.stance, score: v.score })),
    etf: brief.etf.map((e) => ({ symbol: e.symbol, label: e.label, lastFlow: fmtUsd(e.facts.lastFlow ?? 0), lastDate: e.facts.lastDate, fiveDay: fmtUsd(e.facts.sum5 ?? 0), streak: e.facts.streak })),
    fomc: { label: brief.fomc.label, reasons: brief.fomc.reasons },
    treasury: brief.treasury.reasons,
  };
  try {
    const res = await fetch('https://models.github.ai/inference/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        model: process.env.FLOWDESK_MODEL || 'openai/gpt-4.1-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'You write a 3-sentence daily crypto flows brief for retail readers. Use ONLY the facts provided. Copy numbers exactly as given; never compute or invent numbers, prices or predictions. No advice, no hype.' },
          { role: 'user', content: JSON.stringify(facts) },
        ],
      }),
    });
    if (!res.ok) return { text: null, note: `model HTTP ${res.status}` };
    const text = (await res.json())?.choices?.[0]?.message?.content?.trim();
    if (!text) return { text: null, note: 'empty model reply' };
    const g = groundedNumbers(text, facts);
    return g.ok ? { text, note: 'checked: every number appears in the data' } : { text: null, note: `rejected: unsupported numbers ${g.extra.join(', ')}` };
  } catch (e) { return { text: null, note: `model error: ${e.message}` }; }
}

function rss(entries) {
  const esc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  const site = process.env.FLOWDESK_SITE || 'https://wwaterfall2027.github.io/flowdesk/';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>FlowDesk daily brief</title><link>${site}</link><description>Daily crypto ETF flows, Fed odds and corporate BTC buying, explained. Built on SoSoValue data.</description>\n${entries.map((e) => `<item><title>${esc(e.date + ': ' + e.headline)}</title><link>${site}#${e.date}</link><guid isPermaLink="false">flowdesk-${e.date}</guid><pubDate>${new Date(e.date + 'T12:00:00Z').toUTCString()}</pubDate><description>${esc(e.summary)}</description></item>`).join('\n')}\n</channel></rss>\n`;
}

async function main() {
  const asOf = process.env.FLOWDESK_AS_OF || (KEY ? new Date().toISOString().slice(0, 10) : '2026-11-13');
  const prev = await readJson('docs/data/latest.json');
  let raw, sourceMode;
  if (KEY) { raw = await collectLive(asOf); sourceMode = 'live'; }
  else { raw = { ...sampleData(), errors: [] }; sourceMode = 'sample'; }

  const fomcPrev = sourceMode === 'sample' ? raw.fomcPrev : (prev?.sourceMode === 'live' ? prev?.raw?.fomc : null);
  const brief = buildBrief({ asOf, sourceMode, etfBySymbol: raw.etfBySymbol, fomc: raw.fomc, fomcPrev, purchases: raw.purchases, news: raw.news, market: raw.market });
  brief.ai = await aiBrief(brief);
  brief.sourceErrors = raw.errors;
  brief.generatedAt = new Date().toISOString();
  brief.raw = { fomc: raw.fomc }; // kept so tomorrow's run can measure the change

  await mkdir(path('docs/data/history/'), { recursive: true });
  await writeFile(path('docs/data/latest.json'), JSON.stringify(brief, null, 2));
  await writeFile(path(`docs/data/history/${asOf}.json`), JSON.stringify(brief, null, 2));
  const index = await readJson('docs/data/index.json', []);
  const entry = { date: asOf, headline: brief.headline, sourceMode, summary: brief.ai.text || brief.views.map((v) => `${v.symbol}: ${v.stance} (${v.score})`).join('; ') };
  const next = [entry, ...index.filter((e) => e.date !== asOf)].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 90);
  await writeFile(path('docs/data/index.json'), JSON.stringify(next, null, 2));
  await writeFile(path('docs/feed.xml'), rss(next.slice(0, 30)));
  console.log(`FlowDesk ${asOf} [${sourceMode}] ${brief.headline}`);
  for (const v of brief.views) console.log(`  ${v.symbol}: ${v.stance} (${v.score}, ${v.confidence})`);
  console.log(`  AI brief: ${brief.ai.note}`);
  if (raw.errors.length) console.log(`  source errors:\n   - ${raw.errors.join('\n   - ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
