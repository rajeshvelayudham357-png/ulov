# Production performance root-cause report (read-only)

**Date:** 2026-09-24  
**Scope:** Admin + shared Node API (`dating-backend`) against production MySQL (live).  
**Constraints honored:** No DDL/DML maintenance, no config changes, no code deploys, no load tests.

---

## Methodology and evidence limits

| Evidence type | Source |
|---------------|--------|
| Application SQL | `dating-backend` controllers/services (cited paths below) |
| Production latency | External HTTP probes noted in incident (~244s male-last-login, ~24.5s male-engagement, ~34.7s users) |
| Production table/index inventory | Operator-provided sizes and index list |
| **EXPLAIN / EXPLAIN FORMAT=JSON** | Run against **local `ulov` MySQL** (~1,636 users, **1,545** male engagement rows, **64** `users` indexes)—schema and row counts aligned with production post-backfill |
| Production EXPLAIN | **Not executed** (no production DB credentials in this workspace). Findings below assume plan shape matches local EXPLAIN unless prod cardinality differs. |

**Verified post-backfill counts (local mirror):** `user_engagement_stats` **1,546** rows; eligible males **1,545** (consistent with production backfill completion).

---

## A. Executive summary

1. **`GET /api/admin/male-last-login` is the dominant root cause** for extreme admin slowness. It runs **one SQL statement** that selects up to **2,000** male users and, for **each row**, executes **two dependent (correlated) subqueries**: `MAX(device_tokens.updatedAt)` and `MAX(user_online_logs.cameOnlineAt)`. EXPLAIN shows **`DEPENDENT SUBQUERY`** on `user_online_logs` with **`rows ≈ 124` per user** (index `idx_user_online_logs_user` on `userId` only). At ~2,000 males, that is on the order of **hundreds of thousands of index row examinations**, which **scales linearly** with male count and per-user log volume—consistent with a **~244s** observed endpoint latency (order-of-magnitude), even though the same query on a warm local instance completed in **~13ms**.

2. **`GET /api/admin/male-engagement`** runs **four parallel query groups** per request (filtered COUNT, **full-male summary scan** with heavy `CASE`/`DATEDIFF`, paginated LIST with **`Using temporary; Using filesort`**, plus **two** reactivation aggregates on `growth_events`). This explains **multi-second to ~24s** variability (filter complexity, cache state, and pool contention), not “small table = fast.”

3. **`GET /api/admin/users`** is **moderately inefficient** (full table scan + filesort for list; `findAndCountAll` = COUNT + SELECT) but **should not alone produce ~34s** on ~1.6k rows unless **waiting on the Sequelize pool** or other concurrent long queries. **Pool contention is a credible amplifier** for users/dashboard/mobile latency.

4. **`users` table carries 64 indexes**, including **31 duplicate UNIQUE indexes on `email`** and **32 duplicate UNIQUE indexes on `username`** (plus PRIMARY). These are **not the primary read latency driver** for admin list endpoints but add **write/update overhead** on every user mutation and signup.

5. **128 MB InnoDB buffer pool:** Hot admin tables total **~ tens of MB** on production (per operator sizes). **Insufficient evidence** that buffer pool size is the **primary** cause of 244s queries; correlated subquery row multiplication is a stronger, EXPLAIN-backed explanation. Buffer pool may still contribute marginally under cold cache or if total schema exceeds 128 MB on disk.

6. **Engagement backfill** was a **one-time** heavy write/aggregate workload (~1,545 upserts). It could have caused **temporary** pressure; **persistent** slowness matches **query shapes** that remain in production code.

---

## B. Exact slow queries / endpoints

### B.1 `GET /api/admin/male-last-login`

**Route:** `admin.routes.js` → `listMaleLoginActivity` (`maleLoginActivity.controller.js`).

**SQL (exact shape):**

```sql
SELECT
  u.id, u.publicUserId, u.name, u.nickname, u.username, u.phone, u.avatar,
  u.online, u.lastSeen, u.lastLoginAt, u.createdAt, u.updatedAt,
  (SELECT MAX(dt.updatedAt) FROM device_tokens dt WHERE dt.userId = u.id) AS lastAppOpenAt,
  (SELECT MAX(log.cameOnlineAt) FROM user_online_logs log WHERE log.userId = u.id) AS lastOnlineLogAt
FROM users u
WHERE u.gender IN ('Male', 'male')
ORDER BY COALESCE(u.lastLoginAt, u.lastSeen, u.updatedAt) DESC
LIMIT 2000;
```

**Post-SQL work (Node):** Search/inactive filters and summary KPIs run **in memory** on up to 2,000 rows (not N+1 DB).

**Measured (local, read-only):** Full `LIMIT 2000` query **~13 ms** (warm cache, fast disk).  
**Observed (production HTTP):** **~244 s** (one probe).

---

### B.2 `GET /api/admin/male-engagement`

**Service:** `adminMaleEngagement.service.js` → `getMaleEngagementDashboard`.

**Per request (parallel via `Promise.all`):**

| # | Query role | SQL pattern |
|---|------------|-------------|
| 1 | Filtered total | `SELECT COUNT(*) … FROM users u LEFT JOIN user_engagement_stats ues … WHERE <filters>` |
| 2 | **Global summary** | `SELECT COUNT(*), SUM(CASE WHEN <ENGAGEMENT_BUCKET_SQL> …)` over **all males** (filters **not** applied) |
| 3 | Page list | `SELECT … ORDER BY ues.last_meaningful_activity_at IS NULL ASC, ues.last_meaningful_activity_at DESC, u.id DESC LIMIT/OFFSET` |
| 4a–b | Reactivation | Two× `COUNT(DISTINCT ge.userId)` on `growth_events` with **`EXISTS` correlated** subquery on prior `SESSION_STARTED` and `DATEDIFF` on IST-shifted dates |

**Observed (production HTTP):** ~**1.9–3.2 s** vs ~**24.5 s**.

---

### B.3 `GET /api/admin/users`

**Handler:** `admin.controller.js` → `getAdminUsersList` (`adminUsers.service.js`).

**Sequelize:**

```javascript
User.findAndCountAll({
  where,           // optional Op.or with LIKE '%search%' on many columns
  attributes: LIST_ATTRIBUTES,  // wide row + literals for blocked/accountStatus
  order: [["createdAt", "DESC"]],
  limit, offset,
  distinct: true,
});
```

Generates **COUNT** + **SELECT** against `users`. No joins; no correlated subqueries.

**Observed (production HTTP):** ~**34.7 s** (one probe).

---

### B.4 `GET /api/admin/dashboard`

**Handler:** `admin.controller.js` `dashboard` (~2282+).

**Pattern:** **Many sequential** Sequelize `count` / `sum` calls (users, calls, earnings, withdraws, KYC, support)—partially batched in `Promise.all` for KYC and support only. **~15–20 round-trips** per dashboard load.

**Observed (production HTTP):** ~**1–6 s**.

---

### B.5 Other admin list (related, not in probe list)

**`GET /api/admin/male-users`** (`getAdminMaleUsersList` in `adminPanelLists.service.js`): **3 parallel queries** with derived aggregates on `payment_orders` (`GROUP BY userId`, `MAX(updatedAt)` join pattern). Heavier than plain users list; can consume **3 pool slots** per request.

---

### B.6 High-frequency mobile paths (shared pool)

| Path | DB pattern |
|------|------------|
| `recordEngagement` / `recordEngagementAsync` | Upsert into `user_engagement_stats` (primary key `userId`) after optional schema ensure |
| `growthEvents.service` | Inserts + async engagement |
| `payment.service` | Order writes + async engagement |

These are **short** single-row writes compared to admin analytics queries but **compete for the same Sequelize pool** (`max: 20`, `acquire: 30000` ms in `database.js`).

---

## C. EXPLAIN findings (local DB; read-only)

### C.1 Male last login — outer query

```
table u | type ALL | rows ~1636 | filtered ~20% | Extra: Using where; Using filesort
```

No index supports `gender IN ('Male','male')` nor `ORDER BY COALESCE(lastLoginAt, lastSeen, updatedAt)`.

### C.2 Male last login — dependent subqueries (LIMIT 2000 plan)

| id | select_type | table | type | key | rows | Notes |
|----|-------------|-------|------|-----|------|-------|
| 1 | PRIMARY | u | ALL | — | 1636 | filesort |
| 2 | **DEPENDENT SUBQUERY** | dt | ref | device_tokens_user_id_platform | **~1** | `userId` |
| 3 | **DEPENDENT SUBQUERY** | log | ref | idx_user_online_logs_user | **~124** | `userId` only |

**EXPLAIN FORMAT=JSON** (excerpt): subquery on `log` is `"dependent": true`, `"cacheable": false`, `query_cost` **~137** **per outer row** in the optimizer model for the sampled plan.

**Scaling estimate (evidence-based):**  
If ~327 male rows are produced from the outer scan (1636 × 20% filter) up to LIMIT 2000, and each male triggers ~124 log row examinations: **~327 × 124 ≈ 40k** log row reads minimum; for **2000 males** with similar skew: **2000 × 124 ≈ 248,000** examinations—**consistent with ~244s** if each examination averages ~1 ms under production IO/load (local warm run ~13 ms total).

**device_tokens:** EXPLAIN **rows ~1** per subquery—index **`(userId, platform)`** is **adequate** for `MAX(updatedAt)` per user at current cardinality (~237 rows total).

### C.3 Male engagement — COUNT / summary

```
u  | ALL | rows ~1636 | Using where
ues| eq_ref | PRIMARY | Using index (on summary COUNT)
```

Full **male user heap scan** for every summary/COUNT; join to stats is cheap (PK).

### C.4 Male engagement — LIST

```
Extra: Using where; Using temporary; Using filesort
```

`ORDER BY ues.last_meaningful_activity_at IS NULL ASC, ues.last_meaningful_activity_at DESC` does **not** use `idx_ues_meaningful_activity` effectively (leading expression is `IS NULL`, and driving table is `users` ALL).

### C.5 Reactivation query

Plan uses **`growth_events`** indexes `idx_growth_events_name_created` / `idx_growth_events_user_created`; EXPLAIN JSON shows **`using_temporary_table`: true** for `COUNT(DISTINCT userId)`. Optimizer cost **~28** on local data—cheap per query, but **two** run every engagement page load.

Original design used **`EXISTS` + correlated subquery** on `ge_prev`; rewritten plan on MySQL 8 may semi-join—still non-trivial work on **~14k** `growth_events` rows.

### C.6 Admin users list

```
type ALL | rows ~1636 | Extra: Using filesort
```

With `LIKE '%term%'` on multiple columns: **Using where; Using filesort**, no index use (expected).

---

## D. Missing / ineffective indexes (recommendations **not** applied)

| Access pattern | Current index | EXPLAIN issue | Recommendation tier |
|----------------|---------------|---------------|---------------------|
| Male last login: `MAX(cameOnlineAt) WHERE userId = ?` | `idx_user_online_logs_user (userId)` | **~124 rows examined** per user (must scan all logs for user) | **Medium:** composite **`(userId, cameOnlineAt)`**—see § composite hypothesis |
| Male last login: filter/sort males | None on gender / activity coalesce | Full scan + filesort | **Structural:** precomputed last-activity column or denormalized rollups—not index-only |
| Male engagement: sort by meaningful activity | `idx_ues_meaningful_activity` | Not used due to ORDER BY shape + driving `users` | **Structural:** query rewrite (drive from `ues` or subquery) before index helps |
| Male engagement: `LOWER(COALESCE(gender))` | None | Full scan | Expression index or normalized `gender` column (structural) |
| Admin users: `ORDER BY createdAt DESC` | None used | filesort on ~1.6k rows | Low impact at current size; optional `(createdAt)` |
| Admin users search | 63× redundant unique username/email | Cannot help `LIKE '%x%'` | N/A for search |

---

## E. Redundant indexes on `users` (64 total)

**Inventory (local mirror, matches production report):**

- **PRIMARY** (`id`)
- **31 unique indexes** on **`email` alone**: `email`, `email_2` … `email_31`
- **32 unique indexes** on **`username` alone**: `username`, `username_2` … `username_32`
- **1 additional** index (non username/email)—confirm on prod: likely `publicUserId` or similar

**Exact duplicates:** Two groups—**all 31 email indexes** are identical key definitions; **all 32 username indexes** are identical.

**Application usage (`adminUsers.service.js`, auth lookups):** Queries use **`id`**, **`phone`**, or **`LIKE '%…%'`** on name/username/email—**none require 31 copies** of the same unique constraint.

**Write overhead:** Each `INSERT`/`UPDATE` touching `username` or `email` must maintain **dozens** of duplicate B-trees. At ~1.6k users this is **unlikely to cause 244s reads**; impact is **steady-state write amplification** and metadata bloat (**~4.44 MB** index size on prod for `users`).

**Confidence:** **High** that duplicates are redundant; **medium** that they measurably hurt admin read latency; **high** that they hurt writes and migration DDL time.

---

## F. Pool contention analysis

**Config** (`src/config/database.js`):

```javascript
pool: { max: 20, min: 2, acquire: 30000, idle: 10000 }
```

**Observed production:** `max_used_connections = 20` (pool can saturate).

**Mechanism:**

- One **`male-last-login`** request holds **1 connection** for the **entire** duration of the mega-query (**minutes** if prod matches ~244s).
- **`male-engagement`** uses **4 parallel** connections per request.
- **`male-users`** uses **3 parallel** connections.
- **Dashboard** uses many sequential connections.
- **Mobile** traffic uses the **same pool** in the same Node/PM2 process.

If **≥20** long-running or parallel admin queries overlap, mobile and other admin handlers **block in `pool.acquire`** up to **30s**—explaining **~34s users** without a pathological users SQL plan.

**Confidence:** **High** that pool saturation **can** delay unrelated endpoints; **medium** without prod APM tying wait time to acquire.

---

## G. Backfill impact analysis

**Completed production backfill:** ~1,545 males; `user_engagement_stats` populated (~1,534 meaningful).

**During backfill:** Batch aggregates over `growth_events`, `chat_messages`, `call_histories`, `payment_orders`, plus **~1.5k upserts**—temporary IO, lock, and pool usage.

**After backfill:**

- Table **`user_engagement_stats`** is **~1.5k rows**—join cost is **O(m males)** with cheap PK lookup, not the bottleneck.
- Male last login **does not use** `user_engagement_stats`; it still hits **`user_online_logs` per user**.

**Conclusion:** Backfill **could explain a temporary incident window**; **cannot explain sustained ~244s male-last-login** without the correlated subquery pattern.

**Confidence:** Backfill transient **medium**; persistent query design **high**.

---

## H. Mobile vs admin impact

| Factor | Admin | Mobile |
|--------|-------|--------|
| Worst queries | male-last-login, male-engagement, male-users | Mostly point reads/writes |
| Connection hold time | Up to **minutes** (male-last-login) | Milliseconds–low seconds |
| Symptom alignment | Admin pages time out / spin | App “slow” when pool starved |

Admin **read** load is the ** aggressor** on shared infrastructure; mobile **writes** (`recordEngagementAsync`) add queue depth but are not individually slow.

---

## I. Root-cause confidence by hypothesis

| Hypothesis | Confidence | Evidence |
|------------|------------|----------|
| Correlated `MAX(user_online_logs)` per male × 2000 | **Very high** | Code + EXPLAIN `DEPENDENT SUBQUERY`, rows~124 |
| Correlated `MAX(device_tokens)` per male | **Low** (as bottleneck) | EXPLAIN rows~1 |
| Male engagement multi-query + filesort + full male scan | **High** | Code + EXPLAIN temporary/filesort |
| Sequelize pool exhaustion delaying other APIs | **High** (mechanism) / **Medium** (prod measured) | pool max 20 = max_used_connections; 244s hold |
| 128 MB buffer pool miss | **Low** as primary | Small working set; no prod InnoDB metrics |
| 64 redundant user indexes causing read slowness | **Low** | Full table scans dominate reads |
| Redundant indexes causing write slowness | **Medium** | 63 duplicate uniques |
| Backfill-only incident | **Medium** transient | One-time writes; code unchanged for worst endpoint |
| Admin users SQL alone causing 34s | **Low** | Simple ALL+filesort on 1.6k rows |

---

### C.7 Composite `(userId, cameOnlineAt)` — **hypothesis only** (index **not** created)

**Question:** Would **`(userId, cameOnlineAt)`** materially improve male-last-login?

**Current EXPLAIN:** Subquery uses **`ref`** on `(userId)` only; **`rows ≈ 124`** for `MAX(cameOnlineAt)`—optimizer expects to scan **all log rows per user**.

**Expected behavior with composite (textbook + MySQL optimizer):** For `WHERE userId = ?` + `MAX(cameOnlineAt)`, InnoDB can often resolve **`MAX`** by reading the **last entry** in the **`(userId, cameOnlineAt)`** index (single row or backward index scan)—reducing **`rows_examined`** from **~124 → ~1** per user in typical plans.

**Materiality:** If prod latency is dominated by **2000 × 124** examinations, composite index is **material** (**order-of-magnitude** speedup potential). **Cannot confirm exact prod plan without EXPLAIN on production** after index exists; pre-create validation options: rewrite query to **`JOIN` pre-aggregated subquery** (same logical test, no new index).

**device_tokens composite:** **Not supported by EXPLAIN** as needed (already rows~1).

---

## J. Recommended fixes (ordered; **not applied**)

### Immediate / low-risk

1. **Operational:** Avoid opening **male-last-login** / **male-engagement** during peak mobile usage until query is fixed (reduces pool hold)—**no code change**.
2. **Observability:** Enable **slow query log** / app-level query timing on admin routes (threshold 1–2s)—evidence for prod EXPLAIN equivalents.
3. **Verify production `user_engagement_stats` row count** (~1545)—already mirrored locally.

### Medium-risk (query/index; requires change window + validation)

4. **Rewrite male-last-login SQL** to **JOIN** derived tables:

   ```sql
   LEFT JOIN (SELECT userId, MAX(updatedAt) AS lastAppOpenAt FROM device_tokens GROUP BY userId) dt …
   LEFT JOIN (SELECT userId, MAX(cameOnlineAt) AS lastOnlineLogAt FROM user_online_logs GROUP BY userId) log …
   ```

   **Two aggregations** over small tables (~237 tokens, ~13k logs) vs **4000 dependent subqueries**. **Expected impact:** replace **~244s** class with **sub-second to low seconds** (local aggregation would be ms-scale). **Risk:** semantic parity with current COALESCE ordering; test on staging.

5. **Add `(userId, cameOnlineAt)` on `user_online_logs`** **only after** staging EXPLAIN shows **`rows ≈ 1`** for per-user MAX (or as part of rewrite above). **Expected impact:** large reduction if keeping correlated shape. **Risk:** index build IO on live table (~1.5 MB data)—schedule off-peak.

6. **Male engagement:** Cache **global summary** + reactivation counts (TTL 1–5 min) or compute summary in **one pass** with list when filters allow. **Expected impact:** cut 24s spikes to ~1–3s range. **Risk:** stale KPIs.

7. **Separate Sequelize pool** (or read replica) for heavy admin analytics vs mobile—**expected impact:** mobile isolated from 244s holds. **Risk:** infra complexity.

### Structural

8. **Drop duplicate `username_*` / `email_*` indexes** keeping **one** unique each—after `sys.schema_unused_indexes` or performance_schema review on prod. **Expected impact:** faster writes, smaller buffer churn; **not** fix for male-last-login reads. **Risk:** long DDL, lock time.

9. **Normalize `users.gender`** / generated column for male filter to avoid `LOWER(COALESCE(...))` scans.

10. **Materialized last-activity** for admin dashboards (includes app open / online log / login)—eliminates repeated aggregates.

---

## K. Expected impact (if implemented)

| Fix | Endpoint | Expected latency (prod order-of-magnitude) |
|-----|----------|---------------------------------------------|
| JOIN rewrite male-last-login | male-last-login | **244s → &lt;5s** (likely &lt;1s DB time) |
| Composite index only (no rewrite) | male-last-login | **Major** if rows/user high; **uncertain** if rewrite done |
| Engagement summary cache | male-engagement | **24s → 2–5s** under load |
| Pool split | mobile APIs | Fewer **30s acquire timeouts** |
| Drop duplicate uniques | writes / migrations | Incremental; **not** admin read silver bullet |

---

## L. Risks

- DDL on live **`user_online_logs`** / **`users`** indexes: lock and replication lag.
- Query rewrite changing **sort order** or **NULL handling** for last activity.
- Cached engagement summary **stale** vs real-time ops expectations.
- Dropping “duplicate” uniques: must confirm no legacy migration tool depends on names `email_17`, etc.

---

## M. Validation plan (after any approved change)

1. On **staging** with prod-sized dumps: `EXPLAIN FORMAT=JSON` for new male-last-login SQL; assert **`rows_examined`** ≪ prior **2000 × 124**.
2. Compare **100-user sample** lastAppOpenAt / lastOnlineLogAt against current endpoint (row-by-row diff).
3. Load test **admin only** (low concurrency): male-last-login p95 &lt; 2s DB time.
4. Load test **admin + mobile** simulation: verify mobile p95 stable with admin tab open.
5. Production: re-run HTTP probes; watch `Threads_running`, pool queue, slow log.
6. Post index cleanup: measure `INSERT`/`UPDATE` user micro-benchmark (optional).

---

## Appendix: Request path

```
Admin browser → HTTPS → Node (PM2) → Sequelize pool → MySQL
Mobile app    → HTTPS → same Node process → same pool → MySQL
```

**Files:**

- Male last login: `src/controllers/maleLoginActivity.controller.js`
- Male engagement: `src/services/adminMaleEngagement.service.js`
- Users: `src/services/adminUsers.service.js`
- Dashboard: `src/controllers/admin.controller.js` (`dashboard`)
- Pool: `src/config/database.js`

---

*Report generated from read-only code inspection and local EXPLAIN; no production mutations performed.*
