import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const { sendNotificationEmailMock, captureExceptionMock } = vi.hoisted(() => ({
  sendNotificationEmailMock: vi.fn().mockResolvedValue(undefined),
  captureExceptionMock: vi.fn(),
}));
vi.mock("./email", () => ({ sendNotificationEmail: sendNotificationEmailMock }));
vi.mock("@sentry/nextjs", () => ({ captureException: captureExceptionMock }));

const { createNotification } = await import("./notifications");

function fakeClient(insertResult: { error: unknown } = { error: null }) {
  const insert = vi.fn().mockResolvedValue(insertResult);
  const from = vi.fn().mockReturnValue({ insert });
  return { client: { from } as unknown as SupabaseClient, from, insert };
}

describe("createNotification", () => {
  beforeEach(() => {
    sendNotificationEmailMock.mockReset().mockResolvedValue(undefined);
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
    const { client } = fakeClient({ error: dbError });

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
});
