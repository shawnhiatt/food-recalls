import { describe, expect, test } from "vitest";
import { renderPushPayload, type PushAlert } from "../convex/lib/push";

// §9 push/lock-screen redaction: the payload builder's signature has no way
// to accept matchedOn reasons, so "no health-attribute text on the lock
// screen" is enforced by construction. These tests pin the shape and copy.

const baseAlert: PushAlert = {
  title: "Example Snack Co. bars",
  severity: "class1",
  url: "https://foodrecalls.app/recalls/abc123",
  tag: "abc123",
};

describe("renderPushPayload (§9)", () => {
  test("returns exactly title, body, url, tag — nothing else", () => {
    const payload = renderPushPayload(baseAlert);
    expect(Object.keys(payload).sort()).toEqual(["body", "title", "url"].concat("tag").sort());
  });

  test("title carries the severity label, body carries the product name", () => {
    const payload = renderPushPayload(baseAlert);
    expect(payload.title).toBe("High risk recall");
    expect(payload.body).toBe("Example Snack Co. bars");
  });

  test.each([
    ["class1", "High risk recall"],
    ["class2", "Moderate risk recall"],
    ["class3", "Low risk recall"],
    ["unknown", "Risk level unknown recall"],
  ] as const)("severity %s -> title %s", (severity, expectedTitle) => {
    const payload = renderPushPayload({ ...baseAlert, severity });
    expect(payload.title).toBe(expectedTitle);
  });

  test("url and tag pass through unchanged for deep-linking / notification replacement", () => {
    const payload = renderPushPayload(baseAlert);
    expect(payload.url).toBe(baseAlert.url);
    expect(payload.tag).toBe(baseAlert.tag);
  });
});
