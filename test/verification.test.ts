import { describe, expect, it, vi } from "vitest";
import { recordDocumentUploads } from "../src/verification";

describe("verification persistence", () => {
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
