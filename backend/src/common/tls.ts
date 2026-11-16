import { existsSync, readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';

export interface TlsServeOptions {
  pfx?: Buffer;
  passphrase?: string;
  key?: Buffer;
  cert?: Buffer;
}

export interface TlsCertificateSummary {
  subject: string;
  validFrom: string;
  validTo: string;
  thumbprint: string;
}

export interface TlsMaterial {
  options: TlsServeOptions;
  httpsPort: number;
  /** 0 disables the plain-HTTP redirect listener. */
  redirectPort: number;
  certificatePath: string | null;
  certificate: TlsCertificateSummary | null;
}

let cached: TlsMaterial | null | undefined;

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = parseInt((value || '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback;
}

function summarize(der: Buffer): TlsCertificateSummary | null {
  try {
    const certificate = new X509Certificate(der);
    return {
      subject: certificate.subject.split('\n').join(', '),
      validFrom: certificate.validFrom,
      validTo: certificate.validTo,
      thumbprint: certificate.fingerprint.replace(/:/g, '').toUpperCase(),
    };
  } catch {
    return null;
  }
}

/**
 * Resolves the TLS material from the environment.
 *
 * Returns null when no certificate is configured (development). A partially
 * configured TLS setup throws instead of silently falling back to plain HTTP,
 * so an installed server can never be downgraded by a typo.
 */
export function getTlsMaterial(): TlsMaterial | null {
  if (cached !== undefined) return cached;

  const pfxPath = (process.env.TLS_PFX_PATH || '').trim();
  const keyPath = (process.env.TLS_KEY_PATH || '').trim();
  const certPath = (process.env.TLS_CERT_PATH || '').trim();
  const publicPath = (process.env.TLS_CERT_PUBLIC_PATH || '').trim();
  const passphrase = process.env.TLS_PFX_PASSPHRASE || '';

  const hasPfx = pfxPath.length > 0;
  const hasPem = keyPath.length > 0 || certPath.length > 0;
  if (!hasPfx && !hasPem) {
    cached = null;
    return cached;
  }
  if (hasPfx && hasPem) {
    throw new Error(
      'Configure either TLS_PFX_PATH or TLS_KEY_PATH/TLS_CERT_PATH, not both',
    );
  }

  let options: TlsServeOptions;
  if (hasPfx) {
    if (!existsSync(pfxPath)) {
      throw new Error('TLS_PFX_PATH points to a missing file: ' + pfxPath);
    }
    options = { pfx: readFileSync(pfxPath), passphrase: passphrase || undefined };
  } else {
    if (!keyPath || !certPath) {
      throw new Error('Both TLS_KEY_PATH and TLS_CERT_PATH are required for PEM TLS');
    }
    if (!existsSync(keyPath) || !existsSync(certPath)) {
      throw new Error('TLS_KEY_PATH or TLS_CERT_PATH points to a missing file');
    }
    options = { key: readFileSync(keyPath), cert: readFileSync(certPath) };
  }

  const httpsPort = parsePort(process.env.PORT, 3000);
  const redirectDefault = httpsPort <= 65000 ? httpsPort + 80 : 0;
  const redirectRaw = (process.env.HTTP_REDIRECT_PORT || '').trim();
  const redirectPort =
    redirectRaw === '0' ? 0 : parsePort(redirectRaw, redirectDefault);

  let certificate: TlsCertificateSummary | null = null;
  if (publicPath && existsSync(publicPath)) {
    certificate = summarize(readFileSync(publicPath));
  }

  cached = {
    options,
    httpsPort,
    redirectPort: redirectPort === httpsPort ? 0 : redirectPort,
    certificatePath: publicPath && existsSync(publicPath) ? publicPath : null,
    certificate,
  };
  return cached;
}

/** HSTS stays opt-in: a self-signed certificate plus HSTS would lock browsers out. */
export function getHstsMaxAge(): number {
  const parsed = parseInt((process.env.TLS_HSTS_MAX_AGE || '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}
