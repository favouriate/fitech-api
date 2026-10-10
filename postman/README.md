# Fitech API — Postman Collection

End-to-end API tests for the Fitech fintech backend.

## Setup

1. Import `Fitech-API.postman_collection.json` into Postman
2. Import `Fitech-Local.postman_environment.json` into Postman
3. Activate the `fitech-local` environment (top-right dropdown)
4. Fill in `testPassword` locally after import
5. Start the backend: `npm run start:dev` (from project root)

## Auth Flow

The `Auth` folder contains 5 requests that must run **in order**:

| # | Request | Purpose |
|---|---|---|
| 1 | `register` | Creates a user with a unique timestamped email |
| 2 | `login` | Returns access + refresh tokens (auto-saved to env) |
| 3 | `refresh` | Rotates the refresh token |
| 4 | `logout` | Revokes the current session |
| 5 | `logout-all` | Revokes every session for the user |

### Running the flow

**Manual:** Click each request → Send, in the order above.

**Automated (recommended):** Hover the `Auth` folder → `...` → **Run folder**.

Run the requests within the 15-minute access token TTL.

## Environment Variables

| Variable | Type | Purpose |
|---|---|---|
| `baseUrl` | default | API base URL (`http://localhost:3000/v1`) |
| `rootUrl` | default | Server root (`http://localhost:3000`) |
| `testEmail` | default | Auto-generated per Register run |
| `testPassword` | secret | Test user password (fill after import) |
| `accessToken` | secret | JWT — auto-filled by Login |
| `refreshToken` | secret | Opaque token — auto-filled by Login |

## Notes

- **Never commit secrets.** The environment file is an empty template for credentials and tokens. Fill in `testPassword` locally after import.
- **Access tokens expire in 15 minutes.** Re-run Login before testing any protected endpoint manually.
- Run only the `Auth` folder. The export also includes a placeholder request named `Fitech API` with an invalid URL; configure it before use.
