# Call Incoming Delivery Diagnostic

**Purpose:** Record evidence from **one** controlled direct call (foreground female).  
**Status:** Awaiting test execution — instrumentation added, no delivery/billing logic changed.

---

## Environment

| Field | Male device | Female device |
|-------|-------------|---------------|
| API host | _(from `CALL_ENV_DIAGNOSTIC`)_ | |
| Socket host | | |
| Build (`development` / `production`) | | |

**Match check:** Male API host == Female API host == expected staging: ☐ Yes ☐ No  
**Match check:** Male Socket host == Female Socket host == expected staging: ☐ Yes ☐ No

---

## Test accounts

| Role | User ID |
|------|---------|
| Male | |
| Female | |

---

## Call

| Field | Value |
|-------|--------|
| callId | |
| callSessionId | |
| callHistoryId | |
| Test date/time (UTC) | |

---

## Backend trace

Paste `CALL_DELIVERY_TRACE` JSON lines in order:

| Stage | Present? | Notes |
|-------|----------|--------|
| CALL_USER_RECEIVED | ☐ | |
| RECEIVER_ONLINE_CHECK | ☐ | `receiverOnline`: |
| RECEIVER_OFFLINE | ☐ | |
| RECEIVER_BUSY_CHECK | ☐ | `busy`: |
| LIVE_CALL_UPSERT_START | ☐ | |
| LIVE_CALL_UPSERT_SUCCESS | ☐ | |
| LIVE_CALL_UPSERT_ERROR | ☐ | |
| RECEIVER_SOCKET_LOOKUP | ☐ | `socketFound`: |
| SOCKET_EMIT_START | ☐ | |
| SOCKET_EMIT_COMPLETE | ☐ | |
| SOCKET_SKIPPED_NO_CONNECTION | ☐ | |

```
(paste raw server logs here)
```

Legacy lines still present: `USER ONLINE:`, `RECEIVER SOCKET:`, `CALL REQUEST:`

---

## Female trace

Paste `FEMALE_CALL_TRACE` and `CALL_ENV_DIAGNOSTIC` lines:

| Stage | Present? | Notes |
|-------|----------|--------|
| SOCKET_CONNECTED | ☐ | |
| SOCKET_REGISTERED | ☐ | |
| INCOMING_CALL_RECEIVED | ☐ | |
| INCOMING_CALL_DEDUPE_CHECK | ☐ | |
| INCOMING_CALL_DEDUPE_REJECTED | ☐ | |
| INCOMING_CALL_GATE_CHECK | ☐ | |
| INCOMING_CALL_GATE_REJECTED | ☐ | |
| INCOMING_CALL_STATE_UPDATE | ☐ | |
| INCOMING_CALL_UI_SHOW | ☐ | `presentation`: |

```
(paste Metro / adb logcat here)
```

---

## Delivery events

Query existing table (read-only):

```sql
SELECT event, metadata, createdAt
FROM call_delivery_events
WHERE callId = '<callId>'
ORDER BY id ASC;
```

```
(paste rows)
```

---

## DB verification

```bash
cd dating-backend
node scripts/staging-call-qa-verify.mjs <callHistoryId>
```

```json
(paste full JSON)
```

---

## ROOT CAUSE CLASSIFICATION

Select **one**:

- [ ] **A.** Backend receiver marked offline  
- [ ] **B.** Receiver considered busy  
- [ ] **C.** Live-call upsert failure  
- [ ] **D.** No receiver socket  
- [ ] **E.** Socket emitted but female listener did not receive  
- [ ] **F.** Female listener received but dedupe rejected  
- [ ] **G.** Female listener received but gate rejected  
- [ ] **H.** Female state updated but UI failed  
- [ ] **I.** Environment mismatch  
- [ ] **J.** Still inconclusive  

**Evidence summary:**

_(fill after one controlled call)_

---

## REQUIRED NEXT FIX

_(Describe smallest fix only — do not implement until classified.)_

---

## FINANCIAL IMPACT

| Area | Changed |
|------|---------|
| Billing | **NO** |
| Wallet | **NO** |
| Creator earnings | **NO** |
| Settlement | **NO** |

---

## Test procedure (single call)

1. Deploy/restart backend with new traces; rebuild female + male apps.  
2. Female **foreground**; confirm `SOCKET_CONNECTED` + `SOCKET_REGISTERED` + server `USER ONLINE`.  
3. Male calls female **once** (direct voice or video).  
4. Do **not** retry.  
5. Collect logs + run verifier + SQL above.  
6. Fill this report and classification.

**Instrumentation files (temporary):**

- Backend: `src/utils/callDeliveryTrace.util.js`, `server.js` (`call-user`), `callDelivery.service.js`  
- Mobile: `src/utils/femaleCallTrace.ts`, `src/utils/callEnvDiagnostic.ts`, `_layout.tsx`, `incomingCallGate.service.ts`, `notification.service.ts`, `PremiumUserCard.tsx`
