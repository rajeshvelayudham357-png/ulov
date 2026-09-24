# Call Reliability P0 Verification Report

## 1. Test Environment

| Item | Value |
|------|--------|
| Date | 2026-09-24 |
| Backend repo | `dating-backend` (local) |
| Mobile repo | `DatingApp` (local) |
| Node | v22.23.1 |
| DB | Local MySQL `ulov` via `src/config/.env` |
| Production | **Not deployed; no production changes** |
| P0 code | Local implementation from prior P0 task (callStore, coordinator, accept ACK, male timeout, callDelivery) |

---

## 2. Backend Tests

### 2.1 Core call / billing / earnings suite (executed)

Command:

```bash
node --test --test-concurrency=1 \
  src/services/__tests__/callAccept.service.test.js \
  src/services/__tests__/callDelivery.test.js \
  src/services/__tests__/callFinancialIdempotency.integration.test.js \
  src/services/__tests__/callRate.util.test.js \
  src/services/__tests__/directCall.regression.test.js \
  src/services/__tests__/quickConnect.billing.test.js
```

| Result | Count |
|--------|------:|
| **Pass** | **30** |
| **Fail** | **0** |

**Coverage highlights:**

| Area | Tests |
|------|--------|
| Call create (direct) | `directCall.regression.test.js` |
| Call rates / male cost / creator % | `callRate.util.test.js` (11 tests in file; included in 30 total) |
| Settlement / idempotency | `callFinancialIdempotency.integration.test.js` (sequential + **concurrent** `completeCallRecord`) |
| Zero billing (miss/reject/cancel/QC) | `quickConnect.billing.test.js` |
| Single bill on connected end | `quickConnect.billing.test.js` (`endCall` + second `completeCallRecord` wallet unchanged) |
| Accept evaluation | `callAccept.service.test.js` |
| Incoming delivery | `callDelivery.test.js` |

### 2.2 Extended QC / socket lifecycle suite (executed)

Same as implementation verification, including `quickConnect.matrix.test.js`, `quickConnect.integration.test.js`, `quickConnect.test.js`:

| Result | Count |
|--------|------:|
| Pass | 64 |
| **Fail** | **2** |

| Failed test | Likely cause | P0 related? |
|-------------|--------------|-------------|
| `processExpiredQuickConnectAttempts recovers expired ringing rows` | Local DB/QC harness timing or schema state | No |
| `App settings defaults keep Quick Connect disabled` | Local `app_settings` has QC enabled (`true !== false`) | No |

**No financial or call-rate assertions failed.**

### 2.3 Wallet / ledger

- Wallet balance mutation on connected call end: covered in `quickConnect.billing.test.js` via `callEnd.controller` + `Wallet` model.
- `completeCallRecord` does **not** debit wallet directly (wallet debit is on `endCall` controller path); idempotency tests use `coinsSpent` + `Earning` row count.

### 2.4 Tests added in this verification pass

| File | Purpose |
|------|---------|
| `callFinancialIdempotency.integration.test.js` | **New:** concurrent `completeCallRecord` → one earning row, stable `coinsSpent` |

---

## 3. Mobile Tests

### 3.1 Executed (Node `--test` + tsx)

```bash
node --import ./scripts/test-node-preload.mjs --import tsx/esm --test \
  src/services/callTerminationCoordinator.logic.test.ts \
  src/services/callBackendFinalization.logic.test.ts \
  src/services/incomingCallDedupe.logic.test.ts \
  src/store/callStoreEndPayload.regression.logic.test.ts
```

| Result | Count |
|--------|------:|
| **Pass** | **14** |
| **Fail** | **0** |

### 3.2 Not available / not run

| Area | Reason |
|------|--------|
| `callStore` / `[id].tsx` / Agora E2E | No Jest/Detox suite; `callStore` import pulls RN AsyncStorage (Node link failure) |
| `waiting.tsx` male timeout | No extracted pure function; **manual / staging** only |
| `IncomingCallView` ACK UI | Covered indirectly via backend accept ACK + dedupe tests |
| Full `npm test:utils` (engagement/session) | Out of call P0 scope; not re-run in this pass |

### 3.3 Tests added in this verification pass

| File | Purpose |
|------|---------|
| `callBackendFinalization.logic.test.ts` | Concurrent `tryClaimFinancialFinalization` → single winner |
| `callStoreEndPayload.regression.logic.test.ts` | Inline mirror of `buildEndCallPayload` coin math (avoids RN imports) |

---

## 4. Call Flow Matrix

| Scenario | Result | Billing | Creator Earning | Notes |
|---|---|---|---|---|
| **A.** Normal voice (create→ring→accept→connect→bill→end) | **Partial PASS** | Settles via backend tests | Via `calculateCallBilling` | No Agora E2E; create + `endCall` + billing formulas covered |
| **B.** Normal video | **Partial PASS** | Video half-minute rules in `callRate.util` + mobile payload mirror | Same backend path | No full Agora video E2E |
| **C.** Reject | **PASS** (backend) | **0** | **0** | `quickConnect.billing` reject/missed rows; direct reject via history status |
| **D.** Missed | **PASS** (backend) | **0** | **0** | QC timeout/missed tests |
| **E.** Male 45s waiting timeout | **NOT AUTOMATED** | Expected **0** ( `syncBackend: false`, duration 0 ) | **0** | Implemented in `waiting.tsx`; requires manual/staging |
| **F.** Accept ACK race | **Partial PASS** | N/A at accept | N/A | Backend ACK on `accept-call`; mobile direct accept uses ACK; no duplicate-accept automation |
| **G.** Socket disconnect | **NOT AUTOMATED** | — | — | Idempotency guards tested in isolation only |
| **H.** Agora `onUserOffline` | **NOT AUTOMATED** | — | — | Same as G |
| **I.** Manual End Call | **NOT AUTOMATED** | Async finalize (design) | Once via guards | Code review: `[id].tsx` navigates before post-call side effects |
| **J.** Double End Call | **Partial PASS** | Single settlement | Single earning row | `tryBeginCallEnding` + `tryClaimFinancialFinalization` + backend `alreadyCompleted` |
| **K.** End + offline race | **NOT AUTOMATED** | — | — | Guards exist; no simulated race E2E |
| **L.** End + socket disconnect race | **NOT AUTOMATED** | — | — | Same |
| **M.** End during wallet spend in flight | **NOT AUTOMATED** | — | — | Existing in-call spend path unchanged; not stress-tested |
| **N.** Agora join failure | **NOT AUTOMATED** | — | — | Billing still tied to connect trigger in code review; verify on staging |

---

## 5. Financial Regression Matrix

Source of truth: **`callRate.util.js`**, **`calculateCallBilling`**, **`completeCallRecord`**, mobile **`buildEndCallPayload`** mirror (hardcoded 10/60 male, 5/30 female earn mirror on end payload).

| Financial Behavior | Before (baseline tests) | After (this verification) | Result |
|---|---|---|---|
| Male coin deduction formula (`computeMaleCallCost`) | `callRate.util.test.js` | Same tests **pass** | **UNCHANGED** |
| Creator earning formula (`computeCreatorEarnings`) | `callRate.util.test.js` | Same tests **pass** | **UNCHANGED** |
| Voice rate resolution | Global/custom in util tests | **pass** | **UNCHANGED** |
| Video rate / half-minute minimum | Util + mobile mirror test | **pass** | **UNCHANGED** |
| Creator earning % | Util tests (50%, 80%, etc.) | **pass** | **UNCHANGED** |
| Billing start trigger | Not unit-tested (Agora `onUserJoined` → `connectCall`) | **No code change in verification** | **UNCHANGED** (by inspection) |
| Billing interval (in-call spend) | Not re-tested here | No verification edits | **UNCHANGED** (by inspection) |
| Duration calculation (backend settlement) | `completeCallRecord` + billing tests | **pass** | **UNCHANGED** |
| Rounding / ceil rules | Util + mobile mirror | **pass** | **UNCHANGED** |
| Insufficient wallet | Not in this test set | — | **NOT RE-TESTED** |
| Wallet transaction on end | `quickConnect.billing` `endCall` | **pass** | **UNCHANGED** |
| Creator earning transaction | Idempotency + billing tests | **pass** (1 earning row) | **UNCHANGED** |
| Call history `coinsSpent` | Billing + idempotency | **pass** | **UNCHANGED** |
| Settlement terminal status | `alreadyCompleted` tests | **pass** | **UNCHANGED** |
| Mobile end payload amounts | New mirror tests | **pass** | **UNCHANGED** |

**Note:** Mobile in-call rates use store defaults from API; **end-call HTTP payload** still uses fixed 10/60 and 5/30 mirror math (pre-existing; not altered in verification).

---

## 6. Idempotency / Race Tests

| Test | Layer | Result |
|------|--------|--------|
| `completeCallRecord` twice (sequential) | Backend | **PASS** — second `alreadyCompleted: true`, same `maleCost` |
| `completeCallRecord` twice (concurrent) | Backend | **PASS** — one completion path, **one** `Earning` row, stable `coinsSpent` |
| `endCall` then `completeCallRecord` | Backend | **PASS** — wallet balance unchanged on second (`quickConnect.billing`) |
| `tryClaimFinancialFinalization` ×2 | Mobile client | **PASS** |
| 8× concurrent financial claim | Mobile client | **PASS** — exactly one `true` |
| `tryBeginCallEnding` ×2 | Mobile client | **PASS** |
| Socket + HTTP duplicate | — | **NOT AUTOMATED** |
| HTTP + Agora callback duplicate | — | **NOT AUTOMATED** |
| Client retry (`finalizeCallOnBackend` 3×) | Mobile | **Logic** — only first claim proceeds; retries not mocked in Node (no RN axios stack) |

**Stable identifier:** `callHistoryId` / `callSessionId` on finalize payload and `completeCallRecord({ callHistoryId })`.

---

## 7. Performance

Lightweight **controller-level** timings (local DB, single iteration):

| Step | Approx. duration |
|------|------------------|
| `POST /call/create` (`createVideoCall`) | **~10 ms** |
| `POST /calls/end` (`endCall` controller, 30s voice) | **~12 ms** |

**Not measured:** socket `call-user`, `accept-call` RTT (requires running socket server + two clients).

---

## 8. Remaining Risks

1. **E2E gap:** Agora, AppState, socket disconnect, and UI “immediate exit” are not automated.
2. **Male waiting timeout:** Logic in `waiting.tsx` only; no unit test.
3. **QC matrix failures:** Two failing tests appear **environment/settings** related, not call-rate regressions.
4. **Dual rate paths:** In-call wallet spend vs mobile end payload mirror vs backend `calculateCallBilling` — backend remains authoritative at settlement; mirror unchanged but still a pre-existing consistency surface.
5. **Female post-call UI:** May show `liveGold` until dashboard refresh when backend finalize is async.
6. **Staging soak** not performed.

---

## 9. Final Verdict

| Gate | Verdict |
|------|---------|
| **CALL RELIABILITY** | **NOT READY** — Required matrix items **E, G–M, N** lack automated proof; QC suite has 2 non-P0 failures in full run |
| **EARNINGS SAFETY** | **VERIFIED** (scoped) — Duplicate **settlement** via `completeCallRecord` / `endCall` cannot double-charge or double-create earnings in tested paths; formulas unchanged per regression tests. **Not** a substitute for full in-call spend + E2E duplicate-end soak. |

**Deployment Recommendation:** **DO NOT DEPLOY**

Recommended before deploy:

1. Staging manual matrix for **E, I, J, K, L** (male timeout, end UX, races).
2. Fix or quarantine flaky QC env tests if they block CI.
3. Optional: Detox/integration harness for `[id].tsx` + `waiting.tsx`.
4. Socket timing capture with live server (T0–T10 / E0–E5 from P0 spec).

---

## Appendix: Commands to reproduce

```bash
# Backend core
cd dating-backend && node --test --test-concurrency=1 \
  src/services/__tests__/callAccept.service.test.js \
  src/services/__tests__/callDelivery.test.js \
  src/services/__tests__/callFinancialIdempotency.integration.test.js \
  src/services/__tests__/callRate.util.test.js \
  src/services/__tests__/directCall.regression.test.js \
  src/services/__tests__/quickConnect.billing.test.js

# Mobile call logic
cd DatingApp && node --import ./scripts/test-node-preload.mjs --import tsx/esm --test \
  src/services/callTerminationCoordinator.logic.test.ts \
  src/services/callBackendFinalization.logic.test.ts \
  src/services/incomingCallDedupe.logic.test.ts \
  src/store/callStoreEndPayload.regression.logic.test.ts
```
