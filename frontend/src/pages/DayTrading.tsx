import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createChart, CrosshairMode, LineStyle, IChartApi, ISeriesApi, CandlestickData, HistogramData, UTCTimestamp, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import { Zap, RefreshCw, Calculator, AlertCircle, TrendingUp, TrendingDown, Activity, Clock, BarChart2 } from 'lucide-react';
import { generateDTPick, fetchCandles, GeneratedDTPick, DTTopPick, DTCandidate, Candle } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CalcState { entry: string; stop: string; target: string; account: string; riskPct: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number) { return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtTime(d: Date) { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }); }

function calcResults(s: CalcState) {
  const entry = parseFloat(s.entry), stop = parseFloat(s.stop);
  const target = parseFloat(s.target), account = parseFloat(s.account);
  const riskPct = parseFloat(s.riskPct);
  if (!entry || !stop || !target || !account || !riskPct) return null;
  if (stop >= entry || target <= entry) return null;
  const riskPerShare = entry - stop;
  const maxLoss = account * (riskPct / 100);
  const shares = Math.floor(maxLoss / riskPerShare);
  if (shares < 1) return null;
  const posVal = shares * entry;
  const reward = (target - entry) * shares;
  const rrRatio = (target - entry) / riskPerShare;
  return { riskPerShare, maxLoss, shares, posVal, reward, rrRatio };
}

function isMarketOpen(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const h = et.getHours(), m = et.getMinutes();
  const mins = h * 60 + m;
  return mins >= 570 && mins < 960; // 9:30 AM – 4:00 PM ET
}

function rsiColor(rsi: number) {
  if (rsi >= 70) return 'text-red-400';
  if (rsi <= 30) return 'text-blue-400';
  if (rsi >= 55) return 'text-emerald-400';
  return 'text-zinc-300';
}

// ─── Chart component ──────────────────────────────────────────────────────────

interface ChartProps {
  candles: Candle[];
  entry?: number; stop?: number; target?: number;
  interval: string;
  onIntervalChange: (i: string) => void;
}

const INTERVALS = ['1m', '5m', '15m', '1h', '1d'];

function TradingChart({ candles, entry, stop, target, interval, onIntervalChange }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 320,
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
      color: '#3f3f46',
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volRef.current = vSeries;

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth });
    });
    ro.observe(el);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, []);

  // Update data
  useEffect(() => {
    if (!candleRef.current || !volRef.current || candles.length === 0) return;
    const cd: CandlestickData[] = candles.map(c => ({
      time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close,
    }));
    const vd: HistogramData[] = candles.map(c => ({
      time: c.time as UTCTimestamp, value: c.volume,
      color: c.close >= c.open ? '#16a34a40' : '#dc262640',
    }));
    candleRef.current.setData(cd);
    volRef.current.setData(vd);
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  // Update price lines
  useEffect(() => {
    if (!candleRef.current) return;
    // Remove existing lines by recreating series options (lightweight-charts doesn't expose line removal well — we use applyOptions)
    // Instead, we track via removePriceLine
    try {
      if (entry != null) {
        candleRef.current.createPriceLine({ price: entry, color: '#3b82f6', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `Entry ${fmt$(entry)}` });
      }
      if (stop != null) {
        candleRef.current.createPriceLine({ price: stop, color: '#ef4444', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `Stop ${fmt$(stop)}` });
      }
      if (target != null) {
        candleRef.current.createPriceLine({ price: target, color: '#22c55e', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `Target ${fmt$(target)}` });
      }
    } catch { /* ignore */ }
  }, [entry, stop, target, candles]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex gap-1">
          {INTERVALS.map(iv => (
            <button key={iv} onClick={() => onIntervalChange(iv)}
              className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition-colors ${interval === iv ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
              {iv}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-zinc-600">
          <BarChart2 size={11} />
          <span>Entry <span className="text-blue-400">—</span> · Stop <span className="text-red-400">—</span> · Target <span className="text-emerald-400">—</span></span>
        </div>
      </div>
      <div ref={containerRef} className="rounded-xl overflow-hidden border border-zinc-800" />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DayTrading() {
  const { token } = useAuth();

  const [pick, setPick]           = useState<GeneratedDTPick | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [candles, setCandles]     = useState<Candle[]>([]);
  const [interval, setInterval_]  = useState('5m');
  const [candleErr, setCandleErr] = useState('');

  const [calc, setCalc] = useState<CalcState>({
    entry: '', stop: '', target: '', account: '100', riskPct: '2',
  });

  const results = useMemo(() => calcResults(calc), [calc]);
  const marketOpen = isMarketOpen();

  const top = pick?.top as (DTTopPick | null) | undefined;

  // Load the AI pick analysis (cached 15 min server-side)
  const loadPick = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError('');
    try {
      const data = await generateDTPick(token);
      setPick(data);
      setLastUpdated(new Date());
      if (data.top) {
        setCalc(prev => ({
          ...prev,
          entry:  data.top!.entry.toFixed(2),
          stop:   data.top!.stop.toFixed(2),
          target: data.top!.target.toFixed(2),
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load setup');
    } finally { setLoading(false); }
  }, [token]);

  // Load candle data for chart
  const loadCandles = useCallback(async (sym: string, iv: string) => {
    if (!token || !sym) return;
    setCandleErr('');
    try {
      const data = await fetchCandles(token, sym, iv);
      setCandles(data);
    } catch {
      setCandleErr('Chart data unavailable');
    }
  }, [token]);

  // Initial load
  useEffect(() => { loadPick(); }, [loadPick]);

  // Load candles when symbol or interval changes
  useEffect(() => {
    if (top?.symbol) loadCandles(top.symbol, interval);
  }, [top?.symbol, interval, loadCandles]);

  // Auto-refresh: pick every 15 min, candles based on interval
  useEffect(() => {
    const candleTtl = interval === '1m' ? 60 : interval === '5m' ? 300 : 600;
    const pickInterval = setInterval(loadPick, 15 * 60 * 1000);
    const candleInterval = setInterval(() => {
      if (top?.symbol) loadCandles(top.symbol, interval);
    }, candleTtl * 1000);
    return () => { clearInterval(pickInterval); clearInterval(candleInterval); };
  }, [loadPick, loadCandles, top?.symbol, interval]);

  function setField(k: keyof CalcState, v: string) {
    setCalc(prev => ({ ...prev, [k]: v }));
  }

  const handleIntervalChange = (iv: string) => {
    setInterval_(iv);
    setCandles([]);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 animate-fade-in space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap size={20} className="text-amber-400" />
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">Day Trading</h1>
            <p className="text-xs text-zinc-600">Live algorithm · Auto-refreshes every 15 min</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 text-xs ${marketOpen ? 'text-emerald-400' : 'text-zinc-500'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${marketOpen ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
            {marketOpen ? 'Market Open' : 'Market Closed'}
          </div>
          <button onClick={loadPick} disabled={loading}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="card p-4 border-red-500/20 bg-red-500/5 flex items-center gap-2">
          <AlertCircle size={15} className="text-red-400 shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !pick && (
        <div className="space-y-4">
          <div className="card p-5 animate-pulse space-y-3">
            <div className="h-6 bg-zinc-800 rounded w-1/4" />
            <div className="h-10 bg-zinc-800 rounded w-1/3" />
            <div className="h-64 bg-zinc-800 rounded-xl" />
          </div>
        </div>
      )}

      {/* No setup */}
      {!loading && pick && !pick.top && (
        <div className="card p-10 text-center space-y-2">
          <Activity size={28} className="text-zinc-700 mx-auto" />
          <p className="text-zinc-400 font-medium">No active setups right now</p>
          <p className="text-zinc-600 text-sm">{pick.message ?? 'Markets may be closed or low-volatility. Check back during market hours.'}</p>
        </div>
      )}

      {/* Main setup */}
      {top && (
        <>
          {/* Symbol header */}
          <div className="rounded-xl border border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-transparent p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-mono text-3xl font-bold text-zinc-100">{top.symbol}</span>
                  <span className={`flex items-center gap-1 font-mono text-base font-semibold ${top.dp >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {top.dp >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                    {top.dp >= 0 ? '+' : ''}{top.dp.toFixed(2)}%
                  </span>
                </div>
                <span className="font-mono text-2xl text-zinc-300">{fmt$(top.c)}</span>
              </div>
              <div className="text-right">
                <p className="text-xs text-zinc-600 mb-1 flex items-center gap-1 justify-end">
                  <Clock size={10} />
                  {lastUpdated ? fmtTime(lastUpdated) : '—'}
                </p>
                <p className="text-xs text-zinc-700">Day: {fmt$(top.l)} – {fmt$(top.h)}</p>
                <p className="text-xs text-zinc-700">Gap: {top.gap >= 0 ? '+' : ''}{top.gap.toFixed(2)}%</p>
              </div>
            </div>

            {/* Entry / Stop / Target */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: 'ENTRY',  value: fmt$(top.entry),  color: 'text-blue-400',    border: 'border-blue-500/20',    bg: 'bg-blue-500/5'    },
                { label: 'STOP',   value: fmt$(top.stop),   color: 'text-red-400',     border: 'border-red-500/20',     bg: 'bg-red-500/5'     },
                { label: 'TARGET', value: fmt$(top.target), color: 'text-emerald-400', border: 'border-emerald-500/20', bg: 'bg-emerald-500/5' },
              ].map(({ label, value, color, border, bg }) => (
                <div key={label} className={`rounded-xl border ${border} ${bg} p-3 text-center`}>
                  <p className="text-xs text-zinc-600 uppercase tracking-wider mb-1">{label}</p>
                  <p className={`font-mono text-lg font-semibold ${color}`}>{value}</p>
                </div>
              ))}
            </div>

            {/* Technical badges */}
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'R:R',    value: `${((top.target - top.entry) / (top.entry - top.stop)).toFixed(1)}:1`,  color: 'text-amber-400' },
                { label: 'RSI',    value: top.rsi.toString(), color: rsiColor(top.rsi) },
                { label: 'VOL',    value: `${top.volRatio.toFixed(1)}x avg`,  color: 'text-violet-400' },
                { label: 'ATR',    value: fmt$(top.atr),  color: 'text-zinc-300' },
                { label: 'SCORE',  value: `${top.score}/100`, color: top.score >= 60 ? 'text-emerald-400' : top.score >= 40 ? 'text-amber-400' : 'text-zinc-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 flex items-center gap-2">
                  <span className="text-xs text-zinc-600 uppercase tracking-wider">{label}</span>
                  <span className={`font-mono text-sm font-semibold ${color}`}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Chart */}
          <div className="card p-4">
            {candleErr ? (
              <div className="h-64 flex items-center justify-center text-zinc-600 text-sm">{candleErr}</div>
            ) : candles.length === 0 ? (
              <div className="h-64 flex items-center justify-center">
                <div className="h-64 w-full bg-zinc-900 rounded-xl animate-pulse" />
              </div>
            ) : (
              <TradingChart
                candles={candles}
                entry={top.entry}
                stop={top.stop}
                target={top.target}
                interval={interval}
                onIntervalChange={handleIntervalChange}
              />
            )}
          </div>

          {/* AI analysis */}
          {pick?.ai_setup && (
            <div className="card p-5 border-zinc-700/50">
              <p className="text-xs text-zinc-600 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <Activity size={11} />
                Setup Analysis
              </p>
              <p className="text-sm text-zinc-300 leading-relaxed">{pick.ai_setup}</p>
            </div>
          )}
        </>
      )}

      <div className="grid lg:grid-cols-2 gap-6">

        {/* Risk calculator */}
        <div>
          <p className="text-xs text-zinc-600 uppercase tracking-widest font-semibold mb-3 flex items-center gap-2">
            <Calculator size={12} />
            Position Sizer
          </p>
          <div className="card p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {([
                { key: 'entry',   label: 'Entry ($)'   },
                { key: 'stop',    label: 'Stop Loss ($)'},
                { key: 'target',  label: 'Target ($)'  },
                { key: 'account', label: 'Account ($)' },
              ] as { key: keyof CalcState; label: string }[]).map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-xs text-zinc-600 uppercase tracking-wider mb-1.5">{label}</label>
                  <input type="number" value={calc[key]} onChange={e => setField(key, e.target.value)}
                    className="input-field font-mono text-sm" placeholder="0.00" step="0.01" />
                </div>
              ))}
              <div className="col-span-2">
                <label className="block text-xs text-zinc-600 uppercase tracking-wider mb-1.5">Risk % per trade</label>
                <input type="number" value={calc.riskPct} onChange={e => setField('riskPct', e.target.value)}
                  className="input-field font-mono text-sm" placeholder="2" step="0.5" min="0.5" max="10" />
              </div>
            </div>

            {results ? (
              <div className="border-t border-zinc-800 pt-4 space-y-3 animate-slide-up">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Shares',        value: results.shares.toLocaleString(), color: 'text-zinc-100' },
                    { label: 'Position Size', value: fmt$(results.posVal),            color: 'text-zinc-100' },
                    { label: 'Max Loss',      value: fmt$(results.maxLoss),           color: 'text-red-400'  },
                    { label: 'Target Profit', value: fmt$(results.reward),            color: 'text-emerald-400' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-zinc-800/60 rounded-lg p-3">
                      <p className="text-xs text-zinc-600 uppercase tracking-wider mb-1">{label}</p>
                      <p className={`font-mono text-base font-semibold ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>
                <div className={`rounded-lg p-4 flex items-center justify-between border ${results.rrRatio >= 2 ? 'bg-emerald-500/8 border-emerald-500/20' : 'bg-red-500/8 border-red-500/20'}`}>
                  <div>
                    <p className="text-xs text-zinc-600 uppercase tracking-wider mb-0.5">Risk : Reward</p>
                    <p className={`font-mono text-2xl font-semibold ${results.rrRatio >= 2 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {results.rrRatio.toFixed(2)} : 1
                    </p>
                  </div>
                  <span className={`text-sm font-bold ${results.rrRatio >= 2 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {results.rrRatio >= 2 ? '✓ VALID' : '✗ SKIP'}
                  </span>
                </div>
                {results.rrRatio < 2 && (
                  <p className="text-xs text-red-400 text-center">Minimum 2:1 R:R required. Adjust target or find a tighter entry.</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-zinc-700 text-center pt-2">Fill in all fields to calculate position size.</p>
            )}
          </div>
        </div>

        {/* Other candidates */}
        <div>
          <p className="text-xs text-zinc-600 uppercase tracking-widest font-semibold mb-3">Other Setups Today</p>
          {pick?.candidates && pick.candidates.length > 1 ? (
            <div className="card divide-y divide-zinc-800/60">
              {(pick.candidates as DTCandidate[]).slice(1).map(c => (
                <div key={c.symbol} className="px-4 py-3 flex items-center justify-between hover:bg-zinc-800/20 transition-colors">
                  <div>
                    <span className="font-mono text-sm font-semibold text-zinc-200">{c.symbol}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-zinc-600">RSI {c.rsi}</span>
                      <span className="text-xs text-zinc-600">Vol {c.volRatio.toFixed(1)}x</span>
                      <span className={`text-xs ${c.score >= 60 ? 'text-emerald-400' : 'text-zinc-500'}`}>Score {c.score}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-right">
                    <span className="font-mono text-sm text-zinc-400">{fmt$(c.c)}</span>
                    <span className={`font-mono text-sm font-medium ${c.dp >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {c.dp >= 0 ? '+' : ''}{c.dp.toFixed(2)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card p-8 text-center text-zinc-600 text-sm">
              {pick ? 'No additional setups found today.' : 'Loading...'}
            </div>
          )}

          {/* Trading rules */}
          <div className="mt-4 card p-4 space-y-2">
            <p className="text-xs text-zinc-600 uppercase tracking-widest font-semibold mb-3">Rules — Never Break These</p>
            {[
              'No setup = no trade. Only take confirmed signals.',
              'Never risk more than 2% of account per trade.',
              'Cut losses at stop. No averaging down.',
              'Take target or trail stop — no holding hoping.',
              'Max 2 trades per day. Overtrading kills accounts.',
              'Never trade the first 15 min of market open.',
            ].map((rule, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-xs text-zinc-700 font-mono mt-0.5">{i + 1}.</span>
                <p className="text-xs text-zinc-500">{rule}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
