/**
 * Role enum — MUST match backend RoleName enum exactly.
 * Verified against: SELECT enum_range(NULL::"RoleName");
 *   → {ADMIN, MANAGER, CASHIER, WAITER, KITCHEN}
 */
export type Role = 'ADMIN' | 'MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN';

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: Role;
}

export interface LoginResponse {
  accessToken: string;
  user: User;
}

/** Shape of what we persist in localStorage. */
export interface StoredAuth {
  token: string;
  user: User;
  /** Unix epoch seconds — read from JWT `exp`. Not invented. */
  expiresAt: number;
}
