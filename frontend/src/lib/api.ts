/**
 * Tiny fetch wrapper. No dependencies.
 *
 * Responsibilities:
 *   - Attach Authorization: Bearer <token> when present.
 *   - Parse JSON responses uniformly.
 *   - On 401 from a PROTECTED endpoint, clear auth and redirect to /login.
 *   - On 401 from a login endpoint (/auth/login, /auth/login-pin),
 *     return the server's actual error message instead of falsely
 *     saying "Session expired".
 */

const BASE = '/api';
const TOKEN_KEY = 'cs_auth_token';

// Endpoints where a 401 means "wrong credentials", not "session expired"
const LOGIN_ENDPOINTS = ['/auth/login', '/auth/login-pin'];

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  errorMessage: string | null;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResult<T>> {
  const headers = new Headers(options.headers ?? {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { ...options, headers });
  } catch {
    return {
      ok: false,
      status: 0,
      data: null,
      errorMessage: 'Network error — is the backend running?',
    };
  }

  let body: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (response.status === 401) {
    const isLoginEndpoint = LOGIN_ENDPOINTS.some((p) => path === p);

    if (isLoginEndpoint) {
      // Pass through the server's message: "Invalid credentials", "Invalid PIN"
      const message =
        (body && typeof body === 'object' && 'message' in body
          ? String((body as Record<string, unknown>).message)
          : null) ?? 'Authentication failed';
      return { ok: false, status: 401, data: null, errorMessage: message };
    }

    // Protected endpoint with a bad/expired token
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('cs_auth_user');
    localStorage.removeItem('cs_auth_exp');
    if (window.location.pathname !== '/login') {
      window.location.replace('/login');
    }
    return {
      ok: false,
      status: 401,
      data: null,
      errorMessage: 'Session expired. Please sign in again.',
    };
  }

  if (!response.ok) {
    const message =
      (body && typeof body === 'object' && 'message' in body
        ? String((body as Record<string, unknown>).message)
        : null) ?? `Request failed (${response.status})`;
    return { ok: false, status: response.status, data: null, errorMessage: message };
  }

  return { ok: true, status: response.status, data: body as T, errorMessage: null };
}

export const TOKEN_STORAGE_KEY = TOKEN_KEY;
export const USER_STORAGE_KEY = 'cs_auth_user';
export const EXP_STORAGE_KEY = 'cs_auth_exp';
