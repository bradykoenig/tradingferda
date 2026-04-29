import { useState, useMemo } from 'react';
import { Zap, AlertTriangle, Calculator, TrendingUp, TrendingDown } from 'lucide-react';

interface WatchlistItem {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  volume: string;
  rvol: number;
  catalyst: string;
  setup: string | null;
}

const WATCHLIST: WatchlistItem[] = [
  { ticker: 'NVDA', price: 127.45, change: 4.23, changePercent: 3.43, volume: '48.2M', rvol: 2.1, catalyst: 'Earnings beat + AI spend upgrade', setup: 'Breakout above prior high, high RVOL, VWAP support' },
  { ticker: 'AMD', price: 158.90, change: -2.45, changePercent: -1.52, volume: '22.1M', rvol: 1.4, catalyst: 'Sector sympathy with NVDA', setup: null },
  { ticker: 'MSTR', price: 312.00, change: 18.50, changePercent: 6.30, volume: '8.4M', rvol: 3.8, catalyst: 'BTC breakout above $70k', setup: 'Gap and go setup off open, extreme RVOL' },
  { ticker: 'COIN', price: 220.15, change: 9.80, changePercent: 4.66, volume: '12.3M', rvol: 2.6, catalyst: 'Crypto momentum', setup: null },
];

interface CalcInputs {
  entry: string;
  stop: string;
  target: string;
  accountSize: string;
  riskPct: string;
}

function calcResults(inputs: CalcInputs) {
  const entry = parseFloat(inputs.entry);
  const stop = parseFloat(inputs.stop);
  const target = parseFloat(inputs.target);
  const account = parseFloat(inputs.accountSize);
  const riskPct = parseFloat(inputs.riskPct);

  if (!entry || !stop || !target || !account || !riskPct) return null;
  if (stop >= entry) return null;
  if (target <= entry) return null;

  const riskPerShare = entry - stop;
  const maxLoss = account * (riskPct / 100);
  const shares = Math.floor(maxLoss / riskPerShare);
  const positionValue = shares * entry;
  const reward = (target - entry) * shares;
  const rrRatio = (target - entry) / riskPerShare;

  return { riskPerShare, maxLoss, shares, positionValue, reward, rrRatio };
}

function fmt(n: number, prefix = '$', decimals = 2) {
  return `${prefix}${n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export default function DayTrading() {
  const [calc, setCalc] = useState<CalcInputs>({
    entry: '', stop: '', target: '', accountSize: '50000', riskPct: '1',
  });

  const results = useMemo(() => calcResults(calc), [calc]);

  function setField(field: keyof CalcInputs, value: string) {
    setCalc(prev => ({ ...prev, [field]: value }));
  }

  const validSetups = WATCHLIST.filter(w => w.setup !== null);
  const watching = WATCHLIST.filter(w => w.setup === null);

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 animate-fade-in">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <Zap size={20} className="text-amber-400" />
          <h1 className="text-xl font-semibold text-zinc-100">Day Trading</h1>
        </div>
        <p className="text-sm text-zinc-500 ml-8">
          Only enter with a defined setup, clear stop, and minimum 2:1 reward-to-risk.
        </p>
      </div>

      <div className="card p-4 mb-8 flex items-center gap-3 border-amber-500/20 bg-amber-500/5">
        <AlertTriangle size={15} className="text-amber-400 shrink-0" />
        <p className="text-xs text-zinc-400">
          <span className="text-amber-400 font-medium">No setup = No trade.</span>{' '}
          Do not chase. Do not enter without a defined exit. Displaying sample watchlist data — live integration coming in Phase 2.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        <div>
          <p className="section-header">Active Setups</p>
          {validSetups.length === 0 ? (
            <div className="card p-6 text-center">
              <p className="text-zinc-500 text-sm">No qualified setups right now.</p>
              <p className="text-zinc-600 text-xs mt-1">Wait for price action to confirm.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {validSetups.map(item => (
                <div key={item.ticker} className="card p-4 border-emerald-500/20 bg-emerald-500/5">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <span className="font-mono font-semibold text-zinc-100">{item.ticker}</span>
                      <span className={`ml-3 text-sm font-mono ${item.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {item.change >= 0 ? '+' : ''}{item.changePercent.toFixed(2)}%
                      </span>
                    </div>
                    <span className="badge-green">SETUP</span>
                  </div>
                  <p className="text-xs text-zinc-500 mb-2">{item.catalyst}</p>
                  <p className="text-xs text-zinc-400 bg-zinc-800 rounded px-2 py-1.5">{item.setup}</p>
                  <div className="flex gap-4 mt-3">
                    <span className="text-xs text-zinc-500">Vol: <span className="text-zinc-300">{item.volume}</span></span>
                    <span className="text-xs text-zinc-500">RVOL: <span className={item.rvol >= 2 ? 'text-emerald-400' : 'text-zinc-300'}>{item.rvol}x</span></span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {watching.length > 0 && (
            <div className="mt-4">
              <p className="section-header">Watching (No Setup Yet)</p>
              <div className="space-y-2">
                {watching.map(item => (
                  <div key={item.ticker} className="card p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-medium text-zinc-200">{item.ticker}</span>
                        <span className={`text-xs font-mono ${item.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {item.change >= 0 ? '+' : ''}{item.changePercent.toFixed(2)}%
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-zinc-500">
                        <span>RVOL {item.rvol}x</span>
                        {item.change >= 0 ? <TrendingUp size={14} className="text-emerald-400" /> : <TrendingDown size={14} className="text-red-400" />}
                      </div>
                    </div>
                    <p className="text-xs text-zinc-600 mt-1">{item.catalyst}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <p className="section-header flex items-center gap-2">
            <Calculator size={13} />
            Risk Calculator
          </p>
          <div className="card p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-zinc-500 uppercase tracking-wider mb-1.5">Entry Price</label>
                <input
                  type="number"
                  value={calc.entry}
                  onChange={e => setField('entry', e.target.value)}
                  className="input-field font-mono"
                  placeholder="0.00"
                  step="0.01"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 uppercase tracking-wider mb-1.5">Stop Loss</label>
                <input
                  type="number"
                  value={calc.stop}
                  onChange={e => setField('stop', e.target.value)}
                  className="input-field font-mono"
                  placeholder="0.00"
                  step="0.01"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 uppercase tracking-wider mb-1.5">Target Price</label>
                <input
                  type="number"
                  value={calc.target}
                  onChange={e => setField('target', e.target.value)}
                  className="input-field font-mono"
                  placeholder="0.00"
                  step="0.01"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 uppercase tracking-wider mb-1.5">Account Size</label>
                <input
                  type="number"
                  value={calc.accountSize}
                  onChange={e => setField('accountSize', e.target.value)}
                  className="input-field font-mono"
                  placeholder="50000"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-zinc-500 uppercase tracking-wider mb-1.5">Risk Per Trade (%)</label>
                <input
                  type="number"
                  value={calc.riskPct}
                  onChange={e => setField('riskPct', e.target.value)}
                  className="input-field font-mono"
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
                    <p className="stat-label mb-1">Shares</p>
                    <p className="stat-value text-xl">{results.shares.toLocaleString()}</p>
                  </div>
                  <div className="bg-zinc-800 rounded-lg p-3">
                    <p className="stat-label mb-1">Position Size</p>
                    <p className="stat-value text-xl">{fmt(results.positionValue)}</p>
                  </div>
                  <div className="bg-zinc-800 rounded-lg p-3">
                    <p className="stat-label mb-1">Max Loss</p>
                    <p className="stat-value text-xl text-red-400">{fmt(results.maxLoss)}</p>
                  </div>
                  <div className="bg-zinc-800 rounded-lg p-3">
                    <p className="stat-label mb-1">Target Profit</p>
                    <p className="stat-value text-xl text-emerald-400">{fmt(results.reward)}</p>
                  </div>
                </div>

                <div className={`rounded-lg p-4 flex items-center justify-between ${results.rrRatio >= 2 ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
                  <div>
                    <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Reward : Risk</p>
                    <p className={`font-mono text-2xl font-semibold ${results.rrRatio >= 2 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {results.rrRatio.toFixed(2)} : 1
                    </p>
                  </div>
                  <div className={`text-sm font-semibold ${results.rrRatio >= 2 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {results.rrRatio >= 2 ? '✓ VALID' : '✗ SKIP'}
                  </div>
                </div>

                {results.rrRatio < 2 && (
                  <p className="text-xs text-red-400 text-center">
                    R:R below 2:1 — do not take this trade. Adjust target or find a better entry.
                  </p>
                )}
              </div>
            )}

            {!results && (calc.entry || calc.stop || calc.target) && (
              <p className="text-xs text-zinc-600 text-center">
                Entry must be above stop. Target must be above entry.
              </p>
            )}
          </div>

          <div className="card p-4 mt-4 border-zinc-700/50">
            <p className="section-header mb-3">Day Trading Rules</p>
            <ul className="space-y-2">
              {[
                'Never enter without a defined stop loss.',
                'Minimum 2:1 reward-to-risk on every trade.',
                'No chasing. If you missed the entry, pass.',
                'Do not hold and hope. Honor your stop.',
                'High RVOL + clean chart pattern = valid setup.',
              ].map(rule => (
                <li key={rule} className="flex items-start gap-2 text-xs text-zinc-500">
                  <span className="text-amber-400 mt-0.5 shrink-0">·</span>
                  {rule}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
