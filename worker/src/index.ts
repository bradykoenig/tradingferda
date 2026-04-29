export interface Env {
  PASSWORD_HASH: string;
  JWT_SECRET: string;
}

const SALT = 'schlima-site-v1-salt';
const JWT_EXPIRY_SECONDS = 60 * 60 * 24; // 24 hours

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

async function pbkdf2Hash(password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(SALT), iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  return Array.from(new Uint8Array(bits))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function b64url(input: string | Uint8Array): string {
  const str = typeof input === 'string' ? input : String.fromCharCode(...input);
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function signJWT(payload: Record<string, unknown>, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + JWT_EXPIRY_SECONDS }));
  const message = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return `${message}.${b64url(new Uint8Array(sig))}`;
}

async function verifyJWT(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    b64urlDecode(sig),
    new TextEncoder().encode(`${header}.${body}`)
  );
  if (!valid) return null;
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
  return payload;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders();

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === '/api/login' && request.method === 'POST') {
      let body: { username?: string; password?: string };
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid JSON' }, 400, cors);
      }

      if (!body.username || !body.password) {
        return json({ error: 'Invalid credentials' }, 401, cors);
      }

      if (body.username !== 'schlima') {
        return json({ error: 'Invalid credentials' }, 401, cors);
      }

      const inputHash = await pbkdf2Hash(body.password);
      if (inputHash !== env.PASSWORD_HASH) {
        return json({ error: 'Invalid credentials' }, 401, cors);
      }

      const token = await signJWT({ user: 'schlima' }, env.JWT_SECRET);
      return json({ token }, 200, cors);
    }

    if (url.pathname === '/api/verify' && request.method === 'GET') {
      const auth = request.headers.get('Authorization');
      if (!auth?.startsWith('Bearer ')) {
        return json({ valid: false }, 401, cors);
      }
      const payload = await verifyJWT(auth.slice(7), env.JWT_SECRET);
      if (!payload) return json({ valid: false }, 401, cors);
      return json({ valid: true }, 200, cors);
    }

    return new Response('Not found', { status: 404, headers: cors });
  },
};
