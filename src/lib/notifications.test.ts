import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const { sendNotificationEmailMock, sendNotificationSmsMock, captureExceptionMock } = vi.hoisted(() => ({
  sendNotificationEmailMock: vi.fn().mockResolvedValue(undefined),
  sendNotificationSmsMock: vi.fn().mockResolvedValue(undefined),
  captureExceptionMock: vi.fn(),
}));
vi.mock("./email", () => ({ sendNotificationEmail: sendNotificationEmailMock }));
vi.mock("./sms", () => ({ sendNotificationSms: sendNotificationSmsMock }));
vi.mock("@sentry/nextjs", () => ({ captureException: captureExceptionMock }));

const { createNotification } = await import("./notifications");

function fakeClient(
  options: { insertError?: unknown; emailNotificationsEnabled?: boolean | null; smsNotificationsEnabled?: boolean | null } = {},
) {
  const insert = vi.fn().mockResolvedValue({ error: options.insertError ?? null });
  const recipientRowIsNull = options.emailNotificationsEnabled === null || options.smsNotificationsEnabled === null;
  const maybeSingle = vi.fn().mockResolvedValue({
    data: recipientRowIsNull
      ? null
      : {
          email_notifications_enabled: options.emailNotificationsEnabled ?? true,
          sms_notifications_enabled: options.smsNotificationsEnabled ?? false,
        },
    error: null,
  });

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === "notifications") return { insert };
    if (table === "users") return { select: () => ({ eq: () => ({ maybeSingle }) }) };
    throw new Error(`Unexpected table "${table}" in this test's fake client`);
  });

  return { client: { from } as unknown as SupabaseClient, from, insert, maybeSingle };
}

describe("createNotification", () => {
  beforeEach(() => {
    sendNotificationEmailMock.mockReset().mockResolvedValue(undefined);
    sendNotificationSmsMock.mockReset().mockResolvedValue(undefined);
    captureExceptionMock.mockReset();
  });

  it("inserts a row scoped to the given tenant and user, with the link defaulted to null when omitted", async () => {
    const { client, from, insert } = fakeClient();

    await createNotification(client, {
      tenantId: "tenant-1",
      userId: "user-1",
      type: "position_assigned",
      message: "You've been assigned to Finance.",
    });

    expect(from).toHaveBeenCalledWith("notifications");
    expect(insert).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      user_id: "user-1",
      notification_type: "position_assigned",
      message: "You've been assigned to Finance.",
      link: null,
    });
  });

  it("passes the link through when provided", async () => {
    const { client, insert } = fakeClient();

    await createNotification(client, {
      tenantId: "tenant-1",
      userId: "user-1",
      type: "weekly_advisory_ready",
      message: "Your weekly performance advisory is ready.",
      link: "/dashboard",
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ link: "/dashboard" }));
  });

  it("does not attempt to send an email when the email param is omitted", async () => {
    const { client } = fakeClient();

    await createNotification(client, {
      tenantId: "tenant-1",
      userId: "user-1",
      type: "position_assigned",
      message: "You've been assigned to Finance.",
    });

    expect(sendNotificationEmailMock).not.toHaveBeenCalled();
  });

  it("sends an email with the notification's message and link when the email param is provided", async () => {
    const { client } = fakeClient();

    await createNotification(client, {
      tenantId: "tenant-1",
      userId: "user-1",
      type: "weekly_advisory_ready",
      message: "Your weekly performance advisory is ready.",
      link: "/dashboard",
      email: { to: "user@example.com", subject: "Your weekly advisory" },
    });

    expect(sendNotificationEmailMock).toHaveBeenCalledWith(
      "user@example.com",
      "Your weekly advisory",
      "Your weekly performance advisory is ready.",
      "/dashboard",
    );
  });

  it("reports a failed insert to Sentry instead of leaving it invisible", async () => {
    const dbError = { message: "constraint violation" };
    const { client } = fakeClient({ insertError: dbError });

    await expect(
      createNotification(client, {
        tenantId: "tenant-1",
        userId: "user-1",
        type: "position_assigned",
        message: "You've been assigned to Finance.",
      }),
    ).resolves.toBeUndefined();

    expect(captureExceptionMock).toHaveBeenCalledWith(dbError, expect.anything());
  });

  it("catches a thrown email failure and reports it, without failing the caller", async () => {
    const { client } = fakeClient();
    const sendError = new Error("network failure");
    sendNotificationEmailMock.mockRejectedValue(sendError);

    await expect(
      createNotification(client, {
        tenantId: "tenant-1",
        userId: "user-1",
        type: "position_assigned",
        message: "You've been assigned to Finance.",
        email: { to: "user@example.com", subject: "Subject" },
      }),
    ).resolves.toBeUndefined();

    expect(captureExceptionMock).toHaveBeenCalledWith(sendError, expect.anything());
  });

  describe("email-notification preference", () => {
    it("skips the email (but still writes the in-app row) when the recipient has opted out", async () => {
      const { client, insert } = fakeClient({ emailNotificationsEnabled: false });

      await createNotification(client, {
        tenantId: "tenant-1",
        userId: "user-1",
        type: "position_assigned",
        message: "You've been assigned to Finance.",
        email: { to: "user@example.com", subject: "Subject" },
      });

      expect(insert).toHaveBeenCalled();
      expect(sendNotificationEmailMock).not.toHaveBeenCalled();
    });

    it("sends when the recipient row can't be found, rather than silently dropping the notification", async () => {
      const { client } = fakeClient({ emailNotificationsEnabled: null });

      await createNotification(client, {
        tenantId: "tenant-1",
        userId: "user-1",
        type: "position_assigned",
        message: "You've been assigned to Finance.",
        email: { to: "user@example.com", subject: "Subject" },
      });

      expect(sendNotificationEmailMock).toHaveBeenCalled();
    });

    it("bypasses the opt-out for a security-relevant account_status_changed notification", async () => {
      const { client, maybeSingle } = fakeClient({ emailNotificationsEnabled: false });

      await createNotification(client, {
        tenantId: "tenant-1",
        userId: "user-1",
        type: "account_status_changed",
        message: "Your account has been suspended.",
        email: { to: "user@example.com", subject: "Account status changed" },
      });

      expect(maybeSingle).not.toHaveBeenCalled();
      expect(sendNotificationEmailMock).toHaveBeenCalled();
    });
  });

  describe("sms-notification preference", () => {
    it("does not attempt to send a text when the sms param is omitted", async () => {
      const { client } = fakeClient();
      await createNotification(client, {
        tenantId: "tenant-1",
        userId: "user-1",
        type: "position_assigned",
        message: "You've been assigned to Finance.",
      });
      expect(sendNotificationSmsMock).not.toHaveBeenCalled();
    });

    it("skips the text when the recipient hasn't opted in (opt-in default)", async () => {
      const { client } = fakeClient({ smsNotificationsEnabled: false });
      await createNotification(client, {
        tenantId: "tenant-1",
        userId: "user-1",
        type: "account_created",
        message: "Welcome",
        sms: { to: "+15551234567" },
      });
      expect(sendNotificationSmsMock).not.toHaveBeenCalled();
    });

    it("sends the text when the recipient has explicitly opted in", async () => {
      const { client } = fakeClient({ smsNotificationsEnabled: true });
      await createNotification(client, {
        tenantId: "tenant-1",
        userId: "user-1",
        type: "account_created",
        message: "Welcome",
        sms: { to: "+15551234567" },
      });
      expect(sendNotificationSmsMock).toHaveBeenCalledWith("+15551234567", "Welcome");
    });

    it("does NOT default to sending when the recipient row can't be found — opt-in fails closed, unlike email", async () => {
      const { client } = fakeClient({ emailNotificationsEnabled: null, smsNotificationsEnabled: null });
      await createNotification(client, {
        tenantId: "tenant-1",
        userId: "user-1",
        type: "account_created",
        message: "Welcome",
        sms: { to: "+15551234567" },
      });
      expect(sendNotificationSmsMock).not.toHaveBeenCalled();
    });

    it("bypasses the opt-in requirement for a security-relevant account_status_changed notification", async () => {
      const { client, maybeSingle } = fakeClient({ smsNotificationsEnabled: false });
      await createNotification(client, {
        tenantId: "tenant-1",
        userId: "user-1",
        type: "account_status_changed",
        message: "Your account has been suspended.",
        sms: { to: "+15551234567" },
      });
      expect(maybeSingle).not.toHaveBeenCalled();
      expect(sendNotificationSmsMock).toHaveBeenCalledWith("+15551234567", "Your account has been suspended.");
    });

    it("catches a thrown SMS failure and reports it, without failing the caller", async () => {
      const { client } = fakeClient({ smsNotificationsEnabled: true });
      const sendError = new Error("carrier rejected");
      sendNotificationSmsMock.mockRejectedValue(sendError);

      await expect(
        createNotification(client, {
          tenantId: "tenant-1",
          userId: "user-1",
          type: "account_created",
          message: "Welcome",
          sms: { to: "+15551234567" },
        }),
      ).resolves.toBeUndefined();
      expect(captureExceptionMock).toHaveBeenCalledWith(sendError, expect.anything());
    });

    it("looks up both preferences in a single query when email and sms are both requested", async () => {
      const { client, maybeSingle } = fakeClient({ emailNotificationsEnabled: true, smsNotificationsEnabled: true });
      await createNotification(client, {
        tenantId: "tenant-1",
        userId: "user-1",
        type: "account_created",
        message: "Welcome",
        email: { to: "user@example.com", subject: "Welcome" },
        sms: { to: "+15551234567" },
      });
      expect(maybeSingle).toHaveBeenCalledTimes(1);
      expect(sendNotificationEmailMock).toHaveBeenCalled();
      expect(sendNotificationSmsMock).toHaveBeenCalled();
    });
  });
});
