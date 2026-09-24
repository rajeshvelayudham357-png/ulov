# Call Reliability P0 — Staging QA & Final Gate

**Last updated:** 2026-09-24  
**P0 scope:** Optimistic end, idempotent termination, accept ACK, male 45s timeout, faster incoming delivery, stale pending-incoming fix (120s window)  
**Production:** Not deployed  
**Code change policy for this gate:** No new product/financial changes during validation  

**Related docs:** [Automated verification](./call-reliability-p0-verification-report.md) · [Incoming delivery audit](./call-incoming-delivery-root-cause-audit.md) · [Diagnostic template](./call-incoming-delivery-diagnostic-report.md)

---

# FINAL P0 GATE (summary)

| Dimension | Result | Basis |
|-----------|--------|--------|
| **AUTOMATED TEST RESULT** | **PASS** | Backend **30/30**; Mobile logic **14/14** (see below) |
| **REAL-DEVICE RESULT** | **PARTIAL** | Direct M→F call reported **working** post stale-recovery fix; Phases 1–9 **not fully instrumented** in this report (no verifier JSON / T0–T4 captures attached) |
| **FINANCIAL REGRESSION RESULT** | **PASS (automated scope)** | `callRate.util`, `quickConnect.billing`, idempotency integration; mobile end-payload mirror unchanged; **no PRE-P0 staging numeric baseline** in repo |
| **PRODUCTION DEPLOYMENT DECISION** | **NO-GO** | Required race/timeout phases (3–8) lack documented DB verifier evidence; do not auto-deploy |

---

## Call Reliability

**Criteria for PASS:**

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Normal voice/video connect | **PARTIAL PASS** | Team report: direct flow works; formal Phase 1–2 rows below **NOT RUN** (agent) |
| Incoming delivery | **PASS (reported)** | Post 120s pending-incoming + validation fix |
| Stale recovery / phantom calls | **PASS (reported + code)** | `MAX_PENDING_INCOMING_AGE_MS`, `incoming-status` expiry, recovery validation |
| Male 45s waiting timeout | **NOT RUN** | Needs timed device test + verifier |
| Optimistic End Call (T1 before T4) | **NOT RUN** | Needs timestamps |
| Double end / socket / Agora races | **NOT RUN (device)** | **Automated:** idempotency tests PASS |
| Reconnect safe | **NOT RUN** | Phase 8 |

**CALL RELIABILITY (gate):** **NOT READY** for production until Phases 3–8 and 9 are **PASS** with logs + `staging-call-qa-verify.mjs` JSON.

---

## Earnings Safety

**Criteria for PASS:**

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Billing formulas unchanged | **PASS (automated)** | No edits to `callRate.service.js` / `callRate.util.js` settlement path in P0; `callRate.util.test.js` green |
| Creator earning unchanged | **PASS (automated)** | Same |
| No duplicate wallet on double settle | **PASS (automated)** | `quickConnect.billing` + `callFinancialIdempotency` sequential + concurrent |
| Zero billing missed/reject/timeout | **PASS (automated)** | QC billing zero paths; **Phase 3 device NOT RUN** |
| Termination races → one settlement | **PARTIAL** | Client `tryClaimFinancialFinalization` + backend `alreadyCompleted`; **device Phases 5–7 NOT RUN** |

**EARNINGS SAFETY (gate):** **VERIFIED (automated + code review scope)** — **NOT** full staging financial soak with PRE-P0 numeric table filled.

---

## Final Result

| | |
|--|--|
| **CALL RELIABILITY** | **NOT READY** |
| **EARNINGS SAFETY** | **VERIFIED** (scoped — see above) |
| **PRODUCTION** | **NO-GO** |

---

# AUTOMATED TEST RESULT (executed 2026-09-24)

### Backend — **30 / 30 PASS**

```bash
cd dating-backend && node --test --test-concurrency=1 \
  src/services/__tests__/callAccept.service.test.js \
  src/services/__tests__/callDelivery.test.js \
  src/services/__tests__/callFinancialIdempotency.integration.test.js \
  src/services/__tests__/callRate.util.test.js \
  src/services/__tests__/directCall.regression.test.js \
  src/services/__tests__/quickConnect.billing.test.js
```

Includes:

- Duplicate `completeCallRecord` → `alreadyCompleted`
- **Concurrent** `completeCallRecord` → single earning row, stable `coinsSpent`
- Connected `endCall` → second settle does not double wallet
- Zero-duration / missed / reject QC paths → `coinsSpent = 0`
- Direct `POST /call/create` regression

### Mobile logic — **14 / 14 PASS**

```bash
cd DatingApp && node --import ./scripts/test-node-preload.mjs --import tsx/esm --test \
  src/services/callTerminationCoordinator.logic.test.ts \
  src/services/callBackendFinalization.logic.test.ts \
  src/services/incomingCallDedupe.logic.test.ts \
  src/store/callStoreEndPayload.regression.logic.test.ts
```

Includes: ending guard, financial claim dedupe, end-payload coin mirror (10/60, 5/30 half-minute rules).

---

# REAL-DEVICE RESULT (Phases 1–9)

> **Note:** Agent cannot execute device tests. Fill sections after each run. Team indicated **direct call flow is working** after stale-recovery fix.

## Phase 1 — Normal voice call

**Status:** NOT RUN (formal capture) / **informal: working (team)**

| Field | Value |
|-------|--------|
| callHistoryId | |
| callSessionId | |
| Timestamps (start / accept / Agora / end) | |

**DB verifier:**

```json

```

**Financial:** wallet before/after, coinsSpent, earningRows — |

**PASS / FAIL / NOT RUN:** NOT RUN

---

## Phase 2 — Normal video call

**Status:** NOT RUN

(Same tables as Phase 1.)

---

## Phase 3 — Male 45s unanswered timeout

**Status:** NOT RUN

**Expected:** coinsSpent=0, earningRows=0, no `call-accepted`.

---

## Phase 4 — Optimistic End Call

**Status:** NOT RUN

| Event | Timestamp |
|-------|-----------|
| T0 End pressed | |
| T1 UI exit | |
| T2 Agora leave | |
| T3 /calls/end start | |
| T4 /calls/end complete | |

**Expect:** T1/T2 ≪ T4.

---

## Phase 5 — Double End Call

**Status:** NOT RUN

**Expected:** earningRows ≤ 1, single wallet ref.

---

## Phase 6 — End + socket disconnect

**Status:** NOT RUN

---

## Phase 7 — End + Agora offline race

**Status:** NOT RUN

---

## Phase 8 — Reconnect

**Status:** NOT RUN

---

## Phase 9 — Stale call regression

**Status:** PARTIAL (fix deployed; formal test NOT RUN)

**Code evidence (no billing change):**

- `callIncomingRecovery.service.js`: `MAX_PENDING_INCOMING_AGE_MS = 120_000`, SQL `createdAt >= minCreatedAt`
- `getIncomingCallStatus`: `active: false` when outside window
- Mobile: recovery validates active; clears overlay/ringtone when stale

**Device checklist:**

- [ ] Old `live`/`ringing` row &gt; 120s → no incoming UI on app open  
- [ ] New call after restart → received normally  

---

# PHASE 10 — Financial regression (PRE-P0 vs P0)

| Field | PRE-P0 (staging baseline) | P0 (measure) | Result |
|-------|---------------------------|--------------|--------|
| Voice rate | _fill from admin/settings_ | | |
| Video rate | | | |
| Coins spent | | | |
| Creator earning | | | |
| Creator earning % | | | |
| Billing start | onUserJoined → connectCall | unchanged in code | ☐ Match |
| Duration | | | |
| Rounding | | | |

**Automated proxy:** `callRate.util.test.js` + mobile payload mirror tests — **unchanged outputs** for fixed duration fixtures.

---

# PHASE 11 — Database verification command

```bash
cd dating-backend
node scripts/staging-call-qa-verify.mjs <callHistoryId>
```

**Race scenarios:** `counts.earningRows <= 1`; no duplicate `walletTransactionsReferenceId` for same call.

---

# Scenario summary matrix

| Phase | Description | Status | Billing OK | Idempotent |
|-------|-------------|--------|------------|------------|
| 1 | Voice connected | NOT RUN | — | — |
| 2 | Video connected | NOT RUN | — | — |
| 3 | 45s timeout | NOT RUN | — | — |
| 4 | Optimistic end | NOT RUN | — | — |
| 5 | Double end | NOT RUN | — | Auto PASS |
| 6 | End + socket | NOT RUN | — | — |
| 7 | End + Agora | NOT RUN | — | — |
| 8 | Reconnect | NOT RUN | — | — |
| 9 | Stale regression | PARTIAL | N/A | N/A |

---

# If tests fail (policy)

1. Do **not** change financial logic to force PASS.  
2. Do **not** deploy.  
3. Document failing stage + `CALL_DELIVERY_TRACE` / `FEMALE_CALL_TRACE` / verifier JSON.  
4. Propose **smallest non-financial fix** separately.

---

# Deployment rule

**Do not deploy to production automatically.**

When Phases 1–8 are **PASS** with verifier JSON and Phase 10 baseline filled, reassess:

- **CALL RELIABILITY:** READY  
- **EARNINGS SAFETY:** VERIFIED (staging soak)  
- **PRODUCTION:** GO only after explicit release approval  

Until then: **NO-GO**.
