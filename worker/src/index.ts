export interface Env {
  PASSWORD_HASH: string;
  JWT_SECRET: string;
  ODDS_API_KEY: string;
  ANTHROPIC_API_KEY: string;
}

const SALT = 'schlima-site-v1-salt';
const JWT_EXPIRY = 60 * 60 * 24 * 7; // 7 days

// ─── CORS / helpers ────────────────────────────────────────────────────────────

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data: unknown, status: number, cors: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

async function requireAuth(request: Request, env: Env, cors: HeadersInit): Promise<Response | null> {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401, cors);
  const payload = await verifyJWT(auth.slice(7), env.JWT_SECRET);
  if (!payload) return json({ error: 'Unauthorized' }, 401, cors);
  return null;
}

// ─── Auth helpers ──────────────────────────────────────────────────────────────

async function pbkdf2Hash(password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(SALT), iterations: 100000, hash: 'SHA-256' },
    key, 256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function b64url(input: string | Uint8Array): string {
  const str = typeof input === 'string' ? input : String.fromCharCode(...input);
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(input: string): Uint8Array {
  return Uint8Array.from(atob(input.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

async function signJWT(payload: Record<string, unknown>, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + JWT_EXPIRY }));
  const msg = `${header}.${body}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return `${msg}.${b64url(new Uint8Array(sig))}`;
}

async function verifyJWT(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('HMAC', key, b64urlDecode(sig), new TextEncoder().encode(`${header}.${body}`));
  if (!valid) return null;
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
  return payload;
}

// ─── Stock helpers ─────────────────────────────────────────────────────────────

// ─── Yahoo Finance helpers ────────────────────────────────────────────────────

interface YFQuote {
  symbol: string; shortName?: string; longName?: string;
  regularMarketPrice: number; regularMarketChange: number; regularMarketChangePercent: number;
  regularMarketVolume: number; regularMarketOpen: number; regularMarketDayLow: number;
  regularMarketDayHigh: number; regularMarketPreviousClose: number;
  averageDailyVolume3Month?: number; marketCap?: number; sector?: string; industry?: string;
}
interface YFKeyStats {
  beta?: { raw: number }; forwardPE?: { raw: number }; priceToBook?: { raw: number };
  earningsQuarterlyGrowth?: { raw: number }; enterpriseToEbitda?: { raw: number };
  enterpriseToRevenue?: { raw: number };
}
interface YFFinancialData {
  revenueGrowth?: { raw: number }; earningsGrowth?: { raw: number };
  grossMargins?: { raw: number }; profitMargins?: { raw: number };
  returnOnEquity?: { raw: number }; debtToEquity?: { raw: number };
  freeCashflow?: { raw: number }; totalRevenue?: { raw: number };
  operatingCashflow?: { raw: number };
}
interface YFSummaryDetail { trailingPE?: { raw: number }; beta?: { raw: number }; marketCap?: { raw: number } }
type YFSummary = { defaultKeyStatistics?: YFKeyStats; financialData?: YFFinancialData; summaryDetail?: YFSummaryDetail };
interface YFHistory { closes: number[]; highs: number[]; lows: number[]; opens: number[]; volumes: number[] }

async function yfFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://finance.yahoo.com/',
    } });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch { return null; }
}

async function yfScreener(scrId: string, count: number, cache: Cache, ttl = 900): Promise<YFQuote[]> {
  const key = new Request(`https://cache.schlima/yf/screen/${scrId}/${count}`);
  const hit = await cache.match(key).catch(() => null);
  if (hit) return hit.json().catch(() => []) as Promise<YFQuote[]>;
  const data = await yfFetch<{ finance?: { result?: Array<{ quotes?: YFQuote[] }> } }>(
    `https://query2.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&lang=en-US&region=US&scrIds=${scrId}&count=${count}`
  );
  const quotes = data?.finance?.result?.[0]?.quotes ?? [];
  await cache.put(key, new Response(JSON.stringify(quotes), { headers: { 'Cache-Control': `public, max-age=${ttl}`, 'Content-Type': 'application/json' } })).catch(() => {});
  return quotes;
}

async function yfSummary(symbol: string, cache: Cache): Promise<YFSummary> {
  const key = new Request(`https://cache.schlima/yf/summary/${symbol}`);
  const hit = await cache.match(key).catch(() => null);
  if (hit) return hit.json().catch(() => ({})) as Promise<YFSummary>;
  const data = await yfFetch<{ quoteSummary?: { result?: YFSummary[] } }>(
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=defaultKeyStatistics,financialData,summaryDetail`
  );
  const s = data?.quoteSummary?.result?.[0] ?? {};
  await cache.put(key, new Response(JSON.stringify(s), { headers: { 'Cache-Control': 'public, max-age=21600', 'Content-Type': 'application/json' } })).catch(() => {});
  return s;
}

async function yfHistory(symbol: string, range: string, cache: Cache, ttl = 900): Promise<YFHistory> {
  const key = new Request(`https://cache.schlima/yf/hist/${symbol}/${range}`);
  const hit = await cache.match(key).catch(() => null);
  const empty: YFHistory = { closes: [], highs: [], lows: [], opens: [], volumes: [] };
  if (hit) return hit.json().catch(() => empty) as Promise<YFHistory>;
  const data = await yfFetch<Record<string, unknown>>(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${range}`);
  const result = (data?.chart as Record<string, unknown> | undefined);
  const rows = (result?.result as unknown[] | undefined)?.[0] as Record<string, unknown> | undefined;
  const quote = ((rows?.indicators as Record<string, unknown> | undefined)?.quote as unknown[] | undefined)?.[0] as Record<string, unknown[]> | undefined;
  const clean = (arr: unknown[] | undefined): number[] => (arr ?? []).filter((v): v is number => typeof v === 'number');
  const out: YFHistory = {
    closes:  clean(quote?.close),
    highs:   clean(quote?.high),
    lows:    clean(quote?.low),
    opens:   clean(quote?.open),
    volumes: clean(quote?.volume),
  };
  await cache.put(key, new Response(JSON.stringify(out), { headers: { 'Cache-Control': `public, max-age=${ttl}`, 'Content-Type': 'application/json' } })).catch(() => {});
  return out;
}

// ─── Technical indicators ─────────────────────────────────────────────────────

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  const gains = changes.map(c => Math.max(c, 0));
  const losses = changes.map(c => Math.max(-c, 0));
  let ag = gains.slice(0, period).reduce((s, v) => s + v, 0) / period;
  let al = losses.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < gains.length; i++) {
    ag = (ag * (period - 1) + gains[i]) / period;
    al = (al * (period - 1) + losses[i]) / period;
  }
  if (al === 0) return 100;
  return Math.round(100 - 100 / (1 + ag / al));
}

function calcATR(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (highs.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++)
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])));
  const slice = trs.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

function sma(arr: number[], n: number): number {
  const s = arr.slice(-n);
  return s.length ? s.reduce((a, v) => a + v, 0) / s.length : 0;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function sp(v: number | null | undefined, bad: number, good: number): number {
  if (v == null || !isFinite(v)) return 45;
  return Math.round(Math.min(Math.max((v - bad) / (good - bad), 0), 1) * 100);
}

function scoreLT(q: YFQuote, s: YFSummary): { overall: number; dims: Record<string, number> } {
  const fin = s.financialData ?? {}, stats = s.defaultKeyStatistics ?? {}, det = s.summaryDetail ?? {};
  const fcfYield = fin.freeCashflow?.raw && det.marketCap?.raw ? fin.freeCashflow.raw / det.marketCap.raw : null;
  const dims: Record<string, number> = {
    'Revenue Growth':   sp(fin.revenueGrowth?.raw,                               -0.05, 0.25),
    'Earnings Growth':  sp(fin.earningsGrowth?.raw ?? stats.earningsQuarterlyGrowth?.raw, -0.10, 0.35),
    'Profit Margin':    sp(fin.profitMargins?.raw,                                0,    0.30),
    'Return on Equity': sp(fin.returnOnEquity?.raw,                               0.05, 0.40),
    'Valuation (P/E)':  sp(stats.forwardPE?.raw ?? det.trailingPE?.raw,          45,   10),
    'Debt (D/E)':       sp(fin.debtToEquity?.raw != null ? fin.debtToEquity.raw / 100 : null, 2.0, 0),
    'EV/EBITDA':        sp(stats.enterpriseToEbitda?.raw,                         30,   8),
    'FCF Yield':        sp(fcfYield,                                              0,    0.06),
  };
  const weights = [0.20, 0.18, 0.15, 0.14, 0.12, 0.08, 0.08, 0.05];
  return { overall: Math.round(Object.values(dims).reduce((s, v, i) => s + v * weights[i], 0)), dims };
}

function ratingFromScore(score: number): string {
  if (score >= 78) return 'STRONG BUY';
  if (score >= 65) return 'WATCHLIST';
  if (score >= 52) return 'HOLD';
  if (score >= 42) return 'OVERVALUED';
  if (score >= 32) return 'RISKY';
  return 'PASS';
}

async function callClaude(prompt: string, apiKey: string): Promise<string> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 220,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json() as { content?: { text: string }[] };
    return data.content?.[0]?.text ?? '';
  } catch {
    return '';
  }
}

// ─── Stat enrichment helpers ─────────────────────────────────────────────────

interface StatContext { avg: number; last10Avg?: number; gamesPlayed: number }

const MLB_PROP_FIELDS: Record<string, { group: 'hitting' | 'pitching'; field: string }> = {
  batter_hits:        { group: 'hitting',  field: 'hits'       },
  batter_home_runs:   { group: 'hitting',  field: 'homeRuns'   },
  pitcher_strikeouts: { group: 'pitching', field: 'strikeOuts' },
};

const NHL_PROP_FIELDS: Record<string, string> = {
  player_goals:         'goals',
  player_shots_on_goal: 'shots',
  player_points:        'points',
};

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

async function mlbNameMap(cache: Cache): Promise<Record<string, number>> {
  const key = new Request('https://cache.schlima/mlb/namemap');
  const cached = await cache.match(key).catch(() => null);
  if (cached) return cached.json().catch(() => ({})) as Promise<Record<string, number>>;

  const res = await fetch('https://statsapi.mlb.com/api/v1/sports/1/players?season=2025&gameType=R', {
    headers: { 'User-Agent': 'Schlima/1.0' },
  }).catch(() => null);
  if (!res?.ok) return {};

  const data = await res.json() as { people?: Array<{ id: number; fullName: string }> };
  const map: Record<string, number> = {};
  for (const p of data.people ?? []) map[normName(p.fullName)] = p.id;
  await cache.put(key, new Response(JSON.stringify(map), {
    headers: { 'Cache-Control': 'public, max-age=21600', 'Content-Type': 'application/json' },
  })).catch(() => {});
  return map;
}

async function mlbBatchStats(
  requests: Array<{ playerName: string; market: string }>,
  nameMap: Record<string, number>,
  cache: Cache,
): Promise<Record<string, StatContext>> {
  const result: Record<string, StatContext> = {};
  const hitterIds: number[] = [], pitcherIds: number[] = [];
  const idMeta = new Map<number, Array<{ playerName: string; market: string; field: string; group: string }>>();

  for (const { playerName, market } of requests) {
    const fi = MLB_PROP_FIELDS[market];
    if (!fi) continue;
    const id = nameMap[normName(playerName)];
    if (!id) continue;
    if (!idMeta.has(id)) {
      idMeta.set(id, []);
      (fi.group === 'hitting' ? hitterIds : pitcherIds).push(id);
    }
    idMeta.get(id)!.push({ playerName, market, field: fi.field, group: fi.group });
  }

  const fetchGroup = async (ids: number[], group: string): Promise<Record<number, Record<string, number>>> => {
    if (!ids.length) return {};
    const gKey = new Request(`https://cache.schlima/mlb/batch/${group}/${[...ids].sort().join(',')}`);
    const gc = await cache.match(gKey).catch(() => null);
    if (gc) return gc.json().catch(() => ({})) as Promise<Record<number, Record<string, number>>>;

    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/people?personIds=${ids.join(',')}&hydrate=stats(group=${group},type=season,season=2025)&season=2025`,
      { headers: { 'User-Agent': 'Schlima/1.0' } },
    ).catch(() => null);
    if (!r?.ok) return {};

    const d = await r.json() as {
      people?: Array<{ id: number; stats?: Array<{ splits?: Array<{ stat: Record<string, number> }> }> }>;
    };
    const gr: Record<number, Record<string, number>> = {};
    for (const p of d.people ?? []) {
      const sp = p.stats?.[0]?.splits?.[0];
      if (sp) gr[p.id] = sp.stat;
    }
    await cache.put(gKey, new Response(JSON.stringify(gr), {
      headers: { 'Cache-Control': 'public, max-age=3600', 'Content-Type': 'application/json' },
    })).catch(() => {});
    return gr;
  };

  // Also fetch game logs for last-10-game trend (hitters only for now)
  const fetchGameLog = async (ids: number[], group: string): Promise<Record<number, number[]>> => {
    if (!ids.length) return {};
    const logResults: Record<number, number[]> = {};
    await Promise.allSettled(ids.map(async (id) => {
      const gKey = new Request(`https://cache.schlima/mlb/gamelog/${group}/${id}`);
      const gc = await cache.match(gKey).catch(() => null);
      if (gc) { logResults[id] = await gc.json().catch(() => []) as number[]; return; }

      const fieldKey = group === 'hitting' ? 'hits' : 'strikeOuts';
      const r = await fetch(
        `https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=gameLog&group=${group}&season=2025&sportId=1`,
        { headers: { 'User-Agent': 'Schlima/1.0' } },
      ).catch(() => null);
      if (!r?.ok) return;
      const d = await r.json() as { stats?: Array<{ splits?: Array<{ stat: Record<string, number> }> }> };
      const logs = (d.stats?.[0]?.splits ?? []).slice(-15).map(g => g.stat[fieldKey] ?? 0);
      logResults[id] = logs;
      await cache.put(gKey, new Response(JSON.stringify(logs), {
        headers: { 'Cache-Control': 'public, max-age=3600', 'Content-Type': 'application/json' },
      })).catch(() => {});
    }));
    return logResults;
  };

  const [hStats, pStats, hLogs] = await Promise.all([
    fetchGroup(hitterIds, 'hitting'),
    fetchGroup(pitcherIds, 'pitching'),
    fetchGameLog(hitterIds, 'hitting'),
  ]);

  for (const [id, metas] of idMeta.entries()) {
    for (const { playerName, market, field, group } of metas) {
      const stats = group === 'hitting' ? hStats[id] : pStats[id];
      if (!stats) continue;
      const total = stats[field];
      const gp = stats.gamesPlayed ?? stats.gamesPitched ?? 0;
      if (total == null || gp === 0) continue;

      let last10Avg: number | undefined;
      const logs = hLogs[id];
      if (logs && logs.length >= 5) {
        const recent = logs.slice(-10);
        last10Avg = recent.reduce((s, v) => s + v, 0) / recent.length;
      }

      result[`${playerName}|${market}`] = { avg: total / gp, last10Avg, gamesPlayed: gp };
    }
  }
  return result;
}

async function nhlSingleStats(playerName: string, propMarket: string, cache: Cache): Promise<StatContext | null> {
  const field = NHL_PROP_FIELDS[propMarket];
  if (!field) return null;

  const key = new Request(`https://cache.schlima/nhl/${normName(playerName)}/${field}`);
  const cached = await cache.match(key).catch(() => null);
  if (cached) return cached.json().catch(() => null) as Promise<StatContext | null>;

  const suggestRes = await fetch(
    `https://suggest.svc.nhl.com/svc/suggest/v1/minplayers/${encodeURIComponent(playerName)}/3`,
    { headers: { 'User-Agent': 'Schlima/1.0' } },
  ).catch(() => null);
  if (!suggestRes?.ok) return null;

  const suggestData = await suggestRes.json() as { suggestions?: string[] };
  const playerId = suggestData.suggestions?.[0]?.split('|')[0];
  if (!playerId || isNaN(parseInt(playerId))) return null;

  const pRes = await fetch(`https://api-web.nhle.com/v1/player/${playerId}/landing`).catch(() => null);
  if (!pRes?.ok) return null;

  const pd = await pRes.json() as {
    featuredStats?: { regularSeason?: { subSeason?: Record<string, number> } };
  };
  const stats = pd.featuredStats?.regularSeason?.subSeason;
  if (!stats) return null;

  const gp = stats.gamesPlayed ?? 0;
  const total = stats[field];
  if (!gp || total == null) return null;

  const ctx: StatContext = { avg: total / gp, gamesPlayed: gp };
  await cache.put(key, new Response(JSON.stringify(ctx), {
    headers: { 'Cache-Control': 'public, max-age=3600', 'Content-Type': 'application/json' },
  })).catch(() => {});
  return ctx;
}

async function enrichPlayerStats(
  requests: Array<{ playerName: string; market: string }>,
  sport: string,
  cache: Cache,
): Promise<Record<string, StatContext>> {
  if (sport === 'baseball_mlb') {
    const nameMap = await mlbNameMap(cache);
    return mlbBatchStats(requests, nameMap, cache);
  }
  if (sport === 'icehockey_nhl') {
    const result: Record<string, StatContext> = {};
    await Promise.allSettled(
      requests.slice(0, 12).map(async ({ playerName, market }) => {
        const ctx = await nhlSingleStats(playerName, market, cache);
        if (ctx) result[`${playerName}|${market}`] = ctx;
      }),
    );
    return result;
  }
  return {};
}

// ─── Main handler ──────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders();

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    // ── Auth ──────────────────────────────────────────────────────────────────

    if (url.pathname === '/api/login' && request.method === 'POST') {
      let body: { username?: string; password?: string };
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }
      if (body.username !== 'schlima') return json({ error: 'Invalid credentials' }, 401, cors);
      if (!body.password) return json({ error: 'Invalid credentials' }, 401, cors);
      const inputHash = await pbkdf2Hash(body.password);
      if (inputHash !== env.PASSWORD_HASH) return json({ error: 'Invalid credentials' }, 401, cors);
      const token = await signJWT({ user: 'schlima' }, env.JWT_SECRET);
      return json({ token }, 200, cors);
    }

    if (url.pathname === '/api/verify' && request.method === 'GET') {
      const auth = request.headers.get('Authorization');
      if (!auth?.startsWith('Bearer ')) return json({ valid: false }, 401, cors);
      const payload = await verifyJWT(auth.slice(7), env.JWT_SECRET);
      return json({ valid: !!payload }, payload ? 200 : 401, cors);
    }

    // ── Odds ──────────────────────────────────────────────────────────────────

    if (url.pathname === '/api/scores' && request.method === 'GET') {
      const authErr = await requireAuth(request, env, cors);
      if (authErr) return authErr;
      if (!env.ODDS_API_KEY) return json({ error: 'Odds API not configured' }, 503, cors);
      const sport = url.searchParams.get('sport') ?? 'basketball_nba';
      const scoresUrl = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/scores/`);
      scoresUrl.searchParams.set('apiKey', env.ODDS_API_KEY);
      scoresUrl.searchParams.set('daysFrom', '3');
      try {
        const res = await fetch(scoresUrl.toString());
        if (!res.ok) return json({ error: 'Scores API error' }, 502, cors);
        const data = await res.json();
        return new Response(JSON.stringify(data), { headers: { ...cors, 'Content-Type': 'application/json' } });
      } catch {
        return json({ error: 'Failed to fetch scores' }, 502, cors);
      }
    }

    if (url.pathname === '/api/props' && request.method === 'GET') {
      const authErr = await requireAuth(request, env, cors);
      if (authErr) return authErr;
      if (!env.ODDS_API_KEY) return json({ error: 'Odds API not configured' }, 503, cors);
      const sport = url.searchParams.get('sport') ?? 'basketball_nba';

      // 4-hour server-side cache shared across all users
      const propsCache = caches.default;
      const propsCacheKey = new Request(`https://cache.schlima/props/${sport}`);
      const propsCached = await propsCache.match(propsCacheKey);
      if (propsCached) {
        const body = await propsCached.text();
        return new Response(body, { headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      const propMarketsMap: Record<string, string> = {
        basketball_nba: 'player_points,player_rebounds,player_assists,player_threes',
        baseball_mlb: 'batter_hits,pitcher_strikeouts,batter_home_runs',
        icehockey_nhl: 'player_goals,player_shots_on_goal,player_points',
        americanfootball_nfl: 'player_pass_yds,player_rush_yds,player_reception_yds,player_reception_tds',
      };
      const propMarkets = propMarketsMap[sport] ?? 'player_points';
      try {
        const eventsUrl = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/events/`);
        eventsUrl.searchParams.set('apiKey', env.ODDS_API_KEY);
        const evRes = await fetch(eventsUrl.toString());
        if (!evRes.ok) return json({ error: 'Player props require Odds API Standard plan ($30/mo).' }, 402, cors);
        const events = await evRes.json() as Array<{ id: string; sport_key: string; sport_title: string; commence_time: string; home_team: string; away_team: string }>;
        const now = new Date();
        // Analyse up to 10 upcoming games so we have a large pool to filter from
        const upcoming = events
          .filter(e => new Date(e.commence_time) > now)
          .sort((a, b) => new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime())
          .slice(0, 10);

        // Fetch prop odds for all games in parallel
        // Track plan errors separately so we can give a clear error when all fetches fail
        let planLimited = false;
        const rawProps = await Promise.all(upcoming.map(async (event) => {
          const propUrl = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds/`);
          propUrl.searchParams.set('apiKey', env.ODDS_API_KEY);
          propUrl.searchParams.set('regions', 'us');
          propUrl.searchParams.set('markets', propMarkets);
          propUrl.searchParams.set('oddsFormat', 'american');
          try {
            const res = await fetch(propUrl.toString());
            if (res.status === 422 || res.status === 402 || res.status === 401) {
              planLimited = true;
              return null;
            }
            if (!res.ok) return null;
            const data = await res.json() as { bookmakers?: Array<{ title: string; markets: Array<{ key: string; outcomes: Array<{ name: string; description?: string; price: number; point?: number }> }> }> };
            return { ...event, bookmakers: data.bookmakers ?? [] };
          } catch { return null; }
        }));
        const propsData = rawProps.filter((g): g is NonNullable<typeof g> => g !== null);

        // If every event failed due to a plan limitation, tell the frontend clearly
        if (planLimited && propsData.length === 0) {
          return json({
            error: 'Player props require Odds API Standard plan ($30/mo). Visit the-odds-api.com to upgrade.',
          }, 402, cors);
        }

        // Collect unique player/market combos for stat enrichment
        const statRequests: Array<{ playerName: string; market: string }> = [];
        const seen = new Set<string>();
        for (const game of propsData) {
          for (const bm of game.bookmakers) {
            for (const mkt of bm.markets) {
              for (const out of mkt.outcomes) {
                if (!out.description) continue;
                const k = `${out.description}|${mkt.key}`;
                if (!seen.has(k)) { seen.add(k); statRequests.push({ playerName: out.description, market: mkt.key }); }
              }
            }
          }
        }

        // Enrich with real player stats from official free APIs (MLB + NHL)
        const cache = caches.default;
        const playerStats = await enrichPlayerStats(statRequests, sport, cache);

        // Attach the shared stat map to every game so the frontend can use it
        const enriched = propsData.map(game => ({ ...game, playerStats }));
        const propsBody = JSON.stringify(enriched);
        await propsCache.put(propsCacheKey, new Response(propsBody, {
          headers: { 'Cache-Control': 'public, max-age=86400', 'Content-Type': 'application/json' },
        })).catch(() => {});
        return new Response(propsBody, { headers: { ...cors, 'Content-Type': 'application/json' } });
      } catch {
        return json({ error: 'Failed to fetch player props' }, 502, cors);
      }
    }

    if (url.pathname === '/api/odds' && request.method === 'GET') {
      const authErr = await requireAuth(request, env, cors);
      if (authErr) return authErr;
      if (!env.ODDS_API_KEY) return json({ error: 'Odds API not configured' }, 503, cors);
      const sport = url.searchParams.get('sport') ?? 'basketball_nba';

      // 20-minute server-side cache so all devices see identical picks within the same window
      const cache = caches.default;
      const cacheKey = new Request(`https://cache.schlima/odds/${sport}`);
      const cached = await cache.match(cacheKey);
      if (cached) {
        const body = await cached.text();
        return new Response(body, { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      const oddsUrl = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/odds/`);
      oddsUrl.searchParams.set('apiKey', env.ODDS_API_KEY);
      oddsUrl.searchParams.set('regions', 'us');
      oddsUrl.searchParams.set('markets', 'h2h,spreads,totals');
      oddsUrl.searchParams.set('oddsFormat', 'american');
      try {
        const res = await fetch(oddsUrl.toString());
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({})) as { message?: string; error_code?: string };
          const msg = errBody.message ?? '';
          if (errBody.error_code === 'OUT_OF_USAGE_CREDITS' || res.status === 402 || msg.toLowerCase().includes('usage') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('limit')) {
            return json({ error: 'Odds API monthly credits exhausted. Upgrade at the-odds-api.com or wait until next month.' }, 402, cors);
          }
          if (res.status === 401) return json({ error: 'Invalid Odds API key. Check your ODDS_API_KEY secret.' }, 502, cors);
          return json({ error: msg || 'Odds API error' }, 502, cors);
        }
        const data = await res.json();
        const body = JSON.stringify(data);
        await cache.put(cacheKey, new Response(body, {
          headers: { 'Cache-Control': 'public, max-age=86400', 'Content-Type': 'application/json' },
        }));
        return new Response(body, { headers: { ...cors, 'Content-Type': 'application/json' } });
      } catch {
        return json({ error: 'Failed to fetch odds' }, 502, cors);
      }
    }

    // ── Stock: single ticker ──────────────────────────────────────────────────

    if (url.pathname === '/api/stock/metrics' && request.method === 'GET') {
      const authErr = await requireAuth(request, env, cors);
      if (authErr) return authErr;
      const symbol = (url.searchParams.get('symbol') ?? '').toUpperCase();
      if (!symbol) return json({ error: 'symbol required' }, 400, cors);
      try {
        const cache = caches.default;
        const [quoteRes, summary] = await Promise.all([
          yfFetch<{ quoteResponse?: { result?: YFQuote[] } }>(
            `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`
          ),
          yfSummary(symbol, cache),
        ]);
        const q = quoteRes?.quoteResponse?.result?.[0];
        if (!q) return json({ error: 'Ticker not found' }, 404, cors);
        const fin = summary.financialData ?? {};
        const ks = summary.defaultKeyStatistics ?? {};
        const sd = summary.summaryDetail ?? {};
        const metrics: Record<string, number | null> = {
          revenueGrowth: fin.revenueGrowth?.raw ?? null,
          earningsGrowth: fin.earningsGrowth?.raw ?? null,
          profitMargins: fin.profitMargins?.raw ?? null,
          returnOnEquity: fin.returnOnEquity?.raw ?? null,
          debtToEquity: fin.debtToEquity?.raw ?? null,
          freeCashflow: fin.freeCashflow?.raw ?? null,
          forwardPE: ks.forwardPE?.raw ?? null,
          priceToBook: ks.priceToBook?.raw ?? null,
          beta: sd.beta?.raw ?? null,
        };
        const scoring = scoreLT(q, summary);
        return new Response(JSON.stringify({
          ticker: symbol,
          metrics,
          quote: { c: q.regularMarketPrice, d: q.regularMarketChange, dp: q.regularMarketChangePercent, h: q.regularMarketDayHigh, l: q.regularMarketDayLow, o: q.regularMarketOpen, pc: q.regularMarketPreviousClose },
          profile: { name: q.longName ?? q.shortName ?? symbol, finnhubIndustry: q.industry ?? q.sector ?? 'Unknown', marketCapitalization: (q.marketCap ?? 0) / 1e6, ticker: symbol },
          scoring, rating: ratingFromScore(scoring.overall),
        }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      } catch {
        return json({ error: 'Failed to fetch stock data' }, 502, cors);
      }
    }

    // ── Stock: AI-generated pick ──────────────────────────────────────────────

    if (url.pathname === '/api/stock/generate-pick' && request.method === 'GET') {
      const authErr = await requireAuth(request, env, cors);
      if (authErr) return authErr;
      const type = url.searchParams.get('type');
      const cache = caches.default;

      try {

      // ── Long-term pick ──────────────────────────────────────────────────────
      if (type === 'longterm') {
        const ltKey = new Request('https://cache.schlima/picks/longterm');
        const ltHit = await cache.match(ltKey);
        if (ltHit) return new Response(await ltHit.text(), { headers: { ...cors, 'Content-Type': 'application/json' } });

        // Dynamic universe from multiple screeners — no fixed list
        const [growth, value, anchors] = await Promise.all([
          yfScreener('growth_technology_stocks', 35, cache, 3600),
          yfScreener('undervalued_growth_stocks', 35, cache, 3600),
          yfScreener('portfolio_anchors', 25, cache, 3600),
        ]);
        const seen = new Set<string>();
        const universe: YFQuote[] = [];
        for (const q of [...growth, ...value, ...anchors]) {
          if (!seen.has(q.symbol) && q.regularMarketPrice >= 5 && (q.marketCap ?? 0) > 500e6) {
            seen.add(q.symbol); universe.push(q);
          }
        }

        // Fetch fundamentals in parallel (batched to stay within YF limits)
        type Scored = { q: YFQuote; s: YFSummary; scoring: ReturnType<typeof scoreLT>; rating: string };
        const scored: Scored[] = [];
        const batch = 15;
        for (let i = 0; i < Math.min(universe.length, 75); i += batch) {
          const chunk = universe.slice(i, i + batch);
          const summaries = await Promise.all(chunk.map(q => yfSummary(q.symbol, cache)));
          for (let j = 0; j < chunk.length; j++) {
            const s = summaries[j];
            if (!s.financialData && !s.defaultKeyStatistics) continue;
            const scoring = scoreLT(chunk[j], s);
            scored.push({ q: chunk[j], s, scoring, rating: ratingFromScore(scoring.overall) });
          }
        }
        scored.sort((a, b) => b.scoring.overall - a.scoring.overall);

        const top3 = scored.slice(0, 3);
        if (!top3.length) return json({ error: 'No data available' }, 503, cors);
        const best = top3[0];

        const toStockData = ({ q, s, scoring, rating }: Scored) => ({
          ticker: q.symbol,
          metrics: {
            revenueGrowth:   s.financialData?.revenueGrowth?.raw ?? null,
            earningsGrowth:  s.financialData?.earningsGrowth?.raw ?? null,
            profitMargins:   s.financialData?.profitMargins?.raw ?? null,
            returnOnEquity:  s.financialData?.returnOnEquity?.raw ?? null,
            forwardPE:       s.defaultKeyStatistics?.forwardPE?.raw ?? null,
            debtToEquity:    s.financialData?.debtToEquity?.raw ?? null,
            enterpriseToEbitda: s.defaultKeyStatistics?.enterpriseToEbitda?.raw ?? null,
            beta:            s.defaultKeyStatistics?.beta?.raw ?? s.summaryDetail?.beta?.raw ?? null,
          },
          quote: { c: q.regularMarketPrice, d: q.regularMarketChange, dp: q.regularMarketChangePercent, h: q.regularMarketDayHigh, l: q.regularMarketDayLow, o: q.regularMarketOpen, pc: q.regularMarketPreviousClose },
          profile: { name: q.shortName ?? q.longName ?? q.symbol, finnhubIndustry: q.sector ?? q.industry ?? 'Unknown', marketCapitalization: (q.marketCap ?? s.summaryDetail?.marketCap?.raw ?? 0) / 1e6, ticker: q.symbol },
          scoring,
          rating,
        });

        const fin = best.s.financialData ?? {}, stats = best.s.defaultKeyStatistics ?? {};
        const ai_thesis = env.ANTHROPIC_API_KEY ? await callClaude(
          `Fundamental analysis for long-term investor. Stock: ${best.q.symbol} (${best.q.shortName ?? best.q.symbol}, ${best.q.sector ?? 'Unknown sector'}).` +
          ` Revenue growth ${((fin.revenueGrowth?.raw ?? 0)*100).toFixed(1)}%, earnings growth ${((fin.earningsGrowth?.raw ?? 0)*100).toFixed(1)}%,` +
          ` net margin ${((fin.profitMargins?.raw ?? 0)*100).toFixed(1)}%, ROE ${((fin.returnOnEquity?.raw ?? 0)*100).toFixed(1)}%,` +
          ` forward P/E ${stats.forwardPE?.raw?.toFixed(1) ?? 'N/A'}, EV/EBITDA ${stats.enterpriseToEbitda?.raw?.toFixed(1) ?? 'N/A'}, score ${best.scoring.overall}/100.` +
          ` Write exactly 2 sentences. First: the strongest reason to own long-term. Second: the primary risk. No intro phrases.`,
          env.ANTHROPIC_API_KEY
        ) : '';

        const body = JSON.stringify({ top: toStockData(best), topThree: top3.map(toStockData), ai_thesis });
        await cache.put(ltKey, new Response(body, { headers: { 'Cache-Control': 'public, max-age=10800', 'Content-Type': 'application/json' } })).catch(() => {});
        return new Response(body, { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // ── Day trading pick ────────────────────────────────────────────────────
      if (type === 'daytrading') {
        const dtKey = new Request('https://cache.schlima/picks/daytrading');
        const dtHit = await cache.match(dtKey);
        if (dtHit) return new Response(await dtHit.text(), { headers: { ...cors, 'Content-Type': 'application/json' } });

        // Dynamic universe: top movers + high-volume actives from market today
        const [actives, gainers] = await Promise.all([
          yfScreener('most_actives', 50, cache, 600),
          yfScreener('day_gainers',  30, cache, 600),
        ]);
        const seen2 = new Set<string>();
        const dtUniverse: YFQuote[] = [];
        for (const q of [...actives, ...gainers]) {
          // $10 floor: no penny stocks (wide spreads, manipulation, unpredictable)
          // $200 cap: accessible for small accounts to buy at least 1 share
          if (!seen2.has(q.symbol) && q.regularMarketPrice >= 10 && q.regularMarketPrice <= 200) {
            seen2.add(q.symbol); dtUniverse.push(q);
          }
        }

        // Fetch 1-month daily history for RSI, ATR, SMA trend, avg volume
        const hists = await Promise.all(dtUniverse.slice(0, 50).map(q => yfHistory(q.symbol, '1mo', cache, 600)));

        interface DTCandidate { q: YFQuote; rsi: number; atr: number; volRatio: number; gap: number; score: number }
        const candidates: DTCandidate[] = [];

        for (let i = 0; i < dtUniverse.length && i < 50; i++) {
          const q = dtUniverse[i], h = hists[i];
          if (h.closes.length < 15) continue; // need ≥15 bars for reliable RSI(14)

          const rsi    = calcRSI(h.closes);
          // 7-day ATR captures recent volatility better than 14-day for day trading stops
          const atr7   = h.highs.length >= 8
            ? calcATR(h.highs.slice(-8), h.lows.slice(-8), h.closes.slice(-8), 7)
            : calcATR(h.highs, h.lows, h.closes);
          const avgVol = sma(h.volumes, 20);
          const volRatio = avgVol > 0 ? q.regularMarketVolume / avgVol : 1;
          // Gap = overnight move from previous close to today's open (direction matters)
          const gap = q.regularMarketPreviousClose > 0
            ? ((q.regularMarketOpen - q.regularMarketPreviousClose) / q.regularMarketPreviousClose) * 100 : 0;
          // Short-term vs medium-term trend
          const sma5  = sma(h.closes, 5);
          const sma20 = sma(h.closes, 20);
          const pct   = q.regularMarketChangePercent;

          // ── Hard filters ─────────────────────────────────────────────────────
          if (avgVol < 300000) continue;   // illiquid: wide spreads, harder to exit
          if (rsi > 80)        continue;   // dangerously overbought — likely to reverse sharply
          if (pct > 15)        continue;   // >15% in one day: likely news catalyst, unpredictable
          if (pct < 0)         continue;   // only trade long setups (momentum direction matters)

          // ── Scoring (max 100) ─────────────────────────────────────────────────

          // Volume surge (25 pts): starts rewarding at 1.5×, maxes at 5×
          // High volume = institutional interest confirming the move
          const volumeScore = Math.min(Math.max(volRatio - 1.5, 0) / 3.5, 1) * 25;

          // RSI zone (25 pts): ideal 50-65 = uptrending but not overbought
          // RSI < 50 = no uptrend; RSI > 72 = likely exhausted
          const rsiScore = rsi >= 50 && rsi <= 65 ? 25
                         : rsi >= 45 && rsi < 50  ? 15
                         : rsi > 65 && rsi <= 72  ? 15
                         : rsi > 72               ? 6
                         : rsi >= 38 && rsi < 45  ? 6
                         : 0;

          // Momentum quality (20 pts): ideal 1.5-6% — confirmed but not extended
          // Extended moves (>8%) are often near exhaustion; dangerous to chase
          const momentumScore = pct >= 1.5 && pct <= 6 ? 20
                              : pct > 6  && pct <= 10   ? 13
                              : pct > 10                 ? 5
                              : pct >= 0.5 && pct < 1.5  ? 10
                              : 0;

          // Uptrend (15 pts): 5-day SMA above 20-day SMA = stock has been rising
          // Never buy a falling knife — trade with the trend
          const trendScore = sma5 >= sma20 * 1.005 ? 15   // confirmed uptrend
                           : sma5 >= sma20 * 0.995  ? 8   // flat / borderline
                           : 0;                            // downtrend — no bonus

          // Gap up (15 pts): positive overnight gap = catalyst before open
          // Only reward POSITIVE gaps (negative gaps mean sellers are in control)
          const gapScore = gap > 0 ? Math.min(gap / 4, 1) * 15 : 0;

          const score = volumeScore + rsiScore + momentumScore + trendScore + gapScore;
          candidates.push({ q, rsi, atr: atr7, volRatio, gap, score });
        }
        candidates.sort((a, b) => b.score - a.score);

        // Two-pass: prefer confirmed live movers; fall back to watchlist if market is closed
        const livePass = candidates.filter(c => c.q.regularMarketChangePercent >= 1.0 && c.volRatio >= 1.5 && c.score >= 25);
        const finalCandidates = livePass.length > 0 ? livePass : candidates.filter(c => c.score > 8);
        const mode = livePass.length > 0 ? 'live' : 'watchlist';

        if (!finalCandidates.length) {
          const msg = JSON.stringify({ top: null, candidates: [], ai_setup: '', mode: 'closed', message: 'No stocks found. Markets may be closed or data is unavailable.' });
          return new Response(msg, { headers: { ...cors, 'Content-Type': 'application/json' } });
        }

        const best = finalCandidates[0], bq = best.q;
        const atr = best.atr > 0 ? best.atr : bq.regularMarketPrice * 0.015;
        const entry = parseFloat(bq.regularMarketPrice.toFixed(2));

        // Stop placement: use day's low (natural support) if it's within 2% of entry
        // If day's low is far away (stock already moved a lot), use 0.5×ATR instead
        // Cap at 2% max to keep position sizing viable for small accounts
        const dayLowDist = entry - bq.regularMarketDayLow;
        const rawStop = dayLowDist > 0 && dayLowDist <= entry * 0.02
          ? dayLowDist              // day's low is clean nearby support
          : Math.min(atr * 0.5, entry * 0.02); // ATR-based, max 2%
        const stopDistance = Math.min(Math.max(rawStop, entry * 0.005), entry * 0.02); // 0.5–2% range
        const stop   = parseFloat((entry - stopDistance).toFixed(2));
        const target = parseFloat((entry + stopDistance * 2.0).toFixed(2)); // strict 2:1 R:R

        const ai_setup = env.ANTHROPIC_API_KEY ? await callClaude(
          `Day trading setup: ${bq.symbol} (${bq.shortName ?? bq.symbol}).` +
          ` Price $${entry}, change +${bq.regularMarketChangePercent.toFixed(2)}%, RSI ${best.rsi},` +
          ` volume ${best.volRatio.toFixed(1)}x avg, gap ${best.gap.toFixed(1)}%, ATR $${atr.toFixed(2)}.` +
          ` Entry $${entry}, stop $${stop}, target $${target} (${((target-entry)/(entry-stop)).toFixed(1)}:1 R/R).` +
          ` Write exactly 2 sentences. First: why this setup is strong today. Second: what invalidates the trade. No intro phrases.`,
          env.ANTHROPIC_API_KEY
        ) : '';

        const toQuote = ({ q }: DTCandidate) => ({ symbol: q.symbol, c: q.regularMarketPrice, d: q.regularMarketChange, dp: q.regularMarketChangePercent, h: q.regularMarketDayHigh, l: q.regularMarketDayLow, o: q.regularMarketOpen, pc: q.regularMarketPreviousClose });
        const body = JSON.stringify({
          top: { ...toQuote(best), entry, stop, target, rsi: best.rsi, atr: parseFloat(atr.toFixed(2)), volRatio: parseFloat(best.volRatio.toFixed(2)), score: Math.round(best.score), gap: parseFloat(best.gap.toFixed(2)) },
          candidates: finalCandidates.slice(0, 8).map(c => ({ ...toQuote(c), rsi: c.rsi, volRatio: parseFloat(c.volRatio.toFixed(2)), score: Math.round(c.score) })),
          ai_setup,
          mode,
        });
        await cache.put(dtKey, new Response(body, { headers: { 'Cache-Control': 'public, max-age=900', 'Content-Type': 'application/json' } })).catch(() => {});
        return new Response(body, { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      return json({ error: 'type must be longterm or daytrading' }, 400, cors);
      } catch {
        return json({ error: 'Failed to generate pick' }, 502, cors);
      }
    }

    // ── Stock: Candlestick data ───────────────────────────────────────────────

    if (url.pathname === '/api/stock/candles' && request.method === 'GET') {
      const authErr = await requireAuth(request, env, cors);
      if (authErr) return authErr;
      const symbol = (url.searchParams.get('symbol') ?? 'SPY').toUpperCase();
      const interval = url.searchParams.get('interval') ?? '5m';
      const intervalCfg: Record<string, { range: string; ttl: number }> = {
        '1m':  { range: '1d',  ttl: 60   },
        '5m':  { range: '1d',  ttl: 300  },
        '15m': { range: '5d',  ttl: 600  },
        '1h':  { range: '1mo', ttl: 1800 },
        '1d':  { range: '3mo', ttl: 3600 },
      };
      const cfg = intervalCfg[interval] ?? intervalCfg['5m'];
      const candleCache = caches.default;
      const ck = new Request(`https://cache.schlima/candles/${symbol}/${interval}`);
      const ch = await candleCache.match(ck);
      if (ch) return new Response(await ch.text(), { headers: { ...cors, 'Content-Type': 'application/json' } });

      const data = await yfFetch<Record<string, unknown>>(
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${cfg.range}`
      );
      const rows = ((data?.chart as Record<string, unknown> | undefined)?.result as unknown[] | undefined)?.[0] as Record<string, unknown> | undefined;
      if (!rows) return json({ error: 'No data' }, 502, cors);
      const timestamps = (rows.timestamp as number[] | undefined) ?? [];
      const quote = (((rows.indicators as Record<string, unknown> | undefined)?.quote as unknown[] | undefined)?.[0]) as Record<string, (number | null)[]> | undefined;
      if (!quote || !timestamps.length) return json({ error: 'No data' }, 502, cors);
      const candles = timestamps.map((t, i) => ({
        time: t,
        open:   quote.open?.[i]   ?? 0,
        high:   quote.high?.[i]   ?? 0,
        low:    quote.low?.[i]    ?? 0,
        close:  quote.close?.[i]  ?? 0,
        volume: quote.volume?.[i] ?? 0,
      })).filter(c => c.open > 0 && c.close > 0);
      const cbody = JSON.stringify(candles);
      await candleCache.put(ck, new Response(cbody, { headers: { 'Cache-Control': `public, max-age=${cfg.ttl}`, 'Content-Type': 'application/json' } })).catch(() => {});
      return new Response(cbody, { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    return new Response('Not found', { status: 404, headers: cors });
  },
};
