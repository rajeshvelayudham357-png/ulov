# Call Incoming Delivery Root Cause Audit

**Date:** 2026-09-24  
**Symptom:** Male direct voice/video call → female mobile **sometimes or never** shows incoming call UI.  
**Mode:** Read-only — **no code changes**, no deploy, no financial logic changes.

---

## 1. Current Symptom

- **Reported:** Direct call delivery failure (incoming UI absent or intermittent).
- **Scope:** Male-initiated direct calls (not Quick Connect unless same `call-user` path).
- **Not proven in this audit:** Whether failure is socket-only, push-only, client presentation, or server early-exit (requires staging/device logs + `call_delivery_events`).

---

## 2. End-to-End Call Delivery Path

| Step | Component | File / symbol |
|------|-----------|----------------|
| 1 | Male taps voice/video | `PremiumUserCard.tsx` (also `PremiumUserCardModern.tsx`, `FemaleProfileBottomSheet.tsx`, etc.) |
| 2 | `POST /api/call/create` | `call.controller.js` → `createVideoCall` |
| 3 | `CallHistory` row (live) | `createVideoCall` reuses or creates `status: "live"` |
| 4 | Male `socket.emit("call-user", …)` | Same components after HTTP success |
| 5 | Server `call-user` handler | `server.js` socket handler |
| 6 | Recipient lookup + gates | `User.findByPk`, `isReceiverBusyWithOther`, `upsertLiveCall` |
| 7 | Route delivery | `routeIncomingCallToCreator` in `callDelivery.service.js` |
| 8 | Socket emit | `io.to(socketId).emit("incoming-call", payload)` |
| 9 | Push fallback (async) | `notifyIncomingCall` inside fire-and-forget IIFE |
| 10 | Female listener | `app/_layout.tsx` → `processIncomingCallDelivery(..., "socket")` |
| 11 | Dedupe + overlay/notification | `incomingCallDedupe.logic.ts`, `incomingCallGate.service.ts` |
| 12 | UI | `IncomingCallOverlayHost` / `IncomingCallView` route |

**HTTP create does not emit sockets** — if male never emits `call-user` after create, female receives nothing.

**Male navigation:** `startCall` + `/call/waiting` — independent of female delivery.

---

## 3. Backend Socket Registration

### Implementation

```405:438:dating-backend/src/server.js
socket.on(
"register-user",
(data)=>{
const userId =
String(
data.userId
);
onlineUsers.set(
userId,
socket.id
);
```

- **Map key:** `String(userId)` — consistent with `onlineUsers.get(String(receiverId))` in `call-user` and `callDelivery.service.js` line 136.
- **Value:** Current socket.id — **last registration wins** for a given userId.
- **Disconnect:** Iterates entries, deletes userId whose stored socketId matches disconnected socket (`server.js` ~1274–1308).

### Female mobile registration (multiple paths)

| Path | When | File |
|------|------|------|
| A | Logged-in user | `_layout.tsx` → `registerSocketUser(user.id)` |
| B | On every socket `connect` | `notification.service.ts` `registerSocketUser` emits `register-user` |
| C | Female dashboard | `female/dashboard.tsx` — `socket.connect()` + `register-user` on `connect` |

**Evidence:** Registration only updates backend map when socket is **connected** and handler runs. If female socket is disconnected, reconnecting, or pointed at a **different host** than the male’s `call-user`, `onlineUsers.get(receiverId)` is **undefined**.

### ID types

- Male `call-user` payload uses `String(user.id)` for `receiverId` / `callerId` (`PremiumUserCard.tsx` ~333–337).
- Server uses `String(data.receiverId)` for map lookup — **no number/string key mismatch** in map lookup itself.

### Classification

| Finding | Confidence |
|---------|------------|
| Missing/stale `onlineUsers` entry → no socket emit | **HIGH CONFIDENCE** (code path emits only if `receiverSocket` truthy) |
| Last register wins / duplicate device | **POSSIBLE** |
| Registration before auth | **NOT SUPPORTED** — requires logged-in `user.id` on client |

---

## 4. `call-user` Handler

**Location:** `dating-backend/src/server.js` ~510–635.

### Exact sequence

1. Log `CALL REQUEST`.
2. Require `callerId` and `receiverId` — else **return** (silent, no emit to female).
3. **`User.findByPk(receiverId)`** — if missing or **`!receiverUser.online`**:
   - Emit **`user-offline`** to caller socket only.
   - **Return** — **no `incoming-call`, no push via this handler.**
4. **`isReceiverBusyWithOther(receiverId, callerId)`** — if true:
   - Emit **`user-busy`** to caller.
   - **Return** — no incoming delivery.
5. **`await upsertLiveCall(data, "live")`** — DB read/write (find or create `CallHistory`).
6. Log `RECEIVER SOCKET:` (legacy log of socket id from map **before** delivery helper).
7. **`await routeIncomingCallToCreator({ io, onlineUsers, data, creatorOnlineInDb })`**
8. On exception: log `LIVE CALL CREATE ERROR` — **no retry, no emit** (catch swallows).

### Answers to audit questions

| # | Question | Answer (from code) |
|---|----------|-------------------|
| 1 | Correct payload? | Assumes client sends channel, tokens, callId, type; not validated field-by-field before route |
| 2 | Correct recipient ID? | Uses `data.receiverId` as creator id in delivery service |
| 3 | Finds female socket? | Only inside `routeIncomingCallToCreator` via `onlineUsers.get(String(creatorId))` |
| 4 | Emits `incoming-call`? | Only if socket id present |
| 5 | Socket missing? | No socket emit; async push attempted later in delivery service |
| 6 | DB before emit? | **Yes** — `upsertLiveCall` **awaited before** `routeIncomingCallToCreator` |
| 7 | Await push before socket? | **No** (after P0 change inside `callDelivery.service.js`) |
| 8 | Exception blocks emit? | **Yes** if thrown in steps 3–5 or before emit in step 7 |
| 9 | Socket before persistence? | **No** at handler level — DB upsert first |
| 10 | `callDelivery.service.js` involved? | **Yes** — all socket emit + async push/logging |

---

## 5. `callDelivery.service.js`

**Function:** `routeIncomingCallToCreator` (`callDelivery.service.js` ~113–223).

### Current behavior (post-P0 diff)

1. Build `payload` with `serverRouted: true`.
2. **`receiverSocket = onlineUsers.get(String(creatorId))`**
3. **If `receiverSocket`:** synchronous **`io.to(receiverSocket).emit("incoming-call", payload)`** — `socketDelivered = true`.
4. **Fire-and-forget async IIFE:** delivery log inserts + **`notifyIncomingCall`** (push). Errors logged as `[CALL_DELIVERY_ASYNC_ERROR]` — **do not block step 3**.
5. Return `{ routed: true, socketDelivered, pushSent: false, … }` immediately (push result not awaited in return value).

### Compared to pre-P0 (git diff)

| Before | After |
|--------|--------|
| Multiple **`await logCallDeliveryEvent`** before emit | Logging **after** emit (async) |
| **`await notifyIncomingCall`** before return | Push in async IIFE **after** emit |
| Socket emit after logging attempts | **Socket emit first** |

### Audit conclusions

| Claim | Classification |
|-------|----------------|
| Failed push prevents socket delivery | **NOT SUPPORTED BY CODE** (post-P0) |
| DB logging prevents socket delivery | **NOT SUPPORTED BY CODE** (post-P0; async) |
| P0 change removed socket emit | **NOT SUPPORTED BY CODE** — emit still synchronous when socket exists |
| P0 could still affect delivery if `call-user` never reaches this function | **POSSIBLE** (upstream gates/exceptions) |
| `call-user` still awaits DB before calling this function | **CONFIRMED** — delay/failure point remains **before** socket-first logic |

---

## 6. Female Mobile `incoming-call` Listener

### Subscription

```686:777:DatingApp/app/_layout.tsx
useEffect(()=>{
  if(!user?.id || !isFemaleGender(user.gender)) return;
  const onIncomingCall = (data: unknown)=>{
    void processIncomingCallDelivery(asPayloadRecord(data), "socket");
  };
  socket.on("incoming-call", onIncomingCall);
  return ()=>{ socket.off("incoming-call", onIncomingCall); };
}, [user?.id, user?.gender, router]);
```

- **Global** for authenticated female users — not tied to a single screen.
- Cleanup on `user.id`, `gender`, or **`router`** change — brief unsubscribe/resubscribe **POSSIBLE** on navigation.

### Handler chain

`processIncomingCallDelivery` (`incomingCallGate.service.ts` ~109–179):

1. Requires **`useAuthStore` female user** — else **return false** (silent).
2. **`normalizeIncomingCallParams`** — requires **`callerId`** — else **return false**.
3. **`shouldPresentIncomingCall`** (socket source) — if same dedupe key within **120s**, **return false** (no UI).
4. Foreground (`AppState.active`): overlay + ringtone.
5. Background: ringtone + optional local notification (socket path).

**Not called on socket path:** `validateIncomingCallStillActive` (that runs in `handleIncomingCallPayload` / push paths with `serverRouted` — `notification.service.ts` ~300–319).

### Dedupe risk

```22:34:DatingApp/src/services/incomingCallDedupe.logic.ts
if (lastPresentedAt && now - lastPresentedAt < INCOMING_CALL_DEDUPE_TTL_MS) {
  return false;
}
```

Repeated `incoming-call` for same `callId` within 2 minutes → **no UI** — **POSSIBLE** for “sometimes” symptom if server/client retries duplicate events.

### Classification

| Finding | Confidence |
|---------|------------|
| Listener not registered (non-female / logged out) | **CONFIRMED** if auth state wrong |
| Dedupe suppresses UI | **POSSIBLE** |
| Payload missing `callerId` | **POSSIBLE** → silent drop |
| Listener only on one screen | **NOT SUPPORTED BY CODE** (_layout is global) |

---

## 7. Push Notification Path

- **Trigger:** `notifyIncomingCall` in `notificationPush.service.js` ~1793+, called **async** from `callDelivery.service.js`.
- **When socket missed:** Primary fallback for **background/killed** if FCM/Expo token valid.
- **Foreground socket delivered:** Push still attempted async; client may also get push listener in `_layout.tsx` ~560–571 (`incoming_call` type) with `skipPresentDedupe` for push source.
- **serverRouted bypass:** Push path allows notify even when DB online check would block non-routed calls (`notificationPush.service.js` ~1819–1833).

**Separate failure modes:**

| State | Primary path | If fails |
|-------|--------------|----------|
| A. Foreground | Socket → overlay | Push/local notification secondary |
| B. Background | Socket may arrive; if app suspended, overlay may not show | Push + notification listener |
| C. Killed | No socket listener | Push only |

**Cannot classify current symptom as socket vs push without device logs.**

---

## 8. Environment Configuration

**Mobile API/Socket resolution:** `DatingApp/src/constants/api.ts`

- `API_HOST` from `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_SOCKET_URL` or dev/prod constants.
- **`SOCKET_URL`** defaults to same origin as API when env unset.
- **Observed in repo (local dev constants):** `http:///192.168.0.159:3001` — **malformed scheme (`http:///` triple slash)** — **HIGH CONFIDENCE** risk for broken HTTP/socket on some builds if env vars not set.

| Mismatch pattern | Effect |
|------------------|--------|
| Male API ≠ Female API | Create succeeds on one env; signaling on another |
| Socket host ≠ API host | `register-user` on wrong server → `onlineUsers` empty on call handler host |
| Staging API + prod push project | Push never arrives |
| Different LAN IP after network change | Socket disconnected; stale registration |

**Classification:** Environment mismatch → **HIGH CONFIDENCE** as a frequent ops cause; **NOT CONFIRMED** for this incident without device config dump (no secrets).

---

## 9. Recent P0 Changes Affecting Delivery

| Area | P0 touched? | Can block `incoming-call`? |
|------|-------------|----------------------------|
| `callDelivery.service.js` socket-first | **Yes** | **Unlikely** — emit earlier than before |
| `server.js` `call-user` | **No structural change** in diff snippet | Still DB-before-route |
| `accept-call` | **Yes** | **No** — after delivery |
| `IncomingCallView` ACK | **Yes** | **No** — post-delivery |
| `callStore` / `[id].tsx` / waiting | **Yes** | **No** — post-accept / end |
| `callTerminationCoordinator` | **Yes** | **No** |

**Conclusion:** P0 delivery refactor **improves** socket timeliness **if** `routeIncomingCallToCreator` is reached. P0 **does not explain** total loss of delivery unless combined with **missing socket registration**, **server early return**, or **client dedupe/auth**.

---

## 10. Root Cause

**No single root cause CONFIRMED without runtime evidence.**

### Ranked hypotheses

| Rank | Hypothesis | Class | Mechanism |
|------|------------|-------|-----------|
| 1 | Female not in `onlineUsers` at `call-user` time | **HIGH CONFIDENCE** | Socket not connected / wrong server / not re-registered after reconnect |
| 2 | `users.online === false` in DB while UI shows online | **HIGH CONFIDENCE** | `call-user` returns early; male gets `user-offline`; no emit |
| 3 | Stuck `CallHistory` in `ACTIVE_CALL_STATUSES` | **POSSIBLE** | `isReceiverBusyWithOther` → `user-busy`; no delivery |
| 4 | `upsertLiveCall` / handler exception | **POSSIBLE** | `LIVE CALL CREATE ERROR`; no route |
| 5 | Client dedupe 120s | **POSSIBLE** | Socket event received but UI suppressed |
| 6 | Malformed / mismatched API-Socket base URL | **POSSIBLE** (env) | Connection or registration failure |
| 7 | P0 `callDelivery` regression | **NOT SUPPORTED BY CODE** | Socket emit moved earlier |

---

## 11. Evidence (file / function references)

| Conclusion | Evidence |
|------------|----------|
| Early exit if DB offline | `server.js` ~544–563 |
| Early exit if busy | `server.js` ~566–590 |
| DB before delivery | `server.js` ~593–610 |
| Socket emit conditional | `callDelivery.service.js` ~136–141 |
| Push async, non-blocking emit | `callDelivery.service.js` ~147–215 |
| Female listener | `_layout.tsx` ~686–735 |
| Client dedupe | `incomingCallDedupe.logic.ts` ~22–34 |
| Male payload | `PremiumUserCard.tsx` ~307–366 |
| ACTIVE call blocks busy | `callState.service.js` ~18–24, ~85–97 |
| API/Socket constants | `constants/api.ts` ~1–34 |

---

## 12. Minimal Fix (DO NOT IMPLEMENT — description only)

Choose after device logs prove the branch:

1. **If `SOCKET_SKIPPED_NO_CONNECTION`:** Ensure `register-user` on every reconnect (`connect` handler already exists); verify **same SOCKET_URL** on both devices; optional server log line when emit skipped (diagnostic only).

2. **If DB offline gate:** Align female “online” heartbeat with `users.online` (product/ops — not billing).

3. **If stuck `live` rows:** Operational cleanup or terminalize stale `CallHistory` before busy check (careful — **touch call state only**, not settlement math).

4. **If handler latency:** Move **`upsertLiveCall` after** socket emit or run in parallel with emit (behavior change — needs review for “call backend must know call” invariant).

5. **If client dedupe:** Clear dedupe on terminal call events or key by callId only once per ring session.

6. **If `api.ts` URL typo:** Fix `http:///` → `http://` in dev constants (env/config — not financial).

**Smallest diagnostic-first step:** Query `call_delivery_events` for failing callIds (`SOCKET_DELIVERED` vs `SOCKET_SKIPPED_NO_CONNECTION`) + server log `RECEIVER SOCKET:` / `USER ONLINE:`.

---

## 13. Financial Safety

Proposed delivery/signaling fixes affect:

| Area | Touched? |
|------|----------|
| Wallet deduction | **No** |
| Billing formulas | **No** |
| Creator earnings | **No** |
| Settlement / `/calls/end` | **No** |
| Billing trigger (Agora join) | **No** |

If a fix would change **when billing starts** or **call duration settlement**, **STOP** — out of scope.

---

## 14. Required Device Test

**Minimum to confirm hypothesis #1 (socket map miss):**

1. Female foreground on dashboard, note `FEMALE SOCKET CONNECTED` log + server `USER ONLINE: <id>`.
2. Male places direct voice call within 10s.
3. Server logs: `CALL REQUEST` → `RECEIVER SOCKET: <socketId>` **non-null**.
4. Female log: incoming handler fires (see diagnostic plan below).
5. DB: `call_delivery_events` row `SOCKET_DELIVERED` for `callId`.

**If `RECEIVER SOCKET: undefined`:** registration/environment — not incoming UI code.

**If socket delivered but no UI:** client dedupe/auth/overlay — capture `processIncomingCallDelivery` return path.

---

## 10. Temporary Diagnostic Log Plan (NOT IMPLEMENTED)

### Server

| Log tag | Fields |
|---------|--------|
| `CALL_USER_RECEIVED` | `callerId`, `receiverId`, `callId`, `timestamp` |
| `CALL_USER_GATE_OFFLINE` | `receiverId`, `dbOnline` |
| `CALL_USER_GATE_BUSY` | `receiverId`, `activeCallId` |
| `CALL_USER_UPSERT_OK` | `callHistoryId`, `ms` |
| `CALL_USER_UPSERT_ERR` | `message` |
| `CALL_DELIVERY_SOCKET` | `receiverId`, `socketId`, `found: boolean`, `callId` |
| `CALL_DELIVERY_EMIT` | `receiverId`, `callId` |
| `CALL_PUSH_RESULT` | `callId`, `notified`, `reason` |

### Female client

| Log tag | Fields |
|---------|--------|
| `SOCKET_CONNECTED` | `socketId`, `userId`, `apiHost`, `socketUrl` (hosts only) |
| `SOCKET_REGISTERED` | `userId` |
| `INCOMING_CALL_RECEIVED` | `callId`, `callerId`, `source: socket` |
| `INCOMING_CALL_DEDUPED` | `callId`, `key` |
| `INCOMING_CALL_UI_SHOWN` | `callId`, `foreground` |

**Never log:** JWT, tokens, Agora tokens, passwords.

---

## 11. Reproduction Matrix (which test proves which cause)

| Test | Male | Female | Distinguishes |
|------|------|--------|----------------|
| 1 | FG | FG | End-to-end socket + overlay |
| 2 | FG | BG | Push vs socket presentation |
| 3 | FG | Killed | Push-only path |
| 4 | FG | Reconnecting | Stale `onlineUsers` vs recovery |
| 5 | FG | Fresh app open | register-user race before call |
| 6 | FG | Socket disconnected | Fallback push + male `user-offline`/`busy` |

---

## Final Output Summary

| Item | Answer |
|------|--------|
| **Exact root cause confirmed?** | **No** — requires staging logs + `call_delivery_events` + device timestamps |
| **Primary code locus if socket miss** | `server.js` `call-user` gates; `onlineUsers` map; `callDelivery.service.js` emit guard |
| **P0 caused it?** | **Not proven**; P0 delivery change **unlikely** to remove emit |
| **Minimal fix** | Prove branch first; likely registration/env/busy/DB-online, not settlement |
| **Billing/earnings affected?** | **No** for signaling-only fixes |
| **Logs + test needed** | § diagnostic plan + §14 minimum device test |

**Production:** Do not deploy from this audit. **Code:** Unchanged per request.
