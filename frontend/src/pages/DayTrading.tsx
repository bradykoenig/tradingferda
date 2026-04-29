import { useState, useEffect, useMemo } from 'react';
import { Zap, RefreshCw, Sparkles, Calculator, AlertCircle, ChevronUp, ChevronDown, TrendingUp, TrendingDown } from 'lucide-react';
import { fetchStockQuotes, generateDTPick, DTQuote, GeneratedDTPick } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

// ─── Constants ────────────────────────────────────────────────────────────────

const WATCHLIST_SYMBOLS = ['NVDA','AMD','TSLA','COIN','MSTR','PLTR','SOFI','SMCI','NFLX','SHOP','RIVN','UPST','GME','HOOD','SQ'];

// ─── Risk calculator ──────────────────────────────────────────────────────────

interface CalcState { entry: string; stop: string; target: string; account: string; riskPct: string }

function calcResults(s: CalcState) {
  const entry = parseFloat(s.entry), stop = parseFloat(s.stop);
  const target = parseFloat(s.target), account = parseFloat(s.account);
  const riskPct = parseFloat(s.riskPct);
  if (!entry || !stop || !target || !account || !riskPct) return null;
  if (stop >= entry || target <= entry) return null;
  const riskPerShare = entry - stop;
  const maxLoss = account * (riskPct / 100);
  const shares = Math.floor(maxLoss / riskPerShare);
  const posVal = shares * entry;
  const reward = (target - entry) * shares;
  const rrRatio = (target - entry) / riskPerShare;
  return { riskPerShare, maxLoss, shares, posVal, reward, rrRatio };
}

function fmt$(n: number) { return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

// ─── Main component ───────────────────────────────────────────────────────────

export default function DayTrading() {
  const { token } = useAuth();

  const [quotes, setQuotes]       = useState<DTQuote[]>([]);
  const [loadingQ, setLoadingQ]   = useState(false);
  const [quoteErr, setQuoteErr]   = useState('');

  const [generated, setGenerated] = useState<GeneratedDTPick | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genErr, setGenErr]       = useState('');

  const [calc, setCalc] = useState<CalcState>({
    entry: '', stop: '', target: '', account: '50000', riskPct: '1',
  });

  const results = useMemo(() => calcResults(calc), [calc]);

  useEffect(() => { loadQuotes(); }, []);

  async function loadQuotes() {
    if (!token) return;
    setLoadingQ(true); setQuoteErr('');
    try {
      const data = await fetchStockQuotes(token, WATCHLIST_SYMBOLS);
      setQuotes(data.sort((a, b) => Math.abs(b.dp) - Math.abs(a.dp)));
    } catch (e) {
      setQuoteErr(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoadingQ(false); }
  }

  async function handleGenerate() {
    if (!token) return;
    setGenerating(true); setGenErr(''); setGenerated(null);
    try {
      const pick = await generateDTPick(token);
      setGenerated(pick);
      if (pick.top) {
        setCalc(prev => ({
          ...prev,
          entry: pick.top!.entry.toFixed(2),
          stop: pick.top!.stop.toFixed(2),
          target: pick.top!.target.toFixed(2),
        }));
      }
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : 'Failed to generate');
    } finally { setGenerating(false); }
  }

  function setField(k: keyof CalcState, v: string) {
    setCalc(prev => ({ ...prev, [k]: v }));
  }

  const movers = quotes.filter(q => Math.abs(q.dp) > 0.5);

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Zap size={20} className="text-amber-400" />
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">Day Trading</h1>
            <p className="text-xs text-zinc-600">No setup = no trade · Live data via Finnhub</p>
          </div>
        </div>
        <button
          onClick={loadQuotes}
          disabled={loadingQ}
          className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <RefreshCw size={13} className={loadingQ ? 'animate-spin' : ''} />
          {loadingQ ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={generating}
        className="w-full mb-8 flex items-center justify-center gap-2 py-3.5 rounded-xl border border-zinc-700 bg-zinc-900 text-sm font-medium text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors disabled:opacity-40"
      >
        <Sparkles size={15} className="text-amber-400" />
        {generating ? 'Scanning for setups...' : 'Find Today\'s Setup'}
      </button>

      {/* Errors */}
      {(quoteErr || genErr) && (
        <div className="card p-4 mb-6 border-red-500/20 bg-red-500/5 flex items-center gap-2">
          <AlertCircle size={15} className="text-red-400 shrink-0" />
          <p className="text-sm text-red-400">
            {(quoteErr || genErr).includes('not configured') ? 'Add FINNHUB_API_KEY to your worker secrets.' : (quoteErr || genErr)}
          </p>
        </div>
      )}

      {/* Generated setup */}
      {generated && (
        <div className="mb-8 space-y-3 animate-slide-up">
          {generated.top ? (
            <>
              <div className="rounded-xl border border-amber-500/25 bg-gradient-to-br from-amber-500/5 to-transparent p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Sparkles size={14} className="text-amber-400" />
                    <span className="text-xs text-zinc-500 uppercase tracking-wider">Generated Setup</span>
                  </div>
                  <span className={`flex items-center gap-1 font-mono text-sm font-semibold ${generated.top.dp >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {generated.top.dp >= 0 ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {generated.top.dp >= 0 ? '+' : ''}{generated.top.dp.toFixed(2)}%
                  </span>
                </div>

                <div className="flex items-baseline gap-3 mb-4">
                  <span className="font-mono text-3xl font-semibold text-zinc-100">{generated.top.symbol}</span>
                  <span className="font-mono text-xl text-zinc-400">${generated.top.c.toFixed(2)}</span>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { label: 'ENTRY', value: `$${generated.top.entry.toFixed(2)}`, color: 'text-zinc-100' },
                    { label: 'STOP', value: `$${generated.top.stop.toFixed(2)}`, color: 'text-red-400' },
                    { label: 'TARGET', value: `$${generated.top.target.toFixed(2)}`, color: 'text-emerald-400' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-zinc-900 rounded-lg p-3 text-center">
                      <p className="text-xs text-zinc-600 uppercase tracking-wider mb-1">{label}</p>
                      <p className={`font-mono font-semibold ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>

                <p className="text-xs text-zinc-600">
                  Day range: ${generated.top.l.toFixed(2)} – ${generated.top.h.toFixed(2)} ·
                  R:R {((generated.top.target - generated.top.entry) / (generated.top.entry - generated.top.stop)).toFixed(1)}:1
                </p>
              </div>

              {generated.ai_setup && (
                <div className="card p-4 border-zinc-700/50">
                  <p className="text-xs text-zinc-600 uppercase tracking-widest mb-2">Setup Analysis</p>
                  <p className="text-sm text-zinc-300 leading-relaxed">{generated.ai_setup}</p>
                </div>
              )}
            </>
          ) : (
            <div className="card p-6 text-center">
              <p className="text-zinc-400 text-sm mb-1">No active setups right now</p>
              <p className="text-zinc-600 text-xs">{generated.message}</p>
            </div>
          )}

          {generated.candidates.length > 1 && (
            <div className="card divide-y divide-zinc-800">
              <div className="px-5 py-3">
                <p className="text-xs text-zinc-600 uppercase tracking-widest font-semibold">Other Movers</p>
              </div>
              {generated.candidates.slice(1).map(c => (
                <div key={c.symbol} className="px-5 py-3 flex items-center justify-between">
                  <span className="font-mono text-sm font-medium text-zinc-200">{c.symbol}</span>
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-sm text-zinc-400">${c.c.toFixed(2)}</span>
                    <span className={`font-mono text-sm ${c.dp >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {c.dp >= 0 ? '+' : ''}{c.dp.toFixed(2)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">

        {/* Live watchlist */}
        <div>
          <p className="text-xs text-zinc-600 uppercase tracking-widest font-semibold mb-3">Live Watchlist</p>
          {loadingQ ? (
            <div className="space-y-2">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="card p-4 animate-pulse">
                  <div className="h-4 bg-zinc-800 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : movers.length > 0 ? (
            <div className="card divide-y divide-zinc-800">
              {movers.map(q => (
                <div key={q.symbol} className="px-4 py-3 flex items-center justify-between hover:bg-zinc-800/30 transition-colors">
                  <div>
                    <span className="font-mono text-sm font-semibold text-zinc-200">{q.symbol}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-sm text-zinc-400">${q.c.toFixed(2)}</span>
                    <div className={`flex items-center gap-1 font-mono text-sm font-medium ${q.dp >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {q.dp >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {q.dp >= 0 ? '+' : ''}{q.dp.toFixed(2)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card p-8 text-center text-zinc-600 text-sm">
              {quoteErr ? 'Failed to load.' : 'No significant movers right now.'}
            </div>
          )}
        </div>

        {/* Risk calculator */}
        <div>
          <p className="text-xs text-zinc-600 uppercase tracking-widest font-semibold mb-3 flex items-center gap-2">
            <Calculator size={12} />
            Risk Calculator
          </p>
          <div className="card p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {([
                { key: 'entry', label: 'Entry' },
                { key: 'stop', label: 'Stop Loss' },
                { key: 'target', label: 'Target' },
                { key: 'account', label: 'Account ($)' },
              ] as { key: keyof CalcState; label: string }[]).map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-xs text-zinc-600 uppercase tracking-wider mb-1.5">{label}</label>
                  <input
                    type="number"
                    value={calc[key]}
                    onChange={e => setField(key, e.target.value)}
                    className="input-field font-mono text-sm"
                    placeholder="0.00"
                    step="0.01"
                  />
                </div>
              ))}
              <div className="col-span-2">
                <label className="block text-xs text-zinc-600 uppercase tracking-wider mb-1.5">Risk %</label>
                <input
                  type="number"
                  value={calc.riskPct}
                  onChange={e => setField('riskPct', e.target.value)}
                  className="input-field font-mono text-sm"
                  placeholder="1"
                  step="0.1"
                  max="5"
                />
              </div>
            </div>

            {results && (
              <div className="border-t border-zinc-800 pt-4 space-y-3 animate-slide-up">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-zinc-800 rounded-lg p-3">
                    <p className="text-xs text-zinc-600 uppercase tracking-wider mb-1">Shares</p>
                    <p className="font-mono text-lg font-semibold text-zinc-100">{results.shares.toLocaleString()}</p>
                  </div>
                  <div className="bg-zinc-800 rounded-lg p-3">
                    <p className="text-xs text-zinc-600 uppercase tracking-wider mb-1">Position</p>
                    <p className="font-mono text-lg font-semibold text-zinc-100">{fmt$(results.posVal)}</p>
                  </div>
                  <div className="bg-zinc-800 rounded-lg p-3">
                    <p className="text-xs text-zinc-600 uppercase tracking-wider mb-1">Max Loss</p>
                    <p className="font-mono text-lg font-semibold text-red-400">{fmt$(results.maxLoss)}</p>
                  </div>
                  <div className="bg-zinc-800 rounded-lg p-3">
                    <p className="text-xs text-zinc-600 uppercase tracking-wider mb-1">Target Profit</p>
                    <p className="font-mono text-lg font-semibold text-emerald-400">{fmt$(results.reward)}</p>
                  </div>
                </div>

                <div className={`rounded-lg p-4 flex items-center justify-between border ${results.rrRatio >= 2 ? 'bg-emerald-500/8 border-emerald-500/20' : 'bg-red-500/8 border-red-500/20'}`}>
                  <div>
                    <p className="text-xs text-zinc-600 uppercase tracking-wider mb-1">R : R</p>
                    <p className={`font-mono text-2xl font-semibold ${results.rrRatio >= 2 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {results.rrRatio.toFixed(2)} : 1
                    </p>
                  </div>
                  <span className={`text-sm font-semibold ${results.rrRatio >= 2 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {results.rrRatio >= 2 ? '✓ VALID' : '✗ SKIP'}
                  </span>
                </div>
                {results.rrRatio < 2 && (
                  <p className="text-xs text-red-400 text-center">Below 2:1. Adjust target or find a better entry.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
