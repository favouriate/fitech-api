# 🏦 Fitech API — Production-Grade Fintech Backend

A robust, ledger-based fintech backend built with NestJS, Prisma, PostgreSQL, and Redis.

🚀 **Live API:** [Health endpoint](https://fitech-api-51485910820.europe-west2.run.app/health)

*Hosted on Google Cloud Run free tier. The first request may take 10–15 seconds to cold start.*

## 🏗️ Architecture & Key Features

This project was built with financial correctness and scalability as the primary goals.

- **Double-Entry Ledger:** Balances are never stored directly. They are derived dynamically from immutable ledger entries (debits and credits), providing an audit trail.
- **Idempotent Transfers:** Transfers require an `Idempotency-Key`. The system uses PostgreSQL `SELECT ... FOR UPDATE` (pessimistic locking) inside `Serializable` ACID transactions to prevent double-spending.
- **State Machine Funding:** The funding module models the deposit lifecycle (`PENDING` → `COMPLETED` / `FAILED` / `EXPIRED`).
- **Secure Webhooks:** Incoming provider callbacks are verified using HMAC-SHA256 signatures against the raw request body.
- **JWT Auth with Rotation:** Short-lived access tokens and long-lived refresh tokens with reuse detection (breach detection). Passwords are hashed using Argon2id.

## 🛠️ Tech Stack

- **Framework:** NestJS 12 (ESM)
- **Database:** PostgreSQL 16 (Neon Serverless) via Prisma 6
- **Cache & Queues:** Redis 7 (Upstash) via BullMQ
- **Infrastructure:** Docker (multi-stage), Google Cloud Run
- **Testing:** Jest, Supertest, Testcontainers (previously measured at 92% coverage and 145 tests)
- **CI/CD:** GitHub Actions, GitHub Container Registry (GHCR)

## 🚀 Local Development

1. Clone the repository and run `npm install` (Node.js 24.9+).
2. Copy `.env.example` to `.env` and fill in your secrets.
3. Start the infrastructure: `docker compose up -d`.
4. Set `DATABASE_URL` to use the local PostgreSQL host port `5433`.
5. Run database migrations: `npx prisma migrate dev`.
6. Start the server: `npm run start:dev`.
7. API runs at [http://localhost:3000](http://localhost:3000), with Swagger UI at `/docs`.

## 🧪 Testing

- `npm run test` — Unit tests
- `npm run test:e2e` — E2E tests (spins up real PostgreSQL and Redis via Testcontainers)
- `npm run test:cov` — Coverage report

## 📬 Postman

Import the collection and sanitized environment template from [postman/](postman/). See the [Postman setup guide](postman/README.md) for the request flow.
