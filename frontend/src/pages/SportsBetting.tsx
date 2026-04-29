import { useState, useEffect, useMemo } from 'react';
import { Activity, RefreshCw, DollarSign, TrendingUp, Ban, AlertCircle, Star, Trophy, CheckCircle, XCircle, Clock } from 'lucide-react';
import { fetchOdds, fetchScores, GameOdds, GameScore } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BookLine { book: string; odds: number }

interface Play {
  gameId: string; sport: string; homeTeam: string; awayTeam: string;
  commenceTime: string; side: string; market: 'h2h' | 'spreads' | 'totals';
  point?: number; bestBook: string; bestOdds: number;
  impliedProb: number; fairProb: number; edge: number; books: BookLine[];
  units: 0.25 | 0.5 | 1;
}

interface SavedBet {
  id: string;
  gameId: string; sport: string; sportKey: string;
  homeTeam: string; awayTeam: string; commenceTime: string;
  side: string; market: 'h2h' | 'spreads' | 'totals';
  point?: number; bestOdds: number; edge: number; units: 0.25 | 0.5 | 1;
  savedAt: string;
  result?: 'win' | 'loss' | 'push';
  resolvedAt?: string;
}

interface Reject {
  gameId: string; sport: string; homeTeam: string; awayTeam: string;
  commenceTime: string; homeML: string; awayML: string; reason: string;
}

type Tab = 'plays' | 'no-bets' | 'bankroll' | 'results';

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

const MARKET_LABEL: Record<string, string> = {
  h2h: 'Moneyline', spreads: 'Spread', totals: 'Total',
};

const MARKET_COLOR: Record<string, string> = {
  h2h: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
  spreads: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  totals: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
};

const SPORT_KEYS_BY_LABEL: Record<string, string> = Object.fromEntries(SPORTS.map(s => [s.label, s.key]));
const BANKROLL_KEY = 'schlima_bankroll_v2';
const BETS_KEY    = 'schlima_bets_v1';

// ─── Math helpers ────────────────────────────────────────────────────────────

function imp(odds: number) {
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}
function noVig(a: number, b: number): [number, number] {
  const ia = imp(a), ib = imp(b), t = ia + ib;
  return [ia / t, ib / t];
}
function fmtOdds(n: number)   { return n > 0 ? `+${n}` : `${n}`; }
function fmtSpread(n: number) { return n >= 0 ? `+${n}` : `${n}`; }
function pct(n: number)       { return `${(n * 100).toFixed(1)}%`; }

function fmtTime(iso: string) {
  const d = new Date(iso);
  const today = new Date(), tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = d.toDateString() === today.toDateString() ? 'Today'
    : d.toDateString() === tomorrow.toDateString() ? 'Tomorrow'
    : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${day} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

// ─── Processing ──────────────────────────────────────────────────────────────

function consensusPoint(g: GameOdds, marketKey: string, sideName: string): number | null {
  const points: number[] = [];
  for (const bm of g.bookmakers) {
    const mkt = bm.markets.find(m => m.key === marketKey);
    if (!mkt) continue;
    const out = mkt.outcomes.find(o => o.name === sideName);
    if (out?.point != null) points.push(out.point);
  }
  if (points.length === 0) return null;
  const freq: Record<string, number> = {};
  for (const p of points) freq[String(p)] = (freq[String(p)] ?? 0) + 1;
  return parseFloat(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]);
}

function pairLines(
  g: GameOdds, marketKey: string, nameA: string, nameB: string,
  ptA?: number | null, ptB?: number | null,
): Array<{ a: BookLine; b: BookLine }> {
  const pairs: Array<{ a: BookLine; b: BookLine }> = [];
  for (const bm of g.bookmakers) {
    const mkt = bm.markets.find(m => m.key === marketKey);
    if (!mkt) continue;
    const outA = mkt.outcomes.find(o => o.name === nameA && (ptA == null || Math.abs((o.point ?? 0) - ptA) < 0.01));
    const outB = mkt.outcomes.find(o => o.name === nameB && (ptB == null || Math.abs((o.point ?? 0) - ptB) < 0.01));
    if (outA && outB) pairs.push({ a: { book: bm.title, odds: outA.price }, b: { book: bm.title, odds: outB.price } });
  }
  return pairs;
}

function avgFairProbs(pairs: Array<{ a: BookLine; b: BookLine }>): [number, number] {
  let sumA = 0, sumB = 0;
  for (const { a, b } of pairs) { const [fa, fb] = noVig(a.odds, b.odds); sumA += fa; sumB += fb; }
  return [sumA / pairs.length, sumB / pairs.length];
}

function collectLines(g: GameOdds, marketKey: string, sideName: string, matchPt?: number | null): BookLine[] {
  const lines: BookLine[] = [];
  for (const bm of g.bookmakers) {
    const mkt = bm.markets.find(m => m.key === marketKey);
    if (!mkt) continue;
    const out = mkt.outcomes.find(o => o.name === sideName && (matchPt == null || Math.abs((o.point ?? 0) - matchPt) < 0.01));
    if (out) lines.push({ book: bm.title, odds: out.price });
  }
  return lines;
}

function buildPlay(g: GameOdds, market: 'h2h' | 'spreads' | 'totals', side: string, fairProb: number, allLines: BookLine[], point?: number): Play | null {
  if (allLines.length === 0) return null;
  const best = allLines.reduce((b, x) => x.odds > b.odds ? x : b);
  const edge = fairProb - imp(best.odds);
  if (edge <= 0) return null;
  return {
    gameId: g.id, sport: g.sport_title, homeTeam: g.home_team, awayTeam: g.away_team,
    commenceTime: g.commence_time, side, market, point, bestBook: best.book, bestOdds: best.odds,
    impliedProb: imp(best.odds), fairProb, edge,
    books: [...allLines].sort((a, b) => b.odds - a.odds),
    units: edge >= 0.06 ? 1 : edge >= 0.04 ? 0.5 : 0.25,
  };
}

function processGames(games: GameOdds[]): { plays: Play[]; rejects: Reject[] } {
  const plays: Play[] = [], rejects: Reject[] = [], now = new Date();
  for (const g of games) {
    if (new Date(g.commence_time) <= now) continue;
    const gamePlays: Play[] = [];

    const h2hPairs = pairLines(g, 'h2h', g.home_team, g.away_team);
    if (h2hPairs.length >= 2) {
      const [fairH, fairA] = avgFairProbs(h2hPairs);
      const pH = buildPlay(g, 'h2h', g.home_team, fairH, collectLines(g, 'h2h', g.home_team));
      const pA = buildPlay(g, 'h2h', g.away_team, fairA, collectLines(g, 'h2h', g.away_team));
      if (pH) gamePlays.push(pH);
      if (pA) gamePlays.push(pA);
    }

    const homeSpreadPt = consensusPoint(g, 'spreads', g.home_team);
    const awaySpreadPt = consensusPoint(g, 'spreads', g.away_team);
    if (homeSpreadPt != null && awaySpreadPt != null) {
      const spreadPairs = pairLines(g, 'spreads', g.home_team, g.away_team, homeSpreadPt, awaySpreadPt);
      if (spreadPairs.length >= 2) {
        const [fairH, fairA] = avgFairProbs(spreadPairs);
        const pH = buildPlay(g, 'spreads', `${g.home_team} ${fmtSpread(homeSpreadPt)}`, fairH, collectLines(g, 'spreads', g.home_team, homeSpreadPt), homeSpreadPt);
        const pA = buildPlay(g, 'spreads', `${g.away_team} ${fmtSpread(awaySpreadPt)}`, fairA, collectLines(g, 'spreads', g.away_team, awaySpreadPt), awaySpreadPt);
        if (pH) gamePlays.push(pH);
        if (pA) gamePlays.push(pA);
      }
    }

    const overPt = consensusPoint(g, 'totals', 'Over');
    if (overPt != null) {
      const totalPairs = pairLines(g, 'totals', 'Over', 'Under', overPt, overPt);
      if (totalPairs.length >= 2) {
        const [fairO, fairU] = avgFairProbs(totalPairs);
        const pO = buildPlay(g, 'totals', `Over ${overPt}`, fairO, collectLines(g, 'totals', 'Over', overPt), overPt);
        const pU = buildPlay(g, 'totals', `Under ${overPt}`, fairU, collectLines(g, 'totals', 'Under', overPt), overPt);
        if (pO) gamePlays.push(pO);
        if (pU) gamePlays.push(pU);
      }
    }

    if (gamePlays.length > 0) {
      plays.push(...gamePlays);
    } else {
      const homeH2H = collectLines(g, 'h2h', g.home_team), awayH2H = collectLines(g, 'h2h', g.away_team);
      const bestH = homeH2H.length > 0 ? homeH2H.reduce((b, x) => x.odds > b.odds ? x : b) : null;
      const bestA = awayH2H.length > 0 ? awayH2H.reduce((b, x) => x.odds > b.odds ? x : b) : null;
      rejects.push({
        gameId: g.id, sport: g.sport_title, homeTeam: g.home_team, awayTeam: g.away_team,
        commenceTime: g.commence_time,
        homeML: bestH ? fmtOdds(bestH.odds) : '—', awayML: bestA ? fmtOdds(bestA.odds) : '—',
        reason: h2hPairs.length < 2 ? 'Not enough books for accurate line comparison.' : 'No positive edge found across moneyline, spread, or total.',
      });
    }
  }
  return { plays: plays.sort((a, b) => b.edge - a.edge), rejects };
}

// ─── Bet storage ──────────────────────────────────────────────────────────────

function loadBets(): SavedBet[] {
  try { return JSON.parse(localStorage.getItem(BETS_KEY) ?? '[]'); } catch { return []; }
}
function saveBets(bets: SavedBet[]) { localStorage.setItem(BETS_KEY, JSON.stringify(bets)); }
function cleanOldBets(bets: SavedBet[]): SavedBet[] {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  return bets.filter(b => new Date(b.commenceTime) > cutoff);
}

// ─── Outcome determination ────────────────────────────────────────────────────

function determineBetOutcome(bet: SavedBet, scores: GameScore[]): 'win' | 'loss' | 'push' | null {
  const game = scores.find(s => s.id === bet.gameId);
  if (!game?.completed || !game.scores) return null;
  const homeScore = parseFloat(game.scores.find(s => s.name === game.home_team)?.score ?? '');
  const awayScore = parseFloat(game.scores.find(s => s.name === game.away_team)?.score ?? '');
  if (isNaN(homeScore) || isNaN(awayScore)) return null;

  if (bet.market === 'h2h') {
    const betScore = bet.side === game.home_team ? homeScore : awayScore;
    const oppScore = bet.side === game.home_team ? awayScore : homeScore;
    if (betScore > oppScore) return 'win';
    if (betScore < oppScore) return 'loss';
    return 'push';
  }
  if (bet.market === 'spreads' && bet.point != null) {
    const isHome = bet.side.startsWith(bet.homeTeam);
    const margin = (isHome ? homeScore : awayScore) - (isHome ? awayScore : homeScore);
    const needed = -bet.point;
    if (margin > needed) return 'win';
    if (margin < needed) return 'loss';
    return 'push';
  }
  if (bet.market === 'totals' && bet.point != null) {
    const total = homeScore + awayScore;
    const isOver = bet.side.startsWith('Over');
    if (isOver ? total > bet.point : total < bet.point) return 'win';
    if (isOver ? total < bet.point : total > bet.point) return 'loss';
    return 'push';
  }
  return null;
}

// ─── Bankroll helpers ─────────────────────────────────────────────────────────

function loadBankroll(): Bankroll {
  try { return JSON.parse(localStorage.getItem(BANKROLL_KEY) ?? ''); } catch { /**/ }
  return { starting: 1000, current: 1000, unit: 25, wins: 0, losses: 0, pushes: 0 };
}
function saveBankroll(b: Bankroll) { localStorage.setItem(BANKROLL_KEY, JSON.stringify(b)); }

// ─── Sub-components ──────────────────────────────────────────────────────────

function SportBadge({ sportKey, label }: { sportKey: string; label: string }) {
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${SPORT_COLOR[sportKey] ?? 'text-zinc-400 bg-zinc-800 border-zinc-700'}`}>{label}</span>;
}
function MarketBadge({ market }: { market: string }) {
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${MARKET_COLOR[market] ?? 'text-zinc-400 bg-zinc-800 border-zinc-700'}`}>{MARKET_LABEL[market] ?? market}</span>;
}

function EdgeBar({ edge }: { edge: number }) {
  return (
    <div className="w-full bg-zinc-800 rounded-full h-1 mt-1">
      <div className="h-1 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400" style={{ width: `${Math.min(edge / 0.12, 1) * 100}%` }} />
    </div>
  );
}

function PlayCard({ play, unitDollar }: { play: Play; unitDollar: number }) {
  const sportKey = SPORTS.find(s => s.label === play.sport)?.key ?? '';
  return (
    <div className="rounded-xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/5 to-transparent overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between border-b border-zinc-800/60">
        <div className="flex items-center gap-2 flex-wrap">
          <SportBadge sportKey={sportKey} label={play.sport} />
          <MarketBadge market={play.market} />
          <span className="text-sm text-zinc-400">{play.homeTeam} vs {play.awayTeam}</span>
        </div>
        <span className="text-xs text-zinc-600 shrink-0 ml-2">{fmtTime(play.commenceTime)}</span>
      </div>
      <div className="px-5 py-4">
        <div className="flex items-start justify-between mb-4">
          <p className="text-xl font-semibold text-zinc-100 leading-tight pr-4">{play.side}</p>
          <div className="text-right shrink-0">
            <p className="font-mono text-2xl font-semibold text-emerald-400">{fmtOdds(play.bestOdds)}</p>
            <p className="text-xs text-zinc-500">@ {play.bestBook}</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 mb-4">
          {[
            { label: 'FAIR',    value: pct(play.fairProb),    color: 'text-emerald-400' },
            { label: 'IMPLIED', value: pct(play.impliedProb), color: 'text-zinc-300'    },
            { label: 'EDGE',    value: `+${pct(play.edge)}`,  color: 'text-emerald-400' },
            { label: 'SIZE',    value: `${play.units}u`,      color: 'text-zinc-300'    },
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
              <span className={`font-mono text-sm ${i === 0 ? 'text-emerald-400 font-semibold' : 'text-zinc-500'}`}>{fmtOdds(b.odds)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-zinc-800/60 flex items-center justify-between">
          <span className="text-xs text-zinc-600">Recommended</span>
          <span className="text-xs font-mono text-zinc-400">{play.units}u = <span className="text-zinc-300">${(play.units * unitDollar).toFixed(0)}</span></span>
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
          <span className="font-mono">{r.homeML}</span><span>/</span><span className="font-mono">{r.awayML}</span>
          <span className="badge-red">PASS</span>
        </div>
      </div>
      <p className="text-xs text-zinc-600 flex items-start gap-1.5">
        <Ban size={11} className="mt-0.5 shrink-0 text-zinc-700" />{r.reason}
      </p>
      <p className="text-xs text-zinc-700 mt-1">{fmtTime(r.commenceTime)}</p>
    </div>
  );
}

function BetResultCard({ bet }: { bet: SavedBet }) {
  const sportKey = SPORTS.find(s => s.label === bet.sport)?.key ?? '';
  const borderBg = bet.result === 'win' ? 'border-emerald-500/30 bg-emerald-500/5'
    : bet.result === 'loss' ? 'border-red-500/30 bg-red-500/5'
    : bet.result === 'push' ? 'border-zinc-700 bg-zinc-800/30'
    : 'border-zinc-800 bg-zinc-900/30';

  const badge = bet.result === 'win'  ? <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400"><CheckCircle size={12} />WIN</span>
    : bet.result === 'loss' ? <span className="flex items-center gap-1 text-xs font-semibold text-red-400"><XCircle size={12} />LOSS</span>
    : bet.result === 'push' ? <span className="text-xs font-semibold text-zinc-400">PUSH</span>
    : <span className="flex items-center gap-1 text-xs text-amber-400"><Clock size={11} />Pending</span>;

  return (
    <div className={`rounded-xl border px-4 py-3 ${borderBg}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <SportBadge sportKey={sportKey} label={bet.sport} />
          <MarketBadge market={bet.market} />
        </div>
        {badge}
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-200">{bet.side}</p>
          <p className="text-xs text-zinc-600">{bet.homeTeam} vs {bet.awayTeam}</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm text-zinc-300">{fmtOdds(bet.bestOdds)}</p>
          <p className="text-xs text-zinc-600">{fmtTime(bet.commenceTime)}</p>
        </div>
      </div>
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

  const [savedBets, setSavedBets] = useState<SavedBet[]>(() => cleanOldBets(loadBets()));
  const [loadingResults, setLoadingResults] = useState(false);
  const [resultsErr, setResultsErr] = useState('');

  useEffect(() => { load(sport); }, [sport]);

  // Auto-save any new plays to localStorage
  const { plays, rejects } = useMemo(
    () => rawData ? processGames(rawData) : { plays: [], rejects: [] },
    [rawData]
  );

  useEffect(() => {
    if (plays.length === 0) return;
    setSavedBets(prev => {
      const existingIds = new Set(prev.map(b => b.id));
      const toAdd: SavedBet[] = plays
        .filter(p => !existingIds.has(`${p.gameId}-${p.side}-${p.market}`))
        .map(p => ({
          id: `${p.gameId}-${p.side}-${p.market}`,
          gameId: p.gameId, sport: p.sport, sportKey: SPORT_KEYS_BY_LABEL[p.sport] ?? '',
          homeTeam: p.homeTeam, awayTeam: p.awayTeam, commenceTime: p.commenceTime,
          side: p.side, market: p.market, point: p.point,
          bestOdds: p.bestOdds, edge: p.edge, units: p.units,
          savedAt: new Date().toISOString(),
        }));
      if (toAdd.length === 0) return prev;
      const updated = [...toAdd, ...prev].slice(0, 300);
      saveBets(updated);
      return updated;
    });
  }, [plays]);

  // Auto-check results when Results tab opens
  useEffect(() => {
    if (tab === 'results') {
      const hasPending = savedBets.some(b => !b.result && new Date(b.commenceTime) <= new Date());
      if (hasPending) checkResults();
    }
  }, [tab]);

  async function load(s: string) {
    if (!token) return;
    setLoading(true); setError(null); setRawData(null);
    try {
      setRawData(await fetchOdds(token, s));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch odds');
    } finally { setLoading(false); }
  }

  async function checkResults() {
    if (!token || loadingResults) return;
    setLoadingResults(true); setResultsErr('');
    const now = new Date();
    const pending = savedBets.filter(b => !b.result && new Date(b.commenceTime) <= now);
    if (pending.length === 0) { setLoadingResults(false); return; }

    const sportKeys = [...new Set(pending.map(b => b.sportKey))].filter(Boolean);
    try {
      const scoreMap: Record<string, GameScore[]> = {};
      await Promise.all(sportKeys.map(async sk => { scoreMap[sk] = await fetchScores(token, sk); }));

      setSavedBets(prev => {
        const updated = prev.map(bet => {
          if (bet.result || new Date(bet.commenceTime) > now) return bet;
          const outcome = determineBetOutcome(bet, scoreMap[bet.sportKey] ?? []);
          if (!outcome) return bet;
          return { ...bet, result: outcome, resolvedAt: new Date().toISOString() };
        });
        saveBets(updated);
        return updated;
      });
    } catch {
      setResultsErr('Could not fetch scores. Try again later.');
    } finally { setLoadingResults(false); }
  }

  function updateBR(updates: Partial<Bankroll>) {
    const next = { ...bankroll, ...updates };
    setBR(next); saveBankroll(next);
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  const todayStr = new Date().toDateString();
  const weekAgo  = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);

  const { todayW, todayL, todayP, weekW, weekL, weekP } = useMemo(() => {
    const resolved = savedBets.filter(b => b.result);
    const todays   = resolved.filter(b => new Date(b.commenceTime).toDateString() === todayStr);
    const weeks    = resolved.filter(b => new Date(b.commenceTime) >= weekAgo);
    return {
      todayW: todays.filter(b => b.result === 'win').length,
      todayL: todays.filter(b => b.result === 'loss').length,
      todayP: todays.filter(b => b.result === 'push').length,
      weekW:  weeks.filter(b => b.result === 'win').length,
      weekL:  weeks.filter(b => b.result === 'loss').length,
      weekP:  weeks.filter(b => b.result === 'push').length,
    };
  }, [savedBets]);

  const pendingCount = savedBets.filter(b => !b.result && new Date(b.commenceTime) <= new Date()).length;

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
            <p className="text-xs text-zinc-600">Live odds · Moneyline, spreads & totals · All positive edges</p>
          </div>
        </div>
        <button onClick={() => load(sport)} disabled={loading}
          className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Sport selector */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {SPORTS.map(s => (
          <button key={s.key} onClick={() => setSport(s.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              sport === s.key ? 'bg-zinc-800 text-zinc-100 border border-zinc-700' : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl mb-8">
        {([
          { id: 'plays'    as Tab, label: 'Best Bets', icon: TrendingUp, count: plays.length },
          { id: 'no-bets'  as Tab, label: 'No Edge',   icon: Ban,        count: rejects.length },
          { id: 'results'  as Tab, label: 'Results',   icon: Trophy,     count: pendingCount > 0 ? pendingCount : null, countAmber: true },
          { id: 'bankroll' as Tab, label: 'Bankroll',  icon: DollarSign, count: null },
        ]).map(({ id, label, icon: Icon, count, countAmber }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors flex-1 justify-center ${
              tab === id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
            }`}>
            <Icon size={14} />
            <span className="hidden sm:inline">{label}</span>
            {count !== null && count !== undefined && (
              <span className={`text-xs rounded-full px-1.5 py-0.5 ${countAmber ? 'bg-amber-500/20 text-amber-400' : count > 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-600'}`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="card p-5 border-red-500/20 bg-red-500/5 flex items-start gap-3 mb-6">
          <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-red-400 font-medium mb-1">{error.includes('not configured') ? 'Odds API not set up yet' : 'Failed to load odds'}</p>
            <p className="text-xs text-zinc-500">{error.includes('not configured') ? 'Add your ODDS_API_KEY secret to the Cloudflare Worker.' : error}</p>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 animate-pulse">
              <div className="h-4 bg-zinc-800 rounded w-2/3 mb-3" />
              <div className="h-8 bg-zinc-800 rounded w-1/3 mb-3" />
              <div className="grid grid-cols-4 gap-2">{[1,2,3,4].map(j => <div key={j} className="h-12 bg-zinc-800 rounded-lg" />)}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Best Bets tab ── */}
      {!loading && tab === 'plays' && (
        <div className="space-y-4 animate-fade-in">
          {!rawData && !error && <div className="card p-12 text-center text-zinc-600 text-sm">Select a sport to load odds.</div>}
          {rawData && plays.length === 0 && (
            <div className="card p-12 text-center">
              <Ban size={28} className="text-zinc-700 mx-auto mb-3" />
              <p className="text-zinc-400 font-medium mb-1">No edges found</p>
              <p className="text-zinc-600 text-sm">Books are aligned across all markets.</p>
            </div>
          )}
          {plays.map(p => <PlayCard key={`${p.gameId}-${p.side}-${p.market}`} play={p} unitDollar={bankroll.unit} />)}
        </div>
      )}

      {/* ── No Edge tab ── */}
      {!loading && tab === 'no-bets' && (
        <div className="space-y-2 animate-fade-in">
          {rejects.length === 0 && rawData && <div className="card p-8 text-center text-zinc-600 text-sm">No games without edges.</div>}
          {rejects.map(r => <RejectCard key={r.gameId} r={r} />)}
        </div>
      )}

      {/* ── Results tab ── */}
      {tab === 'results' && (
        <div className="space-y-5 animate-fade-in">

          {/* Daily / Weekly summary */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Today',     w: todayW, l: todayL, p: todayP },
              { label: 'This Week', w: weekW,  l: weekL,  p: weekP  },
            ].map(({ label, w, l, p }) => {
              const t = w + l; const winPct = t > 0 ? Math.round(w / t * 100) : null;
              return (
                <div key={label} className="card p-4">
                  <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">{label}</p>
                  {t === 0 && p === 0 ? (
                    <p className="text-zinc-600 text-sm">No results yet</p>
                  ) : (
                    <>
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-2xl font-semibold text-emerald-400">{w}W</span>
                        <span className="font-mono text-2xl font-semibold text-red-400">{l}L</span>
                        {p > 0 && <span className="font-mono text-xl text-zinc-500">{p}P</span>}
                      </div>
                      {winPct !== null && <p className="text-xs text-zinc-600 mt-1">{winPct}% win rate</p>}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Check results button */}
          <button onClick={checkResults} disabled={loadingResults}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-zinc-700 text-sm text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors disabled:opacity-40">
            <RefreshCw size={14} className={loadingResults ? 'animate-spin' : ''} />
            {loadingResults ? 'Checking scores...' : `Check Results${pendingCount > 0 ? ` (${pendingCount} pending)` : ''}`}
          </button>

          {resultsErr && (
            <p className="text-xs text-red-400 text-center">{resultsErr}</p>
          )}

          {/* Bet history */}
          {savedBets.length === 0 ? (
            <div className="card p-8 text-center">
              <Trophy size={28} className="text-zinc-700 mx-auto mb-3" />
              <p className="text-zinc-500 text-sm">No bets tracked yet</p>
              <p className="text-zinc-700 text-xs mt-1">Plays are auto-saved when you load odds on any sport</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-zinc-600 uppercase tracking-widest font-semibold px-1">Bet History</p>
              {[...savedBets]
                .sort((a, b) => new Date(b.commenceTime).getTime() - new Date(a.commenceTime).getTime())
                .slice(0, 100)
                .map(bet => <BetResultCard key={bet.id} bet={bet} />)}
            </div>
          )}
        </div>
      )}

      {/* ── Bankroll tab ── */}
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
              { label: 'Wins',   val: bankroll.wins,   color: 'text-emerald-400' },
              { label: 'Losses', val: bankroll.losses, color: 'text-red-400'     },
              { label: 'Pushes', val: bankroll.pushes, color: 'text-zinc-400'    },
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
              {([
                { label: 'Starting Bankroll', key: 'starting' as keyof Bankroll },
                { label: 'Current Bankroll',  key: 'current'  as keyof Bankroll },
                { label: '1 Unit ($)',         key: 'unit'     as keyof Bankroll },
              ]).map(({ label, key }) => (
                <div key={key}>
                  <label className="block text-xs text-zinc-500 uppercase tracking-wider mb-1.5">{label}</label>
                  <input type="number" value={bankroll[key] as number}
                    onChange={e => updateBR({ [key]: parseFloat(e.target.value) || 0 })}
                    className="input-field font-mono" />
                </div>
              ))}
            </div>
            <div className="border-t border-zinc-800 pt-4">
              <p className="text-xs text-zinc-600 mb-3">Record a result</p>
              <div className="flex gap-2">
                <button onClick={() => updateBR({ wins: bankroll.wins + 1, current: bankroll.current + bankroll.unit })}
                  className="flex-1 py-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-sm font-medium hover:bg-emerald-500/20 transition-colors">+ Win</button>
                <button onClick={() => updateBR({ losses: bankroll.losses + 1, current: bankroll.current - bankroll.unit })}
                  className="flex-1 py-2.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 text-sm font-medium hover:bg-red-500/20 transition-colors">− Loss</button>
                <button onClick={() => updateBR({ pushes: bankroll.pushes + 1 })}
                  className="flex-1 py-2.5 rounded-lg bg-zinc-800 text-zinc-400 border border-zinc-700 text-sm font-medium hover:bg-zinc-700 transition-colors">Push</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
