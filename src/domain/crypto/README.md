# `src/domain/crypto` — wire formats (J6)

Pure TS, runs on plain Node and React Native Hermes. Libraries: audited pure-JS
[`@noble/hashes`](https://github.com/paulmillr/noble-hashes) +
[`@noble/ciphers`](https://github.com/paulmillr/noble-ciphers)
(see docs/CONTRACT_CHANGES.md #7 for why not libsodium). Everything below is
**frozen**: sealed blobs live on the server forever and `auth_hash` gates access
(server/README.md §2), so any reimplementation (iOS, libsodium, server tooling)
must reproduce these bytes exactly. The pinned vectors are in `crypto.test.ts`.

## Key derivation chain (BUILD_V1 §10.2)

```
K_g     32 random bytes. Lives ONLY in invite-link fragments + device secure storage.
K_enc = HKDF-SHA256(IKM=K_g, salt=EMPTY, info="ts-enc-v1",  L=32)   — AEAD key, never leaves the device
K_auth= HKDF-SHA256(IKM=K_g, salt=EMPTY, info="ts-auth-v1", L=32)   — access proof, sent over TLS
```

HKDF per RFC 5869, hash SHA-256, salt = empty byte string (equivalent to 32 zero
bytes per RFC 5869 §2.2 — `node:crypto.hkdfSync('sha256', kg, '', info, 32)`
matches). Info = the ASCII bytes of the literal strings above.

## `auth_hash` (decision #5, must match PocketBase's `$security.sha256(string)`)

```
k_auth_b64u = base64url_no_padding(K_auth)                  // 43 chars — the transport form of k_auth
auth_hash   = lowercase_hex( SHA-256( UTF-8(k_auth_b64u) ) ) // 64 hex chars
```

The hash covers the **encoded string**, not the raw 32 key bytes.

### Pinned vector (also asserted in tests)

```
K_g       000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
K_enc     7c8ddb622aee9d8e8b6d62b8791824c1903a60864d5a76a11bd920cc85982a2f
K_auth    aabc40d126464783643412dc2c6590dc3842913fc7bc800595c06ca499c671b3
k_auth_b64u qrxA0SZGR4NkNBLcLGWQ3DhCkT_HvIAFlcBspJnGcbM
auth_hash e6c5f085e7c9314ad20eecf8e51781b52587ca3e8f251036c076e024715a7109
```

## `Sealed` layout (decision #3) — `enc_group_meta`, `enc_nick`

```
sealed = base64_std_padded( nonce || ciphertext_with_tag )
  nonce               24 fresh random bytes (per seal)
  ciphertext_with_tag XChaCha20-Poly1305(key=K_enc, nonce, plaintext=UTF-8(string)),
                      Poly1305 tag (16 bytes) appended at the END ("combined" mode)
  AAD                 none
```

Identical to libsodium `crypto_aead_xchacha20poly1305_ietf_encrypt` with the
nonce prepended. Minimum blob size 40 bytes (24 nonce + 16 tag). Decoding
accepts std or url-safe base64, padded or not (server does the same); encoding
always emits standard padded base64. `open()` throws on any tamper / wrong key.

## Invite link (BUILD_V1 §10.4)

```
https://<host>/j#g=<group_id UUID v4>&k=<base64url_no_padding(K_g)>   // 43-char k
```

The key sits ONLY in the fragment (never sent to any server). `parse()` also
tolerates the `timeserved://…/j#…` deep-link rewrite, query strings, padding /
percent-encoding on `k`, and uppercase — but only the canonical https form above
is contractual. Anything malformed parses to `undefined`, never an exception.
