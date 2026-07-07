// Time Served — shared helpers for the /api/ts/* hook routes.
//
// SECURITY NOTES
// - `k_auth` (the group access proof) must NEVER be logged or echoed back.
//   Nothing in this module writes it to the logger, to error messages or to
//   responses.
// - Unknown group_id and wrong k_auth produce the *identical* 403 error
//   (message + shape), so a caller cannot enumerate which group ids exist.
// - The SHA-256 is always computed (even when the group does not exist) to
//   keep the two failure paths on a similar code path.

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
// std or url-safe base64, with or without padding
const B64_RE = /^[A-Za-z0-9+/\-_]+={0,2}$/;

function isStr(v) {
  return typeof v === "string";
}

function badRequest(msg) {
  throw new BadRequestError(msg);
}

/** Uniform 403 — same error for unknown group and wrong key. */
function deny() {
  throw new ForbiddenError("Invalid group credentials.");
}

/**
 * Validates group_id + k_auth formats, looks the group up by its client
 * UUID and verifies hex(SHA-256(k_auth)) against the stored auth_hash.
 * Throws the uniform 403 on any failure. Returns the group record.
 */
function findGroupChecked(groupId, kAuth) {
  if (!isStr(groupId) || !UUID_V4_RE.test(groupId)) deny();
  if (!isStr(kAuth) || kAuth.length < 16 || kAuth.length > 128 || !B64_RE.test(kAuth)) {
    deny();
  }
  // Hash first so "group missing" and "bad key" cost about the same.
  const hash = $security.sha256(kAuth);
  let group = null;
  try {
    group = $app.findFirstRecordByFilter("groups", "group_uuid = {:g}", {
      g: groupId,
    });
  } catch (_) {
    group = null;
  }
  if (group === null || hash !== group.getString("auth_hash")) deny();
  return group;
}

/** consent flag -> DateTime value for the `consent_at` field ("" clears). */
function consentValue(consent, existing) {
  if (consent !== true) return "";
  if (existing && existing !== "") return existing; // keep original timestamp
  return new DateTime(); // now (UTC)
}

function dateOrNull(record, field) {
  const v = record.getString(field);
  return v === "" ? null : v;
}

function membershipJSON(m) {
  return {
    user_id: m.getString("user_id"),
    enc_nick: m.getString("enc_nick"),
    consent_at: dateOrNull(m, "consent_at"),
    role: m.getString("role"),
  };
}

module.exports = {
  UUID_V4_RE,
  DATE_RE,
  HEX64_RE,
  B64_RE,
  isStr,
  badRequest,
  deny,
  findGroupChecked,
  consentValue,
  dateOrNull,
  membershipJSON,
};
