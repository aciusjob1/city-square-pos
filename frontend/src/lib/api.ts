/**
 * Tiny fetch wrapper. No dependencies.
 *
 * Responsibilities:
 *   - Attach Authorization: Bearer <token> when present.
 *   - Parse JSON responses uniformly.
 *   - On 401 from a PROTECTED endpoint, clear auth and redirect to /login.
 *   - On 401 from /auth/login, return the server's actual error message
 *     (Invalid credentials) rather than falsely saying "Session expired".
 */

const BASE = '/api';
const TOKEN_KEY = 'cs_auth_token';

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

  // Parse body first so we can pass through the server's error message.
  let body: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  // Handle 401 differently depending on the endpoint.
  if (response.status === 401) {
    const isLoginRequest = path === '/auth/login';

    if (!isLoginRequest) {
      // A token was present but rejected, OR a protected route denied access.
      // Wipe local auth and redirect to login.
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

    // Login 401: pass through the backend's message ("Invalid credentials").
    const loginMessage =
      (body && typeof body === 'object' && 'message' in body
        ? String((body as Record<string, unknown>).message)
        : null) ?? 'Invalid credentials';
    return {
      ok: false,
      status: 401,
      data: null,
      errorMessage: loginMessage,
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
