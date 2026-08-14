# Agent Handoff

## Current State

- Project: Cloudflare Worker + Workflow for Magento fraud-hold and customer-verification automation.
- Worker: `fraud-hold-system-v2`.
- Live URL: `https://fraud-hold-system-v2.info-ba2.workers.dev`.
- D1: `fraud_hold_system`.
- R2: `fraud-hold-verification-docs`.
- Workflow: `fraud-scan-workflow`.
- Cron: `* * * * *`.
- Last known deployed version: `9fb4d47f-fb32-42d4-8e2a-da34b143bc88` (ECOM-267).
- Expected test count: 102.
- ECOM-262 military-address handling and the behavioral-rule timestamp fix are deployed in production.
- ECOM-263 initial verification requirements were manually verified in an isolated local Worker against staging-derived case `000000290` and deployed in production as Worker version `b8bc01f5-43b5-4925-9486-3c57cb113a76`: the simulated HTML email and customer upload page showed the same four categories, and the upload page retained the generic multi-file `document` field. No real email or Magento mutation was used during validation.
- ECOM-266 was staging-verified on 2026-08-14 with customer `peter@vapewholesaleusa.com` / Magento customer ID `4`. Order `000000292` was held, recorded one successful verification email through Wrangler's local simulated email binding, approved, returned to `processing`, and changed the exact `Verified` attribute from `"0"` to `"1"`. Magento rejects null-valued custom attributes when they are replayed in a customer PUT, so the update omits those while preserving their existing null state and all writable unrelated attributes. Post-verification military order `000000293` (`AE` / `09012`, `$240`) remained `pending`; D1 recorded `allow`, evaluated only `verified_customer`, and created no hold, case, or email. Offline invoice `202` was created without capture or notification on order `000000292` so the check/money-order fixture could satisfy the approval contract's `processing` transition. The test was local/staging-only with Slack disabled, no external email delivery, and no production deployment.
- ECOM-266 is deployed in production as Worker version `e3d64180-80ac-47de-9c1c-8ca4043530cc`. The first scheduled run after deployment completed successfully for VWU and Misthub with no errors or hold attempts.
- ECOM-267 is deployed in production as Worker version `9fb4d47f-fb32-42d4-8e2a-da34b143bc88`. Consecutive scheduled runs began at `2026-08-14T19:17:52Z`, `19:18:52Z`, and `19:19:52Z`, confirming the one-minute cadence. Completed VWU and Misthub runs succeeded with no errors or hold attempts.
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

- Treat each site's `enabled` flag as persistent production state. Do not change any site's enabled/disabled status as a side effect of a deployment.
- Before deploying, verify the candidate configuration preserves the currently deployed site statuses unless the user explicitly instructs a status change.

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
- Enabled: false.
- Base URL: `https://staging.vapewholesaleusa.com`.
- REST base: `/rest/default/V1`.
- Timezone: `America/Los_Angeles`.
- Access-token secret: `MAGENTO_STAGING_ACCESS_TOKEN`.
- Known production blocker: requests from the deployed Worker receive an nginx HTML `401 Authorization Required` before reaching Magento. The same token works locally. Staging `/rest/` must be exempted from nginx Basic Auth or protected with a separate custom header.
- Production scanning is disabled for this site; the site remains available to the isolated local staging-validation workflow.
- Site failures are isolated, so this recurring staging failure does not stop VWU.

### `misthub`

- Name: `misthub.com`.
- Enabled: true.
- Base URL: `https://misthub.com`.
- REST base: `/rest/V1` (`storeCode: ""`).
- Timezone: `America/Los_Angeles`.
- Access-token secret: `MAGENTO_MISTHUB_ACCESS_TOKEN`.

## Fraud Rules

- Rules are hard-coded in `src/rules.ts`.
- Hold threshold: 2 matched non-required rules unless overridden per site.
- The overseas military shipping-address rule is required; all other active fraud rules are non-required.
- Active rules:
  - Verified Magento customer exemption.
    - A registered customer whose exact `Verified` custom attribute has string value `"1"` bypasses every fraud rule, including the required military-address rule.
    - Guests, missing customers, lookup failures, missing attributes, and other values continue through normal evaluation.
  - Overseas military shipping address.
    - Matches shipping state/ZIP pairs `AA`/`34000`–`34099`, `AE`/`09000`–`09899`, and `AP`/`96200`–`96699`.
    - Accepts normalized five-digit and ZIP+4 values and stores normalized evidence.
    - Holds by itself and overrides the completed-order-history exemption.
    - Creates a `pending_review` case and suppresses the initial customer email even when other rules also match.
  - Registered-customer completed-order-history exemption.
    - Skips remaining non-required fraud rules when the customer has a completed order at least `CUSTOMER_HISTORY_EXEMPTION_MONTHS` calendar months older than the current order, unless the military rule matched.
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
    - The one-hour and same-day signal queries normalize Magento and ISO timestamp formats with SQLite `datetime()` before comparison.
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
  2. For normal holds, create the case as `awaiting_customer` and send the per-site verification email when enabled.
     - The initial email and upload page list the same four required categories: proof of billing and shipping address; payment card showing only the last four digits and cardholder’s name; government-issued photo ID; and a selfie of the cardholder holding the ID.
     - These requirements are guidance only. The initial form retains one flexible multi-file `document` field with the existing file-type and size rules.
  3. For military-address holds, create the case as `pending_review` and record the initial email as skipped by policy.
  4. Staff may manually request information from `pending_review`; successful delivery transitions to `awaiting_customer`, while failure leaves the case pending for retry.
  5. Send Slack only after Magento hold succeeds.
- Staff queue: `/staff`; login: `/staff/login`.
- Queue and case pages include Magento admin links opening in a new tab.
- Staff queue timestamps are formatted in each site's configured `MAGENTO_SITES_JSON.timeZone`, with UTC retained in the HTML timestamp and tooltip.
- Approve releases the Magento hold, expects status `processing`, and then sets the registered Magento customer's exact `Verified` attribute to `"1"` before committing the D1 approval. Existing customer data and writable unrelated custom attributes are preserved; null-valued custom attributes returned by Magento are omitted from the PUT because Magento rejects them on input while retaining their existing null state. Guest approvals skip the marker. A marker failure attempts to restore the hold and leaves the case unapproved for retry. Completed cases hide further action buttons and show a success message.
- Decline is implemented, staging-verified, and deployed in production:
  - The case page shows a confirmation popup reminding staff that the Authorize.net refund remains manual.
  - The flow unholds the order, creates a full offline invoice credit memo, and accepts Magento `closed` or `canceled`; it calls cancel only if the credit memo did not already close the order.
  - Amasty Store Credit requires `arguments.extension_attributes.amstorecredit_base_amount: 0` in the refund request. Omitting the extension object causes its refund plugin to throw a null dereference and return HTTP 500.
  - Failed credit-memo attempts try to restore the Magento hold.
  - Staging order `000000235` created credit memo `22`, refunded `$37.49` in Magento, and transitioned to `closed` without an Authorize.net refund.

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

## Project Documentation

- Keep the Slack Canvas `Fraud Hold System — Workflow, Features, Stack, and Rules` current whenever a project change affects documented workflow, features, technology stack, fraud rules, integrations, production behavior, or known limitations.
- Canvas ID: `F0BMT4B90D9`.
- Canvas URL: `https://vapewholesale.slack.com/docs/T0AR1FH905P/F0BMT4B90D9`.
- Read the existing canvas before editing it, preserve unrelated content, and update only the affected sections.
- Include the canvas update in the completion summary. If access or permissions prevent the update, report that explicitly rather than silently leaving the canvas stale.

## Verification and Deployment

For implementation-complete local and Staging VWU regression testing, use the repository skill at `.agents/skills/validate-fraud-hold-staging`. It derives coverage from `AGENTS.md`, `README.md`, `TESTING.md`, migrations, tests, affected source, and the Slack Canvas; starts a staging-isolated local Worker; creates purpose-built staging data; and requires evidence for every documented feature. Safe detection mode is the default. Live Magento mutations, customer emails, Slack alerts, approve, and decline require explicit approval gates.

Run before deploy:

```bash
npm run verify
```

Expected: 102 tests, TypeScript success, and Wrangler dry-run success reporting cron `* * * * *`.

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
