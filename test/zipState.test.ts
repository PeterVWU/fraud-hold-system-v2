import { describe, expect, it } from "vitest";
import { stateForUsZip } from "../src/zipState";

describe("ZIP-to-state resolver", () => {
  it.each([
    ["96816", "HI"],
    ["96701", "HI"],
    ["96201", "AP"],
    ["96601", "AP"],
    ["90001", "CA"],
    ["10001", "NY"],
    ["00601", "PR"],
    ["00802", "VI"],
    ["96799", "AS"],
    ["06390", "NY"],
    ["42223", "TN"],
    ["96816-1234", "HI"]
  ])("maps %s to %s", (zip, state) => {
    expect(stateForUsZip(zip)).toBe(state);
  });

  it("returns unknown for the multi-territory 969 prefix", () => {
    expect(stateForUsZip("96910")).toBeNull();
  });

  it("returns unknown for malformed ZIP values", () => {
    expect(stateForUsZip("968")).toBeNull();
    expect(stateForUsZip("abcde")).toBeNull();
  });
});
