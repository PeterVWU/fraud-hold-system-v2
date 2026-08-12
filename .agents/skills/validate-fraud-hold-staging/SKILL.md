---
name: validate-fraud-hold-staging
description: Validate fraud-hold-system-v2 implementations and regressions locally against Staging VWU. Use after changing fraud rules, Magento integration, scanning, holds, verification cases, customer email, Slack alerts, staff review actions, D1/R2 persistence, pages, authentication, configuration, or other behavior documented in AGENTS.md, README.md, TESTING.md, or the project Slack Canvas. Starts a staging-isolated local Worker, creates purpose-built Magento staging orders and customer data, exercises changed and existing features, verifies evidence across Magento/D1/UI/notifications, and updates the regression inventory for newly documented features.
---

# Validate Fraud Hold Staging

Run a layered regression of the local source against Staging VWU. Treat the documentation as a changing specification and prove both the implementation under test and all existing documented behavior.

## Required preparation

1. Read the repository `AGENTS.md`, `README.md`, `TESTING.md`, `package.json`, `wrangler.jsonc`, migrations, affected source files, and affected tests.
2. Read the Slack Canvas identified in `AGENTS.md` when Slack access is available.
3. Read [references/regression-matrix.md](references/regression-matrix.md).
4. Inspect `git status` and preserve unrelated changes and `.dev.vars.swp`.
5. Build a traceable matrix with one row per documented feature or safety invariant. Add any newly implemented feature before testing.

Do not declare success from unit tests alone. Record `pass`, `fail`, `blocked`, or `not applicable` plus evidence for every matrix row.

## Safety boundary

- Use only the `staging-vwu` Magento site for external reads and writes.
- Start the Worker with all site metadata present but `enabled:false` for VWU and Misthub. This prevents scans while allowing older local cases to render.
- Never edit checked-in site enablement to obtain local isolation.
- Never deploy, query remote D1, or call production/Misthub Magento during this workflow.
- Never print or commit secrets. Load `.dev.vars` without echoing values.
- Run detection first with Magento updates, customer email, and Slack delivery disabled.
- Obtain explicit approval before live Magento holds, customer emails, Slack alerts, approve/unhold, decline/credit-memo, or cancellation. State the exact orders, recipients, and side effects.
- Use unique order notes and emails that identify the test run. Do not reuse a real customer email unless the user explicitly requests and approves delivery.
- Do not reset reviews or delete D1/R2 data without explicit approval. Create fresh orders instead.
- Decline tests create Magento financial records and require a manual Authorize.net reminder. Use a dedicated low-value staging order and explicit approval.

## Workflow

### 1. Establish the baseline

Run `npm run verify`. Stop on failures caused by the candidate change and fix them before external testing. Note the test count, TypeScript result, and Wrangler dry-run result.

Apply local migrations:

```bash
HOME=/tmp npx wrangler d1 migrations apply fraud_hold_system --local
```

### 2. Start an isolated local Worker

Use [scripts/start-local-worker.sh](scripts/start-local-worker.sh). Start in safe detection mode first:

```bash
.agents/skills/validate-fraud-hold-staging/scripts/start-local-worker.sh
```

The script must show `vwu=false`, `misthub=false`, and `staging-vwu=true`. Keep the resulting process/session available for log inspection. Verify `/health` with a unique query value.

For an approved live phase, stop the safe server and use the explicit Magento, email, and Slack gates documented by `--help`. Never infer approval from a previous task.

### 3. Create purpose-built staging data

Research Magento request bodies in the local Magento 2.4.8 Swagger before writing API calls. Discover the staging customer, product, payment, shipping method, and template order at runtime; do not freeze entity IDs or assume guest checkout is enabled.

Create the smallest set of fresh orders that covers the matrix. Prefer independent orders for independent rules, plus a deliberate sequence for velocity and payment/name history. Store this run manifest in `/tmp`, containing only non-secret IDs and expected matches.

For fraud rules, cover at minimum:

- Below-threshold baseline and non-holdable status.
- Billing/shipping mismatch below and at the 10-completed-order suppression boundary when suitable accounts exist.
- Account age under 24 hours using a dedicated new staging customer; never alter an established account's creation date.
- Same customer/IP order velocity with at least two fresh orders.
- Total below and at `$150`.
- ZIP/state correct, incorrect, full-name limitation, and military pairs.
- Different payment fingerprints and billing names in the same UTC day.
- Completed-order-history exemption below, at, and beyond the configured calendar-month boundary when fixture history can be created safely.
- Military AA/AE/AP boundaries, ZIP+4, normalization, wrong pairings, billing-only military data, exemption override, and mixed-rule email suppression.

If Magento cannot safely create a prerequisite such as aged history, cover it with automated tests and mark live staging evidence `blocked`, including the exact reason. Never falsify production-like customer history merely to turn a row green.

### 4. Run safe detection

Trigger only the staging site. Verify:

- Run statistics and isolated failure behavior.
- `order_reviews`, every `order_rule_results` row and evidence JSON, `order_signals`, cursors, and run logs in local D1.
- No Magento writes, emails, or Slack alerts occurred.
- Dry-run verification cases and customer-upload test links render.
- Staff login, filters, site-local timestamps, Magento links, escaped content, and completed-case controls render.

Compare actual matched rules to the manifest. Investigate every mismatch before live testing.

### 5. Run approved live flows

Restart with only the individually approved capabilities enabled. Use fresh orders because reviews are idempotent.

Verify normal suspicious orders:

- Hold succeeds before queue creation and Slack.
- Case is `awaiting_customer`.
- Initial email attempt records the expected recipient, sender, message ID/error, and status.
- Slack result and Magento comment are persisted.

Verify military orders:

- Required match holds by itself and overrides history exemption.
- Case is `pending_review`.
- Initial email is `skipped` with the policy reason even with other matches.
- Slack and approve/decline remain available.
- Manual request success transitions to `awaiting_customer`; failure remains `pending_review` and can retry.
- The token works for pending and awaiting cases and document uploads associate with the correct request.

Verify staff actions on dedicated orders:

- Approve unholds and expects `processing`; completed cases hide actions.
- Decline confirmation mentions manual Authorize.net refund, unholds, creates a full offline invoice credit memo with Amasty's zero store-credit extension, accepts `closed`/`canceled`, and restores hold on a forced failure.

### 6. Regression audit

Complete every row in the reference matrix and every feature found in current docs. Also verify authentication, manual endpoint safety gates, scan windows/cursors, site isolation, Magento retry rules, D1/R2 persistence, email-disabled test behavior, Slack fallbacks, HTML security, and configuration defaults.

When a documented feature lacks automation, add a proportional automated test. When a new feature changes documented behavior, update `AGENTS.md`, `README.md`, `TESTING.md`, the reference matrix, and the Slack Canvas.

### 7. Report

Lead with the outcome. Include:

- Source commit/diff tested and local Worker mode.
- Orders/customers created and their final Magento states.
- Full matrix totals and all failures/blocks.
- D1, UI, email, Slack, R2, Magento, and log evidence.
- `npm run verify` result and resulting test count.
- Data or financial artifacts left in staging.
- Documentation updates.
- Explicit statement that production was not deployed or mutated.

Do not mark validation complete while a required matrix row is silently untested.
