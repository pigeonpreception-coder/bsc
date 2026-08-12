import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isValidCronRequest } from "./cron-auth";

function requestWithAuth(header: string | null) {
  const headers = new Headers();
  if (header !== null) headers.set("authorization", header);
  return new Request("https://example.com/api/cron/daily-tasks", { headers });
}

describe("isValidCronRequest", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret-value";
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
  });

  it("accepts the correct bearer token", () => {
    expect(isValidCronRequest(requestWithAuth("Bearer test-secret-value"))).toBe(true);
  });

  it("rejects a wrong token", () => {
    expect(isValidCronRequest(requestWithAuth("Bearer wrong-value"))).toBe(false);
  });

  it("rejects a missing authorization header", () => {
    expect(isValidCronRequest(requestWithAuth(null))).toBe(false);
  });

  it("rejects a token of a different length without throwing", () => {
    expect(isValidCronRequest(requestWithAuth("Bearer short"))).toBe(false);
  });

  it("fails closed when CRON_SECRET isn't configured", () => {
    delete process.env.CRON_SECRET;
    expect(isValidCronRequest(requestWithAuth("Bearer undefined"))).toBe(false);
  });
});
