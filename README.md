# Fraud Hold System v2

Cloudflare Workers implementation for polling Magento orders every 5 minutes, evaluating configurable fraud rules, placing matching orders on hold, recording rule evidence in D1, and sending Slack alerts.

## Architecture

- Cloudflare Workflows runs the scheduled scan with `*/5 * * * *`.
- D1 stores site cursors, order reviews, rule evidence, reusable recent-order signals, and run logs.
- Magento REST is used for order search, order detail, hold, status, and internal comments.
- Rules live in `src/rules.ts`; each rule has an `id`, `name`, `enabled`, `required`, and `evaluate` function.
- The initial hold threshold is 2 matched non-required rules. Required-rule support is built in but no initial rule is required.
- Set `HOLD_ACTION_MODE=dry_run` for staging/read-only scans; use `live` to update Magento order status.
- Slack alerts are sent after a successful Magento hold through `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID`.
- Slack hold messages keep the order details and add a final Magento admin link when `adminBaseUrl` is configured.

## Configure

1. Create a D1 database and replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.jsonc`.
2. Copy `.dev.vars.example` to `.dev.vars` for local development.
3. Set Magento and Slack secrets in Cloudflare:

```bash
npx wrangler secret put MAGENTO_MAIN_ACCESS_TOKEN
npx wrangler secret put SLACK_BOT_TOKEN
npx wrangler secret put SLACK_WEBHOOK_URL
npx wrangler secret put MANUAL_RUN_TOKEN
```

4. Update `MAGENTO_SITES_JSON` in `wrangler.jsonc` for each Magento site. Add one object per site with a unique `id`, `baseUrl`, `storeCode`, `accessTokenEnv`, optional `adminBaseUrl`, optional `paymentFingerprintPaths`, and optional `initialLookbackHours` for first-run backfills.
5. Set `SLACK_CHANNEL_ID=C0BBH9RE3GV` for the `fraud-hold-system` Slack channel. `SLACK_BOT_TOKEN` is preferred for channel posting; `SLACK_WEBHOOK_URL` remains supported as a fallback.

The secret name must be `SLACK_BOT_TOKEN`; paste the `xoxb-...` token only when Wrangler prompts for the secret value.

Current staging admin base URL:

```text
https://as.vapewholesaleusa.com/admin_N7zuJfehzDnf
```

Slack hold alert format:

```text
Fraud hold placed for <site name>
Order: <increment id>
Total matched rules: <matched>/<threshold>
Rules: <matched rule names>
Magento admin: Open order
```

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

Health check:

```bash
curl https://<worker-url>/health
```

## Regression Testing

See `TESTING.md` for the required automated checks and staging Magento regression tests, including the positive hold case and the negative no-status-change case.
