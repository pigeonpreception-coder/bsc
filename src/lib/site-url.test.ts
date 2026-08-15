import { describe, it, expect, afterEach } from "vitest";
import { resolveAppUrl } from "./site-url";

describe("resolveAppUrl", () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalVercelUrl = process.env.VERCEL_URL;

  afterEach(() => {
    if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    if (originalVercelUrl === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = originalVercelUrl;
  });

  it("prefers NEXT_PUBLIC_APP_URL over a caller-supplied origin — the whole point is not trusting the request", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://real-domain.example.com";
    process.env.VERCEL_URL = "some-deploy.vercel.app";

    expect(resolveAppUrl("https://attacker.example.com")).toBe("https://real-domain.example.com");
  });

  it("falls back to VERCEL_URL when NEXT_PUBLIC_APP_URL isn't set", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL_URL = "some-deploy.vercel.app";

    expect(resolveAppUrl("https://attacker.example.com")).toBe("https://some-deploy.vercel.app");
  });

  it("only falls back to the caller-supplied origin when neither env var is set — local dev", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;

    expect(resolveAppUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("returns null when nothing is available at all", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;

    expect(resolveAppUrl(null)).toBeNull();
    expect(resolveAppUrl()).toBeNull();
  });
});
