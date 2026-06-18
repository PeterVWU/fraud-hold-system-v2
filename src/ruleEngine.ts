import { getHoldThreshold } from "./config";
import { INITIAL_RULES } from "./rules";
import type { Env, FraudDecision, MagentoOrder, RuleContext, RuleResult, SiteConfig } from "./types";

export async function evaluateFraudRules(
  env: Env,
  site: SiteConfig,
  order: MagentoOrder,
  context: Omit<RuleContext, "site">
): Promise<FraudDecision> {
  const holdThreshold = getHoldThreshold(env, site);
  const ruleContext: RuleContext = { ...context, site };
  const ruleResults: RuleResult[] = [];

  for (const rule of INITIAL_RULES) {
    if (!rule.enabled) {
      continue;
    }

    const result = await rule.evaluate(order, ruleContext);
    ruleResults.push({
      ruleId: rule.id,
      ruleName: rule.name,
      required: rule.required,
      matched: result.matched,
      evidence: result.evidence
    });
  }

  const matchedCount = ruleResults.filter((result) => result.matched && !result.required).length;
  const requiredMatchedCount = ruleResults.filter((result) => result.matched && result.required).length;

  return {
    decision: requiredMatchedCount > 0 || matchedCount >= holdThreshold ? "hold" : "allow",
    holdThreshold,
    matchedCount,
    requiredMatchedCount,
    ruleResults
  };
}

export function formatFraudComment(decision: FraudDecision): string {
  const matchedRules = decision.ruleResults
    .filter((result) => result.matched)
    .map((result) => `- ${result.ruleName} (${result.ruleId})`);

  return [
    "Fraud automation review placed this order on hold.",
    `Matched rules: ${decision.matchedCount}; required matches: ${decision.requiredMatchedCount}; threshold: ${decision.holdThreshold}.`,
    ...matchedRules
  ].join("\n");
}
