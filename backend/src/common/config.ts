const DEV_FALLBACK_SECRET = 'dev-only-change-me';

let warnedMissingSecret = false;
let warnedMissingCors = false;

/**
 * Resolves the JWT signing secret.
 *
 * The old code silently fell back to a hard-coded string, which meant any
 * deployment that forgot JWT_SECRET accepted tokens signed with a public
 * value (full auth bypass). Production now refuses to boot without a real
 * secret; development still runs with a loud warning.
 */
export function getJwtSecret(): string {
  const secret = (process.env.JWT_SECRET || '').trim();
  const isProduction = process.env.NODE_ENV === 'production';

  if (secret) {
    if (isProduction && secret === DEV_FALLBACK_SECRET) {
      throw new Error(
        'JWT_SECRET must not be the default development value in production',
      );
    }
    if (isProduction && secret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters in production');
    }
    return secret;
  }

  if (isProduction) {
    throw new Error('JWT_SECRET environment variable is required in production');
  }

  if (!warnedMissingSecret) {
    warnedMissingSecret = true;
    // eslint-disable-next-line no-console
    console.warn(
      '[security] JWT_SECRET is not set — using an insecure development fallback. ' +
        'Set JWT_SECRET before exposing this server.',
    );
  }
  return DEV_FALLBACK_SECRET;
}

/**
 * Pepper used for the deterministic PIN lookup column. Kept separate from
 * JWT_SECRET so rotating JWT_SECRET does not invalidate every waiter PIN.
 * Defaults to the JWT secret so existing deployments keep working.
 */
export function getPinPepper(): string {
  const pepper = (process.env.PIN_PEPPER || '').trim();
  return pepper || getJwtSecret();
}

/**
 * Comma-separated list of allowed browser origins. A wildcard is no longer
 * reflected back; unknown origins are simply not granted CORS headers.
 */
export function getCorsOrigins(): string[] {
  const raw = (process.env.CORS_ORIGINS || '').trim();
  if (!raw) {
    if (process.env.NODE_ENV === 'production' && !warnedMissingCors) {
      warnedMissingCors = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[security] CORS_ORIGINS is not set; only localhost dev origins are allowed. ' +
          'Set CORS_ORIGINS to your frontend origin(s) in production.',
      );
    }
    return ['http://localhost:5173', 'http://127.0.0.1:5173'];
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
