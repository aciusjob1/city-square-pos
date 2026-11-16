import 'dotenv/config';
import { existsSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { getCorsOrigins } from './common/config';
import { getHstsMaxAge, getTlsMaterial } from './common/tls';
import { NetworkService } from './network/network.module';

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Host header minus any port, scrubbed so it cannot point at another site. */
function redirectHost(hostHeader: string | undefined): string {
  const raw = (hostHeader || '').trim();
  if (!raw || !/^[0-9A-Za-z.\-:[\]]+$/.test(raw)) return 'localhost';
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end > 0 ? raw.slice(0, end + 1) : 'localhost';
  }
  const colon = raw.lastIndexOf(':');
  if (colon > 0 && /^\d+$/.test(raw.slice(colon + 1))) return raw.slice(0, colon);
  return raw;
}

function startHttpRedirect(redirectPort: number, httpsPort: number) {
  const server = createHttpServer((req, res) => {
    const host = redirectHost(req.headers.host);
    const authority = httpsPort === 443 ? host : host + ':' + httpsPort;
    const target = req.url && req.url.startsWith('/') ? req.url : '/';
    // 301 for reads, 308 for everything else so the method and body survive.
    const status = req.method === 'GET' || req.method === 'HEAD' ? 301 : 308;
    res.writeHead(status, {
      Location: 'https://' + authority + target,
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    });
    res.end('Redirecting to HTTPS');
  });
  server.on('error', (error: Error) => {
    console.warn('[tls] HTTP redirect listener unavailable: ' + error.message);
  });
  server.listen(redirectPort, '0.0.0.0', () => {
    console.log('HTTP -> HTTPS redirect on http://0.0.0.0:' + redirectPort);
  });
  server.unref();
}

function resolveFrontendDir(): string | null {
  const candidates = [
    process.env.FRONTEND_DIR?.trim(),
    join(process.cwd(), '..', 'frontend', 'dist'),
    join(process.cwd(), 'frontend', 'dist'),
  ].filter((dir): dir is string => Boolean(dir));

  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) return dir;
  }
  return null;
}

async function bootstrap() {
  const tls = getTlsMaterial();

  // Settings logos travel as base64 data URLs; the Express default of 100 kB
  // rejects the ~600 kB payload the UI allows.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    ...(tls ? { httpsOptions: tls.options } : {}),
  });
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ extended: true, limit: '2mb' }));
  app.setGlobalPrefix('api');
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  const hstsMaxAge = tls ? getHstsMaxAge() : 0;
  app.use((_req: any, res: any, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    if (hstsMaxAge > 0) {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=' + hstsMaxAge + '; includeSubDomains',
      );
    }
    next();
  });

  // Cable-only mode: reject every non-local request that does not originate
  // inside the subnet of a wired adapter on this server.
  const network = app.get(NetworkService);
  let lastBlockLog = 0;
  app.use(async (req: any, res: any, next: () => void) => {
    try {
      if ((await network.mode()) === 'WIRED' && !network.isAllowed(req.socket?.remoteAddress)) {
        if (Date.now() - lastBlockLog > 30_000) {
          lastBlockLog = Date.now();
          console.warn(
            '[security] blocked non-cable client ' + (req.socket?.remoteAddress ?? 'unknown') +
              ' (cable-only mode)',
          );
        }
        res.statusCode = 403;
        res.setHeader('Cache-Control', 'no-store');
        if (String(req.path ?? '').startsWith('/api')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({
            statusCode: 403,
            error: 'Forbidden',
            message:
              'This server only accepts cable (LAN) terminals. Connect this device with an Ethernet cable or ask the manager to allow Wi-Fi terminals in Settings.',
          }));
        } else {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(
            '<!doctype html><meta charset="utf-8"><title>City Square POS</title>' +
              '<body style="font-family:Segoe UI,Arial,sans-serif;background:#111;color:#eee;' +
              'display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
              '<main style="max-width:520px;padding:32px;text-align:center">' +
              '<h1 style="margin:0 0 12px">Cable connection required</h1>' +
              '<p style="line-height:1.5;color:#c9c9c9">This City Square POS server only accepts ' +
              'terminals connected with an Ethernet cable. Connect this device with a cable, or ' +
              'ask the manager to allow Wi-Fi terminals in Settings → Network access.</p>' +
              '</main>',
          );
        }
        return;
      }
    } catch {
      // A database hiccup must not lock every device out.
    }
    next();
  });

  // Coarse per-IP limiter for API traffic; login and PIN endpoints keep their
  // own stricter attempt limits in the database.
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const prune = setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(ip);
    }
  }, 60_000);
  prune.unref?.();
  app.use('/api', (req: any, res: any, next: () => void) => {
    const ip = req.socket?.remoteAddress ?? 'unknown';
    const now = Date.now();
    let bucket = buckets.get(ip);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + 60_000 };
      buckets.set(ip, bucket);
    }
    bucket.count += 1;
    if (bucket.count > 600) {
      res.status(429).json({
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Too many requests from this device. Try again in a minute.',
      });
      return;
    }
    next();
  });

  app.enableCors({
    origin: getCorsOrigins(),
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id'],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Production (installed) mode: one server serves both the API and the SPA.
  // In development FRONTEND_DIR is unset, so fall back to the local build if
  // one exists — that way opening http://localhost:3000 works too.
  const frontendDir = resolveFrontendDir();
  if (frontendDir) {
    app.useStaticAssets(frontendDir, {
      index: 'index.html',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.includes('assets')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    });
    // Any non-API GET renders the SPA shell so deep links keep working.
    app
      .getHttpAdapter()
      .getInstance()
      .get(/^\/(?!api(?:\/|$)).*/, (_req: any, res: any) => {
        res.sendFile(join(frontendDir, 'index.html'));
      });
  }

  const port = tls ? tls.httpsPort : parseInt(process.env.PORT || '3000', 10);
  await app.listen(port, '0.0.0.0');
  console.log('API listening on ' + (tls ? 'https' : 'http') + '://0.0.0.0:' + port + '/api');
  if (tls && tls.redirectPort > 0) {
    startHttpRedirect(tls.redirectPort, port);
  }
  console.log('DB target: ' + (process.env.DATABASE_URL || 'UNDEFINED').replace(/:\/\/[^@]+@/, '://***@'));
}
bootstrap();
