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
