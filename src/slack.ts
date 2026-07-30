import type { FraudDecision, MagentoOrder, SiteConfig } from "./types";
import { buildMagentoAdminOrderUrl } from "./magentoAdmin";

export interface SlackAlertConfig {
  webhookUrl?: string;
  botToken?: string;
  channelId?: string;
}

export async function sendSlackHoldAlert(
  config: SlackAlertConfig,
  site: SiteConfig,
  order: MagentoOrder,
  decision: FraudDecision
): Promise<{ attempted: boolean; succeeded: boolean; error: string | null }> {
  if (config.botToken && config.channelId) {
    return sendSlackApiMessage(config, site, order, decision);
  }

  if (config.webhookUrl) {
    return sendSlackWebhookMessage(config.webhookUrl, site, order, decision);
  }

  return { attempted: false, succeeded: false, error: null };
}

async function sendSlackApiMessage(
  config: SlackAlertConfig,
  site: SiteConfig,
  order: MagentoOrder,
  decision: FraudDecision
): Promise<{ attempted: boolean; succeeded: boolean; error: string | null }> {
  if (!config.botToken || !config.channelId) {
    return { attempted: false, succeeded: false, error: null };
  }

  const text = buildHoldAlertText(site, order, decision);
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${config.botToken}`
    },
    body: JSON.stringify({
      channel: config.channelId,
      text,
      unfurl_links: false,
      unfurl_media: false
    })
  });

  const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!response.ok || !body?.ok) {
    return {
      attempted: true,
      succeeded: false,
      error: body?.error ? `Slack API error: ${body.error}` : `Slack API HTTP ${response.status}`
    };
  }

  return { attempted: true, succeeded: true, error: null };
}

async function sendSlackWebhookMessage(
  webhookUrl: string,
  site: SiteConfig,
  order: MagentoOrder,
  decision: FraudDecision
): Promise<{ attempted: boolean; succeeded: boolean; error: string | null }> {
  const text = buildHoldAlertText(site, order, decision);
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    return { attempted: true, succeeded: false, error: `${response.status} ${await response.text()}` };
  }

  return { attempted: true, succeeded: true, error: null };
}

function buildHoldAlertText(site: SiteConfig, order: MagentoOrder, decision: FraudDecision): string {
  const matched = decision.ruleResults.filter((result) => result.matched).map((result) => result.ruleName);
  const lines = [
    `Fraud hold placed for ${site.name}`,
    `Order: ${order.increment_id ?? order.entity_id}`,
    `Total matched rules: ${decision.matchedCount}/${decision.holdThreshold}`,
    `Rules: ${matched.join(", ")}`
  ];

  const adminUrl = buildMagentoAdminOrderUrl(site, order.entity_id);
  if (adminUrl) {
    lines.push(`Magento admin: <${adminUrl}|Open order>`);
  }

  return lines.join("\n");
}
