import { useState, useEffect, useMemo } from 'react';
import { Activity, RefreshCw, DollarSign, TrendingUp, Ban, AlertCircle, Star } from 'lucide-react';
import { fetchOdds, GameOdds } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BookLine { book: string; odds: number }

interface Play {
  gameId: string; sport: string; homeTeam: string; awayTeam: string;
  commenceTime: string; side: string; bestBook: string; bestOdds: number;
  impliedProb: number; fairProb: number; edge: number; books: BookLine[];
  units: 0.25 | 0.5 | 1;
}

interface Reject {
  gameId: string; sport: string; homeTeam: string; awayTeam: string;
  commenceTime: string; homeML: string; awayML: string; reason: string;
}

type Tab = 'plays' | 'no-bets' | 'bankroll';

interface Bankroll { starting: number; current: number; unit: number; wins: number; losses: number; pushes: number }

const SPORTS = [
  { key: 'basketball_nba', label: 'NBA' },
  { key: 'baseball_mlb', label: 'MLB' },
  { key: 'icehockey_nhl', label: 'NHL' },
  { key: 'americanfootball_nfl', label: 'NFL' },
];

const SPORT_COLOR: Record<string, string> = {
  basketball_nba: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  baseball_mlb:   'text-red-400 bg-red-500/10 border-red-500/20',
  icehockey_nhl:  'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  americanfootball_nfl: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
};

const BANKROLL_KEY = 'schlima_bankroll_v2';
const EDGE_MIN = 0.035;

// ─── Math helpers ────────────────────────────────────────────────────────────

function imp(odds: number) {
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function noVig(a: number, b: number): [number, number] {
  const ia = imp(a), ib = imp(b), t = ia + ib;
  return [ia / t, ib / t];
}

function fmtOdds(n: number) { return n > 0 ? `+${n}` : `${n}`; }
function pct(n: number)     { return `${(n * 100).toFixed(1)}%`; }

function fmtTime(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const isToday = d.toDateString() === today.toDateString();
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const day = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}

// ─── Processing ──────────────────────────────────────────────────────────────

function processGames(games: GameOdds[]): { plays: Play[]; rejects: Reject[] } {
  const plays: Play[] = [];
  const rejects: Reject[] = [];
  const now = new Date();

  for (const g of games) {
    if (new Date(g.commence_time) <= now) continue;

    const homeLines: BookLine[] = [];
    const awayLines: BookLine[] = [];

    for (const bm of g.bookmakers) {
      const h2h = bm.markets.find(m => m.key === 'h2h');
      if (!h2h) continue;
      const ho = h2h.outcomes.find(o => o.name === g.home_team);
      const ao = h2h.outcomes.find(o => o.name === g.away_team);
      if (ho && ao) {
        homeLines.push({ book: bm.title, odds: ho.price });
        awayLines.push({ book: bm.title, odds: ao.price });
      }
    }

    if (homeLines.length < 2) {
      rejects.push({
        gameId: g.id, sport: g.sport_title, homeTeam: g.home_team, awayTeam: g.away_team,
        commenceTime: g.commence_time, homeML: '—', awayML: '—',
        reason: 'Not enough books. Need at least 2 lines to calculate edge.',
      });
      continue;
    }

    let sumFH = 0, sumFA = 0;
    for (let i = 0; i < homeLines.length; i++) {
      const [h, a] = noVig(homeLines[i].odds, awayLines[i].odds);
      sumFH += h; sumFA += a;
    }
    const fairH = sumFH / homeLines.length;
    const fairA = sumFA / awayLines.length;

    const bestH = homeLines.reduce((b, x) => x.odds > b.odds ? x : b);
    const bestA = awayLines.reduce((b, x) => x.odds > b.odds ? x : b);
    const edgeH = fairH - imp(bestH.odds);
    const edgeA = fairA - imp(bestA.odds);

    let found = false;
    for (const [side, edge, best, fairProb, lines] of [
      [g.home_team, edgeH, bestH, fairH, homeLines],
      [g.away_team, edgeA, bestA, fairA, awayLines],
    ] as [string, number, BookLine, number, BookLine[]][]) {
      if (edge >= EDGE_MIN) {
        found = true;
        plays.push({
          gameId: g.id, sport: g.sport_title, homeTeam: g.home_team, awayTeam: g.away_team,
          commenceTime: g.commence_time, side, bestBook: best.book, bestOdds: best.odds,
          impliedProb: imp(best.odds), fairProb, edge,
          books: [...lines].sort((a, b) => b.odds - a.odds),
          units: edge >= 0.06 ? 1 : edge >= 0.045 ? 0.5 : 0.25,
        });
      }
    }

    if (!found) {
      const maxEdge = Math.max(edgeH, edgeA);
      rejects.push({
        gameId: g.id, sport: g.sport_title, homeTeam: g.home_team, awayTeam: g.away_team,
        commenceTime: g.commence_time,
        homeML: fmtOdds(bestH.odds), awayML: fmtOdds(bestA.odds),
        reason: maxEdge > 0
          ? `Best edge: +${(maxEdge * 100).toFixed(1)}% — below the 3.5% threshold.`
          : 'Books are aligned. Vig cancels any detectable edge.',
      });
    }
  }

  return { plays: plays.sort((a, b) => b.edge - a.edge), rejects };
}

// ─── Bankroll helpers ─────────────────────────────────────────────────────────

function loadBankroll(): Bankroll {
  try { return JSON.parse(localStorage.getItem(BANKROLL_KEY) ?? ''); } catch { /**/ }
  return { starting: 1000, current: 1000, unit: 25, wins: 0, losses: 0, pushes: 0 };
}
function saveBankroll(b: Bankroll) { localStorage.setItem(BANKROLL_KEY, JSON.stringify(b)); }

// ─── Sub-components ──────────────────────────────────────────────────────────

function SportBadge({ sportKey, label }: { sportKey: string; label: string }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${SPORT_COLOR[sportKey] ?? 'text-zinc-400 bg-zinc-800 border-zinc-700'}`}>
      {label}
    </span>
  );
}

function EdgeBar({ edge }: { edge: number }) {
  const pct = Math.min(edge / 0.12, 1) * 100;
  return (
    <div className="w-full bg-zinc-800 rounded-full h-1 mt-1">
      <div className="h-1 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400" style={{ width: `${pct}%` }} />
    </div>
  );
}

function PlayCard({ play, unitDollar }: { play: Play; unitDollar: number }) {
  const sportKey = SPORTS.find(s => s.label === play.sport)?.key ?? '';
  return (
    <div className="rounded-xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/5 to-transparent overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between border-b border-zinc-800/60">
        <div className="flex items-center gap-2">
          <SportBadge sportKey={sportKey} label={play.sport} />
          <span className="text-sm text-zinc-400">{play.homeTeam} vs {play.awayTeam}</span>
        </div>
        <span className="text-xs text-zinc-600">{fmtTime(play.commenceTime)}</span>
      </div>

      <div className="px-5 py-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xl font-semibold text-zinc-100">{play.side}</p>
            <p className="text-sm text-zinc-500">Moneyline</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-2xl font-semibold text-emerald-400">{fmtOdds(play.bestOdds)}</p>
            <p className="text-xs text-zinc-500">@ {play.bestBook}</p>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-4">
          {[
            { label: 'FAIR', value: pct(play.fairProb), color: 'text-emerald-400' },
            { label: 'IMPLIED', value: pct(play.impliedProb), color: 'text-zinc-300' },
            { label: 'EDGE', value: `+${pct(play.edge)}`, color: 'text-emerald-400' },
            { label: 'SIZE', value: `${play.units}u`, color: 'text-zinc-300' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-zinc-900 rounded-lg p-2.5 text-center">
              <p className="text-xs text-zinc-600 uppercase tracking-wider mb-1">{label}</p>
              <p className={`font-mono font-semibold text-sm ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        <EdgeBar edge={play.edge} />

        <div className="mt-4 border-t border-zinc-800/60 pt-3 space-y-1.5">
          {play.books.map((b, i) => (
            <div key={b.book} className={`flex items-center justify-between py-1 px-2 rounded ${i === 0 ? 'bg-emerald-500/8 border border-emerald-500/15' : ''}`}>
              <div className="flex items-center gap-2">
                {i === 0 && <Star size={11} className="text-emerald-400 fill-emerald-400" />}
                <span className={`text-sm ${i === 0 ? 'text-zinc-200' : 'text-zinc-500'}`}>{b.book}</span>
              </div>
              <span className={`font-mono text-sm ${i === 0 ? 'text-emerald-400 font-semibold' : 'text-zinc-500'}`}>
                {fmtOdds(b.odds)}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-3 pt-3 border-t border-zinc-800/60 flex items-center justify-between">
          <span className="text-xs text-zinc-600">Recommended</span>
          <span className="text-xs font-mono text-zinc-400">
            {play.units}u = <span className="text-zinc-300">${(play.units * unitDollar).toFixed(0)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function RejectCard({ r }: { r: Reject }) {
  const sportKey = SPORTS.find(s => s.label === r.sport)?.key ?? '';
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <SportBadge sportKey={sportKey} label={r.sport} />
          <span className="text-sm text-zinc-400">{r.homeTeam} vs {r.awayTeam}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-600">
          <span className="font-mono">{r.homeML}</span>
          <span>/</span>
          <span className="font-mono">{r.awayML}</span>
          <span className="badge-red">PASS</span>
        </div>
      </div>
      <p className="text-xs text-zinc-600 flex items-start gap-1.5">
        <Ban size={11} className="mt-0.5 shrink-0 text-zinc-700" />
        {r.reason}
      </p>
      <p className="text-xs text-zinc-700 mt-1">{fmtTime(r.commenceTime)}</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SportsBetting() {
  const { token } = useAuth();
  const [sport, setSport]     = useState('basketball_nba');
  const [tab, setTab]         = useState<Tab>('plays');
  const [rawData, setRawData] = useState<GameOdds[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [bankroll, setBR]     = useState<Bankroll>(loadBankroll);

  useEffect(() => { load(sport); }, [sport]);

  async function load(s: string) {
    if (!token) return;
    setLoading(true); setError(null); setRawData(null);
    try {
      const data = await fetchOdds(token, s);
      setRawData(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch odds');
    } finally {
      setLoading(false);
    }
  }

  function updateBR(updates: Partial<Bankroll>) {
    const next = { ...bankroll, ...updates };
    setBR(next); saveBankroll(next);
  }

  const { plays, rejects } = useMemo(
    () => rawData ? processGames(rawData) : { plays: [], rejects: [] },
    [rawData]
  );

  const profit = bankroll.current - bankroll.starting;
  const roi    = bankroll.starting > 0 ? (profit / bankroll.starting) * 100 : 0;
  const total  = bankroll.wins + bankroll.losses;
  const wr     = total > 0 ? (bankroll.wins / total) * 100 : 0;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Activity size={20} className="text-violet-400" />
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">Sports Betting</h1>
            <p className="text-xs text-zinc-600">Edge ≥ 3.5% threshold · Moneyline only</p>
          </div>
        </div>
        <button
          onClick={() => load(sport)}
          disabled={loading}
          className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Sport selector */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {SPORTS.map(s => (
          <button
            key={s.key}
            onClick={() => setSport(s.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              sport === s.key
                ? 'bg-zinc-800 text-zinc-100 border border-zinc-700'
                : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl mb-8">
        {([
          { id: 'plays' as Tab, label: 'Plays', icon: TrendingUp, count: plays.length },
          { id: 'no-bets' as Tab, label: 'No Bets', icon: Ban, count: rejects.length },
          { id: 'bankroll' as Tab, label: 'Bankroll', icon: DollarSign, count: null },
        ]).map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex-1 justify-center ${
              tab === id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Icon size={14} />
            {label}
            {count !== null && !loading && rawData && (
              <span className={`text-xs rounded-full px-1.5 py-0.5 ${count > 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-600'}`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div className="card p-5 border-red-500/20 bg-red-500/5 flex items-start gap-3 mb-6">
          <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-red-400 font-medium mb-1">
              {error.includes('not configured') ? 'Odds API not set up yet' : 'Failed to load odds'}
            </p>
            <p className="text-xs text-zinc-500">
              {error.includes('not configured')
                ? 'Add your ODDS_API_KEY secret to the Cloudflare Worker. Get a free key at the-odds-api.com'
                : error}
            </p>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 animate-pulse">
              <div className="h-4 bg-zinc-800 rounded w-2/3 mb-3" />
              <div className="h-8 bg-zinc-800 rounded w-1/3 mb-3" />
              <div className="grid grid-cols-4 gap-2">
                {[1,2,3,4].map(j => <div key={j} className="h-12 bg-zinc-800 rounded-lg" />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Plays tab */}
      {!loading && tab === 'plays' && (
        <div className="space-y-4 animate-fade-in">
          {!rawData && !error && (
            <div className="card p-12 text-center text-zinc-600 text-sm">Select a sport to load odds.</div>
          )}
          {rawData && plays.length === 0 && (
            <div className="card p-12 text-center">
              <Ban size={28} className="text-zinc-700 mx-auto mb-3" />
              <p className="text-zinc-400 font-medium mb-1">No plays today</p>
              <p className="text-zinc-600 text-sm">Nothing cleared the 3.5% edge filter. Check back or try another sport.</p>
            </div>
          )}
          {plays.map(p => <PlayCard key={`${p.gameId}-${p.side}`} play={p} unitDollar={bankroll.unit} />)}
        </div>
      )}

      {/* No-bets tab */}
      {!loading && tab === 'no-bets' && (
        <div className="space-y-2 animate-fade-in">
          {rejects.length === 0 && rawData && (
            <div className="card p-8 text-center text-zinc-600 text-sm">No games evaluated yet.</div>
          )}
          {rejects.map(r => <RejectCard key={r.gameId} r={r} />)}
        </div>
      )}

      {/* Bankroll tab */}
      {tab === 'bankroll' && (
        <div className="space-y-5 animate-fade-in">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Bankroll', value: `$${bankroll.current.toLocaleString()}`, color: 'text-zinc-100' },
              { label: 'P&L', value: `${profit >= 0 ? '+' : ''}$${profit.toFixed(0)}`, color: profit >= 0 ? 'text-emerald-400' : 'text-red-400' },
              { label: 'ROI', value: `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`, color: roi >= 0 ? 'text-emerald-400' : 'text-red-400' },
              { label: 'Win Rate', value: `${wr.toFixed(0)}%`, color: 'text-zinc-100' },
            ].map(({ label, value, color }) => (
              <div key={label} className="card p-4">
                <p className="stat-label mb-1">{label}</p>
                <p className={`font-mono text-xl font-medium ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Wins', val: bankroll.wins, color: 'text-emerald-400' },
              { label: 'Losses', val: bankroll.losses, color: 'text-red-400' },
              { label: 'Pushes', val: bankroll.pushes, color: 'text-zinc-400' },
            ].map(({ label, val, color }) => (
              <div key={label} className="card p-4 text-center">
                <p className="stat-label mb-1">{label}</p>
                <p className={`font-mono text-2xl font-medium ${color}`}>{val}</p>
              </div>
            ))}
          </div>

          <div className="card p-5">
            <p className="section-header">Configuration</p>
            <div className="grid md:grid-cols-3 gap-4 mb-5">
              {[
                { label: 'Starting Bankroll', key: 'starting' as keyof Bankroll },
                { label: 'Current Bankroll', key: 'current' as keyof Bankroll },
                { label: '1 Unit ($)', key: 'unit' as keyof Bankroll },
              ].map(({ label, key }) => (
                <div key={key}>
                  <label className="block text-xs text-zinc-500 uppercase tracking-wider mb-1.5">{label}</label>
                  <input
                    type="number"
                    value={bankroll[key] as number}
                    onChange={e => updateBR({ [key]: parseFloat(e.target.value) || 0 })}
                    className="input-field font-mono"
                  />
                </div>
              ))}
            </div>

            <div className="border-t border-zinc-800 pt-4">
              <p className="text-xs text-zinc-600 mb-3">Record a result</p>
              <div className="flex gap-2">
                <button onClick={() => updateBR({ wins: bankroll.wins + 1, current: bankroll.current + bankroll.unit })}
                  className="flex-1 py-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-sm font-medium hover:bg-emerald-500/20 transition-colors">
                  + Win
                </button>
                <button onClick={() => updateBR({ losses: bankroll.losses + 1, current: bankroll.current - bankroll.unit })}
                  className="flex-1 py-2.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 text-sm font-medium hover:bg-red-500/20 transition-colors">
                  − Loss
                </button>
                <button onClick={() => updateBR({ pushes: bankroll.pushes + 1 })}
                  className="flex-1 py-2.5 rounded-lg bg-zinc-800 text-zinc-400 border border-zinc-700 text-sm font-medium hover:bg-zinc-700 transition-colors">
                  Push
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
