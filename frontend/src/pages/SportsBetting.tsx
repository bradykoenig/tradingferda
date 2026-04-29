import { useState } from 'react';
import { Activity, TrendingUp, XCircle, DollarSign, BarChart2 } from 'lucide-react';

type Sport = 'NFL' | 'NBA' | 'MLB' | 'NHL';
type Tab = 'best-bets' | 'line-shopping' | 'no-bets' | 'bankroll';

interface BestBet {
  id: string;
  sport: Sport;
  game: string;
  market: string;
  pick: string;
  sportsbook: string;
  odds: number;
  impliedProb: number;
  modelProb: number;
  edge: number;
  confidence: number;
  units: number;
  reason: string;
}

interface LineShopping {
  id: string;
  sport: Sport;
  game: string;
  market: string;
  pick: string;
  lines: { book: string; odds: number }[];
}

interface NoBet {
  id: string;
  sport: Sport;
  game: string;
  market: string;
  pick: string;
  reason: string;
}

const BEST_BETS: BestBet[] = [
  {
    id: '1', sport: 'NBA', game: 'Celtics vs Heat', market: 'Spread', pick: 'Celtics -4.5',
    sportsbook: 'FanDuel', odds: -108, impliedProb: 51.9, modelProb: 58.2, edge: 6.3,
    confidence: 7, units: 0.5,
    reason: 'Boston +8% in net rating at home this stretch. Miami on 2nd of back-to-back, Butler questionable. Line opened -5.5, sharp money moved it to -4.5 — that\'s line value. Strong matchup edge.',
  },
  {
    id: '2', sport: 'MLB', game: 'Yankees vs Red Sox', market: 'Total', pick: 'Under 8.5',
    sportsbook: 'DraftKings', odds: -112, impliedProb: 52.8, modelProb: 61.0, edge: 8.2,
    confidence: 8, units: 1.0,
    reason: 'Cole vs Sale — two elite arms. Fenway wind blowing in at 18 mph from CF. Both bullpens well-rested. Unders go 68% with two aces and wind-in at Fenway. Model rates this strongly.',
  },
];

const LINE_SHOPPING: LineShopping[] = [
  {
    id: '1', sport: 'NBA', game: 'Celtics vs Heat', market: 'Spread', pick: 'Celtics -4.5',
    lines: [
      { book: 'FanDuel', odds: -108 },
      { book: 'DraftKings', odds: -110 },
      { book: 'BetMGM', odds: -112 },
      { book: 'Caesars', odds: -115 },
    ],
  },
  {
    id: '2', sport: 'MLB', game: 'Yankees vs Red Sox', market: 'Total', pick: 'Under 8.5',
    lines: [
      { book: 'DraftKings', odds: -112 },
      { book: 'FanDuel', odds: -115 },
      { book: 'BetMGM', odds: -118 },
      { book: 'Caesars', odds: -120 },
    ],
  },
];

const NO_BETS: NoBet[] = [
  { id: '1', sport: 'NFL', game: 'Chiefs vs Ravens', market: 'Spread', pick: 'Ravens -2.5', reason: 'Injury uncertainty — Lamar listed as questionable, no confirmation of availability. Avoid until status confirmed.' },
  { id: '2', sport: 'NBA', game: 'Lakers vs Clippers', market: 'Moneyline', pick: 'Clippers ML', reason: 'Line already moved from +155 to +130. Value eliminated before model could confirm. CLV negative.' },
  { id: '3', sport: 'MLB', game: 'Mets vs Cubs', market: 'Total', pick: 'Over 9', reason: 'Low confidence in starting pitchers. Both have high ERA variance last 5 starts. Model shows conflicting signals.' },
  { id: '4', sport: 'NHL', game: 'Rangers vs Bruins', market: 'Moneyline', pick: 'Rangers ML', reason: 'Starting goalie unconfirmed for both teams. Puck line movement unfavorable. No edge until lineups official.' },
];

function oddsToImplied(odds: number): number {
  if (odds > 0) return 100 / (odds + 100) * 100;
  return Math.abs(odds) / (Math.abs(odds) + 100) * 100;
}

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function sportBadge(sport: Sport) {
  const colors: Record<Sport, string> = {
    NFL: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    NBA: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    MLB: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    NHL: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  };
  return `inline-flex items-center border text-xs font-medium px-2 py-0.5 rounded ${colors[sport]}`;
}

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'best-bets', label: 'Best Bets', icon: TrendingUp },
  { id: 'line-shopping', label: 'Line Shopping', icon: BarChart2 },
  { id: 'no-bets', label: 'No-Bet Board', icon: XCircle },
  { id: 'bankroll', label: 'Bankroll', icon: DollarSign },
];

const BANKROLL_KEY = 'schlima_bankroll';

interface BankrollState {
  starting: number;
  current: number;
  unitSize: number;
  wins: number;
  losses: number;
  pushes: number;
}

function loadBankroll(): BankrollState {
  try {
    const raw = localStorage.getItem(BANKROLL_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* empty */ }
  return { starting: 1000, current: 1000, unitSize: 10, wins: 0, losses: 0, pushes: 0 };
}

function saveBankroll(state: BankrollState) {
  localStorage.setItem(BANKROLL_KEY, JSON.stringify(state));
}

export default function SportsBetting() {
  const [tab, setTab] = useState<Tab>('best-bets');
  const [bankroll, setBankrollState] = useState<BankrollState>(loadBankroll);

  function updateBankroll(updates: Partial<BankrollState>) {
    const next = { ...bankroll, ...updates };
    setBankrollState(next);
    saveBankroll(next);
  }

  const profit = bankroll.current - bankroll.starting;
  const roi = bankroll.starting > 0 ? (profit / bankroll.starting) * 100 : 0;
  const totalSettled = bankroll.wins + bankroll.losses;
  const winRate = totalSettled > 0 ? (bankroll.wins / totalSettled) * 100 : 0;

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 animate-fade-in">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <Activity size={20} className="text-violet-400" />
          <h1 className="text-xl font-semibold text-zinc-100">Sports Betting</h1>
        </div>
        <p className="text-sm text-zinc-500 ml-8">
          Strict edge detection only. No edge = no bet. Comfortable showing zero plays.
        </p>
      </div>

      <div className="flex gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl mb-8 overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex-1 justify-center ${
              tab === id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'best-bets' && (
        <div className="space-y-4 animate-fade-in">
          {BEST_BETS.length === 0 ? (
            <div className="card p-12 text-center">
              <XCircle size={32} className="text-zinc-700 mx-auto mb-4" />
              <p className="text-zinc-400 font-medium mb-2">No Qualified Bets Today</p>
              <p className="text-zinc-600 text-sm">Nothing passed the edge filter. This is the correct outcome most days.</p>
            </div>
          ) : (
            BEST_BETS.map(bet => (
              <div key={bet.id} className="card p-5 border-emerald-500/20 bg-emerald-500/5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={sportBadge(bet.sport)}>{bet.sport}</span>
                    <span className="text-zinc-300 text-sm font-medium">{bet.game}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-zinc-500">{bet.units}u</span>
                    <span className="badge-green">PLAY</span>
                  </div>
                </div>

                <div className="flex items-baseline gap-2 mb-3">
                  <span className="text-lg font-semibold text-zinc-100">{bet.pick}</span>
                  <span className="font-mono text-emerald-400 font-medium">{formatOdds(bet.odds)}</span>
                  <span className="text-zinc-500 text-sm">@ {bet.sportsbook}</span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <div className="bg-zinc-800 rounded-lg p-3">
                    <p className="stat-label mb-1">Implied</p>
                    <p className="font-mono text-zinc-300 font-medium">{bet.impliedProb.toFixed(1)}%</p>
                  </div>
                  <div className="bg-zinc-800 rounded-lg p-3">
                    <p className="stat-label mb-1">Model</p>
                    <p className="font-mono text-emerald-400 font-medium">{bet.modelProb.toFixed(1)}%</p>
                  </div>
                  <div className="bg-zinc-800 rounded-lg p-3">
                    <p className="stat-label mb-1">Edge</p>
                    <p className="font-mono text-emerald-400 font-medium">+{bet.edge.toFixed(1)}%</p>
                  </div>
                  <div className="bg-zinc-800 rounded-lg p-3">
                    <p className="stat-label mb-1">Confidence</p>
                    <p className="font-mono text-zinc-300 font-medium">{bet.confidence}/10</p>
                  </div>
                </div>

                <p className="text-xs text-zinc-400 leading-relaxed">{bet.reason}</p>

                <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center gap-2">
                  <span className="text-xs text-zinc-600">Suggested size:</span>
                  <span className="text-xs font-mono text-zinc-300">{bet.units} unit = {fmt(bankroll.unitSize * bet.units)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'line-shopping' && (
        <div className="space-y-4 animate-fade-in">
          <p className="text-xs text-zinc-600 mb-4">Always shop for the best price. Small differences in odds compound significantly over time.</p>
          {LINE_SHOPPING.map(item => {
            const sorted = [...item.lines].sort((a, b) => b.odds - a.odds);
            const best = sorted[0];
            return (
              <div key={item.id} className="card p-5">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className={sportBadge(item.sport)}>{item.sport}</span>
                  <span className="text-zinc-300 text-sm font-medium">{item.game}</span>
                  <span className="text-zinc-500 text-sm">·</span>
                  <span className="text-zinc-500 text-sm">{item.market}</span>
                </div>
                <p className="text-base font-semibold text-zinc-100 mb-4">{item.pick}</p>

                <div className="space-y-2">
                  {sorted.map(line => (
                    <div
                      key={line.book}
                      className={`flex items-center justify-between rounded-lg px-4 py-3 ${
                        line.book === best.book ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-zinc-800'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {line.book === best.book && <span className="text-xs text-emerald-400 font-medium">BEST</span>}
                        <span className="text-sm text-zinc-300">{line.book}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className={`font-mono font-medium text-sm ${line.book === best.book ? 'text-emerald-400' : 'text-zinc-400'}`}>
                          {formatOdds(line.odds)}
                        </span>
                        <span className="text-xs text-zinc-600 font-mono">
                          {oddsToImplied(line.odds).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'no-bets' && (
        <div className="space-y-3 animate-fade-in">
          <div className="card p-4 border-zinc-700/50 bg-zinc-900/50 mb-4">
            <p className="text-xs text-zinc-500 leading-relaxed">
              These opportunities were evaluated and rejected. Understanding why bets fail the filter is as important as finding bets that qualify.
            </p>
          </div>
          {NO_BETS.map(item => (
            <div key={item.id} className="card p-4 border-red-500/10 opacity-80">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={sportBadge(item.sport)}>{item.sport}</span>
                  <span className="text-zinc-400 text-sm">{item.game}</span>
                </div>
                <span className="badge-red shrink-0">PASS</span>
              </div>
              <p className="text-sm text-zinc-400 font-medium mb-2">{item.pick} · {item.market}</p>
              <div className="flex items-start gap-2">
                <XCircle size={13} className="text-red-400 mt-0.5 shrink-0" />
                <p className="text-xs text-zinc-500 leading-relaxed">{item.reason}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'bankroll' && (
        <div className="space-y-5 animate-fade-in">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="card p-4">
              <p className="stat-label mb-1">Current Bankroll</p>
              <p className="stat-value">{fmt(bankroll.current)}</p>
            </div>
            <div className="card p-4">
              <p className="stat-label mb-1">P&L</p>
              <p className={`stat-value ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {profit >= 0 ? '+' : ''}{fmt(profit)}
              </p>
            </div>
            <div className="card p-4">
              <p className="stat-label mb-1">ROI</p>
              <p className={`stat-value ${roi >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {roi >= 0 ? '+' : ''}{roi.toFixed(1)}%
              </p>
            </div>
            <div className="card p-4">
              <p className="stat-label mb-1">Win Rate</p>
              <p className="stat-value">{winRate.toFixed(0)}%</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="card p-4 text-center">
              <p className="stat-label mb-1">Wins</p>
              <p className="text-2xl font-mono font-medium text-emerald-400">{bankroll.wins}</p>
            </div>
            <div className="card p-4 text-center">
              <p className="stat-label mb-1">Losses</p>
              <p className="text-2xl font-mono font-medium text-red-400">{bankroll.losses}</p>
            </div>
            <div className="card p-4 text-center">
              <p className="stat-label mb-1">Pushes</p>
              <p className="text-2xl font-mono font-medium text-zinc-400">{bankroll.pushes}</p>
            </div>
          </div>

          <div className="card p-5">
            <p className="section-header">Settings</p>
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-zinc-500 uppercase tracking-wider mb-1.5">Starting Bankroll</label>
                <input
                  type="number"
                  value={bankroll.starting}
                  onChange={e => updateBankroll({ starting: parseFloat(e.target.value) || 0 })}
                  className="input-field font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 uppercase tracking-wider mb-1.5">Current Bankroll</label>
                <input
                  type="number"
                  value={bankroll.current}
                  onChange={e => updateBankroll({ current: parseFloat(e.target.value) || 0 })}
                  className="input-field font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 uppercase tracking-wider mb-1.5">1 Unit Size ($)</label>
                <input
                  type="number"
                  value={bankroll.unitSize}
                  onChange={e => updateBankroll({ unitSize: parseFloat(e.target.value) || 0 })}
                  className="input-field font-mono"
                />
              </div>
            </div>

            <div className="mt-4 border-t border-zinc-800 pt-4">
              <p className="text-xs text-zinc-600 mb-3">Record a result:</p>
              <div className="flex gap-3">
                <button onClick={() => updateBankroll({ wins: bankroll.wins + 1, current: bankroll.current + bankroll.unitSize })} className="flex-1 py-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-sm font-medium hover:bg-emerald-500/20 transition-colors">
                  + Win
                </button>
                <button onClick={() => updateBankroll({ losses: bankroll.losses + 1, current: bankroll.current - bankroll.unitSize })} className="flex-1 py-2.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 text-sm font-medium hover:bg-red-500/20 transition-colors">
                  − Loss
                </button>
                <button onClick={() => updateBankroll({ pushes: bankroll.pushes + 1 })} className="flex-1 py-2.5 rounded-lg bg-zinc-800 text-zinc-400 border border-zinc-700 text-sm font-medium hover:bg-zinc-700 transition-colors">
                  Push
                </button>
              </div>
            </div>
          </div>

          <div className="card p-4 border-zinc-700/50">
            <p className="section-header mb-3">Bankroll Rules</p>
            <ul className="space-y-2">
              {[
                'Never bet more than 1 unit on any single game.',
                'High-confidence plays = 1 unit. Standard plays = 0.5 unit. Edge bets = 0.25 unit.',
                'Do not chase losses by increasing bet size.',
                'Track every bet. Patterns emerge from consistent records.',
                'A 5% ROI at volume is elite. Aim for disciplined, not explosive.',
              ].map(rule => (
                <li key={rule} className="flex items-start gap-2 text-xs text-zinc-500">
                  <span className="text-violet-400 mt-0.5 shrink-0">·</span>
                  {rule}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function fmt(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
