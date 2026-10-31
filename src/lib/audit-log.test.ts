import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const { captureExceptionMock } = vi.hoisted(() => ({ captureExceptionMock: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: captureExceptionMock }));

const { writeAuditLog } = await import("./audit-log");

function fakeClient(insertResult: { error: unknown }) {
  const insert = vi.fn().mockResolvedValue(insertResult);
  const from = vi.fn().mockReturnValue({ insert });
  return { client: { from } as unknown as SupabaseClient, from, insert };
}

const entry = {
  tenant_id: "tenant-1",
  user_id: "user-1",
  action: "update_row",
  resource_type: "scorecard_row",
  resource_id: "row-1",
};

describe("writeAuditLog", () => {
  it("inserts into audit_log and does not report anything on success", async () => {
    const { client, from, insert } = fakeClient({ error: null });

    await writeAuditLog(client, entry);

    expect(from).toHaveBeenCalledWith("audit_log");
    expect(insert).toHaveBeenCalledWith(entry);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("reports to Sentry instead of throwing when the insert fails", async () => {
    const dbError = { message: "some RLS or column-type failure" };
    const { client } = fakeClient({ error: dbError });

    await expect(writeAuditLog(client, entry)).resolves.toBeUndefined();
    expect(captureExceptionMock).toHaveBeenCalledWith(dbError, { extra: { auditLogEntry: entry } });
  });

  it("does not send old_value/new_value (whole rows, possibly personal data) to Sentry", async () => {
    const { client } = fakeClient({ error: { message: "boom" } });

    await writeAuditLog(client, { ...entry, old_value: { phone: "+250700000000" }, new_value: { email: "a@b.com" } });

    const [, context] = captureExceptionMock.mock.calls.at(-1)!;
    expect(JSON.stringify(context)).not.toContain("+250700000000");
    expect(JSON.stringify(context)).not.toContain("a@b.com");
  });
});
