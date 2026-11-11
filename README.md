# City Square POS

City Square POS is a restaurant point-of-sale system built with a NestJS API, React/Vite frontend, and PostgreSQL database. It supports role-based workflows for waiters, cashiers, managers/admins, kitchen staff, and order/stock operations.

This project is designed to run on a normal PC, with a local PostgreSQL database and a local backend API, while the frontend runs in a browser or can later be packaged into desktop shortcuts/app launchers. The system is meant for a restaurant environment where staff can log in and do the daily POS work, while waiters can use a dedicated PIN-based login.

## What the system does

- Staff login with username and password
- Waiter login with a 4-digit PIN
- Table and order management
- Menu/catalog management
- Stock tracking for managed products
- Bill/receipt request flow
- Kitchen/bar ticket printing flow
- Roles and permissions for different users
- Manager/admin tools for users, categories, products, settings, and stock

## Repository structure

```text
backend/      NestJS API and database logic
frontend/     React client and UI screens
database/     database artifacts and migrations
README.md     project overview and local setup
```

## How to access and set it up on any PC

### 1. Install Git

On Windows, install Git from the official site and then open PowerShell or Command Prompt.

### 2. Clone the project

```powershell
git clone https://github.com/aciusjob1/city-square-pos.git
cd city-square-pos
```

If you need the latest branch:

```powershell
git fetch origin
git switch feature/windows-installer-security-hardening
git pull origin feature/windows-installer-security-hardening
```

### 3. Install PostgreSQL

Install PostgreSQL locally and create a database for the app.

Example:

```sql
CREATE DATABASE citysquare;
CREATE USER citysquare WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE citysquare TO citysquare;
```

### 4. Configure environment variables

Create a `backend/.env` file. This file is local to your machine and should never be committed to Git.

```dotenv
DATABASE_URL=postgres://citysquare:your_secure_password@localhost:5432/citysquare
PORT=3000
JWT_SECRET=replace_me_with_a_strong_random_secret
JWT_EXPIRES_IN=12h
```

Recommended security note:
- Use a long random secret value, not a default value.
- Keep `.env` files outside the public project folder if possible.
- Never share secrets in screenshots, chats, or source control.

### 5. Install backend dependencies and run migrations

```powershell
cd backend
npm install
npm run migrate
npm run seed
npm run start:dev
```

This starts the backend API on:

```text
http://localhost:3000/api
```

### 6. Install frontend dependencies and start the app

Open a second terminal:

```powershell
cd frontend
npm install
npm run dev:staff
```

This starts the staff web app on:

```text
http://localhost:5173
```

For the waiter client:

```powershell
cd frontend
npm run dev:waiter
```

The waiter client opens the waiter PIN login and is meant to be used by waiters only.

## Security and access model

The system uses a role-based access model.

- Staff users sign in using username + password.
- Waiters sign in using their PIN.
- The backend enforces authorization on protected API routes.
- The frontend route protections are optional UX restrictions only and should not be treated as the real security boundary.

### Recommended rules

- Do not use the default seeded credentials in production.
- Use separate strong accounts for manager/admin, cashier, waiter, and kitchen users.
- Use a unique JWT secret per environment.
- Keep the database and backend on a secure machine or within a trusted local network.
- Do not expose your local development server to the public internet.
- Use HTTPS if the system is accessed over a network.

## Future Windows app installation design

The future target is to create a Windows installer that installs two separate desktop launchers:

- City Square POS - Staff
- City Square POS - Waiter

These two icons will point to the same backend, but start different frontend modes:

- Staff launcher starts the staff login page
- Waiter launcher starts the waiter PIN page

This keeps the same backend/database but gives different entry points for different user groups.

The current repo does not yet include the final installer or desktop packaging. It still needs a proper Windows packaging step, app startup configuration, and validation on actual Windows hardware.

## Build checks

These are useful commands while developing and validating the project.

### Backend

```powershell
cd backend
npm install
npm run build
```

### Frontend

```powershell
cd frontend
npm install
npm run build:staff
npm run build:waiter
```

## Important operational notes

- The repository is still in active development.
- Physical printer support must be tested on real machines because printer drivers may need special handling.
- Database backups and proper environment management are important before deployment.
- The codebase has not been fully load-tested here, so any user capacity claim should be based on the actual hardware and usage pattern.

## Troubleshooting

### Backend will not start

Check:
- `backend/.env` is present and valid
- PostgreSQL is installed and running
- database user and password are correct
- `npm install` completed successfully

### Frontend cannot connect to API

Check:
- backend is running on port 3000
- Vite dev server is running on port 5173
- there is no firewall issue blocking local calls

### Database errors

Check:
- database exists
- user has privileges
- migrations were applied
- connection string matches the real database and password

## Final note

This README explains the system, how to access the code, how to set it up on a PC, and the architecture for a future two-app Windows install. It should be kept current as the project evolves.
