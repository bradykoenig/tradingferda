export interface Env {
  PASSWORD_HASH: string;
  JWT_SECRET: string;
  ODDS_API_KEY: string;
  FINNHUB_API_KEY: string;
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

const LT_UNIVERSE = ['MSFT','AAPL','GOOGL','META','AMZN','NVDA','JPM','V','MA','UNH','JNJ','PG','KO','COST','AVGO','HD','WMT','LLY','ABBV','BRK.B'];
const DT_UNIVERSE = ['NVDA','AMD','TSLA','COIN','MSTR','PLTR','SOFI','SMCI','NFLX','SHOP','RIVN','UPST','AFRM','GME','HOOD','SQ','PYPL','SOXL','TQQQ','RBLX'];

interface FinnhubQuote { c: number; d: number; dp: number; h: number; l: number; o: number; pc: number }
interface FinnhubProfile { name: string; finnhubIndustry: string; marketCapitalization: number; ticker: string }
interface FinnhubMetrics { metric: Record<string, number | null> }

async function fh<T>(path: string, key: string): Promise<T> {
  const res = await fetch(`https://finnhub.io/api/v1${path}&token=${key}`);
  return res.json() as Promise<T>;
}

function scorePct(v: number | null | undefined, bad: number, good: number): number {
  if (v == null || !isFinite(v)) return 45;
  return Math.round(Math.min(Math.max((v - bad) / (good - bad), 0), 1) * 100);
}

function scoreLT(m: Record<string, number | null>): { overall: number; dims: Record<string, number> } {
  const dims: Record<string, number> = {
    'Revenue Growth':   scorePct(m['revenueGrowth3Y'] ?? m['revenueGrowthTTMYoy'], 0, 20),
    'Earnings Growth':  scorePct(m['epsGrowthTTMYoy'] ?? m['epsGrowth3Y'], 0, 25),
    'Net Margin':       scorePct(m['netMarginTTM'] ?? m['netMarginAnnual'], 0, 30),
    'Valuation':        scorePct(m['peExclExtraTTM'] ?? m['peBasicExclExtraTTM'], 55, 12),
    'Free Cash Flow':   scorePct(m['pfcfShareTTM'], 60, 12),
    'Debt Level':       scorePct(m['totalDebt/totalEquityAnnual'], 4, 0),
    'Return on Equity': scorePct(m['roeTTM'] ?? m['roe5Y'], 5, 35),
    'Risk (Beta)':      scorePct(m['beta'], 2.0, 0.5),
  };
  const weights = [0.15, 0.15, 0.15, 0.15, 0.15, 0.10, 0.10, 0.05];
  const overall = Math.round(Object.values(dims).reduce((s, v, i) => s + v * weights[i], 0));
  return { overall, dims };
}

function ratingFromScore(score: number): string {
  if (score >= 80) return 'STRONG BUY';
  if (score >= 70) return 'WATCHLIST';
  if (score >= 60) return 'HOLD';
  if (score >= 50) return 'OVERVALUED';
  if (score >= 40) return 'RISKY';
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
          headers: { 'Cache-Control': 'public, max-age=14400', 'Content-Type': 'application/json' },
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
          headers: { 'Cache-Control': 'public, max-age=14400', 'Content-Type': 'application/json' },
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
      if (!env.FINNHUB_API_KEY) return json({ error: 'Stock API not configured' }, 503, cors);
      const symbol = (url.searchParams.get('symbol') ?? '').toUpperCase();
      if (!symbol) return json({ error: 'symbol required' }, 400, cors);
      try {
        const [metrics, quote, profile] = await Promise.all([
          fh<FinnhubMetrics>(`/stock/metric?symbol=${symbol}&metric=all`, env.FINNHUB_API_KEY),
          fh<FinnhubQuote>(`/quote?symbol=${symbol}`, env.FINNHUB_API_KEY),
          fh<FinnhubProfile>(`/stock/profile2?symbol=${symbol}`, env.FINNHUB_API_KEY),
        ]);
        if (!profile.name) return json({ error: 'Ticker not found' }, 404, cors);
        const scoring = scoreLT(metrics.metric);
        return new Response(JSON.stringify({
          ticker: symbol, metrics: metrics.metric, quote, profile,
          scoring, rating: ratingFromScore(scoring.overall),
        }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      } catch {
        return json({ error: 'Failed to fetch stock data' }, 502, cors);
      }
    }

    // ── Stock: batch quotes (day trading watchlist) ────────────────────────────

    if (url.pathname === '/api/stock/quotes' && request.method === 'GET') {
      const authErr = await requireAuth(request, env, cors);
      if (authErr) return authErr;
      if (!env.FINNHUB_API_KEY) return json({ error: 'Stock API not configured' }, 503, cors);
      const symbols = (url.searchParams.get('symbols') ?? '').split(',').filter(Boolean).slice(0, 25);
      if (!symbols.length) return json({ error: 'symbols required' }, 400, cors);
      const quotes = await Promise.all(
        symbols.map(s =>
          fh<FinnhubQuote>(`/quote?symbol=${s}`, env.FINNHUB_API_KEY)
            .then(q => ({ symbol: s, ...q }))
            .catch(() => null)
        )
      );
      return new Response(JSON.stringify(quotes.filter(Boolean)), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // ── Stock: AI-generated pick ──────────────────────────────────────────────

    if (url.pathname === '/api/stock/generate-pick' && request.method === 'GET') {
      const authErr = await requireAuth(request, env, cors);
      if (authErr) return authErr;
      if (!env.FINNHUB_API_KEY) return json({ error: 'Stock API not configured' }, 503, cors);
      try {

      const type = url.searchParams.get('type');

      // ── Long-term pick ──────────────────────────────────────────────────────
      if (type === 'longterm') {
        const results = await Promise.all(
          LT_UNIVERSE.map(async (symbol) => {
            try {
              const [metrics, quote, profile] = await Promise.all([
                fh<FinnhubMetrics>(`/stock/metric?symbol=${symbol}&metric=all`, env.FINNHUB_API_KEY),
                fh<FinnhubQuote>(`/quote?symbol=${symbol}`, env.FINNHUB_API_KEY),
                fh<FinnhubProfile>(`/stock/profile2?symbol=${symbol}`, env.FINNHUB_API_KEY),
              ]);
              const scoring = scoreLT(metrics.metric);
              return { symbol, metrics: metrics.metric, quote, profile, scoring, rating: ratingFromScore(scoring.overall) };
            } catch { return null; }
          })
        );

        const stocks = results
          .filter((r): r is NonNullable<typeof r> => r !== null && r.profile.name !== undefined)
          .sort((a, b) => b.scoring.overall - a.scoring.overall);

        const top = stocks[0];
        if (!top) return json({ error: 'No data available' }, 503, cors);

        let ai_thesis = '';
        if (env.ANTHROPIC_API_KEY) {
          const m = top.metrics;
          ai_thesis = await callClaude(
            `Analyze ${top.symbol} (${top.profile.name}, ${top.profile.finnhubIndustry}) for a disciplined long-term investor. ` +
            `Metrics — PE: ${m['peExclExtraTTM']?.toFixed(1)}, RevenueGrowth3Y: ${m['revenueGrowth3Y']?.toFixed(1)}%, ` +
            `EPSGrowthTTM: ${m['epsGrowthTTMYoy']?.toFixed(1)}%, NetMargin: ${m['netMarginTTM']?.toFixed(1)}%, ` +
            `D/E: ${m['totalDebt/totalEquityAnnual']?.toFixed(2)}, ROE: ${m['roeTTM']?.toFixed(1)}%, ` +
            `Beta: ${m['beta']?.toFixed(2)}, Price: $${top.quote.c?.toFixed(2)}, Score: ${top.scoring.overall}/100. ` +
            `Write exactly 2 sentences. First: the strongest reason to own this stock long-term. Second: the primary risk or reason to wait. Be specific to the numbers. No intro phrases like "Based on" or "This stock".`,
            env.ANTHROPIC_API_KEY
          );
        }

        return new Response(JSON.stringify({ top, topThree: stocks.slice(0, 3), ai_thesis }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }

      // ── Day trading pick ────────────────────────────────────────────────────
      if (type === 'daytrading') {
        const quotes = await Promise.all(
          DT_UNIVERSE.map(async (symbol) => {
            const q = await fh<FinnhubQuote>(`/quote?symbol=${symbol}`, env.FINNHUB_API_KEY).catch(() => null);
            return q ? { symbol, ...q } : null;
          })
        );

        const active = quotes
          .filter((q): q is NonNullable<typeof q> => q !== null && Math.abs(q.dp) > 1.5 && q.c > 3 && q.l > 0)
          .sort((a, b) => Math.abs(b.dp) - Math.abs(a.dp));

        if (!active.length) {
          return new Response(JSON.stringify({ top: null, candidates: [], ai_setup: '', message: 'No active setups right now. Markets may be closed or low-volatility.' }), {
            headers: { ...cors, 'Content-Type': 'application/json' },
          });
        }

        const top = active[0];
        const entry  = parseFloat(top.c.toFixed(2));
        const stop   = parseFloat(Math.max(top.l, entry * 0.98).toFixed(2));
        const risk   = entry - stop;
        const target = parseFloat((entry + risk * 2.5).toFixed(2));

        let ai_setup = '';
        if (env.ANTHROPIC_API_KEY) {
          ai_setup = await callClaude(
            `Intraday trading setup for ${top.symbol}: price $${top.c.toFixed(2)}, ${top.dp > 0 ? '+' : ''}${top.dp.toFixed(2)}% today. ` +
            `Day range $${top.l.toFixed(2)}-$${top.h.toFixed(2)}, opened $${top.o.toFixed(2)}. ` +
            `Setup: entry ~$${entry}, stop $${stop}, target $${target} (2.5:1 R:R). ` +
            `Write exactly 2 sentences. First: what makes this setup worth taking right now. Second: what price action would invalidate it. No intro phrases. Be specific to the levels.`,
            env.ANTHROPIC_API_KEY
          );
        }

        return new Response(JSON.stringify({
          top: { ...top, entry, stop, target },
          candidates: active.slice(0, 6),
          ai_setup,
        }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      return json({ error: 'type must be longterm or daytrading' }, 400, cors);
      } catch {
        return json({ error: 'Failed to generate pick' }, 502, cors);
      }
    }

    return new Response('Not found', { status: 404, headers: cors });
  },
};
