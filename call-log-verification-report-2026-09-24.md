# Final Call Log Verification (Read-Only)

**Source:** Local MySQL `ulov` (backend `.env`) — **read-only queries**  
**Server / PM2 / Metro logs:** **Not available** in workspace (`CALL_DELIVERY_TRACE`, Agora, T0–T4 not on disk)  
**Test window identified:** `2026-09-24` ~`10:14:14Z`–`10:17:18Z`, `callerId=16`, `receiverId=15`

## Call identification (5 scenarios)

| Call # | Scenario (inferred) | callHistoryId | Confidence |
|--------|---------------------|---------------|------------|
| 1 | Voice 30–60s → End | **11921** | **High** — `voice`, `duration=50`, `coinsSpent=20`, `completed` |
| 2 | Video 30–60s → End | **11922** | **High** — `video`, `duration=45`, `coinsSpent=60`, `completed` |
| 3 | 45s unanswered | **11923** | **High** — `cancelled`, `duration=0`, `coinsSpent=0`, ~46s create→update, **no ACCEPTED** in delivery |
| 4 | Optimistic End Call | **Not isolated** | **INCONCLUSIVE** — no separate row; likely overlapped 11921/11922; **T0–T4 not in logs** |
| 5 | Double End Call | **11925** | **Medium** — short `video` `duration=1`, `completed`, single wallet/earning |

**Also in window (not mapped to reported 5):** **11924** — `cancelled` after ~1s, zero billing (possible aborted call between timeout and 11925).

`callSessionId` = `callHistoryId` for these direct calls (mobile uses same id in payloads).

---

## Per-call records

### Call 1 — Voice (11921)

| Field | Value |
|-------|--------|
| Scenario | Voice 30–60s → End |
| callHistoryId / session | 11921 |
| callerId / receiverId | 16 / 15 |
| type | voice |
| createdAt | 2026-09-24T10:14:14.000Z |
| updatedAt (finalized) | 2026-09-24T10:15:07.000Z |
| status | completed |
| duration | 50 |
| coinsSpent | 20 |

### Call 2 — Video (11922)

| Field | Value |
|-------|--------|
| Scenario | Video 30–60s → End |
| callHistoryId | 11922 |
| callerId / receiverId | 16 / 15 |
| type | video |
| createdAt | 2026-09-24T10:15:18.000Z |
| updatedAt | 2026-09-24T10:16:12.000Z |
| status | completed |
| duration | 45 |
| coinsSpent | 60 |

### Call 3 — 45s timeout (11923)

| Field | Value |
|-------|--------|
| Scenario | 45s unanswered |
| callHistoryId | 11923 |
| createdAt | 2026-09-24T10:16:18.000Z |
| updatedAt | 2026-09-24T10:17:04.000Z (~46s) |
| status | cancelled |
| duration | 0 |
| coinsSpent | 0 |

### Call 4 — Optimistic End

**No dedicated callHistoryId.** Not provable from DB alone.

### Call 5 — Double End (11925)

| Field | Value |
|-------|--------|
| callHistoryId | 11925 |
| type | video |
| createdAt | 2026-09-24T10:17:12.000Z |
| updatedAt | 2026-09-24T10:17:18.000Z |
| status | completed |
| duration | 1 |
| coinsSpent | 30 |

---

## Delivery timeline (`call_delivery_events` — UTC)

**Not observable from DB:** `CALL_USER_RECEIVED`, `RECEIVER_ONLINE_CHECK`, `RECEIVER_BUSY_CHECK`, `LIVE_CALL_UPSERT_*`, `SOCKET_EMIT_*` (console `CALL_DELIVERY_TRACE` only).

### 11921 (voice)

| Time | Event |
|------|--------|
| 10:14:14 | CALL_ROUTING_STARTED, SOCKET_DELIVERED, PUSH_*, NOTIFICATION_RECEIVED (socket+push), INCOMING_SCREEN_OPENED |
| 10:14:15 | ACCEPTED (socket) |
| 10:14:16 | ACCEPTED (client) |

### 11922 (video)

| Time | Event |
|------|--------|
| 10:15:18 | ROUTING, SOCKET_DELIVERED, NOTIFICATION_RECEIVED, INCOMING_SCREEN_OPENED, PUSH_SENT |
| 10:15:21 | ACCEPTED (socket + client) |

### 11923 (timeout)

| Time | Event |
|------|--------|
| 10:16:19 | ROUTING, SOCKET_DELIVERED, NOTIFICATION_RECEIVED, INCOMING_SCREEN_OPENED, PUSH_SENT |
| — | **No ACCEPTED** |

### 11925 (double-end candidate)

| Time | Event |
|------|--------|
| 10:17:13 | ROUTING, SOCKET_DELIVERED, NOTIFICATION_RECEIVED, INCOMING_SCREEN_OPENED |
| 10:17:14 | ACCEPTED (socket + client) |

---

## Agora / connection

**Not logged in database.** Accept times above proxy “accept”; join/connected/offline/leave **not observable** from current evidence.

---

## End call / settlement (DB)

| callId | Final status | Wallet tx (referenceId) | Earning rows |
|--------|--------------|-------------------------|--------------|
| 11921 | completed @ 10:15:07 | 1 × debit 20 @ 10:14:16 | 1 (8 coins) |
| 11922 | completed @ 10:16:12 | 1 × debit 60 @ 10:15:27 | 1 (25 coins) |
| 11923 | cancelled @ 10:17:04 | 0 | 0 |
| 11925 | completed @ 10:17:18 | 1 × debit 30 @ 10:17:17 | 1 (12 coins) |

**Duplicate settlement query:** No `referenceId` with >1 wallet row; no `callId` with >1 earning row among 11921–11925.

**Optimistic End:** **T0–T4 not observable from current server logs.**

---

## Financial summary

| callId | coinsSpent | Wallet tx count | Wallet amount | Earning rows | Earning coins | Duplicate settle |
|--------|------------|-----------------|---------------|--------------|---------------|------------------|
| 11921 | 20 | 1 | 20 | 1 | 8 | No |
| 11922 | 60 | 1 | 60 | 1 | 25 | No |
| 11923 | 0 | 0 | — | 0 | — | No |
| 11924 | 0 | 0 | — | 0 | — | No |
| 11925 | 30 | 1 | 30 | 1 | 12 | No |

---

## Double End (11925)

- **Multiple `/calls/end` or `completeCallRecord`:** Not visible without server logs.
- **DB:** Single wallet transaction (9769), single earning (7155), `duplicateEarningSuspect: false`, `duplicateWalletByRefSuspect: false` in verifier.

---

## Phantom / stale recovery

- Each `INCOMING_SCREEN_OPENED` in the test window aligns with a **new** `call_histories` row created within seconds (11921–11925).
- **11923:** Incoming UI without ACCEPT — consistent with ring/no-answer, not stale replay (row created same second as ROUTING).
- No DB evidence of recovery replay for rows **>120s** old in this window.

---

## Final table

| Scenario | Call ID | Status | Duration | Coins | Earning Rows | Wallet Tx | Duplicate Settlement | Result |
|----------|---------|--------|---:|---:|---:|---:|---|---|
| Voice 30–60s | 11921 | completed | 50 | 20 | 1 | 1 | No | **PASS (DB)** |
| Video 30–60s | 11922 | completed | 45 | 60 | 1 | 1 | No | **PASS (DB)** |
| 45s unanswered | 11923 | cancelled | 0 | 0 | 0 | 0 | No | **PASS (DB)** |
| Optimistic End | — | — | — | — | — | — | — | **INCONCLUSIVE** |
| Double End | 11925 | completed | 1 | 30 | 1 | 1 | No | **PASS (DB)** |

---

## Final verdict

| Gate | Verdict |
|------|---------|
| **CALL DELIVERY** | **PASS** (delivery events: socket delivered + accept on connected; no accept on 11923) |
| **CALL TERMINATION** | **PASS** (terminal DB states match scenario; no duplicate completion rows) |
| **FINANCIAL SETTLEMENT** | **PASS** (single wallet + earning per billed call) |
| **DUPLICATE SETTLEMENT** | **PASS** |
| **45-SECOND TIMEOUT** | **PASS** (11923) |
| **OPTIMISTIC END** | **INCONCLUSIVE** (T0–T4 not observable) |
| **PHANTOM CALL REGRESSION** | **PASS** (window events map to new call IDs) |
| **EARNINGS SAFETY** | **VERIFIED** (for calls 11921, 11922, 11925 — one settlement each; 11923/11924 zero) |
| **PRODUCTION RECOMMENDATION** | **NO-GO** until optimistic End Call proven with client timing logs; DB alone insufficient for Phase 4 |

**No code or data was modified.**
