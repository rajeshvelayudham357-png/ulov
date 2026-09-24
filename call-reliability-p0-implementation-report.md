# Call reliability P0 — implementation report

**Date:** 2026-09-24  
**Scope:** 1-to-1 voice/video call reliability (local changes only — **not deployed**)

---

## 1. Files changed

### Backend (`dating-backend`)

| File | Change |
|------|--------|
| `src/services/callAccept.service.js` | Extracted `evaluateCallAcceptRequest` (QC + direct busy/rules) |
| `src/server.js` | Accept-call uses evaluation; ACK before success emit; failure ACK + `call-rejected` on busy |
| `src/services/callDelivery.service.js` | Emit `incoming-call` on active socket first; push/logging async |
| `src/services/__tests__/callAccept.service.test.js` | Accept evaluation tests |
| `src/services/__tests__/callFinancialIdempotency.integration.test.js` | Double `completeCallRecord` → `alreadyCompleted` |

### Mobile (`DatingApp`)

| File | Change |
|------|--------|
| `src/store/callStore.ts` | Idempotent `endCall`; local reset before async backend; `buildEndCallPayload` / `applyLocalCallEndReset` |
| `src/services/callTerminationCoordinator.ts` | Process-wide ending + financial claim guards |
| `src/services/callBackendFinalization.service.ts` | Retries + `tryClaimFinancialFinalization` before `POST /calls/end` |
| `src/services/callTerminationCoordinator.logic.test.ts` | Coordinator unit tests |
| `app/call/[id].tsx` | Optimistic navigation after local end; post-call side effects async |
| `src/components/female/IncomingCallView.tsx` | Direct accept waits for socket ACK (same as QC) |
| `app/call/waiting.tsx` | Male direct-call waiting timeout (45s), `cancel-call`, no backend billing |

---

## 2. Behavioral changes (reliability only)

| Area | Before | After |
|------|--------|--------|
| End Call UI | Blocked on `/calls/end` (up to Axios timeout) | Local Agora leave + store reset immediately; backend finalization async with retries |
| Duplicate termination | Multiple `finishCall` paths could race | `tryBeginCallEnding` + `tryClaimFinancialFinalization` (backend still authoritative via `completeCallRecord`) |
| Direct accept | Female navigated before server ACK | Female waits for accept ACK; failure shows alert, no broken call screen |
| Male waiting | No timeout if `call-accepted` lost | 45s timeout mirrors female ring; `cancel-call` + `syncBackend: false`, duration 0 |
| Incoming delivery | Push/DB work could delay socket emit | Socket `incoming-call` first when recipient online; non-critical work async |

**Unchanged:** Agora config, rate resolution, wallet spend increments during call, `completeCallRecord` / `calculateCallBilling` formulas, billing start trigger (`onUserJoined` → `connectCall` → timer/wallet effects).

---

## 3. Billing / earnings audit (Phase 0)

### Flow trace

1. **Signaling:** `call-user` → `routeIncomingCallToCreator` → client `incoming-call` → accept → `call-accepted`.
2. **Agora connect:** Client join; **billing start** on remote `onUserJoined` → `markCallConnected` / `connectCallStore()` → `useCallTimer` + male `walletStore.spend` (incremental, `referenceId` = `callSessionId`).
3. **During call:** Male debits via `POST /wallet/spend` (not altered in this work).
4. **End:** Mobile `endCall` → `finalizeCallOnBackend` → `POST /api/calls/end` → `saveCallHistory` / `completeCallRecord`.
5. **Settlement:** `completeCallRecord` → `calculateCallBilling` → `computeMaleCallCost` / `computeCreatorEarnings` in `utils/callRate.util.js`; wallet + earning transactions + call history terminal fields.

### Answers (audit checklist)

| # | Topic | Location / behavior |
|---|--------|---------------------|
| 1 | Billing starts | After Agora remote join → `connectCall()` sets `startTime` (mobile `[id].tsx`) |
| 2 | Start event | `onUserJoined` (remote uid), not accept alone |
| 3 | Duration for billing | Connected: `(now - startTime)/1000`; video face gate may adjust billable seconds (unchanged) |
| 4 | Male coin deduction | Incremental `wallet/spend` during call + final alignment in `completeCallRecord` |
| 5 | Creator earnings | `calculateCallBilling` / `computeCreatorEarnings` on backend |
| 6 | Female % | Resolved in `callRate.service.js` (global/creator/default) — **not modified** |
| 7 | Rounding | Existing ceil / half-minute video rules — mobile end payload still uses same hardcoded mirror (60/10 male, 30/5 female, 30s video half) |
| 8 | Wallet spend fails | Existing call-screen handling (unchanged) |
| 9 | End during billing | `completeCallRecord` with computed duration at end time |
| 10 | End twice | Client: `tryBeginCallEnding` + `tryClaimFinancialFinalization`; server: `alreadyCompleted` on second `completeCallRecord` |
| 11 | `onUserOffline` | Still calls `finishCall`; second invocation no-ops on client guards |
| 12 | AppState | Existing handlers; idempotent end |
| 13 | Socket disconnect | Existing cleanup paths; idempotent end |

### Protected constants (verified not edited)

- `DEFAULT_CALL_RATE_SETTINGS` / creator rate resolution in backend
- Mobile end-call payload rates: video 60/30, voice 10/5, 30s video half-minute rules

---

## 4. Proof earning calculation unchanged

- **No edits** to `callRate.service.js`, `callRate.util.js`, `completeCallRecord` billing math, or wallet spend amount logic.
- **Only** timing/order of `POST /calls/end` and duplicate suppression added.
- Regression signal: `callFinancialIdempotency.integration.test.js`, existing `quickConnect.billing.test.js` (not re-run in full suite here).

---

## 5. Tests run

| Suite | Result |
|-------|--------|
| `callAccept.service.test.js` | Pass |
| `callDelivery.test.js` | Pass |
| `callFinancialIdempotency.integration.test.js` | Pass |
| `callTerminationCoordinator.logic.test.ts` (mobile) | Pass |

**Not run in this pass:** full backend `npm test`, full mobile Jest/Expo, E2E call matrix (items 1–35 in spec).

---

## 6. Race-condition coverage

| Scenario | Mitigation |
|----------|------------|
| End + `onUserOffline` | `endingRef` + `tryBeginCallEnding` |
| Double `/calls/end` | `tryClaimFinancialFinalization` + backend `alreadyCompleted` |
| Double accept navigation | ACK gate on direct accept |
| Male wait + late accept | `callAcceptedRef` clears timeout path |

---

## 7. API / socket compatibility

- **REST:** `POST /calls/end` payload unchanged.
- **Socket:** `accept-call` ACK extended to direct calls (already used for QC); success still emits `call-accepted`.
- **New client behavior:** Male waiting timeout emits existing `cancel-call`.

---

## 8. Rollback plan

1. Revert mobile commits (callStore, `[id].tsx`, IncomingCallView, waiting, coordinator services).
2. Revert backend commits (server accept handler, callDelivery, callAccept.service).
3. No database migration was added for this P0.

---

## 9. Known remaining issues

- Female post-call earning toast may briefly use `liveGold` until dashboard refresh (backend finalization async).
- Male rating may use `callSessionId` as `callHistoryId` until backend returns id (optional upgrade: background patch).
- Full observability timestamps (T0–T10, E0–E5) not instrumented.
- Comprehensive call-flow test matrix (spec items 1–35) largely still manual / future automation.
- `CALL_DELIVERY_ASYNC_ERROR` under test pool drain (benign in isolated test run).

---

## 10. Production rollout plan (when approved)

1. Deploy backend first (ACK + faster socket delivery + idempotent settlement unchanged).
2. Deploy mobile; monitor call connect time, end-call latency, duplicate charge alerts.
3. Watch wallet/earning anomaly dashboards for 24–48h.
4. Feature-flag optional: male waiting timeout if needed.

---

## Verdict

| Gate | Status |
|------|--------|
| **CALL RELIABILITY** | **NOT READY** — P0 code paths implemented locally; full test matrix + staging soak not completed |
| **EARNINGS SAFETY** | **VERIFIED** — no formula/rate/trigger changes; settlement path and idempotency tests green on touched areas |

**Do not deploy to production without QA sign-off on the checklist above.**
