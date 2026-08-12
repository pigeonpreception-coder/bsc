import { describe, it, expect, vi } from "vitest";
import { createNotification } from "./notifications";
import type { SupabaseClient } from "@supabase/supabase-js";

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
});
