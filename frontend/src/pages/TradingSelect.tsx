import { useNavigate } from 'react-router-dom';
import { TrendingUp, Zap, ChevronRight, ArrowLeft } from 'lucide-react';

export default function TradingSelect() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-16 animate-fade-in">
      <div className="w-full max-w-2xl">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 text-sm mb-10 transition-colors"
        >
          <ArrowLeft size={16} />
          Back
        </button>

        <div className="text-center mb-12">
          <h1 className="text-3xl font-semibold text-zinc-100 mb-3">What type of trading?</h1>
          <p className="text-zinc-500 text-sm">Choose your timeframe and strategy.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <button
            onClick={() => navigate('/trading/long-term')}
            className="card p-8 text-left group hover:border-zinc-600 transition-all duration-200 hover:bg-zinc-800/50"
          >
            <div className="flex items-start justify-between mb-6">
              <div className="p-3 bg-zinc-800 rounded-xl group-hover:bg-zinc-700 transition-colors">
                <TrendingUp size={22} className="text-emerald-400" />
              </div>
              <ChevronRight size={18} className="text-zinc-600 group-hover:text-zinc-400 transition-colors mt-1" />
            </div>
            <h2 className="text-lg font-semibold text-zinc-100 mb-2">Long-Term Investing</h2>
            <p className="text-sm text-zinc-500 leading-relaxed">
              Find fundamentally strong companies with durable moats. Hold for years, not days.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {['Moat', 'FCF', 'Earnings Growth', 'Valuation'].map(tag => (
                <span key={tag} className="text-xs bg-zinc-800 text-zinc-400 px-2 py-1 rounded">{tag}</span>
              ))}
            </div>
          </button>

          <button
            onClick={() => navigate('/trading/day')}
            className="card p-8 text-left group hover:border-zinc-600 transition-all duration-200 hover:bg-zinc-800/50"
          >
            <div className="flex items-start justify-between mb-6">
              <div className="p-3 bg-zinc-800 rounded-xl group-hover:bg-zinc-700 transition-colors">
                <Zap size={22} className="text-amber-400" />
              </div>
              <ChevronRight size={18} className="text-zinc-600 group-hover:text-zinc-400 transition-colors mt-1" />
            </div>
            <h2 className="text-lg font-semibold text-zinc-100 mb-2">Day Trading</h2>
            <p className="text-sm text-zinc-500 leading-relaxed">
              Technical setups with defined entry, stop, and target. No setup means no trade.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {['VWAP', 'Volume', 'R:R Calc', 'Momentum'].map(tag => (
                <span key={tag} className="text-xs bg-zinc-800 text-zinc-400 px-2 py-1 rounded">{tag}</span>
              ))}
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
