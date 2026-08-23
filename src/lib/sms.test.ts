import { describe, it, expect, afterEach, vi } from "vitest";

const { createMock, captureExceptionMock } = vi.hoisted(() => ({
  createMock: vi.fn().mockResolvedValue({ sid: "sms-1" }),
  captureExceptionMock: vi.fn(),
}));

vi.mock("twilio", () => ({
  default: vi.fn(() => ({ messages: { create: createMock } })),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: captureExceptionMock }));

const { sendNotificationSms } = await import("./sms");

describe("sendNotificationSms", () => {
  const originalSid = process.env.TWILIO_ACCOUNT_SID;
  const originalToken = process.env.TWILIO_AUTH_TOKEN;
  const originalFrom = process.env.TWILIO_FROM_NUMBER;

  afterEach(() => {
    if (originalSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
    else process.env.TWILIO_ACCOUNT_SID = originalSid;
    if (originalToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = originalToken;
    if (originalFrom === undefined) delete process.env.TWILIO_FROM_NUMBER;
    else process.env.TWILIO_FROM_NUMBER = originalFrom;
    createMock.mockClear();
    captureExceptionMock.mockClear();
  });

  it("no-ops without throwing when Twilio credentials aren't configured", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;

    await expect(sendNotificationSms("+15551234567", "Hello")).resolves.toBeUndefined();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("no-ops when credentials are set but TWILIO_FROM_NUMBER is missing", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "token";
    delete process.env.TWILIO_FROM_NUMBER;

    await sendNotificationSms("+15551234567", "Hello");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("sends via Twilio when fully configured", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_FROM_NUMBER = "+15550000000";

    await sendNotificationSms("+15551234567", "Your account status changed");

    expect(createMock).toHaveBeenCalledWith({
      to: "+15551234567",
      from: "+15550000000",
      body: "Your account status changed",
    });
  });

  it("reports a thrown send failure to Sentry instead of letting it propagate", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_FROM_NUMBER = "+15550000000";
    const sendError = new Error("Invalid phone number");
    createMock.mockRejectedValueOnce(sendError);

    await expect(sendNotificationSms("bad-number", "Hello")).resolves.toBeUndefined();
    expect(captureExceptionMock).toHaveBeenCalledWith(sendError, expect.anything());
  });
});
