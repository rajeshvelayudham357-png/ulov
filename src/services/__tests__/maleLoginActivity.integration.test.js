import assert from "node:assert/strict";
import test, { after } from "node:test";

import { QueryTypes } from "sequelize";

import { sequelize } from "../../config/database.js";
import {
  buildMaleLoginActivitySql,
  getMaleLoginActivityReport,
  MALE_LOGIN_ACTIVITY_ROW_LIMIT,
  mapMaleLoginActivityRow,
} from "../maleLoginActivity.service.js";

after(async () => {
  await sequelize.close();
});

const buildLegacyMaleLoginActivitySql = (limit) => `
  SELECT
    u.id,
    u.publicUserId,
    u.name,
    u.nickname,
    u.username,
    u.phone,
    u.avatar,
    u.online,
    u.lastSeen,
    u.lastLoginAt,
    u.createdAt,
    u.updatedAt,
    (
      SELECT MAX(dt.updatedAt)
      FROM device_tokens dt
      WHERE dt.userId = u.id
    ) AS lastAppOpenAt,
    (
      SELECT MAX(log.cameOnlineAt)
      FROM user_online_logs log
      WHERE log.userId = u.id
    ) AS lastOnlineLogAt
  FROM users u
  WHERE u.gender IN ('Male', 'male')
  ORDER BY COALESCE(u.lastLoginAt, u.lastSeen, u.updatedAt) DESC
  LIMIT ${Number(limit)}`;

const normalizeRowForCompare = (row) => ({
  id: Number(row.id),
  lastAppOpenAt: row.lastAppOpenAt ? new Date(row.lastAppOpenAt).toISOString() : null,
  lastOnlineLogAt: row.lastOnlineLogAt
    ? new Date(row.lastOnlineLogAt).toISOString()
    : null,
  lastLoginAt: row.lastLoginAt ? new Date(row.lastLoginAt).toISOString() : null,
  orderKey: [
    row.lastLoginAt,
    row.lastSeen,
    row.updatedAt,
  ]
    .map((v) => (v ? new Date(v).getTime() : 0))
    .join("|"),
});

test("optimized SQL matches legacy SQL for all males up to limit", async () => {
  const limit = MALE_LOGIN_ACTIVITY_ROW_LIMIT;
  const [legacyRows, optimizedRows] = await Promise.all([
    sequelize.query(buildLegacyMaleLoginActivitySql(limit), {
      type: QueryTypes.SELECT,
    }),
    sequelize.query(buildMaleLoginActivitySql(limit), {
      type: QueryTypes.SELECT,
    }),
  ]);

  assert.equal(legacyRows.length, optimizedRows.length);

  const legacyById = new Map(
    legacyRows.map((row) => [Number(row.id), normalizeRowForCompare(row)])
  );
  const optimizedById = new Map(
    optimizedRows.map((row) => [Number(row.id), normalizeRowForCompare(row)])
  );

  assert.deepEqual(
    legacyRows.map((r) => Number(r.id)),
    optimizedRows.map((r) => Number(r.id))
  );

  for (const [id, legacy] of legacyById) {
    const optimized = optimizedById.get(id);
    assert.ok(optimized, `missing id ${id}`);
    assert.equal(optimized.lastAppOpenAt, legacy.lastAppOpenAt, `lastAppOpenAt id=${id}`);
    assert.equal(
      optimized.lastOnlineLogAt,
      legacy.lastOnlineLogAt,
      `lastOnlineLogAt id=${id}`
    );
    assert.equal(optimized.lastLoginAt, legacy.lastLoginAt, `lastLoginAt id=${id}`);
  }
});

test("getMaleLoginActivityReport issues exactly one data query", async () => {
  let queryCount = 0;
  const originalQuery = sequelize.query.bind(sequelize);

  sequelize.query = async (...args) => {
    queryCount += 1;
    return originalQuery(...args);
  };

  try {
    await getMaleLoginActivityReport({ search: "", inactiveDays: 0 });
    assert.equal(queryCount, 1);
  } finally {
    sequelize.query = originalQuery;
  }
});

test("getMaleLoginActivityReport full pipeline matches legacy mapping", async () => {
  const limit = 50;
  const legacyRows = await sequelize.query(buildLegacyMaleLoginActivitySql(limit), {
    type: QueryTypes.SELECT,
  });
  const legacyMapped = legacyRows.map(mapMaleLoginActivityRow);
  const optimizedRows = await sequelize.query(buildMaleLoginActivitySql(limit), {
    type: QueryTypes.SELECT,
  });
  const optimizedMapped = optimizedRows.map(mapMaleLoginActivityRow);

  assert.equal(legacyMapped.length, optimizedMapped.length);
  const ts = (value) =>
    value == null ? null : new Date(value).toISOString();

  for (let i = 0; i < legacyMapped.length; i += 1) {
    assert.equal(legacyMapped[i].id, optimizedMapped[i].id);
    assert.equal(
      ts(legacyMapped[i].lastAppOpenAt),
      ts(optimizedMapped[i].lastAppOpenAt)
    );
    assert.equal(
      ts(legacyMapped[i].lastOnlineLogAt),
      ts(optimizedMapped[i].lastOnlineLogAt)
    );
    assert.equal(
      legacyMapped[i].lastActivityAt?.toISOString?.() ?? null,
      optimizedMapped[i].lastActivityAt?.toISOString?.() ?? null
    );
  }
});
