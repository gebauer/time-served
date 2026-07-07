/// <reference path="../pb_data/types.d.ts" />
//
// Time Served — custom routes (BUILD_V1.md §10.3, JOBS.md J7).
//
//   POST /api/ts/group-create   create group + owner membership
//   POST /api/ts/group-join     join (idempotent) after proving k_auth
//   POST /api/ts/group-feed     enc meta + memberships + consented daily_stats
//   POST /api/ts/group-leave    delete own membership (idempotent)
//
// All routes require an authenticated device (`users` auth record).
// All group access is proven by k_auth (base64url string); the server stores
// only hex(SHA-256(k_auth)) and can gate access but never decrypt names.
// NEVER log k_auth. Unknown group_id and wrong k_auth return the identical
// 403 so group ids cannot be enumerated.

// ---------------------------------------------------------------------------
// POST /api/ts/group-create
// body: { group_id, enc_group_meta, auth_hash, enc_nick, consent }
// ---------------------------------------------------------------------------
routerAdd(
  "POST",
  "/api/ts/group-create",
  (e) => {
    const u = require(`${__hooks}/ts_utils.js`);
    const b = e.requestInfo().body || {};

    if (!u.isStr(b.group_id) || !u.UUID_V4_RE.test(b.group_id)) {
      u.badRequest("group_id must be a lowercase UUID v4.");
    }
    if (!u.isStr(b.auth_hash) || !u.HEX64_RE.test(b.auth_hash)) {
      u.badRequest("auth_hash must be 64 lowercase hex chars (SHA-256).");
    }
    if (!u.isStr(b.enc_group_meta) || b.enc_group_meta.length === 0 || b.enc_group_meta.length > 8192 || !u.B64_RE.test(b.enc_group_meta)) {
      u.badRequest("enc_group_meta must be a non-empty base64 string (max 8192 chars).");
    }
    if (!u.isStr(b.enc_nick) || b.enc_nick.length === 0 || b.enc_nick.length > 2048 || !u.B64_RE.test(b.enc_nick)) {
      u.badRequest("enc_nick must be a non-empty base64 string (max 2048 chars).");
    }
    if (typeof b.consent !== "boolean") {
      u.badRequest("consent must be a boolean.");
    }

    let exists = null;
    try {
      exists = $app.findFirstRecordByFilter("groups", "group_uuid = {:g}", {
        g: b.group_id,
      });
    } catch (_) {
      exists = null;
    }
    if (exists !== null) {
      u.badRequest("A group with this id already exists.");
    }

    const consentAt = u.consentValue(b.consent, "");
    let out = null;

    try {
      $app.runInTransaction((txApp) => {
        const group = new Record(txApp.findCollectionByNameOrId("groups"));
        group.set("group_uuid", b.group_id);
        group.set("enc_group_meta", b.enc_group_meta);
        group.set("auth_hash", b.auth_hash);
        txApp.save(group);

        const membership = new Record(
          txApp.findCollectionByNameOrId("memberships")
        );
        membership.set("group_id", group.id);
        membership.set("user_id", e.auth.id);
        membership.set("enc_nick", b.enc_nick);
        membership.set("consent_at", consentAt);
        membership.set("role", "owner");
        txApp.save(membership);

        out = {
          group_id: b.group_id,
          role: "owner",
          consent_at: membership.getString("consent_at") || null,
        };
      });
    } catch (err) {
      // unique index race → treat like the pre-check
      u.badRequest("A group with this id already exists.");
    }

    return e.json(200, out);
  },
  $apis.requireAuth("users")
);

// ---------------------------------------------------------------------------
// POST /api/ts/group-join
// body: { group_id, k_auth, enc_nick, consent }
// Idempotent: re-join updates enc_nick / consent instead of duplicating.
// ---------------------------------------------------------------------------
routerAdd(
  "POST",
  "/api/ts/group-join",
  (e) => {
    const u = require(`${__hooks}/ts_utils.js`);
    const b = e.requestInfo().body || {};

    const group = u.findGroupChecked(b.group_id, b.k_auth);

    if (!u.isStr(b.enc_nick) || b.enc_nick.length === 0 || b.enc_nick.length > 2048 || !u.B64_RE.test(b.enc_nick)) {
      u.badRequest("enc_nick must be a non-empty base64 string (max 2048 chars).");
    }
    if (typeof b.consent !== "boolean") {
      u.badRequest("consent must be a boolean.");
    }

    let membership = null;
    try {
      membership = $app.findFirstRecordByFilter(
        "memberships",
        "group_id = {:g} && user_id = {:u}",
        { g: group.id, u: e.auth.id }
      );
    } catch (_) {
      membership = null;
    }

    if (membership === null) {
      membership = new Record($app.findCollectionByNameOrId("memberships"));
      membership.set("group_id", group.id);
      membership.set("user_id", e.auth.id);
      membership.set("role", "member");
    }
    membership.set("enc_nick", b.enc_nick);
    membership.set(
      "consent_at",
      u.consentValue(b.consent, membership.getString("consent_at"))
    );
    $app.save(membership);

    return e.json(200, {
      group_id: b.group_id,
      role: membership.getString("role"),
      consent_at: u.dateOrNull(membership, "consent_at"),
    });
  },
  $apis.requireAuth("users")
);

// ---------------------------------------------------------------------------
// POST /api/ts/group-feed
// body: { group_id, k_auth, from_date, to_date }   (dates YYYY-MM-DD, incl.)
// Returns enc_group_meta, all memberships, and daily_stats ONLY for members
// whose consent_at is set.
// ---------------------------------------------------------------------------
routerAdd(
  "POST",
  "/api/ts/group-feed",
  (e) => {
    const u = require(`${__hooks}/ts_utils.js`);
    const b = e.requestInfo().body || {};

    const group = u.findGroupChecked(b.group_id, b.k_auth);

    if (!u.isStr(b.from_date) || !u.DATE_RE.test(b.from_date)) {
      u.badRequest("from_date must be YYYY-MM-DD.");
    }
    if (!u.isStr(b.to_date) || !u.DATE_RE.test(b.to_date)) {
      u.badRequest("to_date must be YYYY-MM-DD.");
    }
    if (b.from_date > b.to_date) {
      u.badRequest("from_date must be <= to_date.");
    }
    const rangeDays =
      (Date.parse(b.to_date) - Date.parse(b.from_date)) / 86400000;
    if (rangeDays > 400) {
      u.badRequest("Date range too large (max 400 days).");
    }

    const memberships = $app.findRecordsByFilter(
      "memberships",
      "group_id = {:g}",
      "created",
      1000,
      0,
      { g: group.id }
    );

    const consented = memberships.filter(
      (m) => m.getString("consent_at") !== ""
    );

    let stats = [];
    if (consented.length > 0) {
      const params = { from: b.from_date, to: b.to_date };
      const ors = consented.map((m, i) => {
        params["u" + i] = m.getString("user_id");
        return "user_id = {:u" + i + "}";
      });
      const rows = $app.findRecordsByFilter(
        "daily_stats",
        "(" + ors.join(" || ") + ") && date >= {:from} && date <= {:to}",
        "date",
        100000,
        0,
        params
      );
      stats = rows.map((r) => ({
        user_id: r.getString("user_id"),
        date: r.getString("date"),
        day_lock_sec: r.getInt("day_lock_sec"),
        night_lock_sec: r.getInt("night_lock_sec"),
        sealed_at: r.getString("sealed_at"),
      }));
    }

    return e.json(200, {
      group_id: b.group_id,
      enc_group_meta: group.getString("enc_group_meta"),
      memberships: memberships.map(u.membershipJSON),
      daily_stats: stats,
    });
  },
  $apis.requireAuth("users")
);

// ---------------------------------------------------------------------------
// POST /api/ts/group-leave
// body: { group_id }
// Deletes the caller's own membership. Idempotent: 204 even if there is
// nothing to delete (also for unknown group ids — no enumeration signal).
// ---------------------------------------------------------------------------
routerAdd(
  "POST",
  "/api/ts/group-leave",
  (e) => {
    const u = require(`${__hooks}/ts_utils.js`);
    const b = e.requestInfo().body || {};

    if (!u.isStr(b.group_id) || !u.UUID_V4_RE.test(b.group_id)) {
      u.badRequest("group_id must be a lowercase UUID v4.");
    }

    let group = null;
    try {
      group = $app.findFirstRecordByFilter("groups", "group_uuid = {:g}", {
        g: b.group_id,
      });
    } catch (_) {
      group = null;
    }

    if (group !== null) {
      let membership = null;
      try {
        membership = $app.findFirstRecordByFilter(
          "memberships",
          "group_id = {:g} && user_id = {:u}",
          { g: group.id, u: e.auth.id }
        );
      } catch (_) {
        membership = null;
      }
      if (membership !== null) {
        $app.delete(membership);
      }
    }

    return e.noContent(204);
  },
  $apis.requireAuth("users")
);
