import { describe, it, expect } from "vitest";
import { resolveApprovalChainFromPositions, listPendingApprovalsForUser, type OrgPositionLite } from "./approval-hierarchy";

// A realistic tree: board -> executive (COO) -> non_executive (Sales dept)
// -> section_supervisor (Section) -> individual_staff (owner).
const board: OrgPositionLite = { id: "board", user_id: "board-user", reports_to_id: null, position_type: "board" };
const coo: OrgPositionLite = { id: "coo", user_id: "coo-user", reports_to_id: "board", position_type: "executive" };
const salesDept: OrgPositionLite = {
  id: "sales-dept",
  user_id: "dept-head-user",
  reports_to_id: "coo",
  position_type: "non_executive",
};
const section: OrgPositionLite = {
  id: "section",
  user_id: "supervisor-user",
  reports_to_id: "sales-dept",
  position_type: "section_supervisor",
};
const staff: OrgPositionLite = {
  id: "staff-pos",
  user_id: "staff-user",
  reports_to_id: "section",
  position_type: "individual_staff",
};

const fullTree = [board, coo, salesDept, section, staff];

describe("resolveApprovalChainFromPositions", () => {
  it("resolves the immediate section supervisor as first approver and the nearest executive as final approver", () => {
    const chain = resolveApprovalChainFromPositions(fullTree, "staff-user");
    expect(chain.blockedReason).toBeNull();
    expect(chain.firstApproverId).toBe("supervisor-user");
    expect(chain.finalApproverId).toBe("coo-user");
    expect(chain.sameApprover).toBe(false);
  });

  it("skips a department head with no section layer in between and still finds the executive", () => {
    const staffUnderDept: OrgPositionLite = { id: "staff-2", user_id: "staff-user-2", reports_to_id: "sales-dept", position_type: "individual_staff" };
    const chain = resolveApprovalChainFromPositions([...fullTree, staffUnderDept], "staff-user-2");
    expect(chain.firstApproverId).toBe("dept-head-user");
    expect(chain.finalApproverId).toBe("coo-user");
  });

  it("is blocked when the owner has no org position at all", () => {
    const chain = resolveApprovalChainFromPositions(fullTree, "nobody");
    expect(chain.blockedReason).toBeTruthy();
  });

  it("is blocked when the owner's position has no reports_to_id", () => {
    const rootOwner: OrgPositionLite = { id: "root", user_id: "root-user", reports_to_id: null, position_type: "individual_staff" };
    const chain = resolveApprovalChainFromPositions([rootOwner], "root-user");
    expect(chain.blockedReason).toBeTruthy();
  });

  it("is blocked when the immediate manager position is vacant", () => {
    const vacantSection: OrgPositionLite = { ...section, user_id: null };
    const chain = resolveApprovalChainFromPositions([board, coo, salesDept, vacantSection, staff], "staff-user");
    expect(chain.blockedReason).toBeTruthy();
  });

  it("is blocked when no executive-level ancestor exists above the immediate manager", () => {
    const headlessDept: OrgPositionLite = { ...salesDept, reports_to_id: null };
    const chain = resolveApprovalChainFromPositions([headlessDept, section, staff], "staff-user");
    expect(chain.blockedReason).toBeTruthy();
  });

  it("is blocked when the resolved executive position is vacant", () => {
    const vacantCoo: OrgPositionLite = { ...coo, user_id: null };
    const chain = resolveApprovalChainFromPositions([board, vacantCoo, salesDept, section, staff], "staff-user");
    expect(chain.blockedReason).toBeTruthy();
  });

  it("collapses first and final approver to the same person when the owner reports directly to an executive, and flags it", () => {
    const directReport: OrgPositionLite = { id: "direct", user_id: "direct-user", reports_to_id: "coo", position_type: "individual_staff" };
    const chain = resolveApprovalChainFromPositions([board, coo, directReport], "direct-user");
    expect(chain.blockedReason).toBeNull();
    expect(chain.firstApproverId).toBe("coo-user");
    expect(chain.finalApproverId).toBe("coo-user");
    expect(chain.sameApprover).toBe(true);
  });

  it("does not infinite-loop on a cyclic reports_to_id chain", () => {
    const a: OrgPositionLite = { id: "a", user_id: "a-user", reports_to_id: "b", position_type: "non_executive" };
    const b: OrgPositionLite = { id: "b", user_id: "b-user", reports_to_id: "a", position_type: "non_executive" };
    const owner: OrgPositionLite = { id: "owner", user_id: "owner-user", reports_to_id: "a", position_type: "individual_staff" };
    const chain = resolveApprovalChainFromPositions([a, b, owner], "owner-user");
    expect(chain.blockedReason).toBeTruthy();
  });
});

describe("listPendingApprovalsForUser", () => {
  const items = [
    { id: "sc-1", ownerId: "staff-user", workflowStatus: "pending_manager_review" },
    { id: "sc-2", ownerId: "staff-user", workflowStatus: "pending_final_review" },
    { id: "sc-3", ownerId: null, workflowStatus: "pending_manager_review" },
    { id: "sc-4", ownerId: "staff-user", workflowStatus: "owner_editing" },
  ];

  it("gives the first approver only the scorecards currently pending manager review", () => {
    const entries = listPendingApprovalsForUser(fullTree, items, "supervisor-user");
    expect(entries).toEqual([{ itemId: "sc-1", level: "first" }]);
  });

  it("gives the final approver only the scorecards currently pending final review", () => {
    const entries = listPendingApprovalsForUser(fullTree, items, "coo-user");
    expect(entries).toEqual([{ itemId: "sc-2", level: "final" }]);
  });

  it("gives an unrelated user nothing", () => {
    const entries = listPendingApprovalsForUser(fullTree, items, "someone-else");
    expect(entries).toEqual([]);
  });

  it("skips items with no owner and items whose chain can't be resolved", () => {
    const orphan = { id: "sc-5", ownerId: "nobody", workflowStatus: "pending_manager_review" };
    const entries = listPendingApprovalsForUser(fullTree, [...items, orphan], "supervisor-user");
    expect(entries.find((e) => e.itemId === "sc-5")).toBeUndefined();
    expect(entries.find((e) => e.itemId === "sc-3")).toBeUndefined();
  });
});
