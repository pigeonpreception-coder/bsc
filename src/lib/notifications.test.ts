import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const { sendNotificationEmailMock } = vi.hoisted(() => ({ sendNotificationEmailMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./email", () => ({ sendNotificationEmail: sendNotificationEmailMock }));

const { createNotification } = await import("./notifications");

function fakeClient() {
  const insert = vi.fn().mockResolvedValue({ data: null, error: null });
  const from = vi.fn().mockReturnValue({ insert });
  return { client: { from } as unknown as SupabaseClient, from, insert };
}

describe("createNotification", () => {
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
    sendNotificationEmailMock.mockClear();

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
    sendNotificationEmailMock.mockClear();

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
});
