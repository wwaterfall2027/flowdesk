// Signal-engine tests. Run in the browser (tests/index.html) or with Node: node tests/run-node.mjs
import { etfFlowSignal, expectedRate, fomcSignal, treasurySignal, newsAttention, deskView, buildBrief, riskChecks } from '../src/signals.js';
import { groundedNumbers } from '../src/guard.js';
import { sampleData } from '../fixtures/sample.mjs';

const results = [];
function test(name, fn) { try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, err: e.message }); } }
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || 'expected'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const near = (a, b, tol, m) => { if (Math.abs(a - b) > tol) throw new Error(`${m || 'expected'}: ${a} not within ${tol} of ${b}`); };

// 20 normal days around +100M (alternating 80/120), then one final day.
const days = (final, n = 20) => {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, total_net_inflow: i % 2 ? 120e6 : 80e6, total_net_assets: 100e9 });
  rows.push({ date: '2026-10-21', total_net_inflow: final, total_net_assets: 100e9 });
  return rows;
};

export function run() {
  test('ETF: a normal day scores 0 (no streak bonus for neutral z)', () => {
    const s = etfFlowSignal('BTC', days(100e6, 20).slice(-21).map((r, i) => ({ ...r, total_net_inflow: i % 2 ? -50e6 : 50e6 })));
    eq(s.score, 0);
  });

  test('ETF: a 2+ sigma inflow after an inflow streak scores +2', () => {
    const s = etfFlowSignal('BTC', days(900e6));
    eq(s.score, 2, 'score');
    if (!(s.facts.z > 2)) throw new Error('z should exceed 2');
    eq(s.label, 'Strong inflows');
  });

  test('ETF: a 2+ sigma outflow scores negative', () => {
    const s = etfFlowSignal('ETH', days(-700e6));
    if (!(s.score < 0)) throw new Error(`score ${s.score}`);
    if (!(s.facts.z < -2)) throw new Error('z should be below -2');
  });

  test('ETF: z-score matches a hand calculation', () => {
    // prior 20 days: mean 100M, sample std = sqrt(20*400e12/19)
    const sd = Math.sqrt((20 * (20e6) ** 2) / 19);
    const s = etfFlowSignal('BTC', days(300e6));
    near(s.facts.z, (300e6 - 100e6) / sd, 0.01, 'z');
  });

  test('ETF: input order does not matter', () => {
    const a = etfFlowSignal('BTC', days(900e6));
    const b = etfFlowSignal('BTC', [...days(900e6)].reverse());
    eq(JSON.stringify(a), JSON.stringify(b));
  });

  test('ETF: fewer than 5 days is low confidence and neutral', () => {
    const s = etfFlowSignal('SOL', days(1e6).slice(0, 3));
    eq(s.score, 0); eq(s.confidence, 'low');
  });

  test('ETF: string numbers from the API are parsed', () => {
    const s = etfFlowSignal('BTC', days(900e6).map((r) => ({ ...r, total_net_inflow: String(r.total_net_inflow) })));
    eq(s.score, 2);
  });

  const fomc = (p) => ({ rate_ranges: ['350-375', '375-400'], meetings: [{ meeting_date: '2026-12-09', probabilities: p }] });
  test('FOMC: expected rate is the probability-weighted midpoint', () => {
    near(expectedRate(fomc(['40.0', '60.0'])).bps, 0.4 * 362.5 + 0.6 * 387.5, 1e-9);
  });

  test('FOMC: more cut odds since last run scores +1', () => {
    const s = fomcSignal(fomc(['60.0', '40.0']), fomc(['30.0', '70.0']));
    eq(s.score, 1); near(s.facts.deltaBps, -7.5, 1e-9);
  });

  test('FOMC: small moves and first readings score 0', () => {
    eq(fomcSignal(fomc(['41.0', '59.0']), fomc(['40.0', '60.0'])).score, 0);
    eq(fomcSignal(fomc(['41.0', '59.0']), null).score, 0);
  });

  test('FOMC: null probabilities are ignored', () => {
    near(expectedRate(fomc(['50.0', null])).bps, 362.5, 1e-9);
  });

  test('Treasury: counts only the last 7 days and dedupes buyers', () => {
    const s = treasurySignal([
      { date: '2026-11-10', ticker: 'MSTR', btc_acq: 4000, acq_cost: 400e6 },
      { date: '2026-11-11', ticker: 'MSTR', btc_acq: 1500, acq_cost: 150e6 },
      { date: '2026-10-01', ticker: 'MARA', btc_acq: 9000, acq_cost: 900e6 },
    ], '2026-11-13');
    eq(s.facts.btc, 5500); eq(s.score, 1); eq(s.facts.buyers.join(), 'MSTR');
  });

  test('News: counts tags, currencies and title mentions per asset', () => {
    const a = newsAttention([
      { title: 'BTC ETF inflows jump', tags: ['ETF'] },
      { title: 'Solana upgrade', matched_currencies: [{ symbol: 'SOL' }] },
      { title: 'Macro week', tags: ['btc'] },
    ], ['BTC', 'SOL', 'ETH']);
    eq(a.counts.BTC, 2); eq(a.counts.SOL, 1); eq(a.counts.ETH, 0);
  });

  test('Desk view: weights are applied and capped', () => {
    const v = deskView('BTC', [{ kind: 'etf', score: 2, confidence: 'high', label: '' }, { kind: 'fomc', score: 1, confidence: 'medium', label: '' }, { kind: 'treasury', score: 1, confidence: 'medium', label: '' }]);
    eq(v.score, 2); eq(v.stance, 'Constructive'); eq(v.confidence, 'high');
  });

  test('Risk checks flag sample data and stale ETF data', () => {
    const r = riskChecks({ asOf: '2026-11-13', etf: [{ symbol: 'BTC', facts: { lastDate: '2026-11-03' } }], fomc: { confidence: 'medium' }, sourceMode: 'sample' });
    if (!r[0].startsWith('SAMPLE DATA')) throw new Error('sample flag missing');
    if (!r.some((x) => x.includes('10 days old'))) throw new Error('stale flag missing');
  });

  test('Full brief builds and every view has drivers', () => {
    const b = buildBrief({ asOf: '2026-10-22', sourceMode: 'sample', etfBySymbol: { BTC: days(900e6), ETH: days(-700e6) }, fomc: fomc(['60.0', '40.0']), fomcPrev: fomc(['30.0', '70.0']), purchases: [], news: [], market: { total_market_cap: '1', total_market_cap_change_pct: '0.5', total_volume_24h: '2' } });
    eq(b.views.length, 2);
    if (!b.headline.includes('ETFs')) throw new Error('headline');
    if (!b.views.every((v) => v.drivers.length >= 2)) throw new Error('drivers');
  });

  test('AI guard: accepts text that only restates given numbers', () => {
    const facts = { etf: [{ symbol: 'BTC', lastFlow: '$912.0M', lastDate: '2026-11-12' }], fomc: { reasons: ['3.66%'] } };
    eq(groundedNumbers('BTC ETFs took in $912.0M on 2026-11-12. Rates near 3.66%.', facts).ok, true);
  });

  test('AI guard: rejects an invented number', () => {
    const g = groundedNumbers('BTC could reach $150,000 soon.', { etf: [{ lastFlow: '$912.0M' }] });
    eq(g.ok, false); if (!g.extra.includes('150000')) throw new Error(JSON.stringify(g.extra));
  });

  test('Sample data: builds a full brief with every symbol and a measured FOMC change', () => {
    const d = sampleData();
    const b = buildBrief({ asOf: '2026-11-13', sourceMode: 'sample', etfBySymbol: d.etfBySymbol, fomc: d.fomc, fomcPrev: d.fomcPrev, purchases: d.purchases, news: d.news, market: d.market });
    eq(b.views.map((v) => v.symbol).join(), 'BTC,ETH,SOL,XRP');
    if (b.fomc.facts.deltaBps === null) throw new Error('fomc delta not measured');
    if (!b.risks[0].startsWith('SAMPLE')) throw new Error('sample flag');
    eq(b.etf.find((e) => e.symbol === 'BTC').facts.lastDate, '2026-11-12');
  });

  return results;
}
