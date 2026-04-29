import { useState } from 'react';
import { Search, TrendingUp, Sparkles, AlertCircle, ChevronUp, ChevronDown } from 'lucide-react';
import { fetchStockMetrics, generateLTPick, StockData } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(s: number) {
  return s >= 70 ? 'text-emerald-400' : s >= 50 ? 'text-amber-400' : 'text-red-400';
}

function scoreBarColor(s: number) {
  return s >= 70 ? 'bg-emerald-500' : s >= 50 ? 'bg-amber-500' : 'bg-red-500';
}

function ratingStyle(r: string) {
  const map: Record<string, string> = {
    'STRONG BUY': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    'WATCHLIST':  'bg-amber-500/10 text-amber-400 border-amber-500/20',
    'HOLD':       'bg-zinc-800 text-zinc-400 border-zinc-700',
    'OVERVALUED': 'bg-red-500/10 text-red-400 border-red-500/20',
    'RISKY':      'bg-red-500/10 text-red-400 border-red-500/20',
    'PASS':       'bg-zinc-800 text-zinc-600 border-zinc-700',
  };
  return map[r] ?? 'bg-zinc-800 text-zinc-400 border-zinc-700';
}

function fmt$(n: number | null | undefined) {
  if (n == null) return '—';
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null | undefined, decimals = 1) {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`;
}

function fmtNum(n: number | null | undefined, decimals = 1) {
  if (n == null) return '—';
  return n.toFixed(decimals);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreCard({ data }: { data: StockData }) {
  const { ticker, quote, profile, scoring, rating, metrics: m } = data;
  const changePos = quote.dp >= 0;

  return (
    <div className="space-y-4 animate-slide-up">
      {/* Header */}
      <div className="card p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="font-mono text-2xl font-semibold text-zinc-100">{ticker}</span>
              <span className={`flex items-center gap-1 text-sm font-mono ${changePos ? 'text-emerald-400' : 'text-red-400'}`}>
                {changePos ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {fmtPct(quote.dp)}
              </span>
            </div>
            <p className="text-zinc-400 text-sm">{profile.name}</p>
            <p className="text-zinc-600 text-xs mt-0.5">{profile.finnhubIndustry}</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-2xl font-semibold text-zinc-100">{fmt$(quote.c)}</p>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${ratingStyle(rating)}`}>
              {rating}
            </span>
          </div>
        </div>

        {/* Score bar */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 bg-zinc-800 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-700 ${scoreBarColor(scoring.overall)}`}
              style={{ width: `${scoring.overall}%` }}
            />
          </div>
          <span className={`font-mono text-sm font-semibold ${scoreColor(scoring.overall)}`}>
            {scoring.overall}/100
          </span>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { label: 'P/E', value: fmtNum(m['peExclExtraTTM'] ?? m['peBasicExclExtraTTM']) },
            { label: 'Rev Growth', value: fmtPct(m['revenueGrowth3Y'] ?? m['revenueGrowthTTMYoy']) },
            { label: 'Net Margin', value: fmtPct(m['netMarginTTM'] ?? m['netMarginAnnual']) },
            { label: 'D/E Ratio', value: fmtNum(m['totalDebt/totalEquityAnnual']) },
          ].map(({ label, value }) => (
            <div key={label} className="bg-zinc-800 rounded-lg p-2.5">
              <p className="text-xs text-zinc-600 uppercase tracking-wider mb-1">{label}</p>
              <p className="font-mono text-sm font-medium text-zinc-200">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Factor breakdown */}
      <div className="card divide-y divide-zinc-800">
        <div className="px-5 py-3">
          <p className="text-xs text-zinc-600 uppercase tracking-widest font-semibold">Factor Breakdown</p>
        </div>
        {Object.entries(scoring.dims).map(([label, score]) => (
          <div key={label} className="px-5 py-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm text-zinc-300">{label}</span>
              <span className={`font-mono text-sm font-medium ${scoreColor(score)}`}>{score}</span>
            </div>
            <div className="w-full bg-zinc-800 rounded-full h-1.5">
              <div className={`h-1.5 rounded-full ${scoreBarColor(score)}`} style={{ width: `${score}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function LongTermInvesting() {
  const { token } = useAuth();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<StockData | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');

  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<{ data: StockData; thesis: string; topThree: StockData[] } | null>(null);
  const [genErr, setGenErr] = useState('');

  async function handleSearch() {
    const sym = query.trim().toUpperCase();
    if (!sym || !token) return;
    setSearching(true); setSearchErr(''); setResult(null);
    try {
      const data = await fetchStockMetrics(token, sym);
      setResult(data);
      setGenerated(null);
    } catch (e) {
      setSearchErr(e instanceof Error ? e.message : 'Failed to fetch');
    } finally { setSearching(false); }
  }

  async function handleGenerate() {
    if (!token) return;
    setGenerating(true); setGenErr(''); setResult(null); setGenerated(null);
    try {
      const pick = await generateLTPick(token);
      setGenerated({ data: pick.top, thesis: pick.ai_thesis, topThree: pick.topThree });
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : 'Failed to generate');
    } finally { setGenerating(false); }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 animate-fade-in">

      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <TrendingUp size={20} className="text-emerald-400" />
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Long-Term Investing</h1>
          <p className="text-xs text-zinc-600">Fundamental analysis · Buy and hold quality</p>
        </div>
      </div>

      {/* Search + Generate */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Ticker symbol (e.g. MSFT)"
            className="input-field pl-9 font-mono"
            spellCheck={false}
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={searching || !query.trim()}
          className="btn-primary px-5 text-sm"
        >
          {searching ? (
            <span className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-zinc-700 border-t-zinc-900 rounded-full animate-spin" />
              Loading
            </span>
          ) : 'Analyze'}
        </button>
      </div>

      <button
        onClick={handleGenerate}
        disabled={generating}
        className="w-full mb-8 flex items-center justify-center gap-2 py-3 rounded-lg border border-zinc-700 bg-zinc-900 text-sm font-medium text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors disabled:opacity-40"
      >
        <Sparkles size={15} className="text-violet-400" />
        {generating ? 'Scanning 20 quality stocks...' : 'Generate Long-Term Pick'}
      </button>

      {/* Errors */}
      {searchErr && (
        <div className="card p-4 mb-5 border-red-500/20 bg-red-500/5 flex items-center gap-2">
          <AlertCircle size={15} className="text-red-400 shrink-0" />
          <p className="text-sm text-red-400">{searchErr}</p>
        </div>
      )}
      {genErr && (
        <div className="card p-4 mb-5 border-red-500/20 bg-red-500/5 flex items-center gap-2">
          <AlertCircle size={15} className="text-red-400 shrink-0" />
          <p className="text-sm text-red-400">{genErr.includes('not configured') ? 'Add FINNHUB_API_KEY to your worker secrets.' : genErr}</p>
        </div>
      )}

      {/* Manual search result */}
      {result && <ScoreCard data={result} />}

      {/* AI-generated pick */}
      {generated && (
        <div className="space-y-4 animate-slide-up">
          {/* Banner */}
          <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 px-5 py-3 flex items-center gap-2">
            <Sparkles size={14} className="text-violet-400 shrink-0" />
            <p className="text-xs text-zinc-400">
              Scanned {generated.topThree.length > 0 ? '20' : ''} quality stocks · Highest fundamental score
            </p>
          </div>

          <ScoreCard data={generated.data} />

          {/* AI thesis */}
          {generated.thesis && (
            <div className="card p-5 border-violet-500/20 bg-violet-500/5">
              <p className="text-xs text-zinc-600 uppercase tracking-widest mb-3">AI Analysis</p>
              <p className="text-sm text-zinc-300 leading-relaxed">{generated.thesis}</p>
            </div>
          )}

          {/* Other top picks */}
          {generated.topThree.length > 1 && (
            <div className="card divide-y divide-zinc-800">
              <div className="px-5 py-3">
                <p className="text-xs text-zinc-600 uppercase tracking-widest font-semibold">Also Scoring Well</p>
              </div>
              {generated.topThree.slice(1).map(s => (
                <div key={s.ticker} className="px-5 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-medium text-zinc-200">{s.ticker}</span>
                    <span className="text-xs text-zinc-500">{s.profile.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-semibold ${scoreColor(s.scoring.overall)}`}>{s.scoring.overall}/100</span>
                    <span className={`text-xs px-2 py-0.5 rounded border ${ratingStyle(s.rating)}`}>{s.rating}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!result && !generated && !searching && !generating && !searchErr && !genErr && (
        <div className="card p-8 text-center">
          <TrendingUp size={28} className="text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-500 text-sm mb-1">Search a ticker or generate a pick</p>
          <p className="text-zinc-700 text-xs">Live data via Finnhub · Scored across 8 fundamental factors</p>
        </div>
      )}
    </div>
  );
}
