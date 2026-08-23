import { describe, it, expect, beforeEach, vi } from "vitest";

const { getCurrentUserMock, writeAuditLogMock, createNotificationMock, assigneeMock, insertMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  writeAuditLogMock: vi.fn(),
  createNotificationMock: vi.fn(),
  assigneeMock: vi.fn(),
  insertMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: writeAuditLogMock }));
vi.mock("@/lib/notifications", () => ({ createNotification: createNotificationMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === "users") {
        return { select: () => ({ eq: () => ({ eq: () => ({ in: () => ({ maybeSingle: assigneeMock }) }) }) }) };
      }
      if (table === "daily_tasks") {
        return { insert: (values: Record<string, unknown>) => ({ select: () => ({ single: () => insertMock(values) }) }) };
      }
      throw new Error(`Unexpected table "${table}" in this test's fake client`);
    },
  }),
}));

const { assignTask } = await import("./task-actions");

const companyAdmin = { id: "admin-1", email: "admin@b.com", full_name: "Admin", role: "company_admin" as const, tenant_id: "tenant-1" };
const staff = { id: "staff-1", email: "staff@b.com", full_name: "Staff One", role: "staff" as const, tenant_id: "tenant-1" };
const assignee = { id: "staff-2", email: "assignee@b.com", full_name: "Assignee Two" };

function formDataFor(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  getCurrentUserMock.mockReset().mockResolvedValue(companyAdmin);
  writeAuditLogMock.mockReset();
  createNotificationMock.mockReset();
  assigneeMock.mockReset().mockResolvedValue({ data: assignee });
  insertMock.mockReset().mockResolvedValue({ data: { id: "task-1" }, error: null });
});

describe("assignTask", () => {
  it("rejects an unauthenticated caller", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    await expect(assignTask(formDataFor({ assignee_id: "staff-2", task_title: "Do it" }))).rejects.toThrow("Not authorized");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects a staff caller (not company_admin/manager)", async () => {
    getCurrentUserMock.mockResolvedValue(staff);
    await expect(assignTask(formDataFor({ assignee_id: "staff-2", task_title: "Do it" }))).rejects.toThrow("Not authorized");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("allows a manager caller", async () => {
    getCurrentUserMock.mockResolvedValue({ ...staff, role: "manager" as const });
    await assignTask(formDataFor({ assignee_id: "staff-2", task_title: "Do it" }));
    expect(insertMock).toHaveBeenCalled();
  });

  it("rejects a missing assignee", async () => {
    await expect(assignTask(formDataFor({ assignee_id: "", task_title: "Do it" }))).rejects.toThrow("Choose who this task is for");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects an empty title", async () => {
    await expect(assignTask(formDataFor({ assignee_id: "staff-2", task_title: "  " }))).rejects.toThrow("title is required");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid priority", async () => {
    await expect(
      assignTask(formDataFor({ assignee_id: "staff-2", task_title: "Do it", task_priority: "urgent" })),
    ).rejects.toThrow("Invalid priority");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects an assignee outside the tenant or not manager/staff", async () => {
    assigneeMock.mockResolvedValue({ data: null });
    await expect(assignTask(formDataFor({ assignee_id: "staff-2", task_title: "Do it" }))).rejects.toThrow(
      "isn't a manager or staff member",
    );
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("inserts the task, audit-logs it, and notifies the assignee", async () => {
    await assignTask(formDataFor({ assignee_id: "staff-2", task_title: "Do it", task_priority: "high", task_date: "2026-09-01" }));

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "tenant-1",
        user_id: "staff-2",
        task_title: "Do it",
        task_priority: "high",
        task_date: "2026-09-01",
        original_date: "2026-09-01",
        assigned_by: "admin-1",
      }),
    );
    expect(writeAuditLogMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "assign_task" }));
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "task_assigned", userId: "staff-2", tenantId: "tenant-1" }),
    );
  });

  it("defaults the due date to today when none is given", async () => {
    const today = new Date().toISOString().split("T")[0];
    await assignTask(formDataFor({ assignee_id: "staff-2", task_title: "Do it" }));
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ task_date: today }));
  });
});
