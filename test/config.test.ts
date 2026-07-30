import { describe, expect, it } from "vitest";
import {
  getHoldActionMode,
  isCustomerEmailEnabled,
  isFraudScanEnabled,
  isMagentoOrderUpdatesEnabled
} from "../src/config";
import type { Env } from "../src/types";

describe("production safety switches", () => {
  it("fails closed when switches are absent", () => {
    const env = {} as Env;

    expect(isFraudScanEnabled(env)).toBe(false);
    expect(isMagentoOrderUpdatesEnabled(env)).toBe(false);
    expect(isCustomerEmailEnabled(env)).toBe(false);
    expect(getHoldActionMode(env)).toBe("dry_run");
  });

  it("enables each capability only for the exact value true", () => {
    const env = {
      FRAUD_SCAN_ENABLED: "true",
      MAGENTO_ORDER_UPDATES_ENABLED: "true",
      CUSTOMER_EMAIL_ENABLED: "true",
      HOLD_ACTION_MODE: "live"
    } as Env;

    expect(isFraudScanEnabled(env)).toBe(true);
    expect(isMagentoOrderUpdatesEnabled(env)).toBe(true);
    expect(isCustomerEmailEnabled(env)).toBe(true);
    expect(getHoldActionMode(env)).toBe("live");
  });
});
