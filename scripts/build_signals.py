# scripts/build_signals.py
# Educational only. Not financial advice.
# Generates BOTH short-term (daily swing) and long-term (weekly investment) ideas.
# Works with public Stooq data so anyone can use the site.

import io, os, json, requests, pandas as pd, numpy as np
from datetime import datetime, timezone

# ---------- Config ----------
STOOQ_URL = "https://stooq.com/q/d/l/?s={symbol}&i={interval}"   # e.g., spy.us, i=d
OUT_DATA = "public/data/today.json"
OUT_OHLC_DIR = "public/ohlc"

WATCHLIST = [
    "spy.us", "qqq.us", "iwm.us",
    "xlk.us", "xlf.us", "xle.us", "xlv.us", "xly.us", "xlb.us", "xli.us", "xlp.us", "xlu.us", "xlc.us",
    "aapl.us", "msft.us", "nvda.us", "amzn.us", "goog.us", "meta.us", "tsla.us", "amd.us", "avgo.us",
]

# Core thresholds (short-term)
UPTREND_RSI_MIN   = 50
DOWNTREND_RSI_MAX = 50
MR_RSI2_MAX       = 10
MR_RSI2_MIN       = 90
MR_TREND_MA       = 200

# Long-term thresholds (weekly)
LT_SMA_WEEKS      = 40      # ~200 trading days
LT_RSI_MIN        = 55      # stronger momentum for investments
LT_MIN_WEEKS      = 60      # need history to trust weekly regime

# Risk / Reward (short-term)
RISK_MULT   = 1.0
REWARD_MULT = 1.8

# Long-term risk model (weekly)
LT_STOP_ATR_MULT   = 2.0
LT_TARGET_ATR_MULT = 4.0

# Liquidity / quality
MIN_PRICE        = 5.0
MIN_DOLLAR_VOL   = 10_000_000   # min 20d avg dollar volume
MAX_SHORT_IDEAS  = 12
MAX_LONG_IDEAS   = 8
VERBOSE          = True
# ----------------------------

def log(msg: str):
    if VERBOSE:
        print(msg)

def fetch_stooq_csv(symbol="spy.us", interval="d") -> pd.DataFrame:
    r = requests.get(STOOQ_URL.format(symbol=symbol, interval=interval), timeout=30)
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.text))
    df.rename(columns=str.lower, inplace=True)
    df['date'] = pd.to_datetime(df['date'])
    df.sort_values('date', inplace=True)
    return df.dropna()

def ema(s, n): return s.ewm(span=n, adjust=False).mean()
def sma(s, n): return s.rolling(n).mean()

def rsi(series, n=14):
    d = series.diff()
    up = pd.Series(np.where(d > 0, d, 0.0), index=series.index)
    dn = pd.Series(np.where(d < 0, -d, 0.0), index=series.index)
    ru = up.ewm(alpha=1/n, adjust=False).mean()
    rd = dn.ewm(alpha=1/n, adjust=False).mean().replace(0, np.nan)
    rs = ru / rd
    return 100 - (100 / (1 + rs))

def atr(df, n=14):
    h, l, c = df['high'], df['low'], df['close']
    pc = c.shift(1)
    tr = pd.concat([(h - l), (h - pc).abs(), (l - pc).abs()], axis=1).max(axis=1)
    return tr.rolling(n).mean()

def round2(x):
    try: return float(f"{float(x):.2f}")
    except: return None

def to_ohlc_json(df, bars=200):
    d = df.tail(bars)
    return [
        {"time": r['date'].strftime("%Y-%m-%d"),
         "open": round2(r['open']), "high": round2(r['high']),
         "low": round2(r['low']), "close": round2(r['close'])}
        for _, r in d.iterrows()
    ]

def liquidity_ok(df) -> bool:
    last = df.iloc[-1]
    if last['close'] < MIN_PRICE:
        return False
    if 'volume' not in df.columns:
        return True
    dv20 = (df['close'] * df['volume']).rolling(20).mean().iloc[-1]
    return (not pd.isna(dv20)) and (dv20 >= MIN_DOLLAR_VOL)

# -------- Market regime (SPY) --------
def market_regime() -> dict:
    df = fetch_stooq_csv("spy.us", "d")
    df['sma200'] = sma(df['close'], 200)
    df['ema20']  = ema(df['close'], 20)
    df['ema50']  = ema(df['close'], 50)
    df['rsi14']  = rsi(df['close'], 14)
    last = df.iloc[-1]
    roc20 = (last['close'] / df['close'].iloc[-21]) - 1.0 if len(df) >= 21 else 0.0

    score  = 0
    score += 1 if last['close'] > df['sma200'].iloc[-1] else -1
    score += 1 if df['ema20'].iloc[-1]  > df['ema50'].iloc[-1] else -1
    score += 1 if df['rsi14'].iloc[-1]  >= 50 else -1
    score += 1 if roc20                 >= 0 else -1

    if score >= 2: bias = "bullish"
    elif score <= -2: bias = "bearish"
    else: bias = "neutral"

    return {
        "score": int(score),
        "bias": bias,
        "spy_close": round2(last['close']),
        "spy_sma200": round2(df['sma200'].iloc[-1]),
        "ema20_gt_ema50": bool(df['ema20'].iloc[-1] > df['ema50'].iloc[-1]),
        "rsi14": round2(df['rsi14'].iloc[-1]),
        "roc20_pct": round2(roc20 * 100.0),
    }

# ---------- Helpers ----------
def plan_dict(entry, stop, target, rr, reason, strat, direction, horizon, score=0.0):
    return {
        "strategy": strat,
        "active": True,
        "entry": round2(entry),
        "stop": round2(stop),
        "target": round2(target),
        "rr": float(f"{rr:.2f}"),
        "reason": reason,
        "direction": direction,   # "bullish" | "bearish"
        "horizon": horizon,       # "short" | "long"
        "_score": float(f"{score:.3f}")  # internal ranking
    }

def quality_long(d) -> float:
    last = d.iloc[-1]
    pts = 0.0
    pts += 1.0 if last['close'] > d['sma200'].iloc[-1] else 0.0
    pts += 1.0 if d['ema20'].iloc[-1] > d['ema50'].iloc[-1] else 0.0
    pts += (d['rsi14'].iloc[-1] - 50.0) / 50.0
    return max(0.0, pts)

def quality_short(d) -> float:
    last = d.iloc[-1]
    pts = 0.0
    pts += 1.0 if last['close'] < d['sma200'].iloc[-1] else 0.0
    pts += 1.0 if d['ema20'].iloc[-1] < d['ema50'].iloc[-1] else 0.0
    pts += (50.0 - d['rsi14'].iloc[-1]) / 50.0
    return max(0.0, pts)

# ---------- Short-term (daily) strategies ----------
def strat_trend_pullback_long(df):
    d = df.copy()
    d['ema5'] = ema(d['close'], 5)
    d['ema20'] = ema(d['close'], 20)
    d['ema50'] = ema(d['close'], 50)
    d['sma200'] = sma(d['close'], 200)
    d['rsi14'] = rsi(d['close'], 14)
    d['atr14'] = atr(d, 14)
    last = d.iloc[-1]
    if any(pd.isna(last[k]) for k in ['ema5','ema20','ema50','sma200','rsi14','atr14']): return None
    if not (last.ema5 > last.ema20 and last.rsi14 >= UPTREND_RSI_MIN): return None

    prior_high = d['high'].iloc[-1]
    entry  = prior_high + 0.05
    stop   = entry - RISK_MULT * last.atr14
    target = entry + REWARD_MULT * last.atr14
    rr     = (target - entry) / max(entry - stop, 1e-6)
    q      = quality_long(d)
    score  = rr * (1.0 + 0.5*q)
    return plan_dict(entry, stop, target, rr, "Uptrend, breakout of prior high.", "TrendPullbackLong", "bullish", "short", score)

def strat_mean_reversion_long(df):
    d = df.copy()
    d['sma200'] = sma(d['close'], MR_TREND_MA)
    d['sma5']   = sma(d['close'], 5)
    d['rsi2']   = rsi(d['close'], 2)
    d['ema20']  = ema(d['close'], 20)
    d['ema50']  = ema(d['close'], 50)
    d['rsi14']  = rsi(d['close'], 14)
    d['atr14']  = atr(d, 14)
    last = d.iloc[-1]
    if any(pd.isna(last[k]) for k in ['sma200','sma5','rsi2','atr14']): return None
    if not (last['close'] > last['sma200'] and last['rsi2'] < MR_RSI2_MAX): return None

    entry  = last['close']
    stop   = entry - RISK_MULT * last['atr14']
    target = last['sma5'] if not pd.isna(last['sma5']) else entry + REWARD_MULT * last['atr14']
    rr     = (target - entry) / max(entry - stop, 1e-6)
    d['sma200'] = sma(d['close'], 200)
    q      = quality_long(d.assign(rsi14=rsi(d['close'],14), ema20=ema(d['close'],20), ema50=ema(d['close'],50)))
    score  = rr * (1.0 + 0.5*q)
    return plan_dict(entry, stop, target, rr, "RSI(2) oversold, snapback to 5SMA.", "MeanReversionLong", "bullish", "short", score)

def strat_trend_pullback_short(df):
    d = df.copy()
    d['ema5'] = ema(d['close'], 5)
    d['ema20'] = ema(d['close'], 20)
    d['ema50'] = ema(d['close'], 50)
    d['sma200'] = sma(d['close'], 200)
    d['rsi14'] = rsi(d['close'], 14)
    d['atr14'] = atr(d, 14)
    last = d.iloc[-1]
    if any(pd.isna(last[k]) for k in ['ema5','ema20','ema50','sma200','rsi14','atr14']): return None
    if not (last.ema5 < last.ema20 and last.rsi14 <= DOWNTREND_RSI_MAX): return None

    prior_low = d['low'].iloc[-1]
    entry  = prior_low - 0.05
    stop   = entry + RISK_MULT * last.atr14
    target = entry - REWARD_MULT * last.atr14
    rr     = (entry - target) / max(stop - entry, 1e-6)
    q      = quality_short(d)
    score  = rr * (1.0 + 0.5*q)
    return plan_dict(entry, stop, target, rr, "Downtrend, breakdown of prior low.", "TrendPullbackShort", "bearish", "short", score)

def strat_mean_reversion_short(df):
    d = df.copy()
    d['sma200'] = sma(d['close'], MR_TREND_MA)
    d['sma5']   = sma(d['close'], 5)
    d['rsi2']   = rsi(d['close'], 2)
    d['ema20']  = ema(d['close'], 20)
    d['ema50']  = ema(d['close'], 50)
    d['rsi14']  = rsi(d['close'], 14)
    d['atr14']  = atr(d, 14)
    last = d.iloc[-1]
    if any(pd.isna(last[k]) for k in ['sma200','sma5','rsi2','atr14']): return None
    if not (last['close'] < last['sma200'] and last['rsi2'] > MR_RSI2_MIN): return None

    entry  = last['close']
    stop   = entry + RISK_MULT * last['atr14']
    target = last['sma5'] if not pd.isna(last['sma5']) else entry - REWARD_MULT * last['atr14']
    rr     = (entry - target) / max(stop - entry, 1e-6)
    d['sma200'] = sma(d['close'], 200)
    q      = quality_short(d.assign(rsi14=rsi(d['close'],14), ema20=ema(d['close'],20), ema50=ema(d['close'],50)))
    score  = rr * (1.0 + 0.5*q)
    return plan_dict(entry, stop, target, rr, "RSI(2) overbought, drop to 5SMA.", "MeanReversionShort", "bearish", "short", score)

# ---------- Weekly/Long-term ----------
def resample_weekly(df: pd.DataFrame) -> pd.DataFrame:
    w = df.set_index('date').resample('W-FRI').agg({
        'open':'first','high':'max','low':'min','close':'last','volume':'sum'
    }).dropna().reset_index()
    return w

def invest_trend_weekly_long(df_daily: pd.DataFrame):
    """Conservative long-term idea: only in strong uptrends on weekly."""
    w = resample_weekly(df_daily)
    if len(w) < LT_MIN_WEEKS:
        return None

    w['sma40'] = sma(w['close'], LT_SMA_WEEKS)
    w['ema10'] = ema(w['close'], 10)
    w['ema30'] = ema(w['close'], 30)
    w['rsi14w'] = rsi(w['close'], 14)

    # Weekly ATR for position sizing
    w2 = w.copy()
    w2['atr14w'] = atr(w2.rename(columns={'date':'date','open':'open','high':'high','low':'low','close':'close','volume':'volume'}), 14)
    last = w2.iloc[-1]
    if any(pd.isna(last[k]) for k in ['sma40','ema10','ema30','rsi14w','atr14w']):
        return None

    # Strong regime filter
    if not (last['close'] > last['sma40'] and last['ema10'] > last['ema30'] and last['rsi14w'] >= LT_RSI_MIN):
        return None

    # Entry near current close; wide stop/target using weekly ATR
    entry  = last['close']
    stop   = entry - LT_STOP_ATR_MULT * last['atr14w']
    target = entry + LT_TARGET_ATR_MULT * last['atr14w']
    rr     = (target - entry) / max(entry - stop, 1e-6)

    # Confidence score: distance above SMA40 + momentum quality
    dist = (last['close'] - last['sma40']) / max(1e-6, last['sma40'])
    momq = (last['rsi14w'] - 50.0) / 50.0
    score = rr * (1.0 + 0.7*max(0.0, dist) + 0.5*max(0.0, momq))

    return plan_dict(entry, stop, target, rr,
        "Weekly uptrend (close>SMA40, EMA10>EMA30, RSIw>55). Position trade.",
        "WeeklyTrendLong", "bullish", "long", score)

# ---------- Momentum fallback ----------
def momentum_info_plan(df):
    d = df.copy()
    d['atr14'] = atr(d, 14)
    last = d.iloc[-1]
    if pd.isna(last['atr14']) or len(d) < 21 or pd.isna(d['close'].iloc[-21]):
        return None
    roc20 = (last['close'] / d['close'].iloc[-21]) - 1.0
    bullish = roc20 >= 0

    entry = round2(last['close'])
    if bullish:
        stop = round2(entry - RISK_MULT * last['atr14'])
        target = round2(entry + REWARD_MULT * last['atr14'])
        rr = (target - entry) / max(entry - stop, 1e-6)
        return plan_dict(entry, stop, target, rr, "20d momentum up.", "MomentumInfo", "bullish", "short", rr)
    else:
        stop = round2(entry + RISK_MULT * last['atr14'])
        target = round2(entry - REWARD_MULT * last['atr14'])
        rr = (entry - target) / max(stop - entry, 1e-6)
        return plan_dict(entry, stop, target, rr, "20d momentum down.", "MomentumInfo", "bearish", "short", rr)

# ---------- Main ----------
def main():
    os.makedirs("public/data", exist_ok=True)
    os.makedirs(OUT_OHLC_DIR, exist_ok=True)

    regime = market_regime()
    log(f"Market bias: {regime['bias']} (score={regime['score']})")

    short_results, long_results = [], []

    for sym in WATCHLIST:
        symu = sym.upper()
        print(f"[{sym}]")
        try:
            df = fetch_stooq_csv(sym, "d")
            if len(df) < 210:
                log("  skipped: not enough history"); continue
            if not liquidity_ok(df):
                log("  skipped: liquidity/price filter"); continue

            with open(os.path.join(OUT_OHLC_DIR, f"{sym}.json"), "w", encoding="utf-8") as f:
                json.dump(to_ohlc_json(df), f, ensure_ascii=False)

            # Short-term candidates (daily)
            cands_short = [
                strat_trend_pullback_long(df),
                strat_mean_reversion_long(df),
                strat_trend_pullback_short(df),
                strat_mean_reversion_short(df),
                momentum_info_plan(df),
            ]
            for c in [x for x in cands_short if x]:
                short_results.append({"symbol": symu, "plan": c})

            # Long-term candidate (weekly)
            lt = invest_trend_weekly_long(df)
            if lt:
                long_results.append({"symbol": symu, "plan": lt})

        except Exception as e:
            log(f"  [WARN] error: {e}\n")

    # Rank and cap per horizon
    short_results.sort(key=lambda r: (r["plan"].get("_score", 0.0), r["plan"].get("rr", 0.0)), reverse=True)
    long_results.sort(key=lambda r: (r["plan"].get("_score", 0.0), r["plan"].get("rr", 0.0)), reverse=True)
    short_results = short_results[:MAX_SHORT_IDEAS]
    long_results  = long_results[:MAX_LONG_IDEAS]

    for r in short_results + long_results:
        r["plan"].pop("_score", None)

    # Combine for backward-compat: UI reads `ideas`. Keep both horizons present.
    ideas = short_results + long_results

    payload = {
        "generated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "watchlist": WATCHLIST,
        "market_bias": regime,
        "ideas": ideas,
        "disclaimer": "Educational use only. Not financial advice. Data provided as-is from public sources.",
    }

    with open(OUT_DATA, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    print(f"\nWrote {OUT_DATA} with {len(ideas)} idea(s). "
          f"({len(short_results)} short-term, {len(long_results)} long-term)")

if __name__ == "__main__":
    main()
