# Agent Handoff

## Current State

- Project: Cloudflare Worker + Workflow for Magento fraud hold automation.
- Worker name: `fraud-hold-system-v2`.
- Live URL: `https://fraud-hold-system-v2.info-ba2.workers.dev`.
- D1 database: `fraud_hold_system`.
- Workflow: `fraud-scan-workflow`.
- Cron: `*/5 * * * *`.
- Last known deployed version after interval-window change: `778185fc-959e-4202-87bc-cc7b974952de`.
- Current branch has the deployed source committed through `a92ce52 Limit scheduled scans to interval window`.

## Active Behavior

- Scheduled scans run every 5 minutes.
- Each enabled site scans only the last configured interval when no cursor exists.
- Existing cursors resume from `site_cursors.last_success_created_at`.
- Current config sets `scanIntervalMinutes: 5` and `cursorOverlapMinutes: 0`.
- Rules are hard-coded in `src/rules.ts`; each rule has `id`, `name`, `enabled`, `required`, and `evaluate`.
- Hold threshold is 2 matched non-required rules unless overridden per site.
- Required-rule support exists, but no current rule is required.
- D1 stores run logs, site cursors, order reviews, per-rule evidence, and order signals.
- Slack alerts are sent only after Magento hold succeeds.
- Slack messages include the original order details plus an admin order link when `adminBaseUrl` is set.

## Sites

- `staging`
  - Enabled: true.
  - Base URL: `https://staging.vapewholesaleusa.com`.
  - Admin base URL: `https://as.vapewholesaleusa.com/admin_N7zuJfehzDnf`.
  - Secret name: `MAGENTO_MAIN_ACCESS_TOKEN`.
  - Current issue: staging Magento REST is behind nginx basic auth. Cloudflare WAF 403 was bypassed, but origin still returns nginx 401 unless REST paths are exempted.

- `misthub`
  - Enabled: false.
  - Base URL: `https://misthub.com`.
  - Admin base URL: `https://sdhds5.misthub.com/Gi3ygQ6cafEK7hZf6uzf`.
  - Secret name: `MAGENTO_MISTHUB_ACCESS_TOKEN`.
  - Correct Magento REST base is `/rest/V1`, so config uses `storeCode: ""`.
  - Misthub was disabled after a live test run held multiple orders. Do not re-enable without explicit user approval.

## Operational Notes

- Do not commit secret values. Only secret names belong in config/docs.
- Worker secrets currently expected:
  - `MAGENTO_MAIN_ACCESS_TOKEN`
  - `MAGENTO_MISTHUB_ACCESS_TOKEN`
  - `MANUAL_RUN_TOKEN`
  - `SLACK_BOT_TOKEN`
- `SLACK_CHANNEL_ID` is configured as `C0BBH9RE3GV`.
- `HOLD_ACTION_MODE` is currently `live`.
- `LOCAL_RUN_DIRECT` is currently `false`, so `/run` queues a Workflow instance.
- One site failure should not stop other sites; `scanAllSites` catches per-site errors.
- Non-holdable statuses such as `complete` are recorded as suspicious but are not sent to Magento hold.
- Unexpected Magento hold failures are recorded and do not abort the remaining order scan.

## Verification

Run before deploy:

```bash
npm run verify
```

Expected current test count: 13 tests.

Useful live checks:

```bash
curl -fsS https://fraud-hold-system-v2.info-ba2.workers.dev/health
npx wrangler secret list
npx wrangler d1 execute fraud_hold_system --remote --command "SELECT site_id, started_at, finished_at, status, pages_fetched, orders_evaluated, holds_attempted, holds_succeeded, substr(error, 1, 180) AS error_summary FROM run_logs ORDER BY started_at DESC LIMIT 10"
```

## Last Known Live Test Results

- Staging live scan could not evaluate orders because origin nginx returned 401.
- Misthub was reachable and the corrected `/rest/V1` base worked.
- A Misthub live run evaluated 104 orders and held 14 orders before the user requested Misthub be stopped.
- Misthub is now disabled in `wrangler.jsonc` and deployed disabled.

## Deployment

Deploy with:

```bash
npx wrangler deploy --minify
```

If a site is being disabled urgently, it is acceptable to deploy the config-only stop before running the full verify suite, then verify afterward.
