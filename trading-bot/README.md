# Trading Bot (Modular Monolith Scaffold)

Production-ready TypeScript scaffold for a crypto trading bot with PostgreSQL + Prisma, strong config validation, structured logging, and test/lint tooling.

## Stack

- Node.js 20+
- TypeScript (NodeNext)
- Prisma ORM (`postgresql` datasource by default; can be switched to `mysql` in `prisma/schema.prisma`)
- Jest + ts-jest
- pino logging
- dotenv + zod config validation
- undici HTTP client
- bottleneck rate limiting
- p-retry retries
- luxon date/time utilities

## Project Structure

```text
trading-bot/
  src/
    config/
    domain/
    events/
    mexc/
    data/
    indicators/
    strategy/
    risk/
    execution/
    portfolio/
    audit/
    app/
  prisma/
  tests/
  package.json
  tsconfig.json
  .env.example
  README.md
```

## Local Setup (No Docker)

### 1) Install dependencies

```bash
npm install
```

### 2) Create environment file

```bash
cp .env.example .env
```

Update `.env` values for your machine.

### 3) Create a PostgreSQL database

Example using psql:

```bash
createdb trading_bot
```

If needed, manually create a user and grant permissions.

### 4) Run Prisma generate + migrations

```bash
npm run prisma:generate
npm run prisma:migrate -- --name init
```

Equivalent direct Prisma command for migration:

```bash
npx prisma migrate dev --name init
```

### 5) Start in development

```bash
npm run dev
```

On successful boot, logger prints:

```text
Bot booted
```

### 6) Build and run production build

```bash
npm run build
npm run start
```

### 7) Run tests and lint

```bash
npm test
npm run lint
```

## Notes

- Database connectivity is initialized in `src/app/main.ts`.
- Trading logic is intentionally not implemented yet; this repository is scaffolding only.
- To switch to MySQL later, change datasource provider and connection string in `prisma/schema.prisma` + `.env`.
