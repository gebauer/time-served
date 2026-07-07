/**
 * Dependency-free base64 for Uint8Array key material. Hand-rolled because the
 * RN runtime has neither Buffer nor (guaranteed) atob/btoa, and pulling a
 * polyfill for 30 lines is not worth it. Standard alphabet, '=' padding.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i += 1) {
  LOOKUP[ALPHABET[i]!] = i;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0b11) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : ALPHABET[((b1 & 0b1111) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : ALPHABET[b2! & 0b111111];
  }
  return out;
}

export function base64ToBytes(encoded: string): Uint8Array {
  if (encoded.length % 4 !== 0) {
    throw new Error('base64ToBytes: input length must be a multiple of 4');
  }
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const byteLength = (encoded.length / 4) * 3 - padding;
  const out = new Uint8Array(byteLength);
  let offset = 0;
  for (let i = 0; i < encoded.length; i += 4) {
    const c0 = digit(encoded, i);
    const c1 = digit(encoded, i + 1);
    const pad2 = encoded[i + 2] === '=';
    const pad3 = encoded[i + 3] === '=';
    const c2 = pad2 ? 0 : digit(encoded, i + 2);
    const c3 = pad3 ? 0 : digit(encoded, i + 3);
    out[offset] = (c0 << 2) | (c1 >> 4);
    offset += 1;
    if (!pad2) {
      out[offset] = ((c1 & 0b1111) << 4) | (c2 >> 2);
      offset += 1;
    }
    if (!pad3) {
      out[offset] = ((c2 & 0b11) << 6) | c3;
      offset += 1;
    }
  }
  return out;
}

function digit(encoded: string, index: number): number {
  const value = LOOKUP[encoded[index]!];
  if (value === undefined) {
    throw new Error(`base64ToBytes: invalid character at index ${index}`);
  }
  return value;
}
