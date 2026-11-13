// FlowDesk signal engine. Pure functions, no I/O: the same module runs in the
// GitHub Actions agent (Node) and in the browser tests.
//
// Every signal carries: a score (-2..+2), a confidence (low/medium/high), the
// plain-language reasons behind it, and the exact numbers it used. Nothing here
// is a trade instruction; the desk explains what moved and why it might matter.

export const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const fmtUsd = (v) => {
  const a = Math.abs(v);
  const s = a >= 1e9 ? `$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : `$${Math.round(a).toLocaleString('en-US')}`;
  return (v < 0 ? '-' : '') + s;
};
export { fmtUsd };

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const std = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
const clampScore = (s) => Math.max(-2, Math.min(2, s));

/**
 * ETF flow signal for one asset.
 * rows: SoSoValue /etfs/summary-history items (any order).
 */
export function etfFlowSignal(symbol, rows) {
  const days = [...(rows || [])]
    .map((r) => ({ date: r.date, flow: num(r.total_net_inflow), assets: num(r.total_net_assets), traded: num(r.total_value_traded) }))
    .filter((r) => r.date && Number.isFinite(r.flow))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (days.length < 5) {
    return { kind: 'etf', symbol, score: 0, confidence: 'low', label: 'Not enough data', reasons: [`Only ${days.length} trading days of ETF data.`], facts: { days: days.length } };
  }
  const last = days[days.length - 1];
  const flows = days.map((d) => d.flow);
  const base = flows.slice(0, -1).slice(-20);
  const sd = std(base);
  const z = sd > 0 ? (last.flow - mean(base)) / sd : 0;
  const sum5 = flows.slice(-5).reduce((s, x) => s + x, 0);
  let streak = 0;
  const sign = Math.sign(last.flow);
  for (let i = days.length - 1; i >= 0 && Math.sign(days[i].flow) === sign && sign !== 0; i--) streak++;
  const flowPctAssets = last.assets ? (last.flow / last.assets) * 100 : null;

  let score = 0;
  const reasons = [];
  const dir = last.flow >= 0 ? 'inflow' : 'outflow';
  if (Math.abs(z) >= 2) { score += Math.sign(z) * 1; reasons.push(`Latest day (${last.date}) net ${dir} of ${fmtUsd(Math.abs(last.flow))} is ${Math.abs(z).toFixed(1)} standard deviations ${z > 0 ? 'above' : 'below'} the prior ${base.length}-day average: unusually ${z > 0 ? 'strong' : 'weak'}.`); }
  else reasons.push(`Latest day (${last.date}) net ${dir} of ${fmtUsd(Math.abs(last.flow))}, within the normal range (z = ${z.toFixed(1)}).`);
  if (Math.abs(sum5) > 0) { const s5 = Math.sign(sum5); reasons.push(`Last 5 trading days: ${fmtUsd(sum5)} net.`); if (streak >= 3 && s5 === sign) { score += sign * 1; reasons.push(`${streak} ${sign > 0 ? 'inflow' : 'outflow'} days in a row.`); } }
  if (flowPctAssets !== null && Math.abs(flowPctAssets) >= 0.5) reasons.push(`That day moved ${flowPctAssets.toFixed(2)}% of total ETF assets.`);
  score = clampScore(score);
  const confidence = days.length >= 15 && Math.abs(z) >= 2 ? 'high' : days.length >= 10 ? 'medium' : 'low';
  const label = score >= 2 ? 'Strong inflows' : score === 1 ? 'Leaning inflows' : score === 0 ? 'Neutral flows' : score === -1 ? 'Leaning outflows' : 'Strong outflows';
  return { kind: 'etf', symbol, score, confidence, label, reasons, facts: { lastDate: last.date, lastFlow: last.flow, z: +z.toFixed(2), sum5, streak: streak * sign, flowPctAssets, days: days.length } };
}

/**
 * FOMC signal: expected policy rate at the next meeting, and how it moved since the
 * previous run (if the desk has one).
 * data: SoSoValue /macro/fomc-probabilities; prev: the same object from the last run.
 */
export function expectedRate(data, meetingIndex = 0) {
  const m = data?.meetings?.[meetingIndex];
  if (!m) return null;
  let total = 0, acc = 0;
  data.rate_ranges.forEach((range, i) => {
    const p = num(m.probabilities[i]);
    if (!p) return;
    const [lo, hi] = range.split('-').map(Number);
    acc += p * ((lo + hi) / 2);
    total += p;
  });
  return total > 0 ? { date: m.meeting_date, bps: acc / total, probSum: total } : null;
}

export function fomcSignal(data, prev) {
  const now = expectedRate(data);
  if (!now) return { kind: 'fomc', score: 0, confidence: 'low', label: 'No FOMC data', reasons: ['FOMC probabilities unavailable.'], facts: {} };
  const reasons = [`Market-implied target rate for the ${now.date} FOMC meeting: ${(now.bps / 100).toFixed(2)}%.`];
  let score = 0, delta = null;
  const before = prev ? expectedRate(prev) : null;
  if (before && before.date === now.date) {
    delta = now.bps - before.bps;
    if (Math.abs(delta) >= 5) {
      score = delta < 0 ? 1 : -1; // more expected cuts = easier money = supportive for risk assets
      reasons.push(`Since the last run, expectations moved ${delta < 0 ? 'toward more easing' : 'toward tighter policy'} by ${Math.abs(delta).toFixed(1)} basis points.`);
    } else reasons.push('Little change since the last run.');
  } else reasons.push('No earlier reading for this meeting yet, so no change is measured.');
  return { kind: 'fomc', score, confidence: before ? 'medium' : 'low', label: score > 0 ? 'Easing odds up' : score < 0 ? 'Easing odds down' : 'Rates steady', reasons, facts: { meeting: now.date, expectedBps: +now.bps.toFixed(1), deltaBps: delta === null ? null : +delta.toFixed(1) } };
}

/**
 * Corporate treasury buying: BTC acquired by tracked companies in the last N days.
 * purchases: concatenated /btc-treasuries/{ticker}/purchase-history items.
 */
export function treasurySignal(purchases, asOf, days = 7) {
  const cutoff = new Date(new Date(asOf).getTime() - days * 864e5).toISOString().slice(0, 10);
  const recent = (purchases || []).filter((p) => p.date >= cutoff && num(p.btc_acq) > 0);
  const btc = recent.reduce((s, p) => s + num(p.btc_acq), 0);
  const usd = recent.reduce((s, p) => s + (num(p.acq_cost) || 0), 0);
  const buyers = [...new Set(recent.map((p) => p.ticker))];
  const score = btc >= 5000 ? 1 : 0;
  const reasons = recent.length
    ? [`${buyers.length} tracked compan${buyers.length === 1 ? 'y' : 'ies'} (${buyers.join(', ')}) bought ${btc.toLocaleString('en-US')} BTC for ${fmtUsd(usd)} in the last ${days} days.`]
    : [`No tracked corporate BTC purchases in the last ${days} days.`];
  return { kind: 'treasury', symbol: 'BTC', score, confidence: recent.length ? 'medium' : 'low', label: score ? 'Corporate buying' : 'Quiet treasuries', reasons, facts: { btc, usd, buyers } };
}

/** News attention: how often each asset is tagged in recent featured/hot news. */
export function newsAttention(items, symbols) {
  const counts = Object.fromEntries(symbols.map((s) => [s, 0]));
  const headlines = Object.fromEntries(symbols.map((s) => [s, []]));
  for (const it of items || []) {
    const tags = new Set([...(it.tags || []), ...((it.matched_currencies || []).map((c) => c.symbol || c.currency_symbol || c).filter(Boolean))].map((t) => String(t).toUpperCase()));
    for (const s of symbols) if (tags.has(s) || new RegExp(`\\b${s}\\b`).test(it.title || '')) { counts[s]++; if (headlines[s].length < 3) headlines[s].push({ title: it.title, link: it.source_link, time: it.release_time }); }
  }
  return { counts, headlines };
}

/** Combine into one desk view per asset. Weights are fixed and published. */
export const WEIGHTS = { etf: 1, fomc: 0.5, treasury: 0.5 };
export function deskView(symbol, parts) {
  const used = parts.filter(Boolean);
  const raw = used.reduce((s, p) => s + (WEIGHTS[p.kind] ?? 0) * p.score, 0);
  const score = Math.round(clampScore(raw) * 10) / 10;
  const stance = score >= 1 ? 'Constructive' : score <= -1 ? 'Cautious' : 'Neutral';
  const conf = used.some((p) => p.confidence === 'high') ? 'high' : used.every((p) => p.confidence === 'low') ? 'low' : 'medium';
  return { symbol, score, stance, confidence: conf, drivers: used.map((p) => ({ kind: p.kind, label: p.label, score: p.score })) };
}

/** Guardrails: what a reader must know before using today's brief. */
export function riskChecks({ asOf, etf, fomc, sourceMode }) {
  const out = [];
  if (sourceMode !== 'live') out.push('SAMPLE DATA: this brief was built from example data, not live SoSoValue data.');
  for (const e of etf) if (e.facts.lastDate) {
    const age = (new Date(asOf) - new Date(e.facts.lastDate)) / 864e5;
    if (age > 4) out.push(`${e.symbol} ETF data is ${Math.floor(age)} days old (market holiday or delayed source).`);
  }
  if (fomc.confidence === 'low') out.push('FOMC change is not measured until the desk has two readings for the same meeting.');
  out.push('Signals describe flows and expectations, not prices. They are not investment advice.');
  return out;
}

/** Build the whole brief from raw API payloads. */
export function buildBrief({ asOf, sourceMode, etfBySymbol, fomc, fomcPrev, purchases, news, market }) {
  const symbols = Object.keys(etfBySymbol);
  const etf = symbols.map((s) => etfFlowSignal(s, etfBySymbol[s]));
  const fomcSig = fomcSignal(fomc, fomcPrev);
  const treas = treasurySignal(purchases, asOf);
  const attention = newsAttention(news, symbols);
  const views = symbols.map((s) => deskView(s, [etf.find((e) => e.symbol === s), fomcSig, s === 'BTC' ? treas : null]));
  const headline = (() => {
    const strongest = [...etf].sort((a, b) => Math.abs(b.facts.z || 0) - Math.abs(a.facts.z || 0))[0];
    return strongest && strongest.facts.lastFlow !== undefined
      ? `${strongest.symbol} ETFs: ${strongest.label.toLowerCase()} (${fmtUsd(strongest.facts.lastFlow)} on ${strongest.facts.lastDate}). ${fomcSig.label}.`
      : fomcSig.label;
  })();
  return {
    asOf, sourceMode, headline,
    market: market ? { capUsd: num(market.total_market_cap), capChangePct: num(market.total_market_cap_change_pct), volume24h: num(market.total_volume_24h) } : null,
    views, etf, fomc: fomcSig, treasury: treas, attention,
    risks: riskChecks({ asOf, etf, fomc: fomcSig, sourceMode }),
    method: { weights: WEIGHTS, etfZ: 'latest day vs prior 20 trading days', streak: '3+ same-sign days add 1 point', fomcThresholdBps: 5, treasuryThresholdBtc: 5000 },
  };
}
