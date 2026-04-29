const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

export async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Login failed');
  }
  const data = await res.json() as { token: string };
  return data.token;
}

export async function verifyToken(token: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/verify`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

export interface OddsOutcome {
  name: string;
  price: number;
  point?: number;
}

export interface OddsMarket {
  key: 'h2h' | 'spreads' | 'totals';
  outcomes: OddsOutcome[];
}

export interface Bookmaker {
  key: string;
  title: string;
  markets: OddsMarket[];
}

export interface GameOdds {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Bookmaker[];
}

// ─── Stock API ────────────────────────────────────────────────────────────────

export interface StockQuote { c: number; d: number; dp: number; h: number; l: number; o: number; pc: number }
export interface StockProfile { name: string; finnhubIndustry: string; marketCapitalization: number; ticker: string }

export interface StockData {
  ticker: string;
  metrics: Record<string, number | null>;
  quote: StockQuote;
  profile: StockProfile;
  scoring: { overall: number; dims: Record<string, number> };
  rating: string;
}

export interface GeneratedLTPick {
  top: StockData;
  topThree: StockData[];
  ai_thesis: string;
}

export interface DTQuote { symbol: string; c: number; d: number; dp: number; h: number; l: number; o: number; pc: number }

export interface GeneratedDTPick {
  top: (DTQuote & { entry: number; stop: number; target: number }) | null;
  candidates: DTQuote[];
  ai_setup: string;
  message?: string;
}

export async function fetchStockMetrics(token: string, symbol: string): Promise<StockData> {
  const res = await fetch(`${API_BASE}/stock/metrics?symbol=${encodeURIComponent(symbol)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(d.error ?? 'Failed to fetch stock data');
  }
  return res.json() as Promise<StockData>;
}

export async function fetchStockQuotes(token: string, symbols: string[]): Promise<DTQuote[]> {
  const res = await fetch(`${API_BASE}/stock/quotes?symbols=${symbols.join(',')}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch quotes');
  return res.json() as Promise<DTQuote[]>;
}

export async function generateLTPick(token: string): Promise<GeneratedLTPick> {
  const res = await fetch(`${API_BASE}/stock/generate-pick?type=longterm`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(d.error ?? 'Failed to generate pick');
  }
  return res.json() as Promise<GeneratedLTPick>;
}

export async function generateDTPick(token: string): Promise<GeneratedDTPick> {
  const res = await fetch(`${API_BASE}/stock/generate-pick?type=daytrading`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(d.error ?? 'Failed to generate pick');
  }
  return res.json() as Promise<GeneratedDTPick>;
}

export interface GameScore {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: Array<{ name: string; score: string }> | null;
}

export async function fetchScores(token: string, sport: string): Promise<GameScore[]> {
  const res = await fetch(`${API_BASE}/scores?sport=${encodeURIComponent(sport)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch scores');
  return res.json() as Promise<GameScore[]>;
}

export async function fetchOdds(token: string, sport: string): Promise<GameOdds[]> {
  const res = await fetch(`${API_BASE}/odds?sport=${encodeURIComponent(sport)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? 'Failed to fetch odds');
  }
  return res.json() as Promise<GameOdds[]>;
}
