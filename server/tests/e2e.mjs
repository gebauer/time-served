// Time Served backend e2e tests. Run via ../test.sh (expects a PocketBase
// instance with the migrations + hooks at $PB_URL).
import { createHash, randomUUID, randomBytes } from "node:crypto";

const PB = process.env.PB_URL || "http://127.0.0.1:8097";

let passed = 0;
let failed = 0;
const fails = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    fails.push(name);
    console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(PB + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

// --- device bootstrap: create users record, then auth-with-password --------
async function registerDevice() {
  const user_uuid = randomUUID().toLowerCase();
  const password = randomBytes(24).toString("base64url");
  const create = await req("POST", "/api/collections/users/records", {
    body: { user_uuid, password, passwordConfirm: password },
  });
  if (create.status !== 200) {
    throw new Error(
      `device register failed: ${create.status} ${JSON.stringify(create.json)}`
    );
  }
  const auth = await req("POST", "/api/collections/users/auth-with-password", {
    body: { identity: user_uuid, password },
  });
  if (auth.status !== 200) {
    throw new Error(`device auth failed: ${auth.status}`);
  }
  return {
    user_uuid,
    password,
    token: auth.json.token,
    id: auth.json.record.id,
  };
}

const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const fakeCipher = (n = 60) => randomBytes(n).toString("base64");

async function main() {
  console.log(`Testing against ${PB}`);

  // health
  const health = await req("GET", "/api/health");
  check("server healthy", health.status === 200);

  // ---- device registration --------------------------------------------
  const A = await registerDevice();
  const B = await registerDevice();
  const C = await registerDevice();
  check("device A registered + authed", !!A.token && A.id.length === 15);
  check("device B registered + authed", !!B.token);
  check("device C registered + authed", !!C.token);

  // rejected: bad uuid format
  const badReg = await req("POST", "/api/collections/users/records", {
    body: { user_uuid: "not-a-uuid", password: "x".repeat(24), passwordConfirm: "x".repeat(24) },
  });
  check("register with malformed user_uuid rejected", badReg.status === 400);

  // duplicate user_uuid rejected
  const dupReg = await req("POST", "/api/collections/users/records", {
    body: { user_uuid: A.user_uuid, password: "y".repeat(24), passwordConfirm: "y".repeat(24) },
  });
  check("register with duplicate user_uuid rejected", dupReg.status === 400);

  // ---- group create ----------------------------------------------------
  const group_id = randomUUID().toLowerCase();
  const k_auth = randomBytes(32).toString("base64url"); // what clients send
  const auth_hash = sha256hex(k_auth); // what the server stores
  const enc_group_meta = fakeCipher(80);

  const noAuthCreate = await req("POST", "/api/ts/group-create", {
    body: { group_id, enc_group_meta, auth_hash, enc_nick: fakeCipher(), consent: true },
  });
  check("group-create without device auth denied", noAuthCreate.status === 401);

  const create = await req("POST", "/api/ts/group-create", {
    token: A.token,
    body: { group_id, enc_group_meta, auth_hash, enc_nick: fakeCipher(), consent: true },
  });
  check(
    "group-create ok (A = owner, consented)",
    create.status === 200 &&
      create.json.role === "owner" &&
      typeof create.json.consent_at === "string",
    JSON.stringify(create.json)
  );

  const dupCreate = await req("POST", "/api/ts/group-create", {
    token: B.token,
    body: { group_id, enc_group_meta, auth_hash, enc_nick: fakeCipher(), consent: true },
  });
  check("group-create with duplicate group_id rejected", dupCreate.status === 400);

  const badHashCreate = await req("POST", "/api/ts/group-create", {
    token: A.token,
    body: {
      group_id: randomUUID().toLowerCase(),
      enc_group_meta,
      auth_hash: "ZZ" + auth_hash.slice(2),
      enc_nick: fakeCipher(),
      consent: true,
    },
  });
  check("group-create with malformed auth_hash rejected", badHashCreate.status === 400);

  // ---- group join ------------------------------------------------------
  const joinB = await req("POST", "/api/ts/group-join", {
    token: B.token,
    body: { group_id, k_auth, enc_nick: fakeCipher(), consent: true },
  });
  check(
    "B joins with consent",
    joinB.status === 200 &&
      joinB.json.role === "member" &&
      typeof joinB.json.consent_at === "string",
    JSON.stringify(joinB.json)
  );
  const bConsentAt = joinB.json.consent_at;

  const joinC = await req("POST", "/api/ts/group-join", {
    token: C.token,
    body: { group_id, k_auth, enc_nick: fakeCipher(), consent: false },
  });
  check(
    "C joins WITHOUT consent",
    joinC.status === 200 && joinC.json.consent_at === null,
    JSON.stringify(joinC.json)
  );

  // wrong key → 403, and identical to unknown-group 403
  const joinWrongKey = await req("POST", "/api/ts/group-join", {
    token: C.token,
    body: { group_id, k_auth: randomBytes(32).toString("base64url"), enc_nick: fakeCipher(), consent: true },
  });
  check("join with wrong k_auth → 403", joinWrongKey.status === 403);

  const joinUnknownGroup = await req("POST", "/api/ts/group-join", {
    token: C.token,
    body: { group_id: randomUUID().toLowerCase(), k_auth, enc_nick: fakeCipher(), consent: true },
  });
  check("join with unknown group_id → 403", joinUnknownGroup.status === 403);
  check(
    "unknown-group and wrong-key errors are identical (no enumeration)",
    JSON.stringify(joinWrongKey.json) === JSON.stringify(joinUnknownGroup.json),
    `${JSON.stringify(joinWrongKey.json)} vs ${JSON.stringify(joinUnknownGroup.json)}`
  );

  // idempotent re-join: updates enc_nick, keeps original consent_at
  const newNickB = fakeCipher(40);
  const rejoinB = await req("POST", "/api/ts/group-join", {
    token: B.token,
    body: { group_id, k_auth, enc_nick: newNickB, consent: true },
  });
  check(
    "re-join is idempotent (still member, consent_at preserved)",
    rejoinB.status === 200 &&
      rejoinB.json.role === "member" &&
      rejoinB.json.consent_at === bConsentAt
  );

  // ---- daily_stats upload (the only direct collection write) -----------
  const seal = (token, user, date, day, night) =>
    req("POST", "/api/collections/daily_stats/records", {
      token,
      body: {
        user_id: user.id,
        date,
        day_lock_sec: day,
        night_lock_sec: night,
        sealed_at: new Date().toISOString(),
      },
    });

  const sA1 = await seal(A.token, A, "2026-07-05", 3600, 7200);
  const sA2 = await seal(A.token, A, "2026-07-06", 1800, 5400);
  const sB1 = await seal(B.token, B, "2026-07-05", 600, 300);
  const sC1 = await seal(C.token, C, "2026-07-05", 999, 111);
  check(
    "A/B/C upload daily_stats",
    sA1.status === 200 && sA2.status === 200 && sB1.status === 200 && sC1.status === 200,
    [sA1.status, sA2.status, sB1.status, sC1.status].join(",")
  );

  // duplicate (user, date) rejected
  const dupStat = await seal(A.token, A, "2026-07-05", 1, 1);
  check("duplicate (user_id, date) rejected", dupStat.status === 400);

  // writing for another user rejected
  const forged = await seal(A.token, B, "2026-07-07", 1, 1);
  check("uploading daily_stats for another user rejected", forged.status === 400);

  // unauthenticated create rejected
  const anonStat = await req("POST", "/api/collections/daily_stats/records", {
    body: { user_id: A.id, date: "2026-07-08", day_lock_sec: 1, night_lock_sec: 1, sealed_at: new Date().toISOString() },
  });
  check("unauthenticated daily_stats create rejected", anonStat.status === 400);

  // update / delete denied (immutability)
  const statId = sA1.json.id;
  const upd = await req("PATCH", `/api/collections/daily_stats/records/${statId}`, {
    token: A.token,
    body: { day_lock_sec: 99999 },
  });
  check("daily_stats update denied (immutable)", upd.status === 403 || upd.status === 404);
  const del = await req("DELETE", `/api/collections/daily_stats/records/${statId}`, {
    token: A.token,
  });
  check("daily_stats delete denied", del.status === 403 || del.status === 404);

  // ---- feed -------------------------------------------------------------
  const feed = await req("POST", "/api/ts/group-feed", {
    token: B.token,
    body: { group_id, k_auth, from_date: "2026-07-01", to_date: "2026-07-07" },
  });
  const f = feed.json || {};
  check("feed returns 200", feed.status === 200, JSON.stringify(f).slice(0, 200));
  check("feed returns enc_group_meta", f.enc_group_meta === enc_group_meta);
  check(
    "feed lists all 3 memberships (incl. unconsented C)",
    Array.isArray(f.memberships) && f.memberships.length === 3
  );
  const mC = (f.memberships || []).find((m) => m.user_id === C.id);
  check("C's membership shows consent_at = null", mC && mC.consent_at === null);
  const mB = (f.memberships || []).find((m) => m.user_id === B.id);
  check("B's membership carries updated enc_nick", mB && mB.enc_nick === newNickB);

  const statUsers = new Set((f.daily_stats || []).map((r) => r.user_id));
  check(
    "feed daily_stats contain consented A and B",
    statUsers.has(A.id) && statUsers.has(B.id)
  );
  check("feed daily_stats EXCLUDE unconsented C", !statUsers.has(C.id));
  check(
    "feed daily_stats row shape",
    (f.daily_stats || []).every(
      (r) =>
        typeof r.date === "string" &&
        Number.isInteger(r.day_lock_sec) &&
        Number.isInteger(r.night_lock_sec) &&
        typeof r.sealed_at === "string"
    )
  );
  check(
    "feed respects date range",
    (f.daily_stats || []).every((r) => r.date >= "2026-07-01" && r.date <= "2026-07-07")
  );

  // narrower range excludes 2026-07-06
  const feedNarrow = await req("POST", "/api/ts/group-feed", {
    token: A.token,
    body: { group_id, k_auth, from_date: "2026-07-05", to_date: "2026-07-05" },
  });
  check(
    "feed date filtering works",
    feedNarrow.status === 200 &&
      feedNarrow.json.daily_stats.every((r) => r.date === "2026-07-05") &&
      !feedNarrow.json.daily_stats.some((r) => r.date === "2026-07-06")
  );

  // wrong k_auth / unknown group → identical 403
  const feedWrong = await req("POST", "/api/ts/group-feed", {
    token: A.token,
    body: { group_id, k_auth: randomBytes(32).toString("base64url"), from_date: "2026-07-01", to_date: "2026-07-07" },
  });
  const feedUnknown = await req("POST", "/api/ts/group-feed", {
    token: A.token,
    body: { group_id: randomUUID().toLowerCase(), k_auth, from_date: "2026-07-01", to_date: "2026-07-07" },
  });
  check("feed with wrong k_auth → 403", feedWrong.status === 403);
  check(
    "feed unknown-group vs wrong-key errors identical",
    feedUnknown.status === 403 &&
      JSON.stringify(feedWrong.json) === JSON.stringify(feedUnknown.json)
  );

  const feedNoAuth = await req("POST", "/api/ts/group-feed", {
    body: { group_id, k_auth, from_date: "2026-07-01", to_date: "2026-07-07" },
  });
  check("feed without device auth denied", feedNoAuth.status === 401);

  // ---- direct collection access is locked -------------------------------
  for (const col of ["users", "daily_stats", "groups", "memberships"]) {
    const list = await req("GET", `/api/collections/${col}/records`, { token: A.token });
    check(`direct list of ${col} denied`, list.status === 403, `got ${list.status}`);
  }
  const viewStat = await req(
    "GET",
    `/api/collections/daily_stats/records/${statId}`,
    { token: A.token }
  );
  check("direct view of a daily_stats record denied", viewStat.status === 403 || viewStat.status === 404);
  const viewOwnUser = await req("GET", `/api/collections/users/records/${A.id}`, {
    token: A.token,
  });
  check("direct view of own users record denied", viewOwnUser.status === 403 || viewOwnUser.status === 404);

  // direct writes to groups/memberships denied
  const directGroup = await req("POST", "/api/collections/groups/records", {
    token: A.token,
    body: { group_uuid: randomUUID().toLowerCase(), enc_group_meta: fakeCipher(), auth_hash: sha256hex("x") },
  });
  check("direct groups create denied", directGroup.status === 400 || directGroup.status === 403);
  const directMem = await req("POST", "/api/collections/memberships/records", {
    token: A.token,
    body: { group_id: "x", user_id: A.id, enc_nick: fakeCipher(), role: "member" },
  });
  check("direct memberships create denied", directMem.status === 400 || directMem.status === 403);

  // ---- leave ------------------------------------------------------------
  const leaveC = await req("POST", "/api/ts/group-leave", {
    token: C.token,
    body: { group_id },
  });
  check("C leaves group → 204", leaveC.status === 204);
  const leaveCAgain = await req("POST", "/api/ts/group-leave", {
    token: C.token,
    body: { group_id },
  });
  check("leave is idempotent → 204", leaveCAgain.status === 204);

  const feedAfterLeave = await req("POST", "/api/ts/group-feed", {
    token: A.token,
    body: { group_id, k_auth, from_date: "2026-07-01", to_date: "2026-07-07" },
  });
  check(
    "after leave, C no longer in memberships",
    feedAfterLeave.status === 200 &&
      feedAfterLeave.json.memberships.length === 2 &&
      !feedAfterLeave.json.memberships.some((m) => m.user_id === C.id)
  );

  // ---- summary ------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("Failed checks:\n - " + fails.join("\n - "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test run crashed:", err);
  process.exit(1);
});
