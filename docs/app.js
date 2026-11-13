const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cls = (score) => (score > 0 ? 'up' : score < 0 ? 'down' : 'flat');
const usd = (v) => { if (v === null || v === undefined || !Number.isFinite(v)) return '—'; const a = Math.abs(v); const s = a >= 1e12 ? `$${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : `$${Math.round(a)}`; return (v < 0 ? '-' : '') + s; };
const meter = (score) => `<div class="meter" aria-hidden="true"><i style="left:${((score + 2) / 4) * 100}%"></i></div>`;

async function load(date) {
  const url = date ? `data/history/${date}.json` : 'data/latest.json';
  const b = await (await fetch(url, { cache: 'no-store' })).json();
  render(b);
}

function render(b) {
  $('#asof').textContent = `Brief for ${b.asOf} · generated ${b.generatedAt ? b.generatedAt.replace('T', ' ').slice(0, 16) + ' UTC' : ''} · source: ${b.sourceMode}`;
  $('#headline').textContent = b.headline;
  $('#sampleBanner').innerHTML = b.sourceMode !== 'live' ? '<div class="warn">Sample data: this brief was built from synthetic example data in SoSoValue\'s format, not live market data.</div>' : '';
  $('#kpis').innerHTML = b.market ? `
    <div><span class="muted small">Crypto market cap</span><b>${usd(b.market.capUsd)}</b></div>
    <div><span class="muted small">24h change</span><b class="${cls(b.market.capChangePct)}">${b.market.capChangePct > 0 ? '+' : ''}${b.market.capChangePct}%</b></div>
    <div><span class="muted small">24h volume</span><b>${usd(b.market.volume24h)}</b></div>` : '';

  $('#aiCard').innerHTML = b.ai?.text
    ? `<div class="muted small">Desk summary (AI-written, number-checked)</div><p style="margin:6px 0 0">${esc(b.ai.text)}</p>`
    : `<div class="muted small">Desk summary</div><p style="margin:6px 0 0">${esc(b.views.map((v) => `${v.symbol} ${v.stance.toLowerCase()} (${v.score > 0 ? '+' : ''}${v.score})`).join(' · '))}.</p><p class="small muted" style="margin:6px 0 0">AI summary: ${esc(b.ai?.note || 'not run')}</p>`;

  $('#views').innerHTML = b.views.map((v) => `
    <div class="card view">
      <div style="display:flex;justify-content:space-between;align-items:baseline"><span class="sym">${esc(v.symbol)}</span><span class="pill">${esc(v.confidence)} confidence</span></div>
      <div class="stance ${v.stance === 'Constructive' ? 'up' : v.stance === 'Cautious' ? 'down' : 'flat'}">${esc(v.stance)} · ${v.score > 0 ? '+' : ''}${v.score}</div>
      ${meter(v.score)}
      <div class="small muted">${v.drivers.map((d) => `${esc(d.kind.toUpperCase())}: ${esc(d.label)} (${d.score > 0 ? '+' : ''}${d.score})`).join('<br>')}</div>
    </div>`).join('');

  $('#etf').innerHTML = b.etf.map((e) => `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:baseline"><b>${esc(e.symbol)} spot ETFs</b><span class="${cls(e.score)}" style="font-weight:700">${esc(e.label)}</span></div>
      <ul class="reasons small">${e.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    </div>`).join('');

  $('#fomc').innerHTML = `<div class="${cls(b.fomc.score)}" style="font-weight:700">${esc(b.fomc.label)}</div><ul class="reasons small">${b.fomc.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`;
  $('#treasury').innerHTML = `<div class="${cls(b.treasury.score)}" style="font-weight:700">${esc(b.treasury.label)}</div><ul class="reasons small">${b.treasury.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`;

  const a = b.attention;
  $('#news').innerHTML = '<tr><th>Asset</th><th>Mentions</th><th>Top headlines</th></tr>' + Object.keys(a.counts).map((s) => `<tr><td><b>${esc(s)}</b></td><td>${a.counts[s]}</td><td class="small">${a.headlines[s].map((h) => h.link ? `<a href="${esc(h.link)}" target="_blank" rel="noopener">${esc(h.title)}</a>` : esc(h.title)).join('<br>') || '<span class="muted">—</span>'}</td></tr>`).join('');

  $('#risks').innerHTML = b.risks.map((r) => `<li>${esc(r)}</li>`).join('') + (b.sourceErrors?.length ? `<li>Source issues today: ${esc(b.sourceErrors.join('; '))}</li>` : '');
  const m = b.method;
  $('#method').innerHTML = `<p style="margin-top:0">Each asset gets a score from −2 to +2. Rules are fixed and public:</p>
    <ul class="reasons">
      <li><b>ETF flows</b> (weight ${m.weights.etf}): +1/−1 when the latest day is 2+ standard deviations from the ${esc(m.etfZ)}; ${esc(m.streak)}.</li>
      <li><b>Fed odds</b> (weight ${m.weights.fomc}): +1 when the market-implied rate for the next meeting falls by ${m.fomcThresholdBps}+ basis points since the last run (more easing expected), −1 when it rises.</li>
      <li><b>Corporate buying</b> (weight ${m.weights.treasury}, BTC only): +1 when tracked companies bought ${m.treasuryThresholdBtc.toLocaleString('en-US')}+ BTC in 7 days.</li>
    </ul>
    <p class="muted" style="margin-bottom:0">The AI summary is optional. It is rejected automatically if it contains any number that isn't in the data.</p>`;
}

async function history() {
  try {
    const idx = await (await fetch('data/index.json', { cache: 'no-store' })).json();
    $('#history').innerHTML = '<tr><th>Date</th><th>Headline</th><th>Source</th></tr>' + idx.map((e) => `<tr><td><a href="#${esc(e.date)}" data-d="${esc(e.date)}">${esc(e.date)}</a></td><td>${esc(e.headline)}</td><td class="small muted">${esc(e.sourceMode)}</td></tr>`).join('');
    $('#history').querySelectorAll('a[data-d]').forEach((a) => { a.onclick = () => load(a.dataset.d).then(() => scrollTo({ top: 0, behavior: 'smooth' })); });
  } catch { $('#history').innerHTML = '<tr><td class="muted">No history yet.</td></tr>'; }
}

const hashDate = location.hash.match(/^#(\d{4}-\d{2}-\d{2})$/)?.[1];
load(hashDate).catch((e) => { $('#asof').textContent = 'Could not load the brief: ' + e.message; }).finally(() => { document.body.dataset.ready = '1'; });
history();
