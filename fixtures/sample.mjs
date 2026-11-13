// SYNTHETIC SAMPLE DATA, in the exact SoSoValue API response format. Not real market
// data. The agent uses it only when SOSOVALUE_API_KEY is not set, and labels every
// output "SAMPLE". Deterministic: the same seed always produces the same data.
export function sampleData() {
  let s = 42;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return u - 3; };
  const tradingDays = [];
  for (let d = new Date('2026-10-01T00:00:00Z'); tradingDays.length < 31; d = new Date(d.getTime() + 864e5)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && d.toISOString().slice(0, 10) <= '2026-11-12') tradingDays.push(d.toISOString().slice(0, 10));
    if (d.toISOString().slice(0, 10) >= '2026-11-12') break;
  }
  const etf = (meanM, sdM, assetsB, lastM, streakBoostM) => {
    let cum = assetsB * 0.3e9;
    return tradingDays.map((date, i) => {
      let f = (meanM + sdM * gauss()) * 1e6;
      if (streakBoostM && i >= tradingDays.length - 4) f = Math.abs(f) + streakBoostM * 1e6;
      if (i === tradingDays.length - 1) f = lastM * 1e6;
      cum += f;
      return { date, total_net_inflow: Math.round(f).toFixed(16), total_value_traded: Math.round((2 + rnd() * 3) * 1e9).toFixed(16), total_net_assets: Math.round(assetsB * 1e9 + cum * 0.1).toFixed(16), cum_net_inflow: cum.toFixed(16) };
    }).reverse(); // the API returns newest first
  };
  const ranges = ['300-325', '325-350', '350-375', '375-400', '400-425'];
  return {
    etfBySymbol: { BTC: etf(60, 180, 140, 912, 150), ETH: etf(10, 60, 22, -238, 0), SOL: etf(2, 6, 1.2, 4, 0), XRP: etf(1, 3, 0.6, 1, 0) },
    fomc: { rate_ranges: ranges, meetings: [{ meeting_date: '2026-12-09', probabilities: ['0.0', '12.4', '63.1', '24.5', '0.0'] }, { meeting_date: '2027-01-27', probabilities: ['8.2', '41.0', '40.3', '10.5', '0.0'] }], as_of: 1794600000000 },
    fomcPrev: { rate_ranges: ranges, meetings: [{ meeting_date: '2026-12-09', probabilities: ['0.0', '5.0', '55.0', '40.0', '0.0'] }] },
    market: { total_market_cap: '3412000000000.00', total_market_cap_change_pct: '1.8', total_volume_24h: '118000000000.00', eth_gas_gwei: '0.21', btc_gas_sat_vb: '4', as_of: 1794600000000 },
    news: [
      { id: 's1', source_link: 'https://sosovalue.com/', release_time: 1794590000000, title: 'Sample: BTC spot ETFs log their largest inflow day this month', tags: ['ETF', 'BTC'] },
      { id: 's2', source_link: 'https://sosovalue.com/', release_time: 1794580000000, title: 'Sample: ETH ETFs see a second day of redemptions', tags: ['ETF', 'ETH'] },
      { id: 's3', source_link: 'https://sosovalue.com/', release_time: 1794570000000, title: 'Sample: futures traders price higher odds of a December cut', tags: ['Macro'] },
      { id: 's4', source_link: 'https://sosovalue.com/', release_time: 1794560000000, title: 'Sample: SOL ETF volumes stay muted', matched_currencies: [{ symbol: 'SOL' }] },
    ],
    purchases: [
      { date: '2026-11-10', ticker: 'MSTR', btc_holding: 690000, btc_acq: 4200, acq_cost: 420000000, avg_btc_cost: 71000 },
      { date: '2026-11-11', ticker: 'MARA', btc_holding: 52000, btc_acq: 900, acq_cost: 91000000, avg_btc_cost: 68000 },
    ],
  };
}
