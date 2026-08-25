import { describe, expect, it, vi } from "vitest";
import { completeInformationRequest, getVerificationCaseByToken, listStaffCases, parseStaffOrderSearch, recordDocumentUploads } from "../src/verification";

describe("verification persistence", () => {
  function queueDb(total: number) {
    const countFirst = vi.fn().mockResolvedValue({ total });
    const pageAll = vi.fn().mockResolvedValue({ results: [] });
    const countBind = vi.fn(() => ({ first: countFirst }));
    const pageBind = vi.fn(() => ({ all: pageAll }));
    const prepare = vi.fn()
      .mockReturnValueOnce({ bind: countBind })
      .mockReturnValueOnce({ bind: pageBind });
    return { db: { prepare } as unknown as D1Database, prepare, countBind, pageBind };
  }

  it("uses the same open filter for count and page queries", async () => {
    const { db, prepare, countBind, pageBind } = queueDb(26);

    const result = await listStaffCases(db);

    const [countSql, pageSql] = prepare.mock.calls.map(([sql]) => String(sql));
    expect(countSql).toContain("status NOT IN ('approved', 'declined')");
    expect(pageSql).toContain("status NOT IN ('approved', 'declined')");
    expect(countBind).toHaveBeenCalledWith();
    expect(pageBind).toHaveBeenCalledWith(25, 0);
    expect(result).toMatchObject({ totalCount: 26, currentPage: 1, totalPages: 2 });
  });

  it("uses the same explicit status filter and calculated offset", async () => {
    const { db, prepare, countBind, pageBind } = queueDb(76);

    const result = await listStaffCases(db, "approved", 3);

    const [countSql, pageSql] = prepare.mock.calls.map(([sql]) => String(sql));
    expect(countSql).toContain("AND status = ?");
    expect(pageSql).toContain("AND status = ?");
    expect(pageSql).toContain("ORDER BY updated_at DESC, id DESC");
    expect(pageSql).toContain("LIMIT ? OFFSET ?");
    expect(countBind).toHaveBeenCalledWith("approved");
    expect(pageBind).toHaveBeenCalledWith("approved", 25, 50);
    expect(result).toMatchObject({ totalCount: 76, currentPage: 3, totalPages: 4 });
  });

  it.each([
    ["000574302", "%000574302%"],
    ["MH0055", "%MH0055%"],
    ["5816", "%5816%"],
    ["mh00555816", "%mh00555816%"],
    ["12345", "%12345%"],
    ["%", "%\\%%"],
    ["_", "%\\_%"],
    ["\\", "%\\\\%"]
  ])("uses a case-insensitive literal order search for %s", async (search, expectedBinding) => {
    const { db, prepare, countBind, pageBind } = queueDb(1);

    await listStaffCases(db, "approved", 1, search);

    const [countSql, pageSql] = prepare.mock.calls.map(([sql]) => String(sql));
    for (const sql of [countSql, pageSql]) {
      expect(sql).toContain("LOWER(COALESCE(increment_id, CAST(magento_order_id AS TEXT))) LIKE LOWER(?) ESCAPE '\\'");
      expect(sql).toContain("AND status = ?");
    }
    expect(countBind).toHaveBeenCalledWith("approved", expectedBinding);
    expect(pageBind).toHaveBeenCalledWith("approved", expectedBinding, 25, 0);
  });

  it.each(["", "   ", "\t\n"])("treats blank order search %j as no search", async (search) => {
    const { db, prepare, countBind, pageBind } = queueDb(0);
    await listStaffCases(db, "all", 1, search);
    const [countSql, pageSql] = prepare.mock.calls.map(([sql]) => String(sql));
    expect(countSql).not.toContain("LIKE LOWER");
    expect(pageSql).not.toContain("LIKE LOWER");
    expect(countBind).toHaveBeenCalledWith();
    expect(pageBind).toHaveBeenCalledWith(25, 0);
  });

  it("clamps against the searched result count", async () => {
    const { db, pageBind } = queueDb(27);
    const result = await listStaffCases(db, "open", 50, "  574  ");
    expect(result).toMatchObject({ totalCount: 27, currentPage: 2, totalPages: 2 });
    expect(pageBind).toHaveBeenCalledWith("%574%", 25, 25);
  });

  it("uses no status predicate for all cases", async () => {
    const { db, prepare, countBind, pageBind } = queueDb(25);

    await listStaffCases(db, "all");

    const [countSql, pageSql] = prepare.mock.calls.map(([sql]) => String(sql));
    expect(countSql).not.toContain("status NOT IN");
    expect(countSql).not.toContain("status = ?");
    expect(pageSql).not.toContain("status NOT IN");
    expect(pageSql).not.toContain("status = ?");
    expect(countBind).toHaveBeenCalledWith();
    expect(pageBind).toHaveBeenCalledWith(25, 0);
  });

  it.each([0, -2, 1.5, Number.NaN])("defaults invalid requested page %s to page one", async (page) => {
    const { db, pageBind } = queueDb(60);

    const result = await listStaffCases(db, "open", page);

    expect(result.currentPage).toBe(1);
    expect(pageBind).toHaveBeenCalledWith(25, 0);
  });

  it("clamps an excessive page to the last available page", async () => {
    const { db, pageBind } = queueDb(51);

    const result = await listStaffCases(db, "open", 999);

    expect(result).toMatchObject({ currentPage: 3, totalPages: 3 });
    expect(pageBind).toHaveBeenCalledWith(25, 50);
  });

  it("keeps an empty queue on page one", async () => {
    const { db, pageBind } = queueDb(0);

    const result = await listStaffCases(db, "open", 9);

    expect(result).toMatchObject({ totalCount: 0, currentPage: 1, totalPages: 1 });
    expect(pageBind).toHaveBeenCalledWith(25, 0);
  });

  it("supports pending-review staff filtering", async () => {
    const { db, countBind, pageBind } = queueDb(1);
    await listStaffCases(db, "pending_review");
    expect(countBind).toHaveBeenCalledWith("pending_review");
    expect(pageBind).toHaveBeenCalledWith("pending_review", 25, 0);
  });

  it("allows unexpired pending-review tokens", async () => {
    const first = vi.fn().mockResolvedValue(null);
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));
    await getVerificationCaseByToken({ prepare } as unknown as D1Database, "token");
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("'pending_review', 'awaiting_customer', 'submitted'"));
  });

  it.each([
    [null, "awaiting_customer"],
    ["provider unavailable", "pending_review"]
  ])("transitions pending review only after a successful request (%s)", async (error, expectedStatus) => {
    const bindings: unknown[][] = [];
    const statement = { bind: (...values: unknown[]) => { bindings.push(values); return statement; } };
    const db = { prepare: vi.fn(() => statement), batch: vi.fn().mockResolvedValue([]) } as unknown as D1Database;
    await completeInformationRequest(db, {
      id: "request-1", caseId: "case-1", recipient: "buyer@example.com", sender: "no-reply@example.com",
      requestedDocumentTypes: ["cardholder_id"], customMessage: null, status: "pending", messageId: null,
      error: null, createdAt: "2026-08-12T00:00:00Z", sentAt: null, updatedAt: "2026-08-12T00:00:00Z"
    }, { messageId: error ? null : "message-1", error, at: "2026-08-12T00:01:00Z" });
    const caseUpdateSql = vi.mocked(db.prepare).mock.calls.map(([sql]) => String(sql)).find((sql) => sql.includes("status = CASE"));
    expect(caseUpdateSql).toContain("status = 'pending_review' THEN 'awaiting_customer'");
    const caseBindings = bindings.find((values) => values.at(-1) === "case-1" && values.length === 7);
    expect(caseBindings?.[4]).toBe(error);
    expect(error ? "pending_review" : "awaiting_customer").toBe(expectedStatus);
  });

  it("records every uploaded document with its request label in one batch", async () => {
    const bindings: unknown[][] = [];
    const statement = {
      bind: (...values: unknown[]) => {
        bindings.push(values);
        return statement;
      }
    };
    const prepare = vi.fn(() => statement);
    const db = {
      prepare,
      batch: vi.fn().mockResolvedValue([])
    } as unknown as D1Database;

    await recordDocumentUploads(db, [
      {
        caseId: "case-1",
        r2Key: "case/id.jpg",
        filename: "id.jpg",
        contentType: "image/jpeg",
        size: 100,
        uploadedAt: "2026-08-03T12:00:00.000Z",
        requestId: "request-1",
        documentType: "cardholder_id"
      },
      {
        caseId: "case-1",
        r2Key: "case/license.pdf",
        filename: "license.pdf",
        contentType: "application/pdf",
        size: 200,
        uploadedAt: "2026-08-03T12:00:00.000Z",
        requestId: "request-1",
        documentType: "tobacco_license"
      }
    ]);

    expect(db.batch).toHaveBeenCalledOnce();
    expect(bindings.flat()).toContain("cardholder_id");
    expect(bindings.flat()).toContain("tobacco_license");
    expect(bindings.flat()).toContain("request-1");
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("status = 'submitted'"));
  });
});

describe("staff order search parsing", () => {
  it.each([[null, ""], ["", ""], ["   ", ""], ["  MH00555816  ", "MH00555816"]])(
    "normalizes %j to %j",
    (value, expected) => expect(parseStaffOrderSearch(value)).toBe(expected)
  );
});
