# Agent Handoff

## Current State

- Project: Cloudflare Worker + Workflow for Magento fraud-hold and customer-verification automation.
- Worker: `fraud-hold-system-v2`.
- Live URL: `https://fraud-hold-system-v2.info-ba2.workers.dev`.
- D1: `fraud_hold_system`.
- R2: `fraud-hold-verification-docs`.
- Workflow: `fraud-scan-workflow`.
- Cron: `*/5 * * * *`.
- Last known deployed version: `5a9a234b-d92a-46f0-9ad9-2e9ff21d0d7b` (source commit `54bc2ef`).
- Expected test count: 48.
- Preserve unrelated changes and `.dev.vars.swp`; do not assume the working tree is clean.

## Production State

- `FRAUD_SCAN_ENABLED=true`.
- `MAGENTO_ORDER_UPDATES_ENABLED=true`.
- `CUSTOMER_EMAIL_ENABLED=true`.
- `HOLD_ACTION_MODE=live`.
- `CUSTOMER_HISTORY_EXEMPTION_MONTHS=12` (positive whole calendar months; missing or invalid values default to 12).
- `LOCAL_RUN_DIRECT=false`; `/run` queues a Workflow.
- VWU production scanning, Magento holds, verification-case creation, Slack alerts, and customer emails were verified working after the Cloudflare skip rule was expanded to allow authenticated POST requests.
- Four verified production orders (`000574263`, `000574269`, `000574275`, and `000574302`) completed the hold/Slack/email/queue flow. `000574302` was later released and its case marked approved because of a false-positive ZIP/state comparison.

## Sites

### `vwu`

- Name: `vapewholesaleusa.com`.
- Enabled: true.
- Base URL: `https://vapewholesaleusa.com`.
- REST base: `/rest/V1` (`storeCode: ""`).
- Timezone: `America/Los_Angeles`.
- Access-token secret: `MAGENTO_MAIN_ACCESS_TOKEN`.
- Extra perimeter header:
  - name: `x-vwu-agent-auth`
  - value secret: `MAGENTO_VWU_AGENT_AUTH`
- Cloudflare must skip relevant security checks for `/rest/V1/` requests carrying the correct secret header. Do not restrict the rule to GET: hold, unhold, comments, approve, and decline use POST.

### `staging-vwu`

- Name: `Staging VWU`.
- Enabled: true.
- Base URL: `https://staging.vapewholesaleusa.com`.
- REST base: `/rest/default/V1`.
- Timezone: `America/Los_Angeles`.
- Access-token secret: `MAGENTO_STAGING_ACCESS_TOKEN`.
- Known production blocker: requests from the deployed Worker receive an nginx HTML `401 Authorization Required` before reaching Magento. The same token works locally. Staging `/rest/` must be exempted from nginx Basic Auth or protected with a separate custom header.
- Site failures are isolated, so this recurring staging failure does not stop VWU.

### `misthub`

- Name: `misthub.com`.
- Enabled: false.
- Base URL: `https://misthub.com`.
- REST base: `/rest/V1` (`storeCode: ""`).
- Timezone: `America/Los_Angeles`.
- Access-token secret: `MAGENTO_MISTHUB_ACCESS_TOKEN`.
- Do not re-enable without explicit user approval.

## Fraud Rules

- Rules are hard-coded in `src/rules.ts`.
- Hold threshold: 2 matched non-required rules unless overridden per site.
- No current rule is required.
- Active rules:
  - Registered-customer completed-order-history exemption.
    - Skips all remaining fraud rules when the customer has a completed order at least `CUSTOMER_HISTORY_EXEMPTION_MONTHS` calendar months older than the current order.
    - Uses Magento `customer_id` only; guest-email history does not qualify.
    - The Magento history query returns both the oldest completed order and the total completed-order count.
    - Lookup failures are logged and normal fraud evaluation continues.
  - Billing/shipping address mismatch.
    - Reuses the completed-order-history result.
    - Suppressed when the registered customer has at least 10 completed orders before the current order.
  - Account age under 24 hours.
  - Two or more orders from the same customer or IP within one hour.
  - Order total at least $150.
  - ZIP does not match state.
  - Multiple cards or billing names used by the same customer in one day.
- Removed rules:
  - Total quantity at least 10.
  - Billing/shipping phone mismatch.
  - Billing/shipping name mismatch.
- Known ZIP issue: Magento may provide a full state name such as `NEBRASKA`, while ZIP lookup returns `NE`. Full-name-to-abbreviation normalization has not yet been implemented. This caused the false hold for `000574302`.

## Hold and Verification Flow

- D1 stores run logs, cursors, reviews, rule evidence, reusable signals, verification cases, email attempts, documents, and staff actions.
- An eligible suspicious order is added to the staff queue only after Magento hold succeeds.
- After a successful hold:
  1. Create a verification case and expiring hashed customer token.
  2. Send the per-site verification email when enabled.
  3. Send Slack only after Magento hold succeeds.
- Staff queue: `/staff`; login: `/staff/login`.
- Queue and case pages include Magento admin links opening in a new tab.
- Staff queue timestamps are formatted in each site's configured `MAGENTO_SITES_JSON.timeZone`, with UTC retained in the HTML timestamp and tooltip.
- Approve releases the Magento hold and expects status `processing`; completed cases hide further action buttons and show a success message.
- Decline is not considered production-ready:
  - Intended flow: unhold, create an offline invoice credit memo, then accept Magento `closed` or `canceled`; staff refunds the payment manually in Authorize.net.
  - Staging Magento returns a generic 500 from `/V1/invoice/{invoiceId}/refund`, likely inside the Rootways Authorize CIM module or another observer.
  - Failed credit-memo attempts now try to restore the Magento hold.
  - The user explicitly chose to leave Decline unresolved for later.

## Safety and Manual Runs

- `/run` requires `MANUAL_RUN_TOKEN`; it queues the Workflow when `LOCAL_RUN_DIRECT=false`.
- `/run-latest` requires scanning enabled.
- With Magento updates enabled, `/run-latest` requires an explicit `site` query parameter.
- `/run-latest` always requires customer email to be disabled.
- Site scans are isolated; unexpected Magento failures are recorded and do not abort remaining orders/sites.
- Non-holdable statuses are recorded as suspicious but are not changed.
- Clearing verification cases does not clear reviews. A previously reviewed/held order will not automatically recreate a case unless its review is deliberately reset and the cursor/window includes it.

## Secrets

Never commit secret values. Expected production secret names:

- `MAGENTO_MAIN_ACCESS_TOKEN`
- `MAGENTO_MISTHUB_ACCESS_TOKEN`
- `MAGENTO_STAGING_ACCESS_TOKEN`
- `MAGENTO_VWU_AGENT_AUTH`
- `MANUAL_RUN_TOKEN`
- `SLACK_BOT_TOKEN`
- `STAFF_REVIEW_PASSWORD`
- `STAFF_SESSION_SECRET`

`SLACK_CHANNEL_ID` is `C0BBH9RE3GV`.

## Verification and Deployment

Run before deploy:

```bash
npm run verify
```

Expected: 48 tests, TypeScript success, and Wrangler dry-run success.

Deploy:

```bash
npx wrangler deploy --minify
```

Useful live checks:

```bash
curl -fsS "https://fraud-hold-system-v2.info-ba2.workers.dev/health?check=$(date +%s)"
npx wrangler secret list
npx wrangler d1 execute fraud_hold_system --remote --command "SELECT site_id, started_at, finished_at, status, pages_fetched, orders_evaluated, holds_attempted, holds_succeeded, substr(error, 1, 180) AS error_summary FROM run_logs ORDER BY started_at DESC LIMIT 10"
```

Use a unique health-check query value because stale edge responses were observed previously.
