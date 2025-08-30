# TradingFerda — Free Daily Playbook (EOD)

A static website that shows the day’s best trade setups (entries/stops/targets + charts + explanations) generated from **free public end-of-day data** (Stooq). No paid APIs. Educational only.

## How it works

- **Nightly GitHub Action** runs `scripts/build_signals.py`
- Downloads daily CSVs from Stooq for a small watchlist
- Computes simple, explainable strategies:
  - Trend Pullback (EMA5/EMA20 + RSI14 + ATR stop/target)
  - Mean Reversion (RSI(2) in bull regime + target to 5SMA)
- Ranks ideas by R/R and writes:
  - `public/data/today.json` (ideas + reasons)
  - `public/ohlc/<symbol>.json` (last 200 bars for charts)
- **Next.js** reads the JSON and renders an interactive dashboard (Lightweight-Charts)

## Local dev

```bash
# node 18+ recommended
npm i
npm run dev
