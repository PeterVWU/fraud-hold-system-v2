#!/usr/bin/env bash
set -euo pipefail

mode="safe"
port="8787"
slack_live="false"

usage() {
  printf '%s\n' \
    'Usage: start-local-worker.sh [--live] [--email-live] [--slack-live] [--port PORT]' \
    '' \
    'Default: dry-run Magento updates, customer email disabled, staging-only scans.' \
    '--live requires ALLOW_STAGING_MUTATIONS=1 and enables live staging Magento updates.' \
    '--email-live additionally requires ALLOW_CUSTOMER_EMAIL=1 and enables customer email.' \
    '--slack-live requires ALLOW_SLACK_ALERTS=1 and preserves the configured Slack channel.'
}

while (($#)); do
  case "$1" in
    --live) mode="live"; shift ;;
    --email-live) mode="email-live"; shift ;;
    --slack-live) slack_live="true"; shift ;;
    --port) port="${2:?missing port}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$mode" in
  safe)
    magento_updates="false"
    customer_email="false"
    hold_mode="dry_run"
    ;;
  live)
    [[ "${ALLOW_STAGING_MUTATIONS:-}" == "1" ]] || { printf 'Set ALLOW_STAGING_MUTATIONS=1 after explicit approval.\n' >&2; exit 2; }
    magento_updates="true"
    customer_email="false"
    hold_mode="live"
    ;;
  email-live)
    [[ "${ALLOW_STAGING_MUTATIONS:-}" == "1" ]] || { printf 'Set ALLOW_STAGING_MUTATIONS=1 after explicit approval.\n' >&2; exit 2; }
    [[ "${ALLOW_CUSTOMER_EMAIL:-}" == "1" ]] || { printf 'Set ALLOW_CUSTOMER_EMAIL=1 after explicit recipient approval.\n' >&2; exit 2; }
    magento_updates="true"
    customer_email="true"
    hold_mode="live"
    ;;
esac

if [[ "$slack_live" == "true" ]]; then
  [[ "${ALLOW_SLACK_ALERTS:-}" == "1" ]] || { printf 'Set ALLOW_SLACK_ALERTS=1 after explicit channel approval.\n' >&2; exit 2; }
  slack_channel=$(node -e 'const fs=require("fs");const c=JSON.parse(fs.readFileSync("wrangler.jsonc","utf8"));process.stdout.write(c.vars.SLACK_CHANNEL_ID || "")')
else
  slack_channel=""
fi

site_json=$(node -e '
const fs = require("fs");
const config = JSON.parse(fs.readFileSync("wrangler.jsonc", "utf8"));
const sites = JSON.parse(config.vars.MAGENTO_SITES_JSON).map((site) => ({
  ...site,
  enabled: site.id === "staging-vwu"
}));
const staging = sites.find((site) => site.id === "staging-vwu");
if (!staging) throw new Error("staging-vwu is missing from MAGENTO_SITES_JSON");
process.stderr.write(`Site isolation: ${sites.map((site) => `${site.id}=${site.enabled}`).join(", ")}\n`);
process.stdout.write(JSON.stringify(sites));
')

exec env XDG_CONFIG_HOME=/tmp/fraud-hold-wrangler-config npx wrangler dev \
  --port "$port" \
  --var LOCAL_RUN_DIRECT:true \
  --var FRAUD_SCAN_ENABLED:true \
  --var "MAGENTO_ORDER_UPDATES_ENABLED:$magento_updates" \
  --var "CUSTOMER_EMAIL_ENABLED:$customer_email" \
  --var "HOLD_ACTION_MODE:$hold_mode" \
  --var "SLACK_CHANNEL_ID:$slack_channel" \
  --var 'SLACK_WEBHOOK_URL:' \
  --var 'SLACK_BOT_TOKEN:' \
  --var "MAGENTO_SITES_JSON:$site_json"
