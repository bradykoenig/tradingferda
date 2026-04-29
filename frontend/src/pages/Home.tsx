import { useNavigate } from 'react-router-dom';
import { TrendingUp, Activity, ChevronRight } from 'lucide-react';

const TODAY = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-16 animate-fade-in">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-12">
          <p className="text-xs text-zinc-600 uppercase tracking-widest mb-3">{TODAY}</p>
          <h1 className="text-3xl font-semibold text-zinc-100 mb-3">What do you want to do today?</h1>
          <p className="text-zinc-500 text-sm">Only act when the edge is clear.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <button
            onClick={() => navigate('/trading')}
            className="card p-8 text-left group hover:border-zinc-600 transition-all duration-200 hover:bg-zinc-800/50"
          >
            <div className="flex items-start justify-between mb-6">
              <div className="p-3 bg-zinc-800 rounded-xl group-hover:bg-zinc-700 transition-colors">
                <TrendingUp size={22} className="text-zinc-300" />
              </div>
              <ChevronRight size={18} className="text-zinc-600 group-hover:text-zinc-400 transition-colors mt-1" />
            </div>
            <h2 className="text-lg font-semibold text-zinc-100 mb-2">Trading</h2>
            <p className="text-sm text-zinc-500 leading-relaxed">
              Long-term fundamental analysis or short-term technical setups with defined risk.
            </p>
          </button>

          <button
            onClick={() => navigate('/sports-betting')}
            className="card p-8 text-left group hover:border-zinc-600 transition-all duration-200 hover:bg-zinc-800/50"
          >
            <div className="flex items-start justify-between mb-6">
              <div className="p-3 bg-zinc-800 rounded-xl group-hover:bg-zinc-700 transition-colors">
                <Activity size={22} className="text-zinc-300" />
              </div>
              <ChevronRight size={18} className="text-zinc-600 group-hover:text-zinc-400 transition-colors mt-1" />
            </div>
            <h2 className="text-lg font-semibold text-zinc-100 mb-2">Sports Betting</h2>
            <p className="text-sm text-zinc-500 leading-relaxed">
              Strict edge detection. Only bet when the data shows a clear positive expected value.
            </p>
          </button>
        </div>

      </div>
    </div>
  );
}
