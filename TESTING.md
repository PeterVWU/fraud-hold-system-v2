# Regression Testing

Run these checks before deploying or after changing fraud rules, Magento API code, D1 schema, scan/cursor behavior, or Slack alerts.

## Automated Checks

```bash
npm run verify
```

This runs:

- `npm run test`
- `npm run typecheck`
- `HOME=/tmp npx wrangler deploy --dry-run`

Expected result:

- Unit tests pass.
- TypeScript passes.
- Wrangler bundles successfully and shows the Workflow, D1, and env var bindings.
- Current expected unit test count is 13.

## Local D1 Setup

For local Worker runs, apply migrations first:

```bash
HOME=/tmp npx wrangler d1 migrations apply fraud_hold_system --local
```

If Wrangler cannot bind `127.0.0.1` in a sandboxed environment, rerun with the required local-network permission.

## Staging Magento Dry-Run Detection Test

Purpose: prove a suspicious staging order is detected and recorded without changing Magento.

Use `HOLD_ACTION_MODE=dry_run` and `LOCAL_RUN_DIRECT=true`.

Expected evidence from the verified staging run:

- Order: `000000265`
- Magento status before dry run: `pending`
- D1 decision: `hold`
- Matched rules: `3`
- Threshold: `2`
- Hold attempted: `0`
- Hold error/reason: `dry run: Magento hold skipped`
- Matched rule evidence:
  - `order_total_gte_150`
  - `total_quantity_gte_10`
  - `zip_state_mismatch`

## Staging Magento Live Hold Test

Purpose: prove a suspicious staging order can be updated to hold and sends a Slack alert.

Only run this on a staging order that is safe to modify.

Expected evidence from the verified staging run:

- Order: `000000265`
- Local Worker run mode: `live`
- Worker result: `holdsAttempted=1`, `holdsSucceeded=1`
- Magento status after run: `holded`
- D1 decision: `hold`
- D1 status after: `holded`
- D1 hold succeeded: `1`
- D1 Slack attempted: `1`
- D1 Slack succeeded: `1`
- Slack channel `fraud-hold-system` / `C0BBH9RE3GV` receives the hold alert message.
- Slack alert keeps the original order detail lines and adds a clickable Magento admin order link at the end when `adminBaseUrl` is configured.

If the order is already `holded`, the Worker should not call Magento hold again; D1 should record hold satisfied with `hold_succeeded=1` and `hold_attempted=0`.

## Staging Negative Status Test

Purpose: prove an order below threshold is not modified.

Expected evidence from the verified staging run:

- Order: `000000264`
- Magento status before run: `pending`
- Local Worker run mode: `live`
- Worker result: `holdsAttempted=0`, `holdsSucceeded=0`
- Magento status after run: `pending`
- D1 decision: `allow`
- D1 matched count: `1`
- D1 threshold: `2`
- D1 hold attempted: `0`
- Only matched rule: `zip_state_mismatch`

## Scheduled Interval Window Test

Purpose: prove scheduled scans do not backfill a large order window when no cursor exists.

Covered by automated tests in `test/scanner.test.ts`.

Expected behavior:

- If a site has no cursor, the scan starts at `scheduledAt - scanIntervalMinutes`.
- Current configured interval is 5 minutes.
- Current configured cursor overlap is 0 minutes.
- If a cursor exists, the scan starts from `site_cursors.last_success_created_at`.
- A site with `enabled:false` is ignored.

This prevents a newly enabled site from processing a full day of orders by default.

## Multi-Site Isolation Test

Purpose: prove one Magento site failure does not block other enabled sites.

Expected behavior:

- Each site gets its own `run_logs` row.
- A failed site records `status=failed` and the error.
- `scanAllSites` logs the site error and continues to the next site.
- Aggregate run stats include successful site work only.

Misthub live testing confirmed the scanner continued after staging failed with origin nginx 401.

## Non-Holdable Status Test

Purpose: prove suspicious orders in terminal statuses are recorded without calling Magento hold.

Covered by automated tests in `test/scanner.test.ts`.

Expected behavior:

- A suspicious order with `status=complete` gets `decision=hold`.
- The system records `hold_attempted=0`.
- The system records a `hold_error` such as `status complete is not holdable`.
- Slack is not sent because no Magento hold succeeded.

## Secrets Handling

Do not commit staging tokens. For local staging runs, put secrets in a temporary file under `/tmp`, pass it with `--env-file`, then delete it after the run.

Example:

```bash
printf '%s\n' \
  'MAGENTO_MAIN_ACCESS_TOKEN=<staging-token>' \
  'MANUAL_RUN_TOKEN=<local-token>' \
  'SLACK_WEBHOOK_URL=' \
  > /tmp/fraud-hold-staging.vars
```

Delete it after testing:

```bash
rm /tmp/fraud-hold-staging.vars
```

## Requirement Checklist

- Scheduled Cloudflare Workflow exists with `*/5 * * * *`.
- Multiple Magento sites are configurable through `MAGENTO_SITES_JSON`.
- Disabled sites are skipped through each site's `enabled` flag.
- New orders are fetched from Magento and paged through by `created_at`.
- No-cursor scheduled scans only check the configured interval, currently 5 minutes.
- Rules are modular and can be enabled, disabled, added, or removed in `src/rules.ts`.
- Threshold matching holds only when matched non-required rules reach the configured threshold.
- Required-rule support exists through each rule's `required` flag.
- Matched and non-matched rule evidence is stored in D1.
- Suspicious orders are updated to Magento hold status only in `live` mode.
- Suspicious orders in non-holdable statuses are recorded without a Magento hold API call.
- Below-threshold orders remain unchanged.
- Slack alert code is tested for bot-token channel posting, webhook fallback, API errors, and clean skip when Slack is unconfigured.
- Scanner hold path is tested to confirm Slack is called only after Magento hold succeeds.

## Live Operational Notes

- Staging currently requires origin nginx basic-auth changes before live scans can evaluate orders.
- Misthub is configured but disabled. Do not re-enable without explicit approval.
- Misthub's REST base is `/rest/V1`, represented by `storeCode: ""`.
- Last Misthub live test before disabling evaluated 104 orders and held 14 orders.
