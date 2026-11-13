# FlowDesk: a one-person crypto research desk, run by an agent

**Live desk:** https://wwaterfall2027.github.io/flowdesk/ · **RSS:** https://wwaterfall2027.github.io/flowdesk/feed.xml

Every morning, FlowDesk reads the market the way a research desk would, then publishes a short brief that anyone can check:

- **Spot ETF flows** for BTC, ETH, SOL and XRP: is today's flow unusual, and is a streak forming?
- **Fed rate odds**: did the market price in more or less easing since yesterday?
- **Corporate BTC buying**: did treasury companies keep buying this week?
- **News attention**: which assets the curated news is talking about.

It turns those into a score from −2 to +2 per asset, and writes down why. All data comes from the [SoSoValue API](https://sosovalue-1.gitbook.io/sosovalue-api-doc).

Built for the SoSoValue Buildathon on AKINDO: *Build Your One-Person On-Chain Finance Business*.

## Why it's useful

ETF flows and Fed odds move crypto, but the raw tables are hard to read. FlowDesk answers the questions people actually ask, in plain language: *Was yesterday's BTC ETF inflow big or normal? Is this a trend? Did rate-cut odds change?* Each answer comes with the exact number behind it.

## How it works

```
GitHub Actions (daily, 02:30 UTC)
  └─ agent/run.mjs
       ├─ SoSoValue API: /etfs/summary-history (BTC, ETH, SOL, XRP), /macro/fomc-probabilities,
       │                 /market/overview, /news/pick, /btc-treasuries/{ticker}/purchase-history
       ├─ src/signals.js: fixed, published scoring rules (pure functions, tested)
       ├─ optional AI summary (GitHub Models), rejected if it contains any number not in the data
       └─ writes docs/data/latest.json, a dated copy, docs/data/index.json and docs/feed.xml
GitHub Pages serves docs/: the desk and its RSS feed
```

No server, no database, no secrets in the page. The API key lives only in a GitHub Actions secret.

### Scoring rules (public and fixed)

| Signal | Weight | Rule |
|---|---|---|
| ETF flows | 1 | +1/−1 when the latest day is 2+ standard deviations from the prior 20 trading days; +1/−1 more for a 3+ day same-direction streak |
| Fed odds | 0.5 | +1 when the market-implied rate for the next FOMC meeting falls 5+ bps since the last run (more easing), −1 when it rises |
| Corporate buying | 0.5 (BTC only) | +1 when tracked companies bought 5,000+ BTC in 7 days |

### Risk controls

- Every brief lists what a reader must know before using it: stale ETF data (holidays), FOMC change not yet measurable, and that signals describe flows, not prices. It is not investment advice.
- **The AI can't invent numbers.** The model receives only the computed facts. The agent extracts every number from its reply and rejects the reply if any number is not in those facts; the desk then falls back to the rule-based summary.
- Rate limits are respected (20 requests per minute: calls are spaced 3.2 s apart, with a retry on 429). One failing endpoint doesn't stop the brief; it's listed under "source issues".
- Without an API key the agent runs on **synthetic sample data** in the API's exact format, and every page says SAMPLE in large letters.

## Run it yourself

1. Fork this repository.
2. Get a free API key at https://sosovalue.com/developer/dashboard.
3. Add it as a repository secret named `SOSOVALUE_API_KEY` (Settings → Secrets and variables → Actions).
4. Enable GitHub Pages from the `docs/` folder, and run the **FlowDesk daily brief** workflow once from the Actions tab.

## Tests

`node tests/run-node.mjs`, or open `tests/index.html` in a browser. **19/19 passing.** They cover z-scores checked against hand calculations, streaks, input order, string numbers from the API, the FOMC expected-rate math, treasury windows, news tagging, weighting and caps, risk flags, the AI number guard, and a full brief built from the sample data. CI runs them before every brief.

## License

MIT. Built with AI assistance (Claude Code).
