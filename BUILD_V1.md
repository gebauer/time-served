# BUILD_V1.md — Time Served

Build spec for V1. Read `CLAUDE.md` first — it holds the architecture invariant and the
platform constraints this document assumes. This file describes *what* to build for the
first shippable Android version, structured so iOS is a later adapter swap, not a rewrite.

---

## 1. One-paragraph product

You put your phone into a physical box that contains one or two passive NFC tags and a
charging cable. Placing the (unlocked) phone in the box reads a tag → identifies the box.
Connecting the cable starts a counted **session**. Unplugging ends it. The app splits every
session into **day-lock** and **night-lock** time and keeps a per-day total. Those daily
totals feed a **group leaderboard** (e.g. a family) where each person appears under a
per-group nickname. The phone keeps everything in full detail locally; the server receives
only sealed daily totals.

## 2. Scope of V1

In:
- Register a box (read a tag, name it, optional location). **Local only.**
- Detect placement (tag) + charging (gate) → start session. Detect unplug → end session;
  reconcile orphaned sessions on launch. **Local only.**
- Split sessions into day/night buckets per calendar day; full local history, editable until
  sealed (§5).
- Seal each day around midday of the following day and upload **only** `{day_lock_sec,
  night_lock_sec}` for that date.
- Groups: create/join via invite link; per-group nickname; consented, group-scoped
  leaderboard. Name layer end-to-end encrypted; measurement numbers plaintext.
- A user can belong to **multiple groups** with a different nickname in each.

Out (later versions):
- iOS build (interfaces stubbed now, implemented later).
- Member removal / key rotation (V1 uses one shared group key; see §10).
- Real accounts / login with PII (V1 identity is an anonymous device credential).
- Box-side electronics (V1 box is 100% passive).

## 3. Non-goals / accepted limitations (product decisions, do not "fix")

- **Not cheat-proof.** Plug in and keep playing → still counts.
- **No charge = no count.** Phone placed without the cable does not start a session.
- **NFC requires unlocked screen.** Placement happens with the screen awake/unlocked;
  documented in onboarding, not engineered around.
- **Sealed days are immutable.** After upload, a day cannot be changed — later discrepancies
  are accepted as errors.
- **Measurement numbers are plaintext on the server.** Justified by their low resolution:
  per user, per day, only two integers (day/night seconds), no timestamps, no box, no
  location. The user is told at sync time that these numbers are uploaded.
- **A session left open across multiple days loses its earlier days.** Sealing (§5) runs at
  midday for every past day regardless of open sessions, and buckets recompute only on
  session close/edit — so a phone that stays boxed for days has those days sealed as zero
  before the session closes. Accepted; see docs/CONTRACT_CHANGES.md #1.
- **Security target is "hard, not bulletproof."** Goal: an outsider without the invite link
  cannot enumerate groups, cannot learn group names or nicknames, cannot tie a `user_id` to a
  person. It is acceptable that a leaked link exposes that group's name layer.

## 4. Data model

All times are UTC epoch ms (`number`) unless noted. Dates are `YYYY-MM-DD` in the user's
**local** time zone (bucketing is local-time, see §5). IDs are client-generated UUID v4.

### 4.1 Local only (never leaves the device, full resolution, editable until seal)

`boxes` — `{id, label, location?, count_mode("charging"), origin(own|foreign), created_at,
updated_at, deleted_at?}`. `origin=own` = registered on this device (label/tags editable);
`origin=foreign` = auto-created from another member's tag (read-only: no relabel, no rewrite).

`sessions` — `{id, box_id, started_at?, ended_at?, last_charging_at, status(armed|open|
closed|discarded), end_reason?(unplug|reconciled|manual), created_at, updated_at}`

`day_buckets` (derived cache, recomputable from sessions) — `{date, day_lock_sec,
night_lock_sec, sealed_at?, dirty}`. `dirty` = changed since last local recompute; `sealed_at`
set once uploaded.

`group_keys` — `{group_id, k_g}` the 256-bit group key obtained from the invite link, stored
in device secure storage (Keystore). Never synced.

`nick_overrides` — `{group_id, member_user_id, local_label}` purely local renaming of any
member ("for me this is Petra"), never synced.

### 4.2 Server (PocketBase) — minimal, see §10 for access rules

`users` — **auth collection.** `{id = user_id (random UUID), created_at}` plus an auto
device credential (token) generated at first launch, held in device secure storage. No email,
no name, no device identifier. Sole purpose: authenticate a device to write **its own**
`daily_stats`.

`daily_stats` — `{id, user_id (FK), date, day_lock_sec, night_lock_sec, sealed_at}`.
Plaintext integers. Unique on `(user_id, date)`. Immutable after creation (no updates).

`groups` — `{id = group_id (random UUID), enc_group_meta, auth_hash, created_at}`.
- `enc_group_meta` = AEAD ciphertext of `{name}` under `K_enc` (server cannot read).
- `auth_hash` = `SHA-256(K_auth)` — lets the server *verify* access without being able to
  *decrypt* (see §10.2).

`memberships` — `{id, group_id (FK), user_id (FK), enc_nick, consent_at?, role(owner|member),
created_at}`.
- `enc_nick` = AEAD ciphertext of the per-group nickname under `K_enc`.
- `consent_at` set when the user agrees this group may read their `daily_stats`.

The leaderboard is **derived**, never stored: a member fetches the group feed (§10.3),
decrypts nicknames locally, joins them to the plaintext daily numbers, ranks deterministically.

## 5. Day/night bucketing & daily sealing

- **Day window:** 08:00–22:00 local. **Night window:** 22:00–08:00 local. (Tunable constants;
  these are the V1 defaults.)
- **Splitting:** a session is sliced at every boundary it crosses — calendar midnight
  (00:00), 08:00, and 22:00 — and each slice is attributed to `(calendar_date, category)`.
  Example: a session 21:00 D → 09:00 D+1 contributes 21:00–22:00 to D/day, 22:00–24:00 to
  D/night, 00:00–08:00 to (D+1)/night, 08:00–09:00 to (D+1)/day. This keeps daily totals
  exactly additive and matches the "seal day D" model.
- **Local recompute** runs after every session close / edit: rebuild affected `day_buckets`,
  mark `dirty`.
- **Sealing & upload:** a scheduled task (default **12:00 local**) seals every still-open past
  day `< today` that is not yet sealed: write `daily_stats {user_id, date, day_lock_sec,
  night_lock_sec, sealed_at=now}`, set local `sealed_at`. The delay to midday D+1 leaves day D
  fully editable until then and deliberately prevents a live intra-day race — members only see
  the previous day, the next midday. After seal: immutable.

## 6. Session state machine

Pure TS in `src/domain/session/`, consumes **domain events** only; adapters translate native
callbacks into them. Events: `TAG_READ(boxId)`, `CHARGING_STARTED`, `CHARGING_STOPPED`,
`CHARGING_HEARTBEAT(ts)`, `APP_RESUMED`, `ARM_TIMEOUT`.

```
IDLE
  └─ TAG_READ(boxId) ──────────► ARMED(boxId, armedAt)        [start FGS; persist nothing yet]
ARMED
  ├─ CHARGING_STARTED ─────────► ACTIVE(boxId, startedAt=now) [write session: status=open, started_at SYNC]
  ├─ ARM_TIMEOUT (no charge Ns)─► IDLE                        [discard; stop FGS]
  └─ TAG_READ(other) ──────────► ARMED(other)                [re-arm]
ACTIVE
  ├─ CHARGING_HEARTBEAT(ts) ───► ACTIVE                       [last_charging_at=ts]
  ├─ CHARGING_STOPPED ─────────► CLOSED(endedAt=now)          [status=closed, end_reason=unplug; recompute buckets; stop FGS]
  └─ (process killed)                                         [row stays open; recovered on APP_RESUMED]
ANY
  └─ APP_RESUMED ──► RECONCILE (§7)
```

`ARM_TIMEOUT` default 120 s (tunable). `started_at` is written synchronously on entering
ACTIVE (CLAUDE.md invariant).

## 7. Reconciliation (mandatory safety net)

Runs on every `APP_RESUMED`:

```ts
for (const s of openSessions()) {                 // status === 'open'
  if (isCharging() && s.box_id === currentArmedBox) continue;   // really still running
  const endedAt = s.last_charging_at ?? s.started_at;           // missed unplug
  closeSession(s, { ended_at: endedAt, end_reason: 'reconciled' });
}
recomputeDirtyBuckets();
```

`last_charging_at` bounds a lost session to the last known charging moment — a missed unplug
costs precision, never the whole session. This is also the mechanism iOS relies on entirely
(no FGS there).

## 8. Native / platform pieces (Android, V1)

### 8.1 NFC — `react-native-nfc-manager`
- Reader mode (`registerTagEvent`) while foreground for active placement.
- Manifest intent filter on NDEF URI `timeserved://box/<uuid>` so a scan on unlock foregrounds
  the app (passive-placement path).
- `platform/android/AndroidTagReader.ts` implements `TagReader`, emits `TAG_READ`.

### 8.2 Charging — `expo-battery` + native receiver
- `expo-battery` for the foreground quick path.
- Reliable unplug + heartbeat via a **dynamically registered** `BroadcastReceiver` for
  `ACTION_POWER_DISCONNECTED` + `ACTION_BATTERY_CHANGED`, registered **inside the FGS** (never
  in the manifest — CLAUDE.md §4).
- `platform/android/AndroidPowerStateProvider.ts` implements `PowerStateProvider`.

### 8.3 Foreground service — custom Expo module + config plugin
- Small Kotlin module via Expo Modules API (no off-the-shelf lib cleanly owns a dynamic power
  receiver).
- FGS type `connectedDevice` (perm `FOREGROUND_SERVICE_CONNECTED_DEVICE`); fallback
  `specialUse` with justification if Play review objects.
- Ongoing low-importance notification `"Time Served läuft – Box: <name>"`.
- Started from the NFC-read handler (app foreground → legal FGS start); stopped on CLOSED/discard.
- `platform/android/AndroidSessionRuntime.ts` implements `SessionRuntime`.

### 8.4 Config plugin (`plugins/`)
NFC feature + permission, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`,
`POST_NOTIFICATIONS`, the `<service>` entry + type, NDEF intent filter. Needs `expo prebuild`
+ dev build.

### 8.5 Permissions UX
- `POST_NOTIFICATIONS` runtime request (13+).
- One-time battery-optimization exemption during onboarding, framed as "so a session isn't cut
  short while your phone sleeps in the box".
- Secure storage for device credential + group keys (`expo-secure-store` / Keystore).

## 9. Tag encoding & detection

### 9.1 Payload
- NTAG215. NDEF message = a **URI record** `timeserved://box/<box-uuid>?v=1` + a **text record**
  with the box label.
- `?v=1` is a format-version marker so future tag layouts stay distinguishable; the reader must
  branch on it and ignore unknown major versions gracefully.
- **Box identity = the UUID in the payload**, not the hardware UID (readable across devices,
  survives tag replacement).
- **Two tags per box**, identical payload, offset positions to cover antenna-placement variance.

### 9.2 Detection (read path) — interaction-free
Reading is **always interaction-free**: in normal operation the app reacts only to valid tags
and never prompts. On every NDEF read, in order:
1. **App-scope check:** does the message contain a URI record with our `timeserved://box/`
   prefix? If not → not our tag, ignore silently.
2. **Resolve:** extract `<box-uuid>`, `v`, and the label text record; look the UUID up in the
   local `boxes` table.
   - **Known UUID** → emit `TAG_READ(boxId)`.
   - **Unknown but valid UUID** (e.g. another member's box) → **auto-create** a local box from
     the tag's own label + UUID with `origin=foreign`, then emit `TAG_READ`. No dialog — the
     name is already in the tag, so no user input is required. Optionally fire a one-shot info
     notification ("Neue Box ‚Büro' erkannt"), purely informational.
3. **Plausibility:** UUID well-formed and `v` supported? Otherwise discard with a clear error.

Writing never happens on this path — only inside the registration wizard (§9.3).

### 9.3 Registration (write path) — explicit "Register new box" wizard
Writing is **never reactive**; it lives in a deliberate wizard, run **before the tags are
stuck down** so a box can carry more than one tag:
1. User enters label (+ optional location) → app generates the box UUID **once** and creates a
   local box with `origin=own`.
2. For each physical tag, a "Write tag" step:
   - Detect tag state: factory-blank → write directly; carrying foreign NDEF → **warn before
     overwriting**; already our payload → offer re-link/relabel.
   - Write NDEF (`Ndef.encodeMessage`: URI `timeserved://box/<uuid>?v=1` + text label), then
     **verify by read-back**.
   - After successful verify, ask about read-only locking per §9.4.
   - Loop: "Write another tag for this box?" → next tag gets the **identical** payload.
3. All tags of a box share the one UUID set in step 1, written while still loose.

### 9.4 Read-only locking — user choice, never automatic
- NTAG215 can be permanently locked (lock bits) so the payload can't be overwritten later.
- This is **irreversible**, so the app must **ask the user explicitly** after a successful
  write + verify ("Tag gegen Überschreiben sperren? Das ist dauerhaft."). Default = **do not
  lock**. Only set lock bits on explicit confirmation.
- Locking is per-tag and optional; an unlocked tag works identically, it is just rewritable.

### 9.5 Capabilities the app must support (`react-native-nfc-manager`)
NDEF read + record filtering (foreground reader mode); NDEF write; read-back verification;
blank/foreign-tag state detection; optional lock-bit setting (gated by 9.4); and the
manifest intent-filter path so a (locked or unlocked) tag with our URI can foreground the app.

## 10. Identity, crypto, groups & sync

### 10.1 Identity (anonymous, non-deanonymizable)
- First launch: generate a random `user_id` (UUID) and a random device credential; create the
  `users` auth record; store credential in secure storage. **Never** derive identity from
  IMEI/hardware. No PII anywhere.
- The user picks a **per-group nickname at join time** (not a global name). They may also
  locally override how any other member is displayed (`nick_overrides`), never synced.

### 10.2 Keys — auth ≠ decryption (the crux)
From the group key `K_g` (256-bit, lives only in the invite link fragment, see 10.4) derive:
- `K_enc = HKDF(K_g, "ts-enc-v1")` — AEAD key (XChaCha20-Poly1305 / libsodium secretbox) for
  `enc_group_meta` and `enc_nick`. **Never sent to the server.**
- `K_auth = HKDF(K_g, "ts-auth-v1")` — access proof. The server stores only
  `auth_hash = SHA-256(K_auth)`.

Consequence: a client proves group access by sending `K_auth`; the server verifies against
`auth_hash` but, because HKDF is one-way, **cannot recover `K_g` or `K_enc`** and therefore
**cannot decrypt names/nicknames**. The server operator can run aggregate stats on plaintext
numbers and gate access, but cannot deanonymize. Sending `K_auth` over TLS to your own server
is fine precisely because it grants access, not decryption — do not log it.

### 10.3 Group feed (read path, enumeration-resistant)
Direct list/view of `daily_stats`, `groups`, `memberships`, `users` is denied by API rules
(`false`). Reads go through a **PocketBase JS-hook route** `POST /api/ts/group-feed`:
- Input: `{group_id, k_auth, from_date, to_date}`.
- Server checks `SHA-256(k_auth) == groups.auth_hash`; on mismatch, 403.
- On success returns: `enc_group_meta`, the group's `memberships` (`{user_id, enc_nick,
  consent_at}`), and `daily_stats` rows for every member whose `consent_at` is set, within the
  date range.
- Client decrypts names/nicks with `K_enc`, joins to plaintext numbers, ranks.

Enumeration resistance: `group_id` is a random UUID (not sequential); group data is reachable
only with `K_auth`; the four collections are not directly listable; admin sees only opaque ids
+ ciphertext names + numbers.

### 10.4 Invite link
`https://<host>/j#g=<group_id>&k=<K_g_base64url>` — the key sits in the URL **fragment**, which
browsers/servers never transmit, so `K_g` reaches the joiner's app without touching the server.
App handles it via deep link / universal link. (A short human code may map to `group_id` for
convenience, but the key only ever travels in the fragment.)

### 10.5 Write path & consent
- A device writes only **its own** `daily_stats` (rule: `@request.auth.id = user_id`, create
  only, no update → immutability).
- Joining a group: client creates a `memberships` row with its `enc_nick` and sets
  `consent_at` = explicit agreement that this group may read its daily numbers. Leaving =
  delete membership → excluded from future feeds. (Cached copies on other members' devices
  persist — acceptable.)
- One `user_id`, one set of `daily_stats`; **N memberships**, each with its own `enc_nick` and
  its own `K_g`. The same plaintext numbers surface in each group under a different name.

### 10.6 Conflict handling
`daily_stats` is create-only and immutable, so no LWW is needed there. `memberships` /
`nick_overrides` are last-write-wins on `updated_at`. Sessions/boxes never sync.

## 11. Screens (V1)

1. **Home / Status** — IDLE ("Leg dein Handy in eine Box") or ACTIVE (box + elapsed, derived
   from `started_at` on render, light interval only while visible — never a persisted timer).
2. **Today / Day-Night bar** — a single stacked bar per day: **sun-yellow = day-lock**,
   **moon-blue = night-lock**, with totals. This is the signature visual.
3. **Onboarding** — placement ritual (unlock → connect cable → place); why charging is the
   gate; notification + battery-optimization prompts; the "numbers uploaded at seal" notice.
4. **Boxes** — list (own + auto-added foreign); "Register new box" wizard (§9.3); edit/delete
   own boxes only — foreign boxes are read-only (shown, not editable).
5. **History** — past days with the day/night bar; sessions per day; sealed days marked;
   reconciled sessions shown honestly; edit allowed only on unsealed days.
6. **Groups** — list of groups; create (name → encrypted; generates link); join (deep link →
   enter per-group nickname → consent toggle). Per-group leaderboard (Today=yesterday sealed /
   Week / All-time), members by decrypted nick, with local rename.
7. **Settings** — own per-group nicks, ARM_TIMEOUT, day/night window constants, seal time
   (default 12:00), battery-optimization status, sync toggle, secure-storage/account info.

## 12. Build order

The build is sliced into parallelizable work packages with an explicit dependency graph and
per-job ownership rules in **`JOBS.md`** — that file is authoritative for ordering and agent
assignment. Summary: J1 (scaffold + contracts, blocking) → J2–J8 in parallel (domain, data,
NFC, FGS, crypto, backend, UI) → J9/J10 integration in parallel → J11 hardening. Do not
follow any other milestone list.

## 13. iOS portability checklist (do not implement now — keep the door open)

Stays **identical**: `domain/` (state machine, scoring, day/night split), `data/` (schema,
seal logic), crypto/sync (§10 is platform-neutral TS), `ui/`, the event vocabulary,
reconciliation.

New adapters in `platform/ios/`:
- **TagReader** — `NFCTagReaderSession` + background NDEF via universal link instead of custom
  scheme; placement UX differs, `TAG_READ` event identical.
- **PowerStateProvider** — `UIDevice` battery-state notifications; no guaranteed live unplug.
- **SessionRuntime** — **no foreground service**; rely on persisted `started_at` +
  reconciliation on next launch (optional `BGTaskScheduler` tail). Works because the domain
  layer never assumed a running process.

Proof the seam held: `pnpm test` (domain + day/night split + scoring + crypto round-trip) must
pass on plain Node, no native module, at every milestone.
