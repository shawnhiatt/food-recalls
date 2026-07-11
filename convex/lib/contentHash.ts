// Content-hash revision identity (SPEC.md §4, §15): the hash covers the material
// fields only, so source-side noise (report dates, quantity strings, raw payload
// reshuffles) never creates a phantom revision. Synchronous pure-TS SHA-256 so the
// same code runs identically in the Convex runtime, Node, and test VMs.

/** The fields whose change constitutes a material update (§4 "Revisioning"). */
export type MaterialFields = {
  classification: string;
  rawStatus: string;
  lifecycle: string;
  states: string[];
  allergens: string[];
  productDesc: string;
  productCodes: string[];
};

export function computeContentHash(fields: MaterialFields): string {
  const canonical = JSON.stringify({
    classification: fields.classification.trim(),
    rawStatus: fields.rawStatus.trim(),
    lifecycle: fields.lifecycle,
    states: [...fields.states].sort(),
    allergens: [...fields.allergens].sort(),
    productDesc: fields.productDesc.trim(),
    productCodes: [...fields.productCodes].sort(),
  });
  return sha256Hex(canonical);
}

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4). Round constants are derived from the fractional parts
// of the cube/square roots of the first primes rather than transcribed, and the
// implementation is pinned by known-answer tests in tests/contentHash.test.ts.
// ---------------------------------------------------------------------------

const PRIMES: number[] = (() => {
  const primes: number[] = [];
  for (let n = 2; primes.length < 64; n++) {
    if (primes.every((p) => n % p !== 0)) primes.push(n);
  }
  return primes;
})();

const frac32 = (x: number) => Math.floor((x - Math.floor(x)) * 0x1_0000_0000);
const K = PRIMES.map((p) => frac32(Math.cbrt(p)));
const H_INIT = PRIMES.slice(0, 8).map((p) => frac32(Math.sqrt(p)));

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;

  // Pad: 0x80, zeros, 64-bit big-endian length, to a multiple of 64 bytes.
  const paddedLen = (((bytes.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x1_0000_0000));
  view.setUint32(paddedLen - 4, bitLen >>> 0);

  const h = [...H_INIT];
  const w = new Array<number>(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h as [
      number, number, number, number, number, number, number, number,
    ];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + hh) >>> 0;
  }

  return h.map((x) => x.toString(16).padStart(8, "0")).join("");
}
