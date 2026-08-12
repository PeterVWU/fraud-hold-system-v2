# Fraud Hold System v2

Cloudflare Workers implementation for polling Magento orders every 5 minutes, evaluating configurable fraud rules, placing matching orders on hold, recording rule evidence in D1, and sending Slack alerts.

## Architecture

- Cloudflare Workflows runs the scheduled scan with `*/5 * * * *`.
- D1 stores site cursors, order reviews, rule evidence, reusable recent-order signals, and run logs.
- Magento REST is used for order search, order detail, hold, status, and internal comments.
- Rules live in `src/rules.ts`; each rule has an `id`, `name`, `enabled`, `required`, and `evaluate` function.
- The hold threshold is 2 matched non-required rules. The overseas military shipping-address rule is required and holds by itself.
- Registered customers with sufficiently old completed-order history bypass remaining non-required fraud rules; `CUSTOMER_HISTORY_EXEMPTION_MONTHS` controls the calendar-month threshold and defaults to 12. A military-address match overrides this exemption.
- Magento writes require both `MAGENTO_ORDER_UPDATES_ENABLED=true` and `HOLD_ACTION_MODE=live`.
- Customer verification email requires `CUSTOMER_EMAIL_ENABLED=true`.
- Scheduled, manual, and latest-order scans require `FRAUD_SCAN_ENABLED=true`.
- Slack alerts are sent after a successful Magento hold through `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID`.
- Slack hold messages keep the order details and add a final Magento admin link when `adminBaseUrl` is configured.
- Site scans are isolated: a failure on one Magento site is logged but does not stop other enabled sites.
- Non-holdable statuses, such as `complete`, are recorded but are not sent to the Magento hold API.

## Current Deployment

- Worker URL: `https://fraud-hold-system-v2.info-ba2.workers.dev`
- Worker name: `fraud-hold-system-v2`
- Workflow: `fraud-scan-workflow`
- D1 database: `fraud_hold_system`
- Schedule: every 5 minutes
- Last documented deployed version: `65929e82-5c8c-4844-b7f4-51462f15442d` (source commit `47ca265`)
- Current production configuration: fraud scanning, Magento updates, and customer email are enabled; `HOLD_ACTION_MODE=live` and `CUSTOMER_HISTORY_EXEMPTION_MONTHS=12`.
- VWU, Misthub, and Staging VWU are enabled. Staging deployed scans still fail at origin nginx Basic Auth; this failure is isolated from the other sites.

## Configure

1. Create a D1 database and set its `database_id` in `wrangler.jsonc`.
2. Copy `.dev.vars.example` to `.dev.vars` for local development.
3. Set Magento and Slack secrets in Cloudflare:

```bash
npx wrangler secret put MAGENTO_MAIN_ACCESS_TOKEN
npx wrangler secret put MAGENTO_MISTHUB_ACCESS_TOKEN
npx wrangler secret put MAGENTO_STAGING_ACCESS_TOKEN
npx wrangler secret put MAGENTO_VWU_AGENT_AUTH
npx wrangler secret put SLACK_BOT_TOKEN
npx wrangler secret put MANUAL_RUN_TOKEN
npx wrangler secret put STAFF_REVIEW_PASSWORD
npx wrangler secret put STAFF_SESSION_SECRET
```

4. Update `MAGENTO_SITES_JSON` in `wrangler.jsonc` for each Magento site. Add one object per site with a unique `id`, `baseUrl`, `storeCode`, `accessTokenEnv`, IANA `timeZone`, optional `adminBaseUrl`, optional `paymentFingerprintPaths`, and optional `scanIntervalMinutes`. Staff timestamps use the site timezone and retain UTC in the HTML tooltip. Scheduled scans default to the last 5-minute interval when no cursor exists.
5. Set `SLACK_CHANNEL_ID=C0BBH9RE3GV` for the `fraud-hold-system` Slack channel. `SLACK_BOT_TOKEN` is preferred for channel posting; `SLACK_WEBHOOK_URL` remains supported as a fallback.
6. Set `CUSTOMER_HISTORY_EXEMPTION_MONTHS` to a positive whole number of calendar months. Missing, zero, fractional, and invalid values safely fall back to 12.

## Verification Portal

When an order reaches the fraud threshold, live mode first places an eligible order on Magento hold and creates the verification case only after that hold succeeds. In test mode it creates the case without changing Magento.

- Customer links use random tokens stored only as hashes and expire after seven days.
- Military-address cases start as `pending_review`; their initial customer email is recorded as skipped by policy. Staff can manually request information, transitioning the case to `awaiting_customer` only after successful delivery.
- Documents are validated for type and size, then stored privately in the `VERIFY_DOCS_BUCKET` R2 binding.
- Staff sign in at `/staff/login` and review cases at `/staff`.
- Approve releases a Magento hold and expects Magento status `processing`.
- Decline shows a confirmation popup reminding staff that the Authorize.net refund remains manual, releases the Magento hold, creates a full offline invoice credit memo, and accepts Magento `closed` or `canceled`. It calls cancel only when the credit memo did not already close the order.
- Amasty Store Credit requires `arguments.extension_attributes.amstorecredit_base_amount: 0` in refund API requests even when no store credit is used. Staging order `000000235` verified this payload by creating credit memo `22`, refunding `$37.49` in Magento, and transitioning to `closed` without contacting Authorize.net.
- Failed credit-memo attempts try to restore the Magento hold.
- Both Magento actions are blocked unless Magento updates are enabled. Completed cases hide the action buttons and display a result message.
- Queue rows and case pages include links to open the exact order in Magento in a new tab.
- When email is disabled, staff can use **Open customer upload page** to test the customer flow without contacting anyone.
- `/health` reports the effective `magentoUpdatesEnabled`, `customerEmailEnabled`, and `customerHistoryExemptionMonths` values.

Required staff credentials are secrets and must not be committed:

```bash
npx wrangler secret put STAFF_REVIEW_PASSWORD
npx wrangler secret put STAFF_SESSION_SECRET
```

Apply D1 migrations before deploying the verification routes:

```bash
npm run db:migrate:remote
```

Safety switch matrix:

| Setting | Test value | Live value |
|---|---:|---:|
| `FRAUD_SCAN_ENABLED` | `false` | `true` |
| `MAGENTO_ORDER_UPDATES_ENABLED` | `false` | `true` |
| `CUSTOMER_EMAIL_ENABLED` | `false` | `true` |
| `HOLD_ACTION_MODE` | `dry_run` or `live` | `live` |

Changing any safety switch is an explicit production action. Setting all three switches to `false` installs the application without scanning orders, changing Magento, or emailing customers. The checked-in production configuration currently sets all three to `true`.

The secret name must be `SLACK_BOT_TOKEN`; paste the `xoxb-...` token only when Wrangler prompts for the secret value.

## Sites

### VWU Production

- Site ID: `vwu`
- Enabled in config: yes
- Magento base URL: `https://vapewholesaleusa.com`
- REST base path: `/rest/V1`
- Secret name: `MAGENTO_MAIN_ACCESS_TOKEN`
- Additional perimeter header: `x-vwu-agent-auth`, sourced from `MAGENTO_VWU_AGENT_AUTH`
- Status: scanning, Magento holds, Slack alerts, queue creation, and customer email verified working in production

The Cloudflare security skip rule must allow `/rest/V1/` requests carrying the correct secret header for both GET and POST. Restricting it to GET allows order scans but blocks hold, unhold, comments, approve, and decline.

### Staging

- Site ID: `staging-vwu`
- Enabled in config: yes
- Magento base URL: `https://staging.vapewholesaleusa.com`
- REST base path: `/rest/default/V1`
- Secret name: `MAGENTO_STAGING_ACCESS_TOKEN`
- Current blocker: the token works locally, but deployed Worker requests receive an nginx HTML 401 before reaching Magento. Exempt `/rest/` from nginx Basic Auth or protect it with a separate custom header.

Admin base URL:

```text
https://as.vapewholesaleusa.com/admin_N7zuJfehzDnf
```

### Misthub

- Enabled in config: yes
- Magento base URL: `https://misthub.com`
- Secret name: `MAGENTO_MISTHUB_ACCESS_TOKEN`
- REST base path: `/rest/V1` (`storeCode` is an empty string in config)
- Status: enabled; site-level failures remain isolated from VWU and Staging VWU.

Admin base URL:

```text
https://sdhds5.misthub.com/Gi3ygQ6cafEK7hZf6uzf
```

Slack hold alert format:

```text
Fraud hold placed for <site name>
Order: <increment id>
Total matched rules: <matched>/<threshold>
Rules: <matched rule names>
Magento admin: Open order
```

## Fraud Rules

The active rules are:

- Required overseas military shipping address. Matches normalized shipping pairs `AA`/`34000`–`34099`, `AE`/`09000`–`09899`, and `AP`/`96200`–`96699`, including ZIP+4. It holds by itself, overrides the history exemption, creates a `pending_review` case, and suppresses the initial customer email.
- Registered customers with a completed order at least `CUSTOMER_HISTORY_EXEMPTION_MONTHS` calendar months older than the current order are exempted from remaining non-required fraud rules unless the military rule matched. The setting defaults to 12 when omitted or invalid. The exemption uses Magento customer ID only; guest-email history does not qualify.
- Billing/shipping address mismatch. This signal is suppressed for established customers with at least 10 completed Magento orders before the current order.
- Account age under 24 hours.
- Two or more orders from the same customer or IP within one hour. Signal timestamps are normalized with SQLite `datetime()` so Magento and ISO formats compare correctly.
- Order total at least $150.
- ZIP does not match state.
- Multiple cards or billing names used by the same customer in one day. Signal timestamps are normalized with SQLite `datetime()` so same-day records are included.

The military-address feature and behavioral-rule timestamp fix are deployed in production as Worker version `65929e82-5c8c-4844-b7f4-51462f15442d` from source commit `47ca265`.

The quantity-at-least-10, billing/shipping phone mismatch, and billing/shipping name mismatch rules were removed.

Known ZIP limitation: Magento can return a full state name such as `NEBRASKA`, while the ZIP resolver returns `NE`. Full-name normalization is not implemented yet and can create a false positive. Order `000574302` was released after this exact issue was confirmed.

## Commands

```bash
npm install
npm run verify
npm run test
npm run typecheck
npm run db:migrate:local
npm run db:migrate:remote
npm run dev
npm run deploy
```

## Manual Run

After deploy, trigger a scan manually:

```bash
curl -X POST https://<worker-url>/run -H "Authorization: Bearer <MANUAL_RUN_TOKEN>"
```

For local direct execution without queueing a Workflow, set `LOCAL_RUN_DIRECT=true` and call the same endpoint.

To scan a bounded latest-order page, use `/run-latest?limit=50&page=1&site=<site-id>`. When Magento updates are enabled, one explicit site is required. Customer email must be disabled for this endpoint.

Health check:

```bash
curl https://<worker-url>/health
```

Inspect recent remote run logs:

```bash
npx wrangler d1 execute fraud_hold_system --remote --command "SELECT site_id, started_at, finished_at, status, pages_fetched, orders_evaluated, holds_attempted, holds_succeeded, substr(error, 1, 180) AS error_summary FROM run_logs ORDER BY started_at DESC LIMIT 10"
```

## Regression Testing

Use the project-local `$validate-fraud-hold-staging` skill in `.agents/skills/validate-fraud-hold-staging` after completing an implementation. It runs the automated baseline, starts a staging-isolated local Worker, creates purpose-built Staging VWU data, and audits every existing and newly documented feature. Its launcher defaults to no Magento writes or customer email and requires explicit gates for approved live phases.

See `TESTING.md` for the required automated checks and staging Magento regression tests, including the positive hold case and the negative no-status-change case.

See `AGENTS.md` for agent handoff notes and operational context.
