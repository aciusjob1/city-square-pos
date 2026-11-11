# City Square POS

City Square POS is a restaurant point-of-sale application with a NestJS API, React/Vite web client, and PostgreSQL database.

## Current application status

The repository currently contains a web application and development setup. The staff and waiter login screens already exist. Two separate frontend build modes are now available so the clients can later be packaged as two Windows applications:

- **Staff client** opens on the staff login (`/login`).
- **Waiter client** opens on the waiter PIN login (`/w/login`) and only accepts a waiter role in its client session.

These are separate client builds, **not yet standalone Windows installers**. The waiter mode is a startup/UX restriction, not a security boundary. The API must continue enforcing authorization for every privileged action.

## Requirements

- Node.js compatible with the lockfiles and package manifests.
- PostgreSQL with the repository migrations applied.
- A configured backend environment file (do not commit secrets).

## Local development

1. Configure PostgreSQL and create the application database/user.
2. Create `backend/.env` with at least:

   ```dotenv
   DATABASE_URL=postgres://<user>:<password>@localhost:5432/<database>
   PORT=3000
   JWT_SECRET=<a cryptographically random secret of at least 32 bytes>
   JWT_EXPIRES_IN=12h
   ```

   Never use a default or example JWT secret for a real deployment. Keep `.env` out of version control.
3. Install and start the backend:

   ```bash
   cd backend
   npm ci
   npm run migrate
   npm run seed
   npm run start:dev
   ```
4. In another terminal, install and start one frontend mode:

   ```bash
   cd frontend
   npm ci
   npm run dev:staff
   ```

   Or run `npm run dev:waiter` for the waiter PIN terminal. The Vite development server listens on port 5173 and proxies `/api` requests to the local backend on port 3000.

Use the repository's seed setup only for development. Change seeded credentials before any production use.

## Build both client variants

From `frontend/`:

```bash
npm ci
npm run build:staff
npm run build:waiter
```

The outputs are `frontend/dist-staff/` and `frontend/dist-waiter/`. Each build is a static web client and needs to be served by a web server/reverse proxy configured to route `/api` to the backend and to provide SPA fallback to `index.html`.

The current repository does **not** yet include an Electron shell, Windows service setup, printer driver implementation, or an installer that creates two installed applications/shortcuts. The builds above are preparation for that installer work, not a claim that the installer is complete. Physical printing must be validated with the actual printer models before deployment.

## Security notes

- Never put a GitHub token, database password, JWT secret, or other credential in source control, screenshots, issue comments, or chat. If a token was shared, revoke it and create a replacement immediately.
- Use HTTPS for clients connecting over a network; do not expose the development server directly to the internet.
- The backend, not frontend routes or build mode, is the authorization boundary.
- Use strong, unique staff passwords, restrict database/network access, and maintain tested backups.
- PINs have only 10,000 possible values; use them only as a waiter convenience credential with strict server-side throttling and appropriate physical access controls. Prefer passwords for privileged accounts.

## Tests and operational readiness

Backend build: `cd backend && npm ci && npm run build`.

Frontend build/lint: `cd frontend && npm ci && npm run build:staff && npm run build:waiter && npm run lint`.

A successful compile is not a full production certification. The repository has not been load-tested here; concurrent capacity depends on the PC/server CPU, memory, PostgreSQL settings/storage, network, printer hardware, and workload. Measure it with representative concurrent order and screen-refresh traffic before selecting a supported user target.

Before a real Windows rollout, complete and test the Windows installer and printer integration, review authentication/rate limiting and backup/restore procedures, then run end-to-end and concurrency tests on the target hardware.
