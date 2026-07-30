import { describe, expect, it } from "vitest";
import {
  getCustomerHistoryExemptionMonths,
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

describe("customer history exemption threshold", () => {
  it("defaults to 12 months when the setting is absent or invalid", () => {
    expect(getCustomerHistoryExemptionMonths({} as Env)).toBe(12);
    expect(getCustomerHistoryExemptionMonths({ CUSTOMER_HISTORY_EXEMPTION_MONTHS: "0" } as Env)).toBe(12);
    expect(getCustomerHistoryExemptionMonths({ CUSTOMER_HISTORY_EXEMPTION_MONTHS: "6.5" } as Env)).toBe(12);
    expect(getCustomerHistoryExemptionMonths({ CUSTOMER_HISTORY_EXEMPTION_MONTHS: "invalid" } as Env)).toBe(12);
  });

  it("accepts a positive whole number of months", () => {
    expect(getCustomerHistoryExemptionMonths({ CUSTOMER_HISTORY_EXEMPTION_MONTHS: "6" } as Env)).toBe(6);
  });
});
