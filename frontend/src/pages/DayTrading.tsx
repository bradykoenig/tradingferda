import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  createChart, CrosshairMode, LineStyle,
  IChartApi, ISeriesApi, CandlestickData, HistogramData, LineData, UTCTimestamp,
  CandlestickSeries, HistogramSeries, LineSeries,
} from 'lightweight-charts';
import { Zap, RefreshCw, AlertCircle, TrendingUp, TrendingDown, Activity, Clock, BarChart2, Shield } from 'lucide-react';
import { generateDTPick, fetchCandles, DTTopPick, DTCandidate, Candle } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function isMarketOpen(): boolean {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  if (et.getDay() === 0 || et.getDay() === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 570 && mins < 960;
}

function rsiZone(rsi: number) {
  if (rsi >= 70) return { label: 'Overbought', textColor: 'text-red-400', dotColor: 'bg-red-500', hint: 'High — risk of reversal soon' };
  if (rsi <= 30) return { label: 'Oversold',   textColor: 'text-blue-400', dotColor: 'bg-blue-500', hint: 'Low — potential bounce setup' };
  if (rsi >= 50) return { label: 'Bullish',    textColor: 'text-emerald-400', dotColor: 'bg-emerald-500', hint: 'Healthy momentum — good for long entries' };
  return             { label: 'Neutral',    textColor: 'text-zinc-400', dotColor: 'bg-zinc-400', hint: 'Wait for stronger momentum' };
}

// ─── RSI Visual Bar ───────────────────────────────────────────────────────────

function RSIBar({ value }: { value: number }) {
  const pct = Math.min(Math.max(value, 0), 100);
  const zone = rsiZone(value);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">RSI</span>
        <span className={`text-sm font-mono font-bold ${zone.textColor}`}>{value}</span>
      </div>
      <div className="relative h-2 rounded-full overflow-visible bg-zinc-800">
        <div className="absolute inset-0 flex rounded-full overflow-hidden pointer-events-none">
          <div className="w-[30%] bg-blue-500/20" />
          <div className="w-[40%] bg-emerald-500/10" />
          <div className="w-[30%] bg-red-500/20" />
        </div>
        <div
          className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full ${zone.dotColor} border-2 border-zinc-950 z-10 shadow`}
          style={{ left: `calc(${pct}% - 6px)` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-zinc-700 px-0.5">
        <span>Oversold</span><span>30 ── 70</span><span>Overbought</span>
      </div>
      <p className="text-[11px] text-zinc-500">{zone.label} — {zone.hint}</p>
    </div>
  );
}

// ─── Volume Bar ───────────────────────────────────────────────────────────────

function VolBar({ ratio }: { ratio: number }) {
  const pct = Math.min(ratio / 5, 1) * 100;
  const { barColor, textColor, hint } = ratio >= 2.5
    ? { barColor: 'bg-emerald-500', textColor: 'text-emerald-400', hint: 'Exceptional — strong conviction' }
    : ratio >= 1.5
    ? { barColor: 'bg-amber-400',   textColor: 'text-amber-400',   hint: 'Elevated — good confirmation' }
    : { barColor: 'bg-zinc-500',    textColor: 'text-zinc-500',    hint: 'Below average — be cautious' };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Volume</span>
        <span className={`text-sm font-mono font-bold ${textColor}`}>{ratio.toFixed(1)}× avg</span>
      </div>
      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-zinc-700 px-0.5">
        <span>1×</span><span>2.5×</span><span>5×</span>
      </div>
      <p className="text-[11px] text-zinc-500">{hint}</p>
    </div>
  );
}

// ─── VWAP ─────────────────────────────────────────────────────────────────────

// Volume Weighted Average Price — resets each trading day (day boundary = midnight UTC)
// This is THE #1 indicator professional day traders use to define intraday fair value.
// Price above VWAP = bullish bias. Price below VWAP = bearish bias.
function calcVWAP(candles: Candle[], intervalKey: string): LineData[] | null {
  if (intervalKey === '1d') return null; // not meaningful for daily bars
  let cumTPV = 0, cumVol = 0, lastDay = -1;
  return candles.map(c => {
    const day = Math.floor(c.time / 86400);
    if (day !== lastDay) { cumTPV = 0; cumVol = 0; lastDay = day; }
    const tp = (c.high + c.low + c.close) / 3;
    cumTPV += tp * c.volume;
    cumVol += c.volume;
    return { time: c.time as UTCTimestamp, value: cumVol > 0 ? cumTPV / cumVol : c.close };
  });
}

// ─── Trading Chart ────────────────────────────────────────────────────────────

interface ChartProps {
  candles: Candle[];
  entry?: number; stop?: number; target?: number;
  interval: string;
  onIntervalChange: (i: string) => void;
}

const INTERVALS = ['1m', '5m', '15m', '1h', '1d'];

function TradingChart({ candles, entry, stop, target, interval, onIntervalChange }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const candleRef    = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volRef       = useRef<ISeriesApi<'Histogram'> | null>(null);
  const vwapRef      = useRef<ISeriesApi<'Line'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const chart = createChart(el, {
      width: el.clientWidth, height: 340,
      layout: { background: { color: '#09090b' }, textColor: '#71717a' },
      grid: { vertLines: { color: '#18181b' }, horzLines: { color: '#18181b' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#27272a' },
      timeScale: { borderColor: '#27272a', timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    const cSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    });
    candleRef.current = cSeries;

    const vSeries = chart.addSeries(HistogramSeries, {
      color: '#3f3f46', priceFormat: { type: 'volume' }, priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.83, bottom: 0 } });
    volRef.current = vSeries;

    // VWAP line — amber/gold, always visible, no extra price line
    const wapSeries = chart.addSeries(LineSeries, {
      color: '#f59e0b',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
    });
    vwapRef.current = wapSeries;

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; vwapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!candleRef.current || !volRef.current || !candles.length) return;
    const cd: CandlestickData[] = candles.map(c => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close }));
    const vd: HistogramData[]   = candles.map(c => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? '#16a34a40' : '#dc262640' }));
    candleRef.current.setData(cd);
    volRef.current.setData(vd);

    // Update VWAP — only for intraday intervals
    const vwapData = calcVWAP(candles, interval);
    if (vwapData && vwapRef.current) {
      vwapRef.current.setData(vwapData as LineData[]);
    } else if (!vwapData && vwapRef.current) {
      vwapRef.current.setData([]);
    }

    chartRef.current?.timeScale().fitContent();
  }, [candles, interval]);

  useEffect(() => {
    if (!candleRef.current) return;
    try {
      if (entry  != null) candleRef.current.createPriceLine({ price: entry,  color: '#3b82f6', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `Entry ${fmt$(entry)}`   });
      if (stop   != null) candleRef.current.createPriceLine({ price: stop,   color: '#ef4444', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `Stop ${fmt$(stop)}`     });
      if (target != null) candleRef.current.createPriceLine({ price: target, color: '#22c55e', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `Target ${fmt$(target)}` });
    } catch { /* ignore */ }
  }, [entry, stop, target, candles]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex gap-1">
          {INTERVALS.map(iv => (
            <button key={iv} onClick={() => onIntervalChange(iv)}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-semibold transition-all ${interval === iv ? 'bg-zinc-700 text-zinc-100 shadow' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'}`}>
              {iv}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-zinc-600">
          <span className="flex items-center gap-1.5"><span className="inline-block w-5 border-t border-dashed border-blue-500/70" />Entry</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-5 border-t border-dashed border-red-500/70" />Stop</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-5 border-t border-dashed border-emerald-500/70" />Target</span>
          {interval !== '1d' && <span className="flex items-center gap-1.5"><span className="inline-block w-5 border-t border-amber-400/70" />VWAP</span>}
        </div>
      </div>
      <div ref={containerRef} className="rounded-xl overflow-hidden border border-zinc-800/60" />
    </div>
  );
}

// ─── Position Sizer ───────────────────────────────────────────────────────────

interface SizerProps { prefill?: { entry: number; stop: number; target: number } }

function LabeledInput({ label, accent, hint, value, onChange, step = '0.01', min }: {
  label: string; accent: string; hint: string; value: string;
  onChange: (v: string) => void; step?: string; min?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label className={`text-xs font-semibold ${accent}`}>{label}</label>
        <span className="text-[10px] text-zinc-600">{hint}</span>
      </div>
      <input
        type="number" value={value} step={step} min={min}
        onChange={e => onChange(e.target.value)}
        className="input-field font-mono text-sm w-full"
        placeholder="0.00"
      />
    </div>
  );
}

function PositionSizer({ prefill }: SizerProps) {
  const [entry,   setEntry]   = useState(prefill?.entry?.toFixed(2)  ?? '');
  const [stop,    setStop]    = useState(prefill?.stop?.toFixed(2)   ?? '');
  const [target,  setTarget]  = useState(prefill?.target?.toFixed(2) ?? '');
  const [account, setAccount] = useState('100');
  const [riskPct, setRiskPct] = useState('2');

  useEffect(() => {
    if (!prefill) return;
    setEntry(prefill.entry.toFixed(2));
    setStop(prefill.stop.toFixed(2));
    setTarget(prefill.target.toFixed(2));
  }, [prefill?.entry, prefill?.stop, prefill?.target]);

  const result = useMemo(() => {
    const e = parseFloat(entry), s = parseFloat(stop), t = parseFloat(target);
    const acc = parseFloat(account), rp = parseFloat(riskPct);
    if (!e || !s || !acc || !rp || s >= e) return null;
    const riskPerShare = e - s;
    const maxRisk      = acc * (rp / 100);
    const shares       = Math.floor(maxRisk / riskPerShare);
    const posVal       = shares * e;
    const rrRatio      = t > e ? (t - e) / riskPerShare : 0;
    const profit       = t > e && shares > 0 ? (t - e) * shares : 0;
    const actualLoss   = riskPerShare * shares;
    const minAcct      = riskPerShare / (rp / 100);
    return { riskPerShare, maxRisk, shares, posVal, rrRatio, profit, actualLoss, minAcct };
  }, [entry, stop, target, account, riskPct]);

  return (
    <div className="card p-5 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-zinc-200">Position Sizer</h3>
        <p className="text-xs text-zinc-600 mt-0.5">Calculates exactly how many shares to buy based on your risk tolerance.</p>
      </div>

      <div className="space-y-3">
        <p className="text-[10px] uppercase tracking-widest font-semibold text-zinc-700">Step 1 — Trade Levels</p>
        <LabeledInput label="Entry Price ($)"  accent="text-blue-400"    hint="price you buy at"            value={entry}  onChange={setEntry} />
        <LabeledInput label="Stop Loss ($)"    accent="text-red-400"     hint="exit if price drops to here" value={stop}   onChange={setStop} />
        <LabeledInput label="Target Price ($)" accent="text-emerald-400" hint="take profits here"           value={target} onChange={setTarget} />
      </div>

      <div className="space-y-3">
        <p className="text-[10px] uppercase tracking-widest font-semibold text-zinc-700">Step 2 — Your Account</p>
        <LabeledInput label="Account Size ($)"   accent="text-zinc-400" hint="your total trading capital"       value={account} onChange={setAccount} />
        <LabeledInput label="Risk Per Trade (%)" accent="text-amber-400" hint="1–2% is standard for beginners" value={riskPct} onChange={setRiskPct} step="0.5" min="0.5" />
      </div>

      <div className="border-t border-zinc-800 pt-4">
        {!result ? (
          <p className="text-xs text-zinc-700 text-center py-2">Fill in all fields above to see your trade size.</p>
        ) : result.shares === 0 ? (
          <div className="rounded-xl bg-amber-500/8 border border-amber-500/20 p-4 space-y-2">
            <p className="text-sm font-semibold text-amber-400">Account too small for 1 share</p>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Your max risk is <span className="text-zinc-200 font-mono">{fmt$(result.maxRisk)}</span>, but
              the risk per share is <span className="text-zinc-200 font-mono">{fmt$(result.riskPerShare)}</span>.
              You'd need at least <span className="text-zinc-200 font-mono">${Math.ceil(result.minAcct)}</span> to take 1 share safely.
            </p>
            <p className="text-[11px] text-zinc-600 mt-1">
              Consider paper trading (simulated, no real money) to practice until your account grows.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-widest font-semibold text-zinc-700">Result</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Shares to Buy',  value: result.shares.toString(),                          color: 'text-zinc-100' },
                { label: 'Position Size',  value: fmt$(result.posVal),                               color: 'text-zinc-100' },
                { label: 'Max Loss',       value: fmt$(result.actualLoss),                            color: 'text-red-400',      sub: 'if stop hits' },
                { label: 'Target Profit',  value: result.profit > 0 ? fmt$(result.profit) : '—',     color: 'text-emerald-400',  sub: 'if target hits' },
              ].map(({ label, value, color, sub }) => (
                <div key={label} className="bg-zinc-800/50 rounded-xl p-3">
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">{label}</p>
                  <p className={`font-mono text-base font-bold ${color}`}>{value}</p>
                  {sub && <p className="text-[10px] text-zinc-700 mt-0.5">{sub}</p>}
                </div>
              ))}
            </div>
            <div className={`rounded-xl p-4 border ${result.rrRatio >= 2 ? 'bg-emerald-500/8 border-emerald-500/20' : 'bg-red-500/8 border-red-500/20'}`}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-0.5">Risk : Reward</p>
                  <p className={`font-mono text-2xl font-bold ${result.rrRatio >= 2 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {result.rrRatio.toFixed(1)} : 1
                  </p>
                </div>
                <span className={`text-xs font-bold px-3 py-1.5 rounded-lg ${result.rrRatio >= 2 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                  {result.rrRatio >= 2 ? '✓ TAKE IT' : '✗ SKIP IT'}
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 leading-snug">
                {result.rrRatio >= 2
                  ? `For every $1 you risk, you stand to make $${result.rrRatio.toFixed(1)}. This is a good trade.`
                  : `Target is too close. Move it to at least ${fmt$(parseFloat(entry) + 2 * result.riskPerShare)} for a 2:1 ratio.`}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DayTrading() {
  const { token } = useAuth();

  const [pick,        setPick]        = useState<Awaited<ReturnType<typeof import('../lib/api').generateDTPick>> | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [candles,     setCandles]     = useState<Candle[]>([]);
  const [interval,    setInterval_]   = useState('5m');
  const [candleErr,   setCandleErr]   = useState('');

  const marketOpen = isMarketOpen();
  const top        = pick?.top as DTTopPick | null | undefined;
  const isWatchlist = pick?.mode === 'watchlist';
  const rrRatio    = top ? (top.target - top.entry) / (top.entry - top.stop) : 0;
  const prefill    = top ? { entry: top.entry, stop: top.stop, target: top.target } : undefined;

  const loadPick = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError('');
    try {
      const data = await generateDTPick(token);
      setPick(data);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load setup');
    } finally { setLoading(false); }
  }, [token]);

  const loadCandles = useCallback(async (sym: string, iv: string) => {
    if (!token || !sym) return;
    setCandleErr('');
    try { setCandles(await fetchCandles(token, sym, iv)); }
    catch { setCandleErr('Chart data unavailable'); }
  }, [token]);

  useEffect(() => { loadPick(); }, [loadPick]);
  useEffect(() => { if (top?.symbol) loadCandles(top.symbol, interval); }, [top?.symbol, interval, loadCandles]);
  useEffect(() => {
    const ttl = interval === '1m' ? 60 : interval === '5m' ? 300 : 600;
    const t1 = setInterval(loadPick, 15 * 60 * 1000);
    const t2 = setInterval(() => { if (top?.symbol) loadCandles(top.symbol, interval); }, ttl * 1000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [loadPick, loadCandles, top?.symbol, interval]);

  const handleIntervalChange = (iv: string) => { setInterval_(iv); setCandles([]); };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 animate-fade-in space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Zap size={16} className="text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">Day Trading</h1>
            <p className="text-xs text-zinc-600">Live algorithm · auto-refreshes every 15 min</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium ${marketOpen ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-zinc-500 bg-zinc-800/80 border-zinc-700/60'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${marketOpen ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
            {marketOpen ? 'Market Open' : 'Market Closed'}
          </div>
          <button onClick={loadPick} disabled={loading}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 px-3 py-1.5 rounded-full border border-zinc-800 hover:border-zinc-700 transition-all disabled:opacity-40">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="card p-4 border-red-500/20 bg-red-500/5 flex items-center gap-3">
          <AlertCircle size={15} className="text-red-400 shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && !pick && (
        <div className="space-y-4 animate-pulse">
          <div className="card p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-8 bg-zinc-800 rounded w-24" />
              <div className="h-6 bg-zinc-800 rounded w-16" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[0,1,2].map(i => <div key={i} className="h-24 bg-zinc-800 rounded-xl" />)}
            </div>
            <div className="grid grid-cols-2 gap-4 pt-2">
              <div className="h-16 bg-zinc-800 rounded-xl" />
              <div className="h-16 bg-zinc-800 rounded-xl" />
            </div>
          </div>
          <div className="h-80 bg-zinc-800/60 rounded-2xl" />
        </div>
      )}

      {/* ── No setup / market closed ── */}
      {!loading && pick && !pick.top && (
        <div className="card p-12 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-zinc-800/80 flex items-center justify-center mx-auto">
            <Activity size={26} className="text-zinc-600" />
          </div>
          <div>
            <p className="text-zinc-200 font-semibold text-lg">
              {marketOpen ? 'No Active Setups Right Now' : 'Market Is Closed'}
            </p>
            <p className="text-zinc-600 text-sm mt-1 max-w-sm mx-auto leading-relaxed">
              {pick.message ?? (marketOpen
                ? 'No stocks meet the quality threshold right now. Markets may be low-volatility. Check back soon.'
                : 'Markets are closed. Live setups appear Mon–Fri 9:30 AM – 4:00 PM ET.')}
            </p>
          </div>
          {lastUpdated && (
            <p className="text-xs text-zinc-700 flex items-center justify-center gap-1.5">
              <Clock size={10} />Last checked {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>
      )}

      {/* ── Main trade signal ── */}
      {top && (
        <>
          {/* Watchlist banner */}
          {isWatchlist && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-800/60 border border-zinc-700/40 text-xs text-zinc-500">
              <Clock size={11} />
              <span>Market closed — showing yesterday's best setup for planning. Levels refresh when market opens.</span>
            </div>
          )}

          {/* Trade signal card */}
          <div className="rounded-2xl border border-zinc-700/50 bg-zinc-900/80 p-6 space-y-5">

            {/* Symbol + price */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <span className="font-mono text-4xl font-bold tracking-tight text-zinc-100">{top.symbol}</span>
                  <span className={`flex items-center gap-1 text-sm font-semibold px-2.5 py-1 rounded-full font-mono ${top.dp >= 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                    {top.dp >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    {top.dp >= 0 ? '+' : ''}{top.dp.toFixed(2)}%
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${top.score >= 60 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}>
                    Score {top.score}/100
                  </span>
                </div>
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-2xl font-semibold text-zinc-200">{fmt$(top.c)}</span>
                  <span className={`text-sm font-mono ${top.d >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {top.d >= 0 ? '+' : ''}{fmt$(top.d)} today
                  </span>
                </div>
              </div>
              <div className="text-right text-xs space-y-1.5">
                <div>
                  <p className="text-zinc-700 mb-0.5">Day range</p>
                  <p className="font-mono text-zinc-400">{fmt$(top.l)} – {fmt$(top.h)}</p>
                </div>
                <div>
                  <p className="text-zinc-700 mb-0.5">Gap at open</p>
                  <p className={`font-mono ${top.gap >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {top.gap >= 0 ? '+' : ''}{top.gap.toFixed(2)}%
                  </p>
                </div>
                {lastUpdated && (
                  <p className="text-zinc-700 flex items-center justify-end gap-1 pt-1">
                    <Clock size={9} />{lastUpdated.toLocaleTimeString()}
                  </p>
                )}
              </div>
            </div>

            {/* Entry / Stop / Target */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'ENTRY',     sub: 'Buy at this price',       value: fmt$(top.entry),  color: 'text-blue-400',    border: 'border-blue-500/20',    bg: 'bg-blue-500/8'    },
                { label: 'STOP LOSS', sub: 'Cut loss if price drops',  value: fmt$(top.stop),   color: 'text-red-400',     border: 'border-red-500/20',     bg: 'bg-red-500/8'     },
                { label: 'TARGET',    sub: 'Take profits here',        value: fmt$(top.target), color: 'text-emerald-400', border: 'border-emerald-500/20', bg: 'bg-emerald-500/8' },
              ].map(({ label, sub, value, color, border, bg }) => (
                <div key={label} className={`rounded-xl border ${border} ${bg} p-4 text-center`}>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 mb-2">{label}</p>
                  <p className={`font-mono text-xl font-bold ${color}`}>{value}</p>
                  <p className="text-[10px] text-zinc-600 mt-2 leading-snug">{sub}</p>
                </div>
              ))}
            </div>

            {/* R:R + ATR summary row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 py-1 border-t border-zinc-800/60 pt-3">
              <div className={`flex items-center gap-2 text-sm font-semibold ${rrRatio >= 2 ? 'text-emerald-400' : 'text-amber-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${rrRatio >= 2 ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                {rrRatio.toFixed(1)}:1 Risk/Reward
                <span className={`text-[10px] font-normal ${rrRatio >= 2 ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {rrRatio >= 2 ? '— good' : '— below ideal (2:1 min)'}
                </span>
              </div>
              <span className="text-zinc-700 hidden sm:inline">·</span>
              <span className="text-xs text-zinc-600">ATR <span className="font-mono text-zinc-300 ml-1">{fmt$(top.atr)}</span></span>
              <span className="text-zinc-700 hidden sm:inline">·</span>
              <span className="text-xs text-zinc-600">ATR = avg daily move per share</span>
            </div>

            {/* RSI + Volume gauges */}
            <div className="grid grid-cols-2 gap-6 pt-1">
              <RSIBar value={top.rsi} />
              <VolBar ratio={top.volRatio} />
            </div>
          </div>

          {/* Chart */}
          <div className="card p-4">
            {candleErr ? (
              <div className="h-72 flex flex-col items-center justify-center gap-2 text-zinc-600 text-sm">
                <BarChart2 size={22} className="text-zinc-700" />
                {candleErr}
              </div>
            ) : candles.length === 0 ? (
              <div className="animate-pulse bg-zinc-900/60 rounded-xl" style={{ height: 340 }} />
            ) : (
              <TradingChart
                candles={candles}
                entry={top.entry} stop={top.stop} target={top.target}
                interval={interval} onIntervalChange={handleIntervalChange}
              />
            )}
          </div>

          {/* AI analysis */}
          {pick?.ai_setup && (
            <div className="card p-5">
              <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-2 flex items-center gap-1.5">
                <Activity size={10} />Setup Analysis
              </p>
              <p className="text-sm text-zinc-300 leading-relaxed">{pick.ai_setup}</p>
            </div>
          )}
        </>
      )}

      {/* ── Bottom grid: Position Sizer + Candidates/Rules ── */}
      <div className="grid lg:grid-cols-2 gap-5">

        <PositionSizer prefill={prefill} />

        <div className="space-y-4">

          {/* Other setups / watchlist */}
          <div>
            <p className="text-[10px] uppercase tracking-widest font-semibold text-zinc-600 mb-2">
              {isWatchlist ? 'Watchlist — Stocks to Monitor' : 'Other Setups Today'}
            </p>
            {pick?.candidates && pick.candidates.length > (top ? 1 : 0) ? (
              <div className="card divide-y divide-zinc-800/50">
                {(pick.candidates as DTCandidate[]).slice(top ? 1 : 0, 7).map(c => {
                  const zone = rsiZone(c.rsi);
                  return (
                    <div key={c.symbol} className="px-4 py-3.5 flex items-center justify-between hover:bg-zinc-800/20 transition-colors">
                      <div>
                        <span className="font-mono text-sm font-bold text-zinc-200">{c.symbol}</span>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-[11px] font-mono font-semibold ${zone.textColor}`}>RSI {c.rsi}</span>
                          <span className="text-zinc-700 text-[10px]">·</span>
                          <span className="text-[11px] text-zinc-500">{c.volRatio.toFixed(1)}× vol</span>
                          <span className="text-zinc-700 text-[10px]">·</span>
                          <span className={`text-[11px] font-semibold ${c.score >= 55 ? 'text-emerald-400' : c.score >= 35 ? 'text-amber-400' : 'text-zinc-600'}`}>
                            {c.score}/100
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-sm text-zinc-300">{fmt$(c.c)}</p>
                        <p className={`font-mono text-xs font-semibold mt-0.5 ${c.dp >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {c.dp >= 0 ? '+' : ''}{c.dp.toFixed(2)}%
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="card p-8 text-center text-zinc-600 text-sm">
                {loading ? 'Loading...' : 'No additional setups found.'}
              </div>
            )}
          </div>

          {/* Rules */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Shield size={13} className="text-zinc-600" />
              <p className="text-[10px] uppercase tracking-widest font-semibold text-zinc-600">Rules — Never Break These</p>
            </div>
            <div className="space-y-3">
              {[
                { rule: 'No confirmed setup = no trade.',      detail: 'Only take what the algorithm flags. Patience is an edge.' },
                { rule: 'Risk max 2% per trade.',              detail: 'The position sizer tells you exactly how many shares.' },
                { rule: 'Cut losses at stop. Always.',         detail: 'No averaging down. No hoping it recovers. Get out.' },
                { rule: 'Exit at target or trail your stop.',  detail: "Don't hold past your target hoping for more." },
                { rule: 'Max 2 trades per day.',               detail: 'Overtrading is the #1 account killer.' },
                { rule: 'Skip the first 15 min of open.',      detail: '9:30–9:45 AM ET is chaotic noise. Let it settle.' },
              ].map(({ rule, detail }, i) => (
                <div key={i} className="flex gap-3">
                  <span className="text-[11px] font-mono text-zinc-700 mt-0.5 shrink-0 w-4">{i + 1}.</span>
                  <div>
                    <p className="text-xs font-semibold text-zinc-300">{rule}</p>
                    <p className="text-[11px] text-zinc-600 mt-0.5 leading-snug">{detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
