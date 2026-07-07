# CONTRACT_CHANGES.md

Process (JOBS.md): shared contracts are `src/domain/types.ts`, the interface files in
`src/platform/` and `src/data/Repositories.ts`, `src/domain/crypto/CryptoPorts.ts`, and the
server route contracts in `server/README.md`. **No job may change a contract silently.**
Any change gets an entry here — date, what changed, why, and which jobs are affected — and
the affected jobs' owners must be able to re-read this file and adapt. Additive changes are
preferred; breaking changes need explicit sign-off from the project owner.

---

## Decisions log

### #1 — 2026-07-07 — Multi-day open sessions lose sealed days (accepted limitation)

BUILD_V1 §5 seals every past day at midday, and bucket recompute runs only on session
close/edit. A session left open across several days (phone stays in the box) therefore has
its earlier days sealed as 0 before it closes; that time is lost because sealed days are
immutable. **Decision (project owner): accept and document — do not engineer around it.**
Listed in BUILD_V1 §3 as an accepted limitation. Affects J2 (no special-casing needed) and
J10 (seal task seals unconditionally).

### #2 — 2026-07-07 — Group create/join go through JS-hook endpoints

BUILD_V1 §10.5 could be read as direct collection creates. Decision: `groups` and
`memberships` are written only via custom PocketBase hook routes (`/api/ts/group-create`,
`/api/ts/group-join`, `/api/ts/group-leave`), consistent with the `group-feed` read hook.
Collection API rules stay uniformly `false` except `daily_stats` create-by-owner.
Affects J7 (implements the routes) and J10 (calls them). Route contracts: `server/README.md`.

### #5 — 2026-07-07 — k_auth transport & auth_hash encoding (set by J7)

`k_auth` travels as **base64url without padding**; `auth_hash` = **lowercase hex SHA-256
over that base64url string itself** (64 chars), because PocketBase's JSVM hashes strings.
J6's `authHash()` must reproduce this exactly. Details: server/README.md §2.

### #4 — 2026-07-07 — user_id on the wire is the PocketBase record id (set by J7)

Client UUIDs don't fit PocketBase 15-char record ids. `users.user_uuid` / `groups.group_uuid`
hold the client UUIDs; `/api/ts/*` routes speak `group_id` = client UUID, but `user_id` in
feeds and `daily_stats` is the **15-char PB record id**, learned from the auth response. The
domain `UserId` brand therefore carries the PB record id at runtime (still random — privacy
unaffected). Affects J10 (sync) and scoring inputs. Details: server/README.md §1.

### #3 — 2026-07-07 — AEAD convention

XChaCha20-Poly1305 (libsodium secretbox-xchacha20poly1305), fresh random 24-byte nonce
**prepended** to the ciphertext, **no additional data**; the whole `nonce || ct` blob is
base64-encoded (`Sealed` type). Applies to `enc_group_meta` and `enc_nick`. Affects J6
(implements) and J7 (treats the values as opaque strings).

### #6 — 2026-07-07 — PROPOSAL (J3): `DayBucketRepository.markDirty` creates missing buckets

The contract doesn't say what `markDirty(dates)` does for a date that has no
`day_buckets` row yet (possible when a session close/edit touches a day before
its first recompute). J3's WatermelonDB implementation **creates a zeroed
bucket (`day_lock_sec=0, night_lock_sec=0, dirty=true, sealed_at=null`)** for
such dates, so `findDirty()` reliably feeds every touched day into the next
recompute. No signature change — behavioral clarification only. Affects J2
(recompute may see zeroed dirty buckets it hasn't computed yet — it overwrites
them via `upsert` anyway) and J10 (none expected). **Accepted** (coordinator,
2026-07-07): this is the desired semantic.

### #7 — 2026-07-07 — PROPOSAL (J5): `PowerStateProvider` stream normalization semantics

The contract promises a clean event stream but does not pin down edge cases. J5's
`AndroidPowerStateProvider` merges two overlapping sources (expo-battery foreground
listener + FGS receiver) and normalizes per subscription
(`src/platform/android/normalizePowerEvents.ts`):

- Duplicate `CHARGING_STARTED` / `CHARGING_STOPPED` are dropped — consumers never see
  the same edge twice in a row (e.g. an unplug observed by both sources emits ONE
  `CHARGING_STOPPED`).
- From the initial unknown state, a first `CHARGING_STOPPED` **is** emitted (a late
  subscriber must still hear the unplug).
- `CHARGING_HEARTBEAT` always passes through and does **not** affect dedupe state, so
  a heartbeat arriving before the plug-in (FGS still running from a previous session)
  cannot swallow the `CHARGING_STARTED` the session machine needs.
- A native heartbeat with `charging=false` is dropped (the unplug is reported by the
  dedicated stop events; heartbeats exist only to feed `last_charging_at`).
- Timestamps pass through unchanged; events synthesized from expo-battery (which has
  no timestamp) use JS `Date.now()` at observation.
- `BatteryState.FULL` counts as charging (power-connection state, CLAUDE.md §4).

No signature change — behavioral clarification only. Affects J9 (consumes the stream;
may map events 1:1 onto domain events without extra dedupe) and the iOS adapter later
(should follow the same rules). **Accepted** (coordinator, 2026-07-07).
### #8 — 2026-07-07 — PROPOSAL (J6): noble crypto libs instead of libsodium

JOBS.md J6 suggests libsodium (`libsodium-wrappers` / `react-native-libsodium`).
`libsodium-wrappers` is WASM-based and does **not** run on React Native Hermes;
`react-native-libsodium` is a native module and therefore forbidden in `src/domain/`
(CLAUDE.md §6 — the lint config enforces it, and domain tests must run on plain Node).
J6 instead uses the audited pure-JS **`@noble/hashes` 2.2.0** (SHA-256, HKDF) and
**`@noble/ciphers` 2.2.0** (XChaCha20-Poly1305), which run identically on Node and
Hermes with no native code.

No wire-format change: HKDF-SHA256 (RFC 5869) and XChaCha20-Poly1305
(draft-irtf-cfrg-xchacha, == libsodium `crypto_aead_xchacha20poly1305_ietf`) are
standard constructions, so decisions #3 and #5 are implemented byte-identically —
ciphertexts and `auth_hash` stay compatible with any future libsodium implementation
(e.g. a native iOS one). Interop is pinned by test vectors in
`src/domain/crypto/crypto.test.ts` (IETF draft AEAD vector, RFC 5869 vectors, and an
independent `node:crypto` cross-check of the full K_g → auth_hash chain); wire formats
are documented in `src/domain/crypto/README.md`. Affects J9/J10 only in one way: the
default RNG is `crypto.getRandomValues`, so the app must import
`react-native-get-random-values` at bootstrap before any crypto call (J6's
`defaultRandomBytes` fails loudly if it's missing). **Accepted** (coordinator,
2026-07-07): Hermes compatibility + domain purity outweigh the JOBS.md suggestion.
