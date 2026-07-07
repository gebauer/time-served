/// <reference path="../pb_data/types.d.ts" />
//
// Time Served — initial server schema (see BUILD_V1.md §4.2 and §10).
//
// Collections:
//   users        — auth collection (anonymous device credential, no email/name).
//                  PocketBase record ids are 15-char alphanumerics, so the
//                  client-generated UUID v4 lives in the dedicated unique field
//                  `user_uuid`, which is also the password-auth identity field.
//   daily_stats  — sealed daily totals, plaintext integers. Create-only by owner.
//   groups       — opaque: client-generated `group_uuid`, AEAD-encrypted meta,
//                  auth_hash = hex(SHA-256(k_auth_b64url_string)).
//   memberships  — group<->user with AEAD-encrypted nickname + consent timestamp.
//
// Access model (BUILD_V1.md §10.3): list/view of ALL four collections is locked
// (rule = null → superuser only). The ONLY direct client write is
// `daily_stats` create by its owner. Everything else goes through the JS hook
// routes in ../pb_hooks/main.pb.js.

migrate(
  (app) => {
    const UUID_V4_PATTERN =
      "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

    // ------------------------------------------------------------------
    // users — adapt the default auth collection into an anonymous device
    // credential store.
    // ------------------------------------------------------------------
    const users = app.findCollectionByNameOrId("users");

    // Drop the default profile fields — no PII, ever.
    users.fields.removeByName("name");
    users.fields.removeByName("avatar");

    users.fields.add(
      new Field({
        name: "user_uuid",
        type: "text",
        required: true,
        min: 36,
        max: 36,
        pattern: UUID_V4_PATTERN,
      })
    );
    users.addIndex("idx_users_user_uuid", true, "user_uuid", "");

    unmarshal(
      {
        // Anonymous: email stays a system field but is never required/used.
        listRule: null,
        viewRule: null,
        createRule: "", // open: anyone may register a device credential
        updateRule: null,
        deleteRule: null,
        manageRule: null,
        passwordAuth: {
          enabled: true,
          identityFields: ["user_uuid"],
        },
        oauth2: { enabled: false },
        otp: { enabled: false },
        mfa: { enabled: false },
      },
      users
    );
    const emailField = users.fields.getByName("email");
    if (emailField) {
      emailField.required = false;
    }
    app.save(users);

    // ------------------------------------------------------------------
    // groups
    // ------------------------------------------------------------------
    const groups = new Collection({
      name: "groups",
      type: "base",
      listRule: null,
      viewRule: null,
      createRule: null, // only via POST /api/ts/group-create
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          name: "group_uuid",
          type: "text",
          required: true,
          min: 36,
          max: 36,
          pattern: UUID_V4_PATTERN,
        },
        // Opaque AEAD ciphertext (XChaCha20-Poly1305, 24-byte nonce prepended),
        // base64 string. Server never decrypts.
        { name: "enc_group_meta", type: "text", required: true, max: 8192 },
        // hex(SHA-256(k_auth)) where k_auth is the base64url string the
        // clients send. Lowercase hex, 64 chars.
        {
          name: "auth_hash",
          type: "text",
          required: true,
          min: 64,
          max: 64,
          pattern: "^[0-9a-f]{64}$",
        },
        { name: "created", type: "autodate", onCreate: true },
      ],
    });
    groups.addIndex("idx_groups_group_uuid", true, "group_uuid", "");
    app.save(groups);

    // ------------------------------------------------------------------
    // daily_stats
    // ------------------------------------------------------------------
    const dailyStats = new Collection({
      name: "daily_stats",
      type: "base",
      listRule: null,
      viewRule: null,
      // The one allowed direct write: a device creates its OWN sealed day.
      createRule: '@request.auth.id != "" && user_id = @request.auth.id',
      updateRule: null, // immutable after creation
      deleteRule: null,
      fields: [
        {
          name: "user_id",
          type: "relation",
          required: true,
          collectionId: users.id,
          cascadeDelete: true,
          minSelect: 0,
          maxSelect: 1,
        },
        // Local calendar date of the sealed day, YYYY-MM-DD.
        {
          name: "date",
          type: "text",
          required: true,
          min: 10,
          max: 10,
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        },
        // Seconds. NOTE: PocketBase `required` rejects 0, so these stay
        // optional and default to 0; bounds enforce sanity.
        { name: "day_lock_sec", type: "number", onlyInt: true, min: 0, max: 86400 },
        { name: "night_lock_sec", type: "number", onlyInt: true, min: 0, max: 86400 },
        // Client-side seal timestamp (UTC).
        { name: "sealed_at", type: "date", required: true },
        { name: "created", type: "autodate", onCreate: true },
      ],
    });
    dailyStats.addIndex("idx_daily_stats_user_date", true, "user_id, date", "");
    app.save(dailyStats);

    // ------------------------------------------------------------------
    // memberships
    // ------------------------------------------------------------------
    const memberships = new Collection({
      name: "memberships",
      type: "base",
      listRule: null,
      viewRule: null,
      createRule: null, // only via /api/ts/group-create and /api/ts/group-join
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          name: "group_id",
          type: "relation",
          required: true,
          collectionId: groups.id,
          cascadeDelete: true,
          minSelect: 0,
          maxSelect: 1,
        },
        {
          name: "user_id",
          type: "relation",
          required: true,
          collectionId: users.id,
          cascadeDelete: true,
          minSelect: 0,
          maxSelect: 1,
        },
        // Opaque AEAD ciphertext of the per-group nickname, base64 string.
        { name: "enc_nick", type: "text", required: true, max: 2048 },
        // Set iff the member consented that this group may read their
        // daily_stats. Empty = no consent (member visible, numbers hidden).
        { name: "consent_at", type: "date" },
        {
          name: "role",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["owner", "member"],
        },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    });
    memberships.addIndex(
      "idx_memberships_group_user",
      true,
      "group_id, user_id",
      ""
    );
    app.save(memberships);
  },
  (app) => {
    // down: remove created collections, restore users defaults
    for (const name of ["memberships", "daily_stats", "groups"]) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (_) {
        // already gone
      }
    }
    const users = app.findCollectionByNameOrId("users");
    try {
      users.fields.removeByName("user_uuid");
    } catch (_) {}
    unmarshal(
      {
        indexes: users.indexes.filter((i) => !i.includes("idx_users_user_uuid")),
        passwordAuth: { enabled: true, identityFields: ["email"] },
      },
      users
    );
    app.save(users);
  }
);
