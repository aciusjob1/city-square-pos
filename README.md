# City Square POS

A restaurant point-of-sale system for daily front-of-house and back-of-house
operations: tables, orders, kitchen/bar printing, menu and stock control,
reports, business days and backups.

It ships as a single Windows installer. One PC is the **main server** (database,
HTTPS API and web app); every other PC, tablet or phone on the same network is a
**terminal** that points at it. Terminals never hold data of their own.

- **Backend:** NestJS 10 + Knex + PostgreSQL 17
- **Frontend:** React 19 + React Router 7 + Vite 8
- **Packaging:** self-contained `.exe` (bundles Node, PostgreSQL and the built app)

---

## Contents

1. [What is inside](#1-what-is-inside)
2. [Architecture](#2-architecture)
3. [Roles and access](#3-roles-and-access)
4. [Requirements](#4-requirements)
5. [Install on Windows (recommended)](#5-install-on-windows-recommended)
6. [HTTPS and certificates](#6-https-and-certificates)
7. [Development setup](#7-development-setup)
8. [Configuration reference](#8-configuration-reference)
9. [Printing](#9-printing)
10. [Stock and ingredient pools](#10-stock-and-ingredient-pools)
11. [Business day](#11-business-day)
12. [Backups](#12-backups)
13. [Building the installer](#13-building-the-installer)
14. [Tests](#14-tests)
15. [Project layout](#15-project-layout)
16. [Troubleshooting](#16-troubleshooting)
17. [Security notes](#17-security-notes)

---

## 1. What is inside

| Area | Capability |
| --- | --- |
| Orders | Dine-in, takeaway and delivery orders; append items; cancel with reason; bill groups |
| Tables | Configurable table count; waiter floor view |
| Menu | Categories and products, per-category printer station, sold-out toggles |
| Printing | Network (raw TCP) and OS-spooler printers, kitchen/bar routing, print jobs log |
| Stock | Stock-managed products, purchase receipts, counts, low-stock filter, restock |
| Recipes | Ingredient pools, product recipes, fractional piece quantities (e.g. 1/4 chicken) |
| Reports | Sales summary with product/waiter cross-filters and day/week/month/year grouping |
| Business day | Open/close/rollover, automatic or manual, day-scoped dashboards |
| Users | Roles, activation, password reset, waiter PINs, self-service password change |
| Branding | Restaurant name, logo and ticket name |
| Backups | Manual/automatic dumps to a local folder and an optional cloud-synced folder |
| Security | HTTPS, HTTP to HTTPS redirect, CSP, JWT auth, rate limits, CORS allowlist |

---

## 2. Architecture

```
                    Restaurant LAN (Ethernet or Wi-Fi)
   +-----------------------------+        +-----------------------------+
   |  Main server PC             |        |  Terminals                  |
   |                             |        |                             |
   |  CitySquarePOS.exe          |  HTTPS |  Browser / installed app    |
   |   +---------------------+   | <----> |  https://<server-ip>:3000   |
   |   | NestJS API + SPA    |   |        |                             |
   |   | :3000 (TLS)         |   |        +-----------------------------+
   |   | :3080 -> 3000       |   |        |  Phones / tablets           |
   |   +----------+----------+   |        |  same URL, certificate      |
   |              |              |        |  installed once             |
   |   +----------v----------+   |        +-----------------------------+
   |   | PostgreSQL 17       |   |
   |   | 127.0.0.1:55432     |   |
   |   +---------------------+   |
   +-----------------------------+
```

Ports used by the installed app:

| Port | Purpose |
| --- | --- |
| 3000 | HTTPS API + web app (`/api/...`, `/login`, ...) |
| 3080 | Plain HTTP, immediately redirected to HTTPS (app port + 80) |
| 55432 | PostgreSQL, bound to 127.0.0.1 only |

The installer picks free ports if 3000/55432 are taken (see `/PORT=` and
`/DBPORT=` below). During development the defaults are 3000 (API) and 5173
(Vite dev server).

---

## 3. Roles and access

| Role | Entry point | Can do |
| --- | --- | --- |
| **ADMIN** | `/login` | Everything a manager can do, including user management |
| **MANAGER** | `/login` | Orders, reports, users, categories, products, sold-out, stock, print jobs, settings (branding, printers, network, business day, backups, certificates) |
| **CASHIER** | `/login` | Cashier dashboard, order list and cancellation, sold-out toggles, reports, print jobs |
| **WAITER** | `/w/login` (PIN) | Floor view, take orders, own orders, own sales, print jobs |
| **KITCHEN** | `/login` | Kitchen queue only |

Guards are enforced on both sides: routes are wrapped in `ProtectedRoute`, and
every API endpoint is protected by `JwtAuthGuard` + `RolesGuard`.

---

## 4. Requirements

For the installed app (no tooling needed on the target PC):

- Windows 10/11, 64-bit
- 4 GB RAM (8 GB recommended)
- ~500 MB free disk for the app, plus room for the database and backups
- A wired or wireless network shared by the server and terminals

For development and building:

- Node.js 20 or newer (built and tested on Node 24)
- PostgreSQL 17 on `127.0.0.1:5432`
- Windows `.NET Framework 4` compiler (`csc.exe`) for the installer
- PostgreSQL 17 binaries at `pg17/pgsql` to build the self-contained installer
  (this directory is **not** committed to Git)

---

## 5. Install on Windows (recommended)

### 5.1 Main server PC

1. Run `CitySquarePOS-Setup.exe`.
2. Keep **Main server — keeps the database and runs the app** selected.
3. Choose the install folder (default
   `%LOCALAPPDATA%\Programs\CitySquarePOS`) and press **Install**.
4. When it finishes, the dialog shows the address terminals must use, e.g.
   `https://192.168.1.53:3000`. Write it down.
5. Allow the app through Windows Firewall if prompted. If you install silently
   (no elevation), run PowerShell as administrator once and allow
   `CitySquarePOS.exe` on TCP 3000 and 3080.

Setup creates two desktop shortcuts:

- **City Square POS (Staff)** — staff login for admin/manager/cashier/kitchen
- **City Square POS (Waiter)** — PIN login for waiters

### 5.2 Terminal PCs

1. Run the same `CitySquarePOS-Setup.exe`.
2. Select **Terminal — connects to the main server**.
3. Enter the server address shown on the main PC, e.g. `192.168.1.53:3000`
   (`https://` is added automatically).
4. Install. Setup fetches the server certificate and trusts it, so the app opens
   without a warning.

Terminals require the main server to be switched on and on the same network.

### 5.3 Phones and tablets

Open `https://<server-ip>:3000` in the browser. Before first use, install the
certificate (see [section 6](#6-https-and-certificates)). The layout is
responsive: waiters get the floor/PIN screens, managers get the sidebar.

### 5.4 Silent / scripted install

```bat
rem Main server, no UI, open Staff app afterwards
CitySquarePOS-Setup.exe /S /DIR="C:\CitySquarePOS" /LAUNCH=staff

rem Terminal pointing at a server
CitySquarePOS-Setup.exe /S /SERVER=192.168.1.53:3000 /LAUNCH=waiter

rem Custom ports
CitySquarePOS-Setup.exe /S /PORT=3010 /DBPORT=55433
```

| Flag | Meaning |
| --- | --- |
| `/S`, `/SILENT` | No UI |
| `/DIR=<path>` | Install folder |
| `/LAUNCH=staff\|waiter\|none` | Which app to open when done (default `none`) |
| `/SERVER=<host:port>` | Terminal mode; clear it (`/SERVER=`) to turn a PC back into a server |
| `/PORT=<n>` | HTTPS app port (default 3000) |
| `/DBPORT=<n>` | PostgreSQL port (default 55432) |

Installing over an existing install is the supported upgrade path. It stops the
running app, keeps the database, JWT secret, configuration and certificate, and
replaces only the program files.

Uninstall from **Apps and features**, or run:

```bat
"%LOCALAPPDATA%\Programs\CitySquarePOS\CitySquarePOS.exe" uninstall
```

It stops the services and removes the shortcuts, the trusted certificate entry
and the install folder. Windows Firewall rules added by Setup must be removed
manually.

---

## 6. HTTPS and certificates

The app serves HTTPS by default. Because the server lives on a private LAN with
no public domain, Setup creates a **self-signed certificate** instead of using a
public certificate authority.

### 6.1 What Setup creates

| File | Purpose |
| --- | --- |
| `data\tls\citysquare.pfx` | Private key + certificate used by the server |
| `data\tls\citysquare.cer` | Public certificate for other devices |

The certificate is valid for 10 years and contains these names:

- `localhost`
- the PC's name (e.g. `DESKTOP-GGS8QHK`)
- `127.0.0.1`
- every LAN IPv4 address the PC had at install time

On the server PC the certificate is added to
**Current User → Trusted Root Certification Authorities**, so the installed app
opens cleanly. A second install reuses the existing certificate, keeping the
same thumbprint.

Plain `http://` requests are redirected: `301` for GET/HEAD, `308` for other
methods. The redirect target is validated so it cannot be abused as an open
redirect.

### 6.2 Trust the certificate on a device

Windows terminals: automatic during Setup (no action).

Phones and tablets: open the app on the server PC as a manager, go to
**Settings → Connection security → Download certificate**, then on the phone:

- **Android:** Settings → Security → Encryption & credentials → Install a
  certificate → CA certificate → pick `CitySquarePOS.cer`.
- **iOS:** AirDrop or email the file, tap it, then Settings → General →
  VPN & Device Management → install the profile, and finally Settings →
  General → About → Certificate Trust Settings → enable full trust.

### 6.3 If the server's IP address changes

The certificate only covers the addresses that existed at install time. If the
router hands the server a new address, devices see
`NET::ERR_CERT_COMMON_NAME_INVALID` (Chrome: "Your connection is not private").

Fix:

1. Close the app on the server.
2. Delete `data\tls\citysquare.pfx` and `data\tls\citysquare.cer`.
3. Run Setup again as **Main server** — a new certificate is generated with the
   current addresses.
4. Re-run Setup on each Windows terminal so it fetches the new certificate, and
   re-install the new `.cer` on phones.

To avoid this, give the server a **DHCP reservation** on the router so its
address never changes.

### 6.4 Optional HSTS

HSTS is **off by default**. With a self-signed certificate, HSTS would make the
browser's warning page impossible to bypass if a certificate ever mismatched.
Enable it only when every device trusts the certificate:

```bat
set TLS_HSTS_MAX_AGE=31536000
```

### 6.5 Hosted certificate endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/tls/info` | Enabled/secure flags, port, redirect port, certificate summary |
| `GET /api/tls/certificate` | Downloads `CitySquarePOS.cer` |

Both are public by design (they are needed before trust exists) and expose no
key material.

---

## 7. Development setup

### 7.1 Database

```bat
createuser -U postgres -P citysquare
createdb -U postgres -O citysquare citysquare
```

Use `citysquare` as the password to match `.env.example`, or edit
`DATABASE_URL` accordingly.

### 7.2 Backend

```bat
cd backend
npm install
copy .env.example .env
npm run migrate
npm run seed
npm run start:dev
```

The API listens on `http://localhost:3000/api` unless TLS variables are set. It
also serves `../frontend/dist` when that build exists, so a single port can host
the whole app outside the Vite dev server.

### 7.3 Frontend

```bat
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api/*` to `localhost:3000`, so no
CORS setup is needed in development.

To run the whole app on one port without the installer:

```bat
cd frontend && npm run build
cd ..\backend && npm run build && npm run start:prod
```

### 7.4 Sample accounts

`npm run seed` recreates the demo data. **These credentials are for local
development only** — change them before letting anyone use the system.

| Username | Password | Role |
| --- | --- | --- |
| `admin` | `admin123` | ADMIN |
| `manager` | `manager123` | MANAGER |
| `cashier1` | `waiter123` | CASHIER |
| `kitchen-test` | `kitchen-test-password` | KITCHEN |
| `john` | `waiter123` (PIN `1234`) | WAITER |
| `fatma` | `waiter123` (PIN `1235`) | WAITER |

Waiters sign in at `/w/login` with their PIN only.

### 7.5 Database migrations

```bat
cd backend
npm run migrate            rem apply pending migrations
npm run migrate:rollback   rem roll back the last batch
npm run seed               rem wipe and reseed demo data
```

Schema is maintained through Knex migrations in `backend/db/migrations`;
`database/schema.sql` is a full reference snapshot. The backend runs pending
migrations at startup, so an upgraded install needs no manual step.

---

## 8. Configuration reference

### 8.1 Backend environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | — | `postgresql://user:pass@host:port/db` |
| `PORT` | `3000` | HTTPS port when TLS is enabled, HTTP port otherwise |
| `NODE_ENV` | `development` | `production` enforces strict JWT/CORS rules |
| `JWT_SECRET` | dev fallback | **Required in production**, at least 32 characters |
| `JWT_EXPIRES_IN` | `12h` | Token lifetime |
| `PIN_PEPPER` | `JWT_SECRET` | Extra pepper for waiter PIN lookup; allows rotating JWT without resetting PINs |
| `CORS_ORIGINS` | `localhost:5173` | Comma-separated allowed browser origins |
| `PIN_RATE_LIMIT_MAX` | `20` | PIN attempts per IP per minute |
| `BACKUP_DIR` | `backups` in app dir | Local backup folder |
| `FRONTEND_DIR` | auto-detected | Folder holding the built SPA |
| `TLS_PFX_PATH` | — | PFX file for HTTPS |
| `TLS_PFX_PASSPHRASE` | — | PFX password |
| `TLS_CERT_PUBLIC_PATH` | — | Public `.cer`/`.crt` offered for download |
| `TLS_KEY_PATH` / `TLS_CERT_PATH` | — | PEM alternative to the PFX |
| `HTTP_REDIRECT_PORT` | `PORT + 80` | Plain-HTTP redirect port; `0` disables it |
| `TLS_HSTS_MAX_AGE` | `0` | HSTS max-age in seconds; `0` sends no HSTS header |

Partial TLS configuration is rejected at startup rather than silently serving
plain HTTP.

### 8.2 `config.ini` (installed app)

Location: `%LOCALAPPDATA%\Programs\CitySquarePOS\config.ini`

| Key | Description |
| --- | --- |
| `version` | Installed version |
| `app_port` | HTTPS port |
| `db_port` | PostgreSQL port |
| `db_user`, `db_password`, `db_name` | Database credentials |
| `jwt_secret` | Generated once, preserved across upgrades |
| `server_url` | Empty on a server; `https://host:port` on a terminal |
| `tls_enabled` | `1` when HTTPS is configured |
| `tls_pfx`, `tls_pfx_password`, `tls_cert_public` | Certificate file paths and PFX password |
| `redirect_port` | Plain-HTTP redirect port (`0` disables) |

### 8.3 Launcher command line

Installed at `%LOCALAPPDATA%\Programs\CitySquarePOS\CitySquarePOS.exe`.

```bat
CitySquarePOS.exe staff                rem start services, open staff login
CitySquarePOS.exe waiter               rem start services, open waiter PIN login
CitySquarePOS.exe staff --no-browser   rem start services only
CitySquarePOS.exe uninstall            rem remove shortcuts, trust entry, install folder
```

The launcher starts PostgreSQL and the backend if they are not running, waits
for a health check, then opens the app. It pins the server certificate
thumbprint and only tolerates an untrusted certificate for loopback/private-IP
health probes.

### 8.4 API overview

All routes are under `/api` and require a bearer token unless marked public.

| Route | Notes |
| --- | --- |
| `POST /api/auth/login` | Username + password (public) |
| `POST /api/auth/login-pin` | Waiter PIN (public) |
| `PATCH /api/auth/password` | Self-service password change |
| `GET /api/auth/me` | Current user |
| `GET /api/health` | Health probe (public) |
| `GET /api/tls/info`, `/api/tls/certificate` | Certificate info/download (public) |
| `/api/orders` | Create, list, fetch, append items, cancel |
| `/api/bill-groups` | Split/merge bill groups |
| `/api/receipts` (under `/api/orders`) | Receipt data |
| `/api/tables` | Table count and floor state |
| `/api/categories`, `/api/products` | Menu catalog and availability |
| `/api/printers`, `/api/print-jobs` | Printer setup, discovery and job log |
| `/api/stock` | Balances, receipts, counts, restock, pools |
| `/api/reports` | Sales summary |
| `/api/day` | Open, close, rollover |
| `/api/users`, `/api/roles` | User and role management |
| `/api/settings` | Branding, printers, network, business day, backups |
| `/api/backups` | List, create, restore metadata |
| `/api/payment-methods` | Payment method list |

---

## 9. Printing

Two printer types are supported:

- **NETWORK** — send ESC/POS bytes to an IP address and port (usually 9100).
  Works with most thermal receipt and kitchen printers.
- **OS** — print through a Windows printer installed on the server PC.

Assign each printer one or both stations (**KITCHEN**, **BAR**) or **NONE** for
receipts. Categories inherit their station, so an order containing kitchen and
bar items is split into separate tickets automatically.

Set defaults for kitchen, bar and receipt printers in
**Settings → Printers**. Failed jobs stay visible in **Print jobs** and can be
retried; every job records its printer, station and error.

> Network printers must be reachable from the **server** PC, not from terminals.

---

## 10. Stock and ingredient pools

- Products are stock-tracked only when **Stock managed** is enabled.
- Stock moves through receipts (purchases), counts (stocktakes) and order
  consumption.
- **Ingredient pools** are shared raw inputs (e.g. chicken, rice). A product
  recipe links quantities per portion, including fractions such as `0.25` for a
  quarter chicken.
- Ordering a stock-managed product is enforced on the server with reservation
  checks under advisory locks, so two terminals cannot oversell the last portion.
- **Sold out** is a manual switch that hides a product immediately, independent
  of stock.

---

## 11. Business day

A business day groups all sales between opening and closing, which matters when
service runs past midnight.

- **AUTO** (default): the day rolls over on its own.
- **MANUAL**: a manager opens and closes the day explicitly from the dashboard.

Dashboards show the current day's SALES, ORDERS and CANCELLED totals. Reports
can be grouped by day, week, month or year and filtered by product or waiter.

---

## 12. Backups

**Settings → Data & backups** shows the backup folder, free space, and every
backup found (local, cloud or previously found).

- Backups are `pg_dump` files named `citysquare-YYYYMMDD-HHMMSS.dump`.
- **Create backup now** writes a dump immediately; the same action can also copy
  it to the configured cloud folder (for example a OneDrive or Google Drive
  folder that syncs automatically).
- Restoring is a manual operation: stop the app, restore the dump into the
  `citysquare` database, and start the app again.

Backups contain the full database, including staff records. Store and share them
accordingly.

---

## 13. Building the installer

Prerequisites:

- Node.js
- Windows `.NET Framework 4` (`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`)
- PostgreSQL 17 binaries placed at `pg17/pgsql` (excluded from Git)

```bat
node installer/build.mjs
```

The script:

1. Builds backend and frontend.
2. Stages the backend, SPA, Node runtime and PostgreSQL into `installer/build`.
3. Compiles `Setup.cs` and `Launcher.cs`, appends the compressed payload, and
   writes `installer/out/CitySquarePOS-Setup.exe`.
4. Copies the result to the Desktop.

The payload excludes pgAdmin, documentation and Stack Builder, keeping the
installer around 125 MB.

---

## 14. Tests

End-to-end tests use Playwright and run against a live stack:

```bat
rem terminal 1
cd backend && npm run start:dev

rem terminal 2
cd frontend && npm run dev

rem terminal 3
cd frontend
set CHROMIUM_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
npx playwright test
```

Notes:

- `TEST_BASE_URL` defaults to `http://localhost:5173`.
- `globalSetup` cleans test orders and attempts logs with `psql`, so `psql` must
  be on `PATH` and able to connect as `citysquare`.
- Tests run serially (`workers: 1`) with a mobile viewport.
- Set `CHROMIUM_PATH` on Windows; the default path targets Termux.

---

## 15. Project layout

```
.
├── backend/                 NestJS API
│   ├── db/migrations/       Knex migrations (source of truth)
│   ├── db/seeds/            Demo data
│   └── src/
│       ├── auth/            Password + PIN auth, JWT strategy
│       ├── orders/          Orders, bill groups, receipts
│       ├── catalog/         Categories and products
│       ├── stock/           Balances, receipts, counts, pools
│       ├── printers/        Drivers, discovery, dispatch, jobs
│       ├── reports/         Sales summary
│       ├── day/             Business day state machine
│       ├── backups/         Dump, list, cloud copy
│       ├── settings/        Branding, printers, network, backups
│       ├── network/         Adapter discovery, cable-only mode
│       ├── tls/             Certificate info and download
│       └── common/          Guards, config, TLS loader, branding
├── frontend/                React SPA
│   └── src/
│       ├── pages/           login, waiter, cashier, manager, kitchen
│       ├── components/      Nav, dialogs, shared UI
│       ├── auth/            Auth context and route guards
│       ├── lib/             Typed API clients
│       └── branding/        Runtime branding provider
├── database/schema.sql      Full schema reference
├── installer/               Windows setup and launcher
│   ├── src/Setup.cs         Installer + certificate lifecycle
│   ├── src/Launcher.cs      Service bootstrap, cert pinning
│   └── build.mjs            Package build script
└── pg17/                    Local PostgreSQL binaries (not committed)
```

---

## 16. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "Your connection is not private" on the server PC | Certificate was issued before the current IP existed | Delete `data\tls\citysquare.*`, re-run Setup as Main server, reinstall terminals ([details](#63-if-the-servers-ip-address-changes)) |
| Warning only on a phone/tablet | Device has not trusted the certificate | Download it from Settings → Connection security and install it |
| Terminal shows "server did not start" | Terminal cannot reach the server | Check the server is running, same network, firewall allows TCP 3000 |
| `403 Cable connection required` | Network access is set to **Wired only** | Connect the device by Ethernet, or change **Settings → Network access** to **All** |
| Login works, then everything 401s | `JWT_SECRET` changed | Sign in again |
| Backend log says database unreachable | PostgreSQL not running or port conflict | Start the launcher, or check `db_port` in `config.ini` |
| Setup cannot open the firewall | Silent install without elevation | Run one elevated `netsh` rule for TCP 3000 and 3080, or rerun setup as administrator |
| Port already in use | Another service occupies 3000/55432 | Reinstall with `/PORT=` and `/DBPORT=` |

Logs:

- `%LOCALAPPDATA%\Programs\CitySquarePOS\logs\launcher.log`
- `%LOCALAPPDATA%\Programs\CitySquarePOS\logs\backend.log`
- `%TEMP%\city-square-pos-setup.log`

---

## 17. Security notes

- Change every seeded password and PIN before real use; set a strong admin
  password from **Settings → My account**.
- Keep the server on the restaurant LAN. Do not port-forward it to the internet.
- In production the backend refuses to start without a real `JWT_SECRET` (32+
  characters) and logs a warning when `CORS_ORIGINS` is unset.
- Login and PIN attempts are rate limited per IP, and API traffic is capped per
  IP per minute.
- Responses carry CSP, `Cross-Origin-Resource-Policy: same-origin` and no
  directory-style framing; HSTS is opt-in.
- The PFX and its password live in `config.ini` / `data\tls` on the server.
  Protect that folder; never commit it to Git.
- Backups and database dumps contain full staff and sales data.
