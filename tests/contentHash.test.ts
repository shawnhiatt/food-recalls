import { describe, expect, test } from "vitest";
import { computeContentHash, sha256Hex } from "../convex/lib/contentHash";

// The SHA-256 implementation derives its constants at module load; these
// known-answer vectors (FIPS 180-4) pin the whole construction.
describe("sha256Hex", () => {
  test("empty string vector", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  test("'abc' vector", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("multi-block input (>64 bytes)", () => {
    expect(
      sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });
});

const base = {
  classification: "Class I",
  rawStatus: "Ongoing",
  lifecycle: "active",
  states: ["GA", "NC"],
  allergens: ["milk"],
  productDesc: "Dark chocolate bar",
  productCodes: ["012345678905"],
};

describe("computeContentHash", () => {
  test("stable across identical inputs", () => {
    expect(computeContentHash(base)).toBe(computeContentHash({ ...base }));
  });

  test("array order does not matter", () => {
    expect(computeContentHash({ ...base, states: ["NC", "GA"] })).toBe(
      computeContentHash(base),
    );
  });

  test("whitespace-only differences do not matter", () => {
    expect(computeContentHash({ ...base, productDesc: " Dark chocolate bar " })).toBe(
      computeContentHash(base),
    );
  });

  test("material change produces a different hash", () => {
    expect(computeContentHash({ ...base, states: ["GA", "NC", "TX"] })).not.toBe(
      computeContentHash(base),
    );
    expect(computeContentHash({ ...base, classification: "Class II" })).not.toBe(
      computeContentHash(base),
    );
    expect(computeContentHash({ ...base, lifecycle: "completed" })).not.toBe(
      computeContentHash(base),
    );
  });
});
