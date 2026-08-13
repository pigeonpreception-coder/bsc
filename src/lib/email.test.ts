import { describe, it, expect, afterEach, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn().mockResolvedValue({ data: { id: "email-1" }, error: null }) }));

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function MockResend() {
    return { emails: { send: sendMock } };
  }),
}));

const { sendNotificationEmail } = await import("./email");

describe("sendNotificationEmail", () => {
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalApiKey;
    if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    sendMock.mockClear();
  });

  it("no-ops without throwing when RESEND_API_KEY isn't configured", async () => {
    delete process.env.RESEND_API_KEY;

    await expect(sendNotificationEmail("user@example.com", "Subject", "Body text")).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends via Resend with an absolute link when RESEND_API_KEY and NEXT_PUBLIC_APP_URL are both set", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";

    await sendNotificationEmail("user@example.com", "Subject", "Body text", "/dashboard");

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];
    expect(call.to).toBe("user@example.com");
    expect(call.subject).toBe("Subject");
    expect(call.html).toContain("Body text");
    expect(call.html).toContain("https://app.example.com/dashboard");
  });

  it("omits the link entirely when no app URL is configured", async () => {
    process.env.RESEND_API_KEY = "test-key";
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;

    await sendNotificationEmail("user@example.com", "Subject", "Body text", "/dashboard");

    const call = sendMock.mock.calls[0][0];
    expect(call.html).not.toContain("<a href");
  });

  it("escapes HTML in the message — an admin-settable department/company name shouldn't be able to inject markup or a link into the email", async () => {
    process.env.RESEND_API_KEY = "test-key";

    await sendNotificationEmail(
      "user@example.com",
      "Subject",
      '<a href="https://evil.example/phish">Click to verify</a>',
    );

    const call = sendMock.mock.calls[0][0];
    expect(call.html).not.toContain("<a href=\"https://evil.example");
    expect(call.html).toContain("&lt;a href=");
  });
});
