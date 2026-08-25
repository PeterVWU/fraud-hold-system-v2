import { describe, expect, it } from "vitest";
import { parseStaffPage } from "../src/verification";

describe("staff page parsing", () => {
  it.each([null, "", "0", "-1", "1.5", "abc", "9007199254740992"])(
    "defaults invalid page %s to one",
    (value) => expect(parseStaffPage(value)).toBe(1)
  );

  it("accepts a positive safe integer", () => {
    expect(parseStaffPage("42")).toBe(42);
  });
});
