import { useState } from 'react';
import { Search, TrendingUp, AlertCircle, CheckCircle, XCircle, MinusCircle, Info } from 'lucide-react';

interface ScoreDimension {
  label: string;
  score: number;
  commentary: string;
}

interface StockAnalysis {
  ticker: string;
  company: string;
  sector: string;
  rating: 'STRONG BUY' | 'WATCHLIST' | 'HOLD' | 'OVERVALUED' | 'RISKY' | 'PASS';
  overallScore: number;
  summary: string;
  dimensions: ScoreDimension[];
}

const SAMPLE_DATA: Record<string, StockAnalysis> = {
  AAPL: {
    ticker: 'AAPL', company: 'Apple Inc.', sector: 'Technology',
    rating: 'WATCHLIST', overallScore: 72,
    summary: 'Apple has an exceptionally durable moat through its ecosystem and brand. Revenue growth has moderated but services segment continues expanding. Valuation is stretched at current levels — wait for a pullback.',
    dimensions: [
      { label: 'Moat', score: 95, commentary: 'Extremely durable ecosystem lock-in; switching costs are very high.' },
      { label: 'Revenue Growth', score: 60, commentary: 'Growth has slowed to mid-single digits as hardware saturates.' },
      { label: 'Earnings Growth', score: 70, commentary: 'EPS growth supported by buybacks; Services improving margins.' },
      { label: 'Free Cash Flow', score: 92, commentary: 'FCF yield is exceptional. One of the strongest cash generators globally.' },
      { label: 'Valuation', score: 40, commentary: 'Trading at ~28x forward earnings. Premium is justified but limits upside.' },
      { label: 'Debt Level', score: 78, commentary: 'Leverage is manageable; strong balance sheet despite buyback program.' },
      { label: 'Profit Margin', score: 88, commentary: 'Net margins ~25%. Services segment significantly expands profitability.' },
      { label: 'Risk', score: 68, commentary: 'China concentration, regulatory scrutiny, and hardware dependence are key risks.' },
    ],
  },
  MSFT: {
    ticker: 'MSFT', company: 'Microsoft Corp.', sector: 'Technology',
    rating: 'STRONG BUY', overallScore: 88,
    summary: 'Microsoft is one of the strongest long-term compounders available. Azure growth, Office 365 pricing power, and AI integration create a formidable position. Valuation is full but justified by quality.',
    dimensions: [
      { label: 'Moat', score: 97, commentary: 'Enterprise lock-in across cloud, productivity, and developer tools is unparalleled.' },
      { label: 'Revenue Growth', score: 82, commentary: 'Azure growing ~30% YoY. Total revenue growing 15-18%.' },
      { label: 'Earnings Growth', score: 85, commentary: 'Consistent double-digit EPS growth. Margin expansion ongoing.' },
      { label: 'Free Cash Flow', score: 91, commentary: 'FCF margin above 35%. Capital-light model at scale.' },
      { label: 'Valuation', score: 55, commentary: 'Trading at ~33x forward earnings. Premium warranted given quality.' },
      { label: 'Debt Level', score: 85, commentary: 'Net cash positive. Conservative balance sheet management.' },
      { label: 'Profit Margin', score: 92, commentary: 'Operating margins ~45% and expanding with AI monetization.' },
      { label: 'Risk', score: 82, commentary: 'Regulatory risk is the primary concern. Antitrust scrutiny globally.' },
    ],
  },
  TSLA: {
    ticker: 'TSLA', company: 'Tesla Inc.', sector: 'Automotive / Technology',
    rating: 'RISKY', overallScore: 38,
    summary: 'Tesla has first-mover advantages in EVs but faces intensifying competition, margin compression, and execution risk on new products. Valuation implies perfection across every future bet.',
    dimensions: [
      { label: 'Moat', score: 55, commentary: 'Brand and supercharger network are real but eroding as competitors invest heavily.' },
      { label: 'Revenue Growth', score: 48, commentary: 'Growth has decelerated sharply as EV demand plateaus.' },
      { label: 'Earnings Growth', score: 30, commentary: 'Earnings declining due to aggressive price cuts to maintain volume.' },
      { label: 'Free Cash Flow', score: 42, commentary: 'FCF has compressed significantly. Heavy capex continues.' },
      { label: 'Valuation', score: 15, commentary: 'Trading at 80x+ forward earnings. Priced for robotaxis, FSD, and Optimus — none certain.' },
      { label: 'Debt Level', score: 72, commentary: 'Balance sheet is clean. Not a concern.' },
      { label: 'Profit Margin', score: 38, commentary: 'Gross margins declining as ASP falls. Needs volume to compensate.' },
      { label: 'Risk', score: 25, commentary: 'Elon distraction, competitive pressure from BYD, and macroeconomic sensitivity.' },
    ],
  },
  META: {
    ticker: 'META', company: 'Meta Platforms Inc.', sector: 'Technology',
    rating: 'STRONG BUY', overallScore: 82,
    summary: 'Meta has rebuilt its advertising engine with remarkable efficiency. Reality Labs losses remain high but core social platforms generate exceptional cash flow. Undervalued relative to quality.',
    dimensions: [
      { label: 'Moat', score: 88, commentary: 'Network effects across Facebook, Instagram, and WhatsApp are deeply entrenched.' },
      { label: 'Revenue Growth', score: 80, commentary: 'Ad revenue regrowing 20%+ YoY after 2022 reset.' },
      { label: 'Earnings Growth', score: 90, commentary: 'Year of Efficiency restructuring drove massive EPS expansion.' },
      { label: 'Free Cash Flow', score: 85, commentary: 'FCF yield ~3-4% at current prices. Very strong for a growth company.' },
      { label: 'Valuation', score: 72, commentary: 'Trading at ~22x forward earnings — reasonable given growth trajectory.' },
      { label: 'Debt Level', score: 88, commentary: 'Net cash position. No leverage concerns.' },
      { label: 'Profit Margin', score: 82, commentary: 'Operating margins recovered to ~40%. Structural improvement sustained.' },
      { label: 'Risk', score: 60, commentary: 'Regulatory risk in EU/US, AI competition, Reality Labs ongoing losses.' },
    ],
  },
};

function ratingConfig(rating: StockAnalysis['rating']) {
  const cfg = {
    'STRONG BUY': { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle },
    'WATCHLIST': { color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', icon: MinusCircle },
    'HOLD': { color: 'text-zinc-400', bg: 'bg-zinc-800 border-zinc-700', icon: MinusCircle },
    'OVERVALUED': { color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', icon: AlertCircle },
    'RISKY': { color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', icon: XCircle },
    'PASS': { color: 'text-zinc-500', bg: 'bg-zinc-800 border-zinc-700', icon: XCircle },
  };
  return cfg[rating];
}

function scoreColor(score: number) {
  if (score >= 75) return 'text-emerald-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-red-400';
}

function scoreBarColor(score: number) {
  if (score >= 75) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}

export default function LongTermInvesting() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<StockAnalysis | null>(null);
  const [notFound, setNotFound] = useState(false);

  function handleSearch() {
    const ticker = query.trim().toUpperCase();
    if (!ticker) return;
    const data = SAMPLE_DATA[ticker];
    if (data) {
      setResult(data);
      setNotFound(false);
    } else {
      setResult(null);
      setNotFound(true);
    }
  }

  const cfg = result ? ratingConfig(result.rating) : null;
  const Icon = cfg?.icon ?? MinusCircle;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 animate-fade-in">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <TrendingUp size={20} className="text-emerald-400" />
          <h1 className="text-xl font-semibold text-zinc-100">Long-Term Investing</h1>
        </div>
        <p className="text-sm text-zinc-500 ml-8">
          Focus on durable fundamentals. Ignore short-term noise. Buy and hold quality.
        </p>
      </div>

      <div className="card p-4 mb-6 flex items-center gap-3 border-zinc-700/50 bg-emerald-500/5">
        <Info size={15} className="text-emerald-400 shrink-0" />
        <p className="text-xs text-zinc-400">
          Try: <button onClick={() => { setQuery('AAPL'); }} className="text-emerald-400 hover:underline">AAPL</button>,{' '}
          <button onClick={() => { setQuery('MSFT'); }} className="text-emerald-400 hover:underline">MSFT</button>,{' '}
          <button onClick={() => { setQuery('META'); }} className="text-emerald-400 hover:underline">META</button>,{' '}
          <button onClick={() => { setQuery('TSLA'); }} className="text-emerald-400 hover:underline">TSLA</button>
          {' '}— live data integration coming in Phase 2.
        </p>
      </div>

      <div className="flex gap-3 mb-8">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Enter ticker symbol (e.g. AAPL)"
            className="input-field pl-10"
            spellCheck={false}
          />
        </div>
        <button onClick={handleSearch} className="btn-primary px-6">
          Analyze
        </button>
      </div>

      {notFound && (
        <div className="card p-6 text-center">
          <p className="text-zinc-400 mb-1">No data for <span className="text-zinc-100 font-mono">{query}</span></p>
          <p className="text-zinc-600 text-sm">Live stock API integration is coming in Phase 2.</p>
        </div>
      )}

      {result && cfg && (
        <div className="space-y-5 animate-slide-up">
          <div className="card p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="font-mono text-2xl font-medium text-zinc-100">{result.ticker}</p>
                <p className="text-zinc-400 text-sm">{result.company}</p>
                <p className="text-zinc-600 text-xs mt-0.5">{result.sector}</p>
              </div>
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-semibold ${cfg.bg} ${cfg.color}`}>
                <Icon size={15} />
                {result.rating}
              </div>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 bg-zinc-800 rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${scoreBarColor(result.overallScore)} transition-all duration-500`}
                  style={{ width: `${result.overallScore}%` }}
                />
              </div>
              <span className={`font-mono font-medium text-sm ${scoreColor(result.overallScore)}`}>
                {result.overallScore}/100
              </span>
            </div>

            <p className="text-sm text-zinc-400 leading-relaxed">{result.summary}</p>
          </div>

          <div className="card divide-y divide-zinc-800">
            <div className="px-6 py-3">
              <p className="section-header mb-0">Factor Breakdown</p>
            </div>
            {result.dimensions.map(dim => (
              <div key={dim.label} className="px-6 py-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-zinc-300">{dim.label}</span>
                  <span className={`font-mono text-sm font-medium ${scoreColor(dim.score)}`}>{dim.score}</span>
                </div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="flex-1 bg-zinc-800 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full ${scoreBarColor(dim.score)} transition-all duration-500`}
                      style={{ width: `${dim.score}%` }}
                    />
                  </div>
                </div>
                <p className="text-xs text-zinc-500">{dim.commentary}</p>
              </div>
            ))}
          </div>

          <div className="card p-5 border-zinc-700/50 bg-zinc-900/50">
            <p className="text-xs text-zinc-600 leading-relaxed text-center">
              Scores are based on sample data. Phase 2 will integrate live fundamental data via stock API.
              This tool supports decision-making — it does not replace your own research.
            </p>
          </div>
        </div>
      )}

      {!result && !notFound && (
        <div className="space-y-4">
          <p className="section-header">Investment Philosophy</p>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              { title: 'Buy Strong Businesses', body: 'Focus on companies with durable competitive advantages, not just cheap stocks.' },
              { title: 'Be Patient', body: 'The best investments require holding through short-term volatility. Think in years, not quarters.' },
              { title: 'Valuation Matters', body: 'Even great businesses can be poor investments if you overpay. Wait for the right price.' },
              { title: 'Diversify Deliberately', body: 'Spread across uncorrelated sectors. Concentration increases risk without guaranteed return.' },
            ].map(item => (
              <div key={item.title} className="card p-5">
                <h3 className="text-sm font-semibold text-zinc-200 mb-2">{item.title}</h3>
                <p className="text-xs text-zinc-500 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
