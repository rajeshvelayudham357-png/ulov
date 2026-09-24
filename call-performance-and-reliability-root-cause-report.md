# Call performance and reliability — root-cause report (read-only)

**Date:** 2026-09-24  
**Scope:** 1-to-1 direct voice/video calls (not Voice Rooms / Battles).  
**Repos:** `DatingApp` (mobile), `dating-backend` (API + Socket.IO).  
**Constraints:** No code, config, deploy, or production changes performed for this report.

---

## 1. Executive summary

User reports (**slow connect**, **random disconnect**, **End Call unresponsive**) match **multiple independent mechanisms** in the current implementation:

1. **Connection is gated on socket + navigation, not Agora alone.** The male stays on `/call/waiting` until `call-accepted`. Only then do both parties mount `/call/[id]`, run **permissions + new Agora engine init + `joinChannel`**. There is **no male-side ring timeout** on the waiting screen; a lost `call-accepted` can stall indefinitely.

2. **`call-user` socket handling is DB-heavy before `incoming-call`.** Server awaits `User.findByPk`, busy check, `upsertLiveCall`, then `routeIncomingCallToCreator` (several delivery-log inserts + **push**). Under **shared Sequelize pool contention** (max 20, documented app-wide), this can delay signaling.

3. **Direct calls: female `accept-call` has no ACK wait** (unlike Quick Connect). Female navigates to the call screen **immediately** after emitting `accept-call`; male navigates only when **`call-accepted`** arrives. Accept handler can **`return` early** (e.g. `findActiveCallForReceiver`) **without emitting** `call-accepted` — asymmetric failure mode.

4. **“Connected” / billing** use **`onUserJoined`**, not Agora connection state alone — correct for billing start, but UI can show “waiting for video” while local join succeeded.

5. **Random disconnects** have several **code-proven triggers:** `onUserOffline` → `finishCall`; insufficient wallet → `leaveChannel` + `finishCall`; female video **AppState background** → `finishCall`; face-detection timeout; cleanup `useEffect` **`leaveChannel`/`release` on unmount**.

6. **End Call hangs** are plausible: `finishCall` is **`async`**, sets **`endingRef`**, then **`await endCallStore()`** which **`await`s `POST /calls/end`** (15s axios timeout) **before** store reset; **no immediate UI teardown**; duplicate presses blocked; errors still attempt navigation in `catch`.

7. **Stale socket routing:** `onlineUsers` is **last `register-user` wins**; wrong socket → no `call-accepted` / no `incoming-call`.

**Do not treat Male Last Login SQL fixes as sufficient** for call reliability; calls depend on **socket + sequential Agora setup + wallet spend API + DB pool**.

---

## 2. Current call architecture

| Layer | Role |
|-------|------|
| Mobile | `createVideoCall` → `socket.emit("call-user")` → `/call/waiting` → `call-accepted` → `/call/[id]` → Agora |
| HTTP | `POST /api/call/create` — tokens + `CallHistory` row |
| HTTP | `POST /api/calls/end` — `saveCallHistory` → `completeCallRecord` |
| HTTP | `POST /api/wallet/spend` — per-minute / video-tier charges while connected (male) |
| Socket | `server.js` — `call-user`, `accept-call`, `reject-call`, `missed-call`, `end-call`, `cancel-call` |
| Delivery | `callDelivery.service.js` — logging + `incoming-call` + push |
| Agora | Tokens in create; **new engine per call screen mount** |

---

## 3. Exact call sequence (direct 1-to-1, from code)

```mermaid
sequenceDiagram
  participant M as Male app
  participant API as POST /api/call/create
  participant S as Socket.IO server
  participant F as Female app
  participant A as Agora RTC

  M->>M: ensureEnoughCoins (client)
  M->>API: createVideoCall(receiverId, callerId, type)
  API->>API: block/busy/offline checks, CallHistory live, 2x token
  API-->>M: channelName, callId, caller/receiver tokens, appId
  M->>S: register-user (if needed)
  M->>S: call-user(payload incl channel, tokens, callId)
  M->>M: startCall(store), router.push /call/waiting
  S->>S: User.findByPk, isReceiverBusy, upsertLiveCall
  S->>S: routeIncomingCallToCreator (logs + push)
  S->>F: incoming-call
  F->>F: processIncomingCallDelivery → overlay / notification
  F->>F: User accepts → accept-call
  Note over F: Direct: no ACK wait; router.replace /call/[id]
  S->>S: accept handler DB upsert accepted
  S->>M: call-accepted
  M->>M: waiting: router.replace /call/[id]
  par Both sides
    M->>A: initializeAgora, joinChannel(caller token)
    F->>A: initializeAgora, joinChannel(receiver token)
  end
  A-->>M: onUserJoined → markCallConnected, connectCallStore, billing timer
  A-->>F: onUserJoined → markCallConnected
  loop Male billing
    M->>API: POST /wallet/spend (on billingSeconds ticks)
  end
  M->>M: End → finishCall → leaveChannel, POST /calls/end, navigate
  M->>S: end-call (zero-duration path only in some branches)
```

**Note:** `POST /call/create` does **not** emit socket events; signaling is **always** client-driven after HTTP returns.

---

## 4. Slow connection analysis

### 4.1 Stage ranking (evidence-based)

| Stage | Code location | Can delay connect? | Evidence |
|-------|---------------|-------------------|----------|
| **A. POST /call/create** | `call.controller.js` | **Yes** | Sequential: block, busy, receiver row, find/create history, **2× `generateAgoraToken`**, `getAgoraAppId`. No wallet TX on create. |
| **B. Socket `call-user`** | `server.js` ~509–633 | **Yes** | Async handler: DB + **`routeIncomingCallToCreator`** (multiple inserts + **`notifyIncomingCall`**) before/at emit. |
| **C. Incoming UI** | `incomingCallGate.service.ts`, overlay | **Yes (foreground)** | Overlay + ringtone; background → notification path (user must open app). |
| **D. User accept** | Human | **Yes** | Female 45s timer (`INCOMING_CALL_TIMEOUT_SECONDS`) then `missed-call`. |
| **E. Token** | Already from create | **Usually no** on accept | Accept navigates with params from payload; **no second token HTTP** on direct accept. |
| **F. Agora init** | `call/[id].tsx` `initializeAgora` | **Yes** | Permissions (Android), **new `createAgoraRtcEngine()`**, enable AV, register handlers, then join. |
| **G. joinChannel** | `call/[id].tsx` | **Yes** | Network/SDK; **connected billing waits `onUserJoined`**. |
| **H. Pool / DB** | Shared Sequelize | **Yes (indirect)** | Same pool as admin; can slow **create**, **call-user**, **accept-call**, **wallet/spend**. |
| **I. App lifecycle** | Female video background | **Terminates**, not slow | AppState → `finishCall`. |
| **J. Race: accept without ACK** | `IncomingCallView.tsx` ~643–648 | **Yes** | Female enters call screen while server may still reject accept; male still on waiting until `call-accepted`. |
| **K. Lost `call-accepted`** | Stale `onlineUsers` | **Yes (indefinite)** | Male **no timeout** on `waiting.tsx` for direct calls. |

### 4.2 Timestamps (T0–T11) — what exists today

| Marker | Exists in code? | Where |
|--------|-----------------|--------|
| T0 Press call | **No** structured log | — |
| T1–T2 POST create | **No** client/server span | axios only |
| T3 `call-user` emit | **No** | After await create |
| T4 `incoming-call` | **Partial** | `call_delivery_events` (`SOCKET_DELIVERED`) |
| T5 Accept | **Partial** | Delivery log `ACCEPTED` |
| T6–T7 Token | **N/A** on accept (preissued) | create response |
| T8 joinChannel | **Console** | `"AGORA JOINED"` |
| T9 Agora CONNECTED state | **Not used** for UI connect | No `onConnectionStateChanged` in call screen |
| T10 remote joined | **Yes** | `console.log("Remote joined")`, `markCallConnected` |
| T11 Billing | **Yes** | `connectCallStore()` sets `startTime`; wallet `useEffect` on `billingSeconds` |

**End call (E0–E7):** only ad-hoc `console.log` (`END CALL ERROR`, etc.); **no unified trace**.

### 4.3 Recommended instrumentation (later — not implemented)

- Client: single `callTraceId` (use `callId`) + monotonic marks at T0,T2,T3,T8,T10,E0,E3,E5,E7 → batch to `/call/delivery-event` or lightweight metrics endpoint.
- Server: span around `call-user` handler (DB vs push vs emit latency).
- Agora: log `onConnectionStateChanged` + join error codes alongside `onUserJoined`.

---

## 5. Random disconnect analysis

### Termination matrix (selected triggers)

| Trigger | Agora | Socket | Backend | Billing / wallet | UI |
|---------|-------|--------|---------|------------------|-----|
| **`onUserOffline`** | via `finishCall` leave/release | — | `POST /calls/end` if connected | stop timer | navigate |
| **Insufficient wallet** | leave + release | — | `finishCall` → `/calls/end` | spend failed | Alert + end |
| **Female video background** | `finishCall` | — | as above | — | navigate |
| **Face timeout** | `finishCall` | — | as above | — | Alert |
| **Incoming 45s timeout** | — | `missed-call` | `updateActiveCallStatus` missed | — | female leaves; male `call-missed` → back |
| **Unmount cleanup** | `leaveChannel`+`release` in useEffect cleanup | — | may race with `finishCall` | — | — |
| **Socket disconnect** | — | — | female may stay “online” in DB | — | — |

**Idempotency:** `finishCall` guarded by **`endingRef`**; `endCallStore` by **`endingInProgress`**. **Not fully idempotent** if first path fails mid-flight: `endingRef` stays true, second End press ignored.

**Dual cleanup:** `onUserOffline` and manual End can race; first wins via `endingRef`.

---

## 6. End Call failure analysis

**Path:** `CallControls` → `onEnd={finishCall}` (`call/[id].tsx` ~1844).

```text
finishCall:
  if endingRef → return
  endingRef = true
  leaveChannel + release
  if connected → await endCallStore({ syncBackend, duration })  // awaits POST /calls/end, 15s timeout
  else → endCallStore + socket end-call (zero duration branch)
  syncAvailability("online")
  female restore + delayed fetchDashboard
  fetchWallet (male)
  router.replace rating or navigateAfterCallEnd
```

**Problems (code evidence):**

1. **No immediate navigation or loading state on button** — UI waits on Agora leave + HTTP.
2. **`endCallStore` awaits API before clearing Zustand** — 15s block on slow pool/network.
3. **`endingInProgress` early return** in store if reentered — second tap noop.
4. **`catch` in `finishCall` still navigates** — good; but **`endingRef` never reset** on success (usually unmounts).
5. **Zero-duration branch** emits socket `end-call` **and** may call `endCallStore` — backend socket vs HTTP both touch `completeCallRecord` / status (possible double-finalize mitigated by `alreadyCompleted` in service).

**User expectation gap:** Button **does** depend on network for backend sync **before** store cleared and navigation completed.

---

## 7. Socket analysis

| Event | Sender | Receiver | Server handler | DB / work | ACK |
|-------|--------|----------|----------------|-----------|-----|
| `register-user` | Client | Server | `server.js` | in-memory map only | No |
| `call-user` | Male | Server → female | `server.js` | find user, busy, upsert live, route delivery | No |
| `incoming-call` | Server | Female | — | (already done) | No |
| `accept-call` | Female | Server → both | `server.js` | delivery log, QC logic, upsert accepted, optional early **return** | **QC only** |
| `call-accepted` | Server | Male (+ female echo) | — | — | No |
| `reject-call` | Female | Server → male | `server.js` | status rejected | No |
| `missed-call` | Female | Server → male | `server.js` | status missed | No |
| `end-call` | Client | Server | `server.js` | `completeCallRecord` or status update | No |
| `cancel-call` | Client | Server | `server.js` | cancel QC / status | No |
| `user-busy` / `user-offline` | Server | Male | from `call-user` | busy/offline checks | No |

**Stale mapping:** `onlineUsers.set(userId, socket.id)` on each `register-user` — **one device per userId**; new login steals socket; missed events if caller/female not registered before emit.

**Reconnect:** No call-state replay on socket reconnect except **`/call/pending-incoming`** recovery path (female); male waiting has **no recovery** for lost `call-accepted`.

---

## 8. Agora analysis

| Topic | Implementation |
|-------|----------------|
| Token | `agora.service.js` — `buildTokenWithUid`, expiry from settings |
| Channel | `getChannelNameForCall(liveCall.id)` at create |
| UID | Numeric `callerId` / `receiverId` |
| Engine | **`createAgoraRtcEngine()` per `/call/[id]` mount** — not singleton `engine` from `agora.ts` |
| Join | After async `initializeAgora()` in `useEffect` |
| Connected | **`onUserJoined` → `markCallConnected`**; local join sets `joined`/`connected` flags only |
| Leave | `finishCall`, wallet fail, cleanup effect |
| Listeners | Registered once per engine instance; released on unmount |
| Missing | **No `onConnectionStateChanged`**, **no token expiry handler** on call screen |

**Risks:** Cleanup effect runs `leaveChannel`/`release` when `[token, channel, uid]` changes or unmount — overlaps with active `finishCall`. Multiple mounts → multiple engines if navigation glitches.

---

## 9. Backend / DB analysis (call paths)

### POST `/api/call/create` (`createVideoCall`)

Approximate sequential DB/API work:

1. `areUsersBlocked`
2. `isReceiverBusyWithOther` → `CallHistory` query
3. `User.findByPk`
4. `findActiveCallByPair` or `CallHistory.create`
5. `generateAgoraToken` ×2 (CPU + settings read)
6. `getAgoraAppId`

**No transaction wrapping entire handler.** Async engagement: `recordCallAttemptedFromNewCallHistory`.

### Socket `call-user`

Additional: `upsertLiveCall` (find + update/create), delivery table inserts, push HTTP.

### POST `/api/calls/end` (`saveCallHistory`)

`completeCallRecord` — find history, billing calc, history update, earning upsert; **wallet balance not updated here** (male charges via **`/wallet/spend`** during call).

### Pool contention

**Yes — calls compete for the same Sequelize pool (max 20)** with admin analytics, socket handlers, engagement async writes, and background workers. Symptom: **slow create**, slow accept handler, slow **`/calls/end`**, slow **wallet spend** → male billing effect stalls or ends call.

---

## 10. Billing analysis

| Question | Answer (code) |
|----------|----------------|
| When does billing start? | After **`onUserJoined`** → `callConnected` → `useCallTimer` → male `useEffect` on `billingSeconds` |
| Blocks UI? | **`chargeWallet` async** inside effect; failure triggers **end call** |
| Duplicate timers? | Effect re-runs on `billingSeconds` change — guarded by `lastChargedMinute` / `chargedThroughRef` |
| End-call interaction | `finishCall` passes `durationSeconds` to `endCallStore`; store **also computes coins locally** for history display |
| Backend finalization | `/calls/end` → `completeCallRecord` (records duration/coins on history) |

Billing **can disconnect** (insufficient balance) and **can extend End Call** (await spend + await `/calls/end`), but **does not block Agora join** directly.

---

## 11. App lifecycle analysis

| Scenario | Behavior |
|----------|----------|
| Female video background/inactive | **`finishCall()`** (`call/[id].tsx` AppState listener) |
| Male background on waiting | Not special-cased |
| Incoming call background | Notification + stash; **no auto full-screen** without user action |
| Socket reconnect | Re-`register-user` required; call signaling may be lost |
| Permission dialog (Android) | Female video ignores brief background during permission (`isRequestingPermissionsRef`) |

---

## 12. Race conditions

1. **Female `proceedToCallAfterAccept` before server emits `call-accepted`** — male still waiting; female may reach Agora first.
2. **`accept-call` early `return`** when `findActiveCallForReceiver` finds other call — **no `call-accepted`**, female already navigated (direct mode).
3. **`onUserOffline` vs manual End** — mitigated by `endingRef`.
4. **Socket `end-call` vs HTTP `/calls/end`** — both can finalize; service has `alreadyCompleted`.
5. **Duplicate `CallHistory` create** — create on HTTP + possible create on `upsertLiveCall` if pair/status mismatch (edge case).

---

## 13. Error handling

- Many **`console.log`** only (`CALL ERROR`, `END CALL API ERROR`, `AGORA ERROR`).
- **`validateIncomingCallStillActive` errors → returns `true`** (fail-open) — may show stale incoming UI.
- Incoming delivery **`catch` on report** → warn only.
- **`finishCall` catch** navigates away — user may think End failed if API errored but screen closed.

---

## 14. Root cause matrix

| User symptom | Possible cause | Evidence | Confidence | File / area |
|--------------|----------------|----------|------------|-------------|
| Slow connect | Male waits `call-accepted` + full Agora init on both sides | `waiting.tsx` → `call/[id].tsx` setup | **High** | `waiting.tsx` ~321–333, `call/[id].tsx` ~788–805 |
| Slow connect | `call-user` DB + push before emit | `routeIncomingCallToCreator` awaits push | **High** | `callDelivery.service.js`, `server.js` |
| Slow connect | POST `/call/create` sequential DB/tokens | controller flow | **Medium** | `call.controller.js` |
| Slow connect | Sequelize pool wait | Shared pool max 20 | **Medium** | `database.js` + app-wide report |
| Slow connect | Female background / notification delay | `processIncomingCallDelivery` | **Medium** | `incomingCallGate.service.ts` |
| Random disconnect | `onUserOffline` → `finishCall` | handler | **High** | `call/[id].tsx` ~753–759 |
| Random disconnect | Wallet spend fail | leave + finishCall | **High** | `call/[id].tsx` ~978–992 |
| Random disconnect | Female video AppState | finishCall | **High** | `call/[id].tsx` ~828–858 |
| Random disconnect | Face gate timeout | finishCall | **Medium** | `handleFaceTimeout` |
| Random disconnect | Unmount cleanup leave/release | useEffect return | **Medium** | `call/[id].tsx` ~807–810 |
| End Call stuck | Await `POST /calls/end` 15s | `endCallStore` → `endCallApi` | **High** | `callStore.ts`, `api/client.ts` timeout |
| End Call stuck | `endingRef` / `endingInProgress` | double-end blocked | **Medium** | `call/[id].tsx`, `callStore.ts` |
| End Call stuck | Agora leave blocking | synchronous call before API | **Low–Medium** | `finishCall` order |
| Stuck on ringing (male) | No waiting timeout | only `call-missed` from female timer | **High** | `waiting.tsx` vs `IncomingCallView` timer |
| Never rings female | Socket not registered / wrong `onlineUsers` | skip emit path | **High** | `server.js`, `callDelivery.service.js` |

---

## 15. Recommended fixes (do not implement in this task)

### P0 — explains production symptoms

| # | File(s) | Problem | Proposed change | Risk | Impact |
|---|---------|---------|-----------------|------|--------|
| 1 | `waiting.tsx` | Male no timeout if `call-accepted` lost | Male ring timeout + cancel + `cancel-call` / status cleanup | Medium | Stops infinite “connecting” |
| 2 | `IncomingCallView.tsx` | Direct accept without ACK | Wait for `accept-call` ack like QC; only then navigate | Low | Fewer male stuck / female-alone in channel |
| 3 | `server.js` `accept-call` | Silent early return | Always emit error to female + never leave male hanging | Low | Signaling consistency |
| 4 | `call/[id].tsx` `finishCall` | UI blocked on API | Optimistic UI: navigate/disconnect immediately; end API async | Medium | End Call responsiveness |
| 5 | `callDelivery.service.js` / `call-user` | Push+logs block routing | Emit `incoming-call` first; push/logs async | Medium | Faster ring |
| 6 | Infra / pool | Pool saturation | Isolate call pool or cap admin concurrency | Medium | Faster create/end/spend |

### P1 — reliability

| # | File | Problem | Change |
|---|------|---------|--------|
| 7 | `call/[id].tsx` | Cleanup vs finishCall race | Single teardown owner |
| 8 | Socket layer | Stale `onlineUsers` | Heartbeat + multi-tab policy or user→Set(sockets) |
| 9 | `incomingCallGate.service.ts` | fail-open status check | fail-closed or short cache |
| 10 | Male waiting | Socket reconnect | Re-emit `call-user` or poll call status |

### P2 — observability

| # | Change |
|---|--------|
| 11 | T0–T11 / E0–E7 trace via `callId` |
| 12 | Server timing logs for `call-user` / `accept-call` handler phases |

### P3 — architectural

| # | Change |
|---|--------|
| 13 | Server-authoritative call state machine + ACK’d transitions |
| 14 | Single Agora service lifecycle per app session |
| 15 | Unify billing: either incremental spend OR end settlement, with reconciliation |

---

## 16. Instrumentation plan

1. Add **`callTraceId = callId`** and client timeline events (see §4.2).  
2. Log server phase durations in **`call-user`** and **`accept-call`** (read-only log tail first on prod).  
3. Correlate with **`call_delivery_events`** already inserted by `callDelivery.service.js`.  
4. Monitor **`Max_used_connections`**, **`Threads_running`**, PM2 during repro.

---

## 17. Test plan (post-fix)

1. Direct call happy path — measure T0→T10 on staging.  
2. Female accept while male offline socket — male timeout behavior.  
3. Accept during DB slowness — ACK gating.  
4. Double End Call — idempotent teardown.  
5. Remote offline during join — no duplicate billing.  
6. Female video home button — intentional terminate still works.  
7. Wallet empty mid-call — clean end + UI.  
8. Socket disconnect mid-waiting — recovery or cancel.

---

## 18. Production rollout plan

1. Ship **P0 signaling + End Call UX** in one backend+mobile release (version lockstep).  
2. Deploy backend first only if backward compatible (ACK optional).  
3. Monitor `call_delivery_events`, call completion rate, average create latency, 409 busy rate.  
4. Roll out pool/isolation separately if infra change.

---

## Appendix: Key file index

| Area | Path |
|------|------|
| Create API | `dating-backend/src/controllers/call.controller.js` |
| Socket handlers | `dating-backend/src/server.js` |
| Delivery | `dating-backend/src/services/callDelivery.service.js` |
| End API | `dating-backend/src/controllers/callHistoryController.js` |
| Call state | `dating-backend/src/services/callState.service.js` |
| Mobile create | `DatingApp/src/components/PremiumUserCard.tsx` (pattern shared) |
| Waiting | `DatingApp/app/call/waiting.tsx` |
| Call UI + Agora | `DatingApp/app/call/[id].tsx` |
| Incoming | `DatingApp/src/components/female/IncomingCallView.tsx` |
| Store / end | `DatingApp/src/store/callStore.ts` |
| Socket incoming | `DatingApp/app/_layout.tsx` |

---

*Read-only audit. No production or repository behavior was changed for this document.*
