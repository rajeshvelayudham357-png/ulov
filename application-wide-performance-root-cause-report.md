# Application-wide performance root-cause report (read-only)

**Date:** 2026-09-24  
**Scope:** `dating-backend` (single Node/Express + Socket.IO process, one MySQL database).  
**Constraints:** No code/deploy/restart/config/index/load changes on production.

---

## Executive conclusion

The incident is **not explained by Male Last Login alone**. Code and architecture review supports a **combination** of:

| Rank | Factor | Confidence | Why |
|------|--------|------------|-----|
| 1 | **Shared Sequelize pool (max 20) + long/parallel admin analytics** | **High** (mechanism) | One connection held minutes starves others; `max_used_connections = 20` matches pool max; measured admin latencies (244s / 34s) exceed `acquire: 30000` ms. |
| 2 | **Long-running / heavy SQL** (admin lists, engagement, growth) | **High** | Correlated subqueries (male-last-login **still on prod until deploy**), multi-query engagement, unbounded mobile reads. |
| 3 | **High-frequency socket path + synchronous logging** | **Medium–High** | `register-user` / `disconnect` log entire `onlineUsers` Map on every event. |
| 4 | **Startup `runDatabaseMigrations()` on every process start** | **Medium** | Many `model.sync({ alter: true })` + schema ensures; correlates with **PM2 restarts (7)**. |
| 5 | **Background timers sharing the same pool** | **Medium** | Quick Connect watchdog (~1s), female online scheduler (~5m), chat purge (6h), broadcast worker, battle expire. |
| 6 | **Mobile hot paths without pagination** | **Medium** | e.g. `getUsers` `User.findAll` with no `limit`. |
| 7 | **External HTTP (payment, push, MSG91)** | **Medium** (path-specific) | Request thread awaits gateway verification / push send on some routes. |
| 8 | **Redis** | **N/A** | **No Redis client usage** found in `src/`. |
| 9 | **128 MB InnoDB buffer pool** | **Low** as primary | Small table footprint in ops data; no InnoDB status available. |
| 10 | **Connection leaks / multiple pools** | **Low** | Single `new Sequelize(` in codebase. |

**Male Last Login JOIN refactor (local only)** removes one major admin hog; **deploying it alone does not guarantee** full-app recovery if pool is saturated by growth dashboard, unbounded `getUsers`, socket logging, and restart migrations.

---

## A. Sequelize / connection pool

### Configuration (actual)

**File:** `src/config/database.js`

| Setting | Value |
|---------|--------|
| Instances | **1** (`export const sequelize = new Sequelize(...)`) |
| `pool.max` | **20** |
| `pool.min` | **2** |
| `pool.acquire` | **30000** ms |
| `pool.idle` | **10000** ms |
| Connection lifetime | Not configured (Sequelize default) |
| Logging | `DB_LOGGING === "true"` only |

**Search:** `new Sequelize(` appears **only** in `database.js`. All models import this shared instance via services/controllers.

**Admin vs mobile:** Same Express app (`app.js`), same HTTP server + Socket.IO (`server.js`), **same pool**.

### Transactions

Found in payment, wallet/gifts, scratch rewards, voice room, battle, profile unlock, admin wallet credit, user delete, account deletion, etc. Typical pattern: `sequelize.transaction(async (t) => { ... })` with DB work inside callback.

**Risk pattern:** Manual `const transaction = await sequelize.transaction()` (e.g. `femaleTask.service.js`, `adminUserDelete.service.js`) — must commit/rollback in `try/finally`; no evidence of HTTP calls **inside** open transactions in sampled payment flow (wallet credit is DB-only inside transaction).

**No evidence** of transactions held across socket handlers’ full disconnect path beyond sequential `await` DB calls (connection returned between queries unless a transaction object is passed — disconnect handler does **not** use a transaction wrapper).

### Pool contention model

- **If 1 request holds 1 connection for 30s:** up to **19** others can still work **if** no other long requests.
- **If 1 request holds ~244s:** that connection is gone for **~4 minutes** → with several admin tabs (male-last-login + male-engagement + growth bootstrap), **`Promise.all` using 4–5 connections each**, mobile/auth/chat can block on **`pool.acquire` up to 30s** → matches **~34s “Users”** admin probe without requiring a slow Users SQL plan.
- **Background jobs** (`setInterval`) use the **same pool** concurrently with HTTP.

### Raw SQL / loops

- Heavy use of `sequelize.query` in admin analytics, engagement, male-last-login (legacy prod), quick connect, growth.
- **Notable loop:** `quickConnect.service.js` — for each of up to **20** candidate creators: up to **4 sequential awaits** (`areUsersBlocked`, `isReceiverBusyWithOther`, `isCreatorReserved`, …) → up to **~80 queries** per quick-connect routing attempt (bounded, but under load adds queue depth).
- **Admin bulk delete:** `for (const id of batchIds) { await deleteAdminUserById(id) }` — sequential transactions (admin-only).

---

## B. Endpoint inventory (prioritized)

Legend: **Q** ≈ DB round-trips (order-of-magnitude from code path). **Ext** = external HTTP.

### Mobile (high traffic)

| Endpoint / area | Controller / service | Q | Notes |
|-----------------|----------------------|---|--------|
| **GET users list (creators feed)** | `user.controller.js` → `getUsers` | **3+** | `User.findAll` **no limit** (all verified females/males matching filter); + `getFemaleRatingStatsMap()` (1 grouped query); + `attachCreatorCallRates` (settings + batch rates). Large JSON payload. |
| **GET profile / by id** | `user.controller.js` | few | Schema ensures on some routes |
| **Auth OTP / login** | `authController.js` | several | `ensureUserSchema()`; MSG91 `fetch` verify |
| **Chat conversation** | `chat.controller.js` → `getConversation` | **3+** | Block check, `canSendChat` (multiple lookups), `ChatMessage.findAll` **2-day window, no LIMIT**, then bulk `update` read |
| **Chat conversations list** | `getConversations` | **3+** | All recent messages 2 days for user **no LIMIT**, aggregated in Node |
| **POST call create** | `call.controller.js` | several | Block/busy checks, `CallHistory` create, Agora token (local/crypto), async engagement |
| **Quick Connect** | `quickConnect.service.js` | **many** | SQL candidate list + per-row loop queries |
| **Wallet / payment** | `payment.controller.js`, `payment.service.js` | varies | **Ext:** PhonePe/Razorpay/PayU/Cashfree/Google; transaction on confirm |
| **Growth events** | `growthEvents.controller.js` | 1–2 | Rate limit in-memory; async engagement upsert |
| **Notifications** | `notification.controller.js` | few | `findAll` history |
| **Leaderboard** | `leaderboard.controller.js` | multiple | Several `Earning.findAll` / `User.findAll` |
| **Female dashboard / tasks** | `female.controller.js`, `femaleTask.service.js` | varies | Tasks + claims |
| **Device / online** | Socket `register-user` | **1+ per connect** | In-memory map + **console.log Map**; disconnect may `User.findByPk`, `update`, call cleanup |

### Admin (heavy)

| Endpoint | Location | Q (typical) | Notes |
|----------|----------|-------------|--------|
| **male-last-login** | `maleLoginActivity.controller.js` | **1** (optimized local) / **1 mega-query with dependent subqueries (prod today)** | Up to 2000 rows; prod ~244s probe |
| **male-engagement** | `adminMaleEngagement.service.js` | **4 parallel** | COUNT + full-male summary + list (filesort) + 2× reactivation SQL |
| **users** | `adminUsers.service.js` | **2** | `findAndCountAll`; slow probe likely **pool wait** |
| **dashboard** | `admin.controller.js` `dashboard` | **~15–20 sequential** | Many `count`/`sum` |
| **male-users** | `adminPanelLists.service.js` | **3 parallel** | Payment aggregates + joins |
| **Growth bootstrap** | `adminGrowth.controller.js` | **5 parallel** | summary, health, funnel, call quality, delivery diagnostics |
| **Growth sub-pages** | `adminGrowth*.service.js` | **many** | Large SQL over `growth_events`, calls, payments |
| **Analytics blocks in admin.controller** | ~6380+ | **many `Promise.all` bundles** | Revenue, calls, creators, etc. |
| **Broadcast targeting** | `broadcast.controller.js` | **multiple `User.findAll`** | Can load large user sets |

### Background (same process + pool)

| Worker | Interval | DB work |
|--------|----------|---------|
| `runDatabaseMigrations` | **Every PM2 start** | Long chain: `ensureUserSchema({ force: true })`, many `safeModelSync(..., { alter: true })` |
| `purgeOldChatMessages` | 6h + on start | `ChatMessage.destroy` bulk |
| `startBroadcastScheduleWorker` | periodic | Broadcast sends / DB |
| `startQuickConnectWatchdog` | default **1000ms** | `processExpiredQuickConnectAttempts` |
| `startFemaleOnlineScheduler` | default **5 min** | Stale female offline batch |
| `startBattleExpireWatchdog` | periodic | Battle state |

---

## C. N+1 and query multiplication (significant findings)

| Location | Pattern | Impact |
|----------|---------|--------|
| **Male last login (production SQL)** | 2× dependent subquery × up to 2000 users | **Critical admin** (addressed locally, not deployed) |
| **Quick Connect routing** | `for (row of rows)` up to 20 × 4 awaits | Up to ~80 Q per session setup |
| **Admin suspicious bulk delete** | `for (id) await deleteAdminUserById` | Up to 150 sequential transactions |
| **Admin user delete service** | `for (sql) await sequelize.query` inside transaction | Small N |
| **Call state cleanup** | `for (call) await completeCallRecord` | Background / disconnect paths |
| **Quick Connect watchdog** | loops over attempts/sessions with awaits | Every ~1s tick |
| **`getUsers`** | Not N+1 but **1 unbounded SELECT** | All creators in memory — scales with roster size |
| **`attachCreatorCallRates`** | Batch `getCreatorCallRatesMap(femaleIds)` | **Not N+1** (good) |

No widespread `users.map(async => Model.find)` anti-pattern found in hot mobile list path; bigger issue is **unbounded `findAll`**.

---

## D. Existing instrumentation

| Mechanism | Present? | Notes |
|-----------|----------|-------|
| Sequelize SQL logging | Opt-in `DB_LOGGING=true` | Off by default; enabling on prod is noisy — avoid unless brief window |
| Request timing middleware | **No** dedicated APM middleware in `app.js` |
| Slow query log (MySQL) | Ops report `slow_queries = 0` | Threshold may exclude 10–30s waits; queries can complete under threshold while pool waits dominate |
| Structured request logs | Sparse `console.log` on errors |
| Growth rate limit | In-memory Map | Not performance tracing |

**Safe use:** Correlate PM2 timestamps with admin page loads; temporarily enable `DB_LOGGING` on **staging** only.

---

## E. Node event loop / logging

### USER ONLINE / ONLINE USERS (high priority)

**File:** `src/server.js`

On **`register-user`** (every mobile socket registration):

```javascript
console.log("USER ONLINE:", userId);
console.log("ONLINE USERS:", onlineUsers);  // entire Map
```

On **`disconnect`** (every socket drop):

```javascript
console.log("ONLINE USERS:", onlineUsers);  // again
```

Plus `SOCKET CONNECTED`, `USER OFFLINE`, DB updates on disconnect for non-female users.

**Effect:** `console.log` of a **Map** forces **synchronous formatting** and stdout I/O on a **high-frequency path** (connect/disconnect storms). This can **block the event loop** and delay **all** HTTP handlers in the same process, independent of MySQL.

**Confidence:** **Medium–High** as a contributor to “whole app feels slow” when many users connect (app foreground, network flaps).

### Other CPU / sync I/O

- Firebase init: `fs.readFileSync` **once** (cached in `getFirebaseMessaging`) — not per request.
- Large admin JSON responses (2000-row male-last-login, unbounded `getUsers`).
- `growthEvents` metadata `JSON.stringify` — per event, moderate volume.

---

## F. PM2 (codebase vs production)

- **No `ecosystem.config.js`** in repo — production PM2 config not versioned here.
- **7 restarts** (operator report): categories require **`pm2 logs` / `~/.pm2/logs`** on server (read-only tail).
- **Code correlation:** Every start runs **`runDatabaseMigrations()`** before `listen` — includes **`model.sync({ alter: true })`** on many models (`databaseMigration.service.js`). A **restart storm** causes **DDL/metadata work** and connection spike → plausible **slow period after deploy/restart**.
- **Cannot classify restarts** without production log excerpts (OOM vs uncaught exception vs deploy).

---

## G. Redis

**Finding:** **Redis is not used** in `dating-backend/src` (no `ioredis`, `redis`, or `createClient`). Slowness is **not** Redis latency for this codebase.

(`mongoose` appears in `package.json` but **no imports in `src/`** — inactive.)

---

## H. External services (request-critical paths)

| Service | Usage | Blocking? |
|---------|--------|-----------|
| **PhonePe / Razorpay / PayU / Cashfree** | `payment.service.js`, controllers | **Yes** — client waits on create/status/verify |
| **Google Play billing** | `googleBilling.service.js` | **Yes** — verify + OAuth token |
| **MSG91** | `msg91.service.js` | Auth verify path |
| **Firebase / Expo push** | `notificationPush.service.js` | **Yes** on notify paths (`axios` / FCM); chat/call notify |
| **Agora** | Token generation local | Low latency (not HTTP per call in sampled `agora.service`) |
| **News feed** | `newsFeed.service.js` | `axios.get` external |

Under gateway slowness, **payment and push** routes hold connections and event-loop time; usually **not** every screen unless those code paths run.

---

## I. MySQL query patterns (by symptom class)

| Pattern | Examples | Index / plan notes |
|---------|----------|-------------------|
| Correlated subqueries | Male last login (**prod**) | DEPENDENT SUBQUERY ~124 rows/user (prior EXPLAIN) |
| Full scan + filesort | Admin users list, male engagement list | `users` ALL |
| Multi-query parallel admin | Engagement, growth bootstrap, male-users | Consumes **multiple of 20** pool slots under concurrency |
| Unbounded SELECT | `getUsers`, chat 2-day messages | Grows with users/messages |
| GROUP BY aggregates | Engagement summary, male-users recharge | OK at current size; heavy under load |
| LIKE `%search%` | Admin users search | Full scan expected |
| COUNT(*) dashboards | Admin dashboard | Many sequential round-trips |

**Buffer pool 128 MB:** Total schema ~tens–low hundreds MB in dev inventory. **Insufficient evidence** it is the dominant bottleneck vs pool + query shape + event-loop logging.

---

## J. Pool contention — explicit answers

**Q: If one request holds a connection 30s, what happens to the other 19?**  
They remain available **only if** no other long requests. Under **20 concurrent** admin/mobile/background queries, new requests **queue** up to **`acquire` 30s**, then error.

**Q: Can slow admin delay mobile?**  
**Yes.** Same Node process, same Sequelize pool. Documented probes (244s admin query) **guarantee** multi-minute connection occupation on prod code path until JOIN fix is deployed.

**Q: Who shares the pool?**  
HTTP admin, HTTP mobile, Socket.IO disconnect handlers, background intervals, async `recordEngagementAsync` / `trackGrowthEventAsync` (fire-and-forget still acquires connections).

---

## K. Smallest safe production observations (during a slow period)

Run **read-only**, **no restarts**, minimal frequency:

### 1. Pool exhaustion (app + MySQL)

```bash
# MySQL (read-only)
mysql -e "SHOW STATUS LIKE 'Threads_%'; SHOW STATUS LIKE 'Max_used_connections';"
mysql -e "SHOW FULL PROCESSLIST\G"   # if permitted; else skip
```

Compare: `Threads_running` sustained high + app slow + **`Max_used_connections` at 20** → strong pool saturation signal.

### 2. DB query contention

```bash
mysql -e "SHOW STATUS LIKE 'Slow_queries';"
mysql -e "SELECT * FROM performance_schema.events_statements_summary_by_digest ORDER BY SUM_TIMER_WAIT DESC LIMIT 10;" 
# only if performance_schema enabled and user has privilege
```

Look for long **`Query`** state rows tied to admin endpoints (time correlation with PM2 access logs if available).

### 3. Node event loop / logging

```bash
pm2 logs <app-name> --lines 200 --nostream | grep -E "USER ONLINE|ONLINE USERS|SOCKET"
```

If thousands of **`ONLINE USERS:`** lines per minute during slowness → logging hypothesis strengthened.

```bash
# If Node 18+ and inspector already enabled (do NOT enable new flags on prod without approval):
# curl localhost:9229/json — skip unless already configured
```

### 4. Redis

**Skip** — not used by this backend.

### 5. External API latency

```bash
pm2 logs <app-name> --lines 500 --nostream | grep -iE "phonepe|razorpay|payu|cashfree|FIREBASE|axios|MSG91"
```

Correlate slow payment/push requests with user reports.

### 6. PM2 restarts (read-only)

```bash
pm2 describe <app-name>   # restart count, uptime, unstable restarts
pm2 logs <app-name> --err --lines 100 --nostream
```

Match restart timestamps to incident windows.

---

## Hypothesis scorecard (strict evidence)

| # | Hypothesis | Verdict | Evidence strength |
|---|------------|---------|-------------------|
| 1 | Pool contention | **Likely major** | max_used=20=pool.max; long admin probes; shared infra |
| 2 | Long-running DB queries | **Likely major** | male-last-login prod; engagement; growth SQL |
| 3 | N+1 | **Moderate** (quick connect, not whole app) | Bounded loops with multiple awaits |
| 4 | Excessive concurrent queries | **Likely** | `Promise.all` on admin growth/engagement |
| 5 | Transactions holding during HTTP | **Unlikely systemic** | Payment tx mostly DB-only |
| 6 | Connection leaks | **Unlikely** | Single pool; standard transaction patterns |
| 7 | Multiple Sequelize pools | **No** | One instance |
| 8 | Event-loop blocking | **Likely contributor** | Map console.log on socket path |
| 9 | Sync logging volume | **Likely contributor** | USER ONLINE / ONLINE USERS |
| 10 | PM2 restarts | **Unknown cause; moderate effect** | 7 restarts; startup migrations heavy |
| 11 | Redis | **No** | Not in codebase |
| 12 | External APIs | **Situational** | Payment/push paths |
| 13 | Buffer pool | **Insufficient data** | No InnoDB status |
| 14 | Mobile API queries | **Moderate** | Unbounded `getUsers`, chat history |
| 15 | Admin API queries | **Strong** | Multiple heavy endpoints |
| 16 | Combination | **Best fit** | — |

---

## Recommended fix order (investigation only — do not implement here)

1. **Deploy male-last-login JOIN refactor** (already local) — removes one connection hog.
2. **Reduce socket Map logging** (staging first) — validate event-loop relief.
3. **Cap / paginate `getUsers` and chat history** — mobile feed latency.
4. **Split admin analytics pool or read replica** — isolate mobile.
5. **Decouple startup migrations** from PM2 restart (run once via CI/job).
6. **Male engagement / growth** — cache summaries, reduce parallel fan-out.
7. **Index/DDL** — only with EXPLAIN on staging/prod read-only.

---

## Male Last Login status (context)

- **Production (today):** Still correlated subquery architecture until backend deploy.
- **Local repo:** JOIN refactor + tests pass (`male-last-login-optimization-report.md`).
- **Do not assume** incident resolved until prod deploy **and** pool/logging/mobile paths addressed.

---

## Files referenced

| Area | Path |
|------|------|
| Pool | `src/config/database.js` |
| Socket logging | `src/server.js` (~404–432, ~1455–1458) |
| Startup migrations | `src/server.js`, `src/services/databaseMigration.service.js` |
| Mobile feed | `src/controllers/user.controller.js` (`getUsers`) |
| Chat | `src/controllers/chat.controller.js` |
| Admin engagement | `src/services/adminMaleEngagement.service.js` |
| Admin growth | `src/controllers/adminGrowth.controller.js` |
| Quick Connect N+1 | `src/services/quickConnect.service.js` ~459–480 |
| Prior DB report | `production-performance-root-cause-report.md` |

---

*Read-only codebase investigation. No production changes performed.*
