export interface Env {
  PASSWORD_HASH: string;
  JWT_SECRET: string;
  ODDS_API_KEY: string;
  FINNHUB_API_KEY: string;
  ANTHROPIC_API_KEY: string;
}

const SALT = 'schlima-site-v1-salt';
const JWT_EXPIRY = 60 * 60 * 24;

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

    if (url.pathname === '/api/odds' && request.method === 'GET') {
      const authErr = await requireAuth(request, env, cors);
      if (authErr) return authErr;
      if (!env.ODDS_API_KEY) return json({ error: 'Odds API not configured' }, 503, cors);
      const sport = url.searchParams.get('sport') ?? 'basketball_nba';
      const oddsUrl = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/odds/`);
      oddsUrl.searchParams.set('apiKey', env.ODDS_API_KEY);
      oddsUrl.searchParams.set('regions', 'us');
      oddsUrl.searchParams.set('markets', 'h2h,spreads,totals');
      oddsUrl.searchParams.set('oddsFormat', 'american');
      const res = await fetch(oddsUrl.toString());
      if (!res.ok) return json({ error: 'Odds API error' }, 502, cors);
      const data = await res.json();
      return new Response(JSON.stringify(data), { headers: { ...cors, 'Content-Type': 'application/json' } });
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
