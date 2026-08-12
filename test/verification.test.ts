import { describe, expect, it, vi } from "vitest";
import { completeInformationRequest, getVerificationCaseByToken, listStaffCases, recordDocumentUploads } from "../src/verification";

describe("verification persistence", () => {
  it("excludes completed cases from the default staff queue", async () => {
    const all = vi.fn().mockResolvedValue({ results: [] });
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    await listStaffCases(db);

    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("status NOT IN ('approved', 'declined')"));
    expect(bind).toHaveBeenCalledWith();
  });

  it("binds an explicit staff queue status filter", async () => {
    const all = vi.fn().mockResolvedValue({ results: [] });
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    await listStaffCases(db, "approved");

    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("AND status = ?"));
    expect(bind).toHaveBeenCalledWith("approved");
  });

  it("supports pending-review staff filtering", async () => {
    const all = vi.fn().mockResolvedValue({ results: [] });
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn(() => ({ bind }));
    await listStaffCases({ prepare } as unknown as D1Database, "pending_review");
    expect(bind).toHaveBeenCalledWith("pending_review");
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
