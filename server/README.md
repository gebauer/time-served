# Time Served — PocketBase backend (J7)

Self-hosted [PocketBase](https://pocketbase.io) **v0.39.5** instance. Stores only
**sealed daily totals in plaintext** plus an **E2E-encrypted name layer** (group
meta + per-group nicknames). Sessions and boxes never reach this server
(BUILD_V1.md §10, CLAUDE.md §1).

```
server/
  pb_migrations/    schema + API rules (applied automatically on start)
  pb_hooks/         custom /api/ts/* routes (JSVM)
  tests/e2e.mjs     end-to-end contract tests
  test.sh           downloads the PB binary, boots a temp instance, runs tests
  Dockerfile, docker-entrypoint.sh, docker-compose.yml   deployment
```

## Key decisions (the contracts the app relies on)

### 1. Record ids vs. client UUIDs

PocketBase record ids are 15-char lowercase alphanumerics — a UUID v4 does not
fit. Therefore:

- **users**: the client-generated UUID v4 lives in the unique field
  `user_uuid` (lowercase!). The PocketBase record id (`record.id`, 15 chars) is
  what appears as `user_id` everywhere else (`daily_stats.user_id`, feed
  memberships). The client learns its own record id from the auth response and
  must persist it alongside the UUID.
- **groups**: the client-generated UUID v4 lives in the unique field
  `group_uuid`. All `/api/ts/*` routes take and return this UUID as
  `group_id` — the internal record id never crosses the API.

### 2. `k_auth` / `auth_hash` encoding

- `k_auth` (= `HKDF(K_g, "ts-auth-v1")`, 32 raw bytes) is transmitted as a
  **base64url string without padding** (43 chars for 32 bytes).
- `auth_hash` = **lowercase hex of SHA-256 over the UTF-8 bytes of that
  base64url string** (64 hex chars). I.e. the hash covers the *encoded string*,
  not the raw key bytes: `auth_hash = hex(sha256(base64url(k_auth_bytes)))`.
  Client (J6) and server must both use this convention.
- The server never logs `k_auth`; it appears only in POST bodies (PocketBase
  logs method/URL/status, not bodies).

### 3. Device auth (anonymous bootstrap)

Chosen mechanism: **open `create` rule on the `users` auth collection** +
standard password auth, with `user_uuid` as the identity field. No custom
register hook needed; PocketBase handles password hashing and token issuance.

First-launch client flow (J10):

```
user_uuid = uuidv4()                      // lowercase
password  = 24+ random bytes, base64url   // store both in secure storage

POST /api/collections/users/records
  { "user_uuid": user_uuid, "password": password, "passwordConfirm": password }
  → 200 { "id": "<15-char record id>", ... }    // persist id as user_id

POST /api/collections/users/auth-with-password
  { "identity": user_uuid, "password": password }
  → 200 { "token": "<JWT>", "record": { "id": ..., "user_uuid": ... } }
```

Send the token as `Authorization: <token>` on every request. Tokens expire
(default ~7 days): on 401, re-run `auth-with-password` (or call
`POST /api/collections/users/auth-refresh` before expiry). No email, no name,
no device identifier is ever stored.

### 4. AEAD payloads are opaque

`enc_group_meta` and `enc_nick` are XChaCha20-Poly1305 ciphertexts with a
random 24-byte nonce **prepended**, no AAD, transported as base64 strings
(std or url-safe accepted). The server validates only "non-empty base64,
size-capped" (8192 / 2048 chars) and never decrypts.

## Collections & API rules

| collection    | list | view | create                                   | update | delete |
|---------------|------|------|------------------------------------------|--------|--------|
| `users`       | ✗    | ✗    | **open** (device bootstrap)              | ✗      | ✗      |
| `daily_stats` | ✗    | ✗    | `@request.auth.id != "" && user_id = @request.auth.id` | ✗ (immutable) | ✗ |
| `groups`      | ✗    | ✗    | ✗ (hook only)                            | ✗      | ✗      |
| `memberships` | ✗    | ✗    | ✗ (hook only)                            | ✗      | ✗      |

✗ = rule `null` (superuser only). All reads of group data go through
`POST /api/ts/group-feed`. The dashboard admin sees only opaque ids,
ciphertext names and plaintext integers.

Fields:

- `users` (auth): `user_uuid` (text, 36, unique, lowercase UUID v4 pattern) +
  system auth fields. `name`/`avatar` removed; email unused and optional.
- `daily_stats`: `user_id` (relation→users, cascade), `date` (text
  `YYYY-MM-DD`, local calendar date of the sealed day), `day_lock_sec`,
  `night_lock_sec` (int, 0..86400), `sealed_at` (datetime, client seal time),
  `created`. **Unique index on `(user_id, date)`.**
- `groups`: `group_uuid` (unique), `enc_group_meta`, `auth_hash`
  (64 lowercase hex), `created`.
- `memberships`: `group_id` (relation→groups, cascade), `user_id`
  (relation→users, cascade), `enc_nick`, `consent_at` (datetime, empty = no
  consent), `role` (`owner` | `member`), `created`, `updated`. **Unique index
  on `(group_id, user_id)`.**

## Route contracts (`/api/ts/*`)

All routes: `POST`, JSON body, require a valid `users` auth token
(`Authorization` header) → `401` otherwise. Validation errors → `400
{ "status": 400, "message": ... }` (standard PocketBase error shape).

**Enumeration resistance:** an unknown `group_id` and a wrong `k_auth` return
the *identical* `403 { "status": 403, "message": "Invalid group credentials." }`.

### POST /api/ts/group-create

```jsonc
// request
{
  "group_id": "3f2b...-uuid-v4",     // client-generated, lowercase
  "enc_group_meta": "<base64>",       // AEAD({name}) under K_enc
  "auth_hash": "<64 hex>",            // hex(sha256(base64url(k_auth)))
  "enc_nick": "<base64>",             // creator's per-group nickname
  "consent": true                     // creator's read-consent
}
// 200 response
{ "group_id": "...", "role": "owner", "consent_at": "2026-07-07 08:15:00.000Z" | null }
```

Creates the group and the creator's `owner` membership atomically.
`consent_at` is stamped **server-side** at request time when `consent` is true
(the server never trusts client timestamps for consent). Duplicate
`group_id` → `400`.

### POST /api/ts/group-join

```jsonc
// request
{ "group_id": "...", "k_auth": "<base64url>", "enc_nick": "<base64>", "consent": true }
// 200 response
{ "group_id": "...", "role": "member" | "owner", "consent_at": "..." | null }
```

Idempotent: re-joining updates `enc_nick` and consent instead of duplicating.
`consent: true` keeps an existing `consent_at` timestamp (or stamps now);
`consent: false` clears it (revocation). Wrong key / unknown group → `403`.

### POST /api/ts/group-feed

```jsonc
// request  (dates inclusive, YYYY-MM-DD, max 400 days per call)
{ "group_id": "...", "k_auth": "<base64url>", "from_date": "2026-07-01", "to_date": "2026-07-07" }
// 200 response
{
  "group_id": "...",
  "enc_group_meta": "<base64>",
  "memberships": [
    { "user_id": "<15-char id>", "enc_nick": "<base64>", "consent_at": "..." | null, "role": "owner" }
  ],
  "daily_stats": [   // ONLY members with consent_at set; sorted by date
    { "user_id": "<15-char id>", "date": "2026-07-05", "day_lock_sec": 3600,
      "night_lock_sec": 7200, "sealed_at": "2026-07-06 12:00:00.000Z" }
  ]
}
```

All memberships are listed (so unconsented members still appear by nick), but
`daily_stats` rows exist only for consented members. Client decrypts
`enc_group_meta`/`enc_nick` with `K_enc`, joins on `user_id`, ranks locally.

### POST /api/ts/group-leave

```jsonc
// request
{ "group_id": "..." }
// response: 204 No Content (always, idempotent — also for unknown groups)
```

Deletes the caller's own membership. An owner leaving does not delete or
transfer the group (V1: group survives; anyone with the link can still join).

## Sealed-daily-totals upload (direct collection write)

The only direct client write besides registration:

```
POST /api/collections/daily_stats/records
Authorization: <token>
{
  "user_id": "<own 15-char record id>",
  "date": "2026-07-05",
  "day_lock_sec": 3600,
  "night_lock_sec": 7200,
  "sealed_at": "2026-07-06T12:00:03.000Z"
}
→ 200 (record) | 400
```

- `user_id` must equal the authed record id, otherwise `400`.
- Rows are **immutable**: update/delete → `403`. A duplicate `(user_id, date)`
  → `400`; the client treats that as "already sealed" and marks the local day
  sealed (idempotent retry).

## Local development & tests

```bash
cd server
./test.sh          # downloads pocketbase v0.39.5 if missing, boots a temp
                   # instance (temp data dir), runs tests/e2e.mjs (46 checks)
```

Run a persistent dev instance:

```bash
./pocketbase serve --dir ./pb_data --hooksDir ./pb_hooks --migrationsDir ./pb_migrations
# dashboard: http://127.0.0.1:8090/_/  (create a superuser on first visit)
```

Migrations apply automatically on start. Binary and `pb_data/` are gitignored.

## Deploy (Coolify)

1. New resource → **Docker Compose**, repo = this repo, base directory
   `server/` (compose file `docker-compose.yml`).
2. Set env vars `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD` (dashboard superuser,
   upserted on every container start).
3. Attach your domain to port `8090` (Coolify's proxy terminates TLS —
   PocketBase must be reached via HTTPS only, `k_auth` travels in bodies).
4. The named volume `pb_data` holds the SQLite DB — include it in backups.
5. Upgrades: bump `PB_VERSION` in `docker-compose.yml`/`Dockerfile`, redeploy.

Hardening (optional, via dashboard → Settings): enable rate limiting for
`/api/ts/*` and the users create endpoint; batch API stays disabled.
