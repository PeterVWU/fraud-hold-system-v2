# Regression Matrix

Use this as the minimum inventory, then add every feature and limitation currently documented in `AGENTS.md`, `README.md`, `TESTING.md`, and the Slack Canvas.

| Area | Required evidence |
|---|---|
| Automated baseline | Tests, TypeScript, Wrangler dry-run, expected test count |
| Configuration | One-minute global cron, one-minute default no-cursor window, explicit custom no-cursor window, deploy-time cadence model, safety switches, secret names, site parsing |
| Site isolation | Only staging enabled locally; one site/order failure does not abort others |
| Scan window | One-minute omitted default, explicit custom no-cursor interval, saved cursor, overlap, pagination, manual endpoint gates; verify site intervals do not independently schedule execution |
| Verified customer exemption | Exact case-sensitive `Verified = "1"`; normal and military full bypass; guests, lookup failures, missing attributes, and other values fail closed |
| History exemption | Registered ID only, calendar-month boundary, lookup failure fallback, military override |
| Military rule | AA/AE/AP ranges and boundaries, ZIP+4, case/whitespace, wrong pairs, invalid ZIP, shipping-only, stored evidence |
| Address mismatch | Match and equality, history reuse, 10-completed-order suppression boundary |
| Account age | Under/at/over 24 hours, invalid/missing dates |
| Velocity | Same customer, email, or IP inside/outside one hour; Magento/ISO timestamp normalization |
| High total | Below/at/above `$150` |
| ZIP/state | Correct, incorrect, non-US, missing data, documented full-state-name limitation |
| Payment/name history | Same/different card and billing name in UTC day; timestamp normalization |
| Review persistence | Decision counts, required count, all rule evidence, signals, run logs, cursors |
| Hold flow | Holdable, already held, non-holdable, false/error response, Magento comment |
| Normal verification | `awaiting_customer`, token expiry/hash, email sent/failed/skipped, Slack ordering; initial email/page share all four required document categories and plural wording while retaining the generic multi-file `document` field |
| Military verification | `pending_review`, policy skip, mixed matches, token access, filters and rendering |
| Information requests | Validation, standard/custom requests, token rotation, success transition, failure retry, history; follow-up page remains limited to staff-selected requirements |
| Uploads/R2 | Type/size validation, request labels, private storage, retrieval, submitted status |
| Staff auth/UI | Login/logout/session, server-side status filters and case-insensitive literal order-number substring search, increment-ID/numeric-ID fallback, combined predicates and filtered totals, blank and wildcard-character inputs, search-specific empty state, 25-case pagination, first/middle/last and invalid/excessive page boundaries, status/search-preserving links and control reset, all matching cases reachable, HTML/URL escaping, timezone/UTC, Magento links, completed controls |
| Approve | Unhold, processing status, registered-customer marker preserving other data/writable attributes while omitting Magento-returned null custom attributes, guest skip, marker-failure hold restoration with no D1 approval writes, action audit |
| Decline | Confirmation, unhold, invoice lookup, offline full credit memo, Amasty field, close/cancel, hold restoration |
| Slack | Bot posting, webhook fallback, errors, skip when unconfigured, only after successful hold |
| Magento client | Auth headers, store path, safe GET retry only, POST mutation behavior, error isolation |
| Documentation | AGENTS, README, TESTING, this matrix, and Slack Canvas synchronized |

For each row record: test identifiers, staging entity IDs, expected result, actual result, evidence location, cleanup/remaining artifacts, and final status.
