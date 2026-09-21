import { QueryTypes } from "sequelize";

import {
  BATTLE_ROOM_STATUSES,
} from "../constants/battle.js";
import { sequelize } from "../config/database.js";
import { getAdminUserDisplayName } from "./adminUsers.service.js";
import { ensureBattleSchema } from "./battleSchema.service.js";

const FINISHED_BATTLE_STATUSES = [
  BATTLE_ROOM_STATUSES.ENDED,
  BATTLE_ROOM_STATUSES.SETTLED,
];

const paginate = (page, limit, max = 100) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), max);
  return {
    page: safePage,
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
  };
};

const paginatedResult = (rows, total, page, limit) => ({
  rows,
  total,
  page,
  limit,
  totalPages: Math.max(1, Math.ceil(total / limit)),
});

export const listAdminFinishedBattles = async ({
  page = 1,
  limit = 25,
  search = "",
} = {}) => {
  await ensureBattleSchema();

  const { page: safePage, limit: safeLimit, offset } = paginate(page, limit);
  const whereParts = ["br.status IN (:finishedStatuses)"];
  const replacements = {
    finishedStatuses: FINISHED_BATTLE_STATUSES,
    limit: safeLimit,
    offset,
  };

  if (String(search || "").trim()) {
    whereParts.push(`(
      CAST(br.id AS CHAR) LIKE :searchLike OR
      ua.name LIKE :searchLike OR
      ua.nickname LIKE :searchLike OR
      ua.username LIKE :searchLike OR
      ua.phone LIKE :searchLike OR
      ub.name LIKE :searchLike OR
      ub.nickname LIKE :searchLike OR
      ub.username LIKE :searchLike OR
      ub.phone LIKE :searchLike
    )`);
    replacements.searchLike = `%${String(search).trim()}%`;
  }

  const whereSql = whereParts.join(" AND ");
  const fromSql = `
    FROM battle_rooms br
    LEFT JOIN battle_fighters fa ON fa.battleId = br.id AND fa.slot = 'A'
    LEFT JOIN battle_fighters fb ON fb.battleId = br.id AND fb.slot = 'B'
    LEFT JOIN users ua ON ua.id = fa.userId
    LEFT JOIN users ub ON ub.id = fb.userId
  `;

  const [countRow, rows] = await Promise.all([
    sequelize
      .query(`SELECT COUNT(*) AS total ${fromSql} WHERE ${whereSql}`, {
        replacements,
        type: QueryTypes.SELECT,
      })
      .then((result) => result[0]),
    sequelize.query(
      `SELECT br.id,
              br.status,
              br.durationSeconds,
              br.startsAt,
              br.endsAt,
              br.settledAt,
              br.winnerFighterId,
              br.createdAt,
              fa.userId AS fighterAUserId,
              fa.scoreCoins AS fighterAScore,
              fa.id AS fighterAId,
              fb.userId AS fighterBUserId,
              fb.scoreCoins AS fighterBScore,
              fb.id AS fighterBId,
              ua.name AS fighterAName,
              ua.nickname AS fighterANickname,
              ua.username AS fighterAUsername,
              ua.phone AS fighterAPhone,
              ua.avatar AS fighterAAvatar,
              ub.name AS fighterBName,
              ub.nickname AS fighterBNickname,
              ub.username AS fighterBUsername,
              ub.phone AS fighterBPhone,
              ub.avatar AS fighterBAvatar,
              (
                SELECT COUNT(*)
                FROM battle_audience_sessions bas
                WHERE bas.battleId = br.id
              ) AS audienceCount,
              (
                SELECT COALESCE(SUM(coinCost), 0)
                FROM battle_gift_records bgr
                WHERE bgr.battleId = br.id
              ) AS totalGiftCoins
       ${fromSql}
       WHERE ${whereSql}
       ORDER BY COALESCE(br.settledAt, br.endsAt, br.updatedAt) DESC
       LIMIT :limit OFFSET :offset`,
      { replacements, type: QueryTypes.SELECT }
    ),
  ]);

  const total = Number(countRow?.total) || 0;
  const formatted = rows.map((row) => {
    const fighterA = row.fighterAUserId
      ? {
          id: Number(row.fighterAId),
          userId: Number(row.fighterAUserId),
          scoreCoins: Number(row.fighterAScore) || 0,
          user: {
            id: Number(row.fighterAUserId),
            name: getAdminUserDisplayName({
              id: row.fighterAUserId,
              name: row.fighterAName,
              nickname: row.fighterANickname,
              username: row.fighterAUsername,
              phone: row.fighterAPhone,
            }),
            phone: row.fighterAPhone || null,
            avatar: row.fighterAAvatar || null,
          },
        }
      : null;

    const fighterB = row.fighterBUserId
      ? {
          id: Number(row.fighterBId),
          userId: Number(row.fighterBUserId),
          scoreCoins: Number(row.fighterBScore) || 0,
          user: {
            id: Number(row.fighterBUserId),
            name: getAdminUserDisplayName({
              id: row.fighterBUserId,
              name: row.fighterBName,
              nickname: row.fighterBNickname,
              username: row.fighterBUsername,
              phone: row.fighterBPhone,
            }),
            phone: row.fighterBPhone || null,
            avatar: row.fighterBAvatar || null,
          },
        }
      : null;

    let winnerSlot = null;
    if (row.winnerFighterId) {
      if (Number(row.winnerFighterId) === Number(row.fighterAId)) {
        winnerSlot = "A";
      } else if (Number(row.winnerFighterId) === Number(row.fighterBId)) {
        winnerSlot = "B";
      }
    }

    return {
      id: Number(row.id),
      status: row.status,
      durationSeconds: Number(row.durationSeconds) || 0,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      settledAt: row.settledAt,
      winnerFighterId: row.winnerFighterId ? Number(row.winnerFighterId) : null,
      winnerSlot,
      audienceCount: Number(row.audienceCount) || 0,
      totalGiftCoins: Number(row.totalGiftCoins) || 0,
      fighters: {
        A: fighterA,
        B: fighterB,
      },
    };
  });

  return paginatedResult(formatted, total, safePage, safeLimit);
};

export const getAdminBattleViewerGifts = async (battleId) => {
  await ensureBattleSchema();

  const normalizedBattleId = Number(battleId);
  if (!Number.isFinite(normalizedBattleId) || normalizedBattleId <= 0) {
    throw new Error("Invalid battle id");
  }

  const [battleRow] = await sequelize.query(
    `SELECT br.id,
            br.status,
            br.durationSeconds,
            br.startsAt,
            br.endsAt,
            br.settledAt,
            br.winnerFighterId
     FROM battle_rooms br
     WHERE br.id = :battleId
       AND br.status IN (:finishedStatuses)
     LIMIT 1`,
    {
      replacements: {
        battleId: normalizedBattleId,
        finishedStatuses: FINISHED_BATTLE_STATUSES,
      },
      type: QueryTypes.SELECT,
    }
  );

  if (!battleRow) {
    throw new Error("Finished battle not found");
  }

  const [fighters, viewerRows, giftRows] = await Promise.all([
    sequelize.query(
      `SELECT bf.id,
              bf.userId,
              bf.slot,
              bf.scoreCoins,
              u.name,
              u.nickname,
              u.username,
              u.phone,
              u.avatar
       FROM battle_fighters bf
       INNER JOIN users u ON u.id = bf.userId
       WHERE bf.battleId = :battleId
       ORDER BY bf.slot ASC`,
      {
        replacements: { battleId: normalizedBattleId },
        type: QueryTypes.SELECT,
      }
    ),
    sequelize.query(
      `SELECT bas.userId,
              bas.status AS sessionStatus,
              bas.joinedAt,
              bas.leftAt,
              u.publicUserId,
              u.name,
              u.nickname,
              u.username,
              u.phone,
              u.avatar,
              u.gender,
              COALESCE(gifts.totalCoinsGifted, 0) AS totalCoinsGifted,
              COALESCE(gifts.giftCount, 0) AS giftCount
       FROM battle_audience_sessions bas
       INNER JOIN users u ON u.id = bas.userId
       LEFT JOIN (
         SELECT senderId,
                SUM(coinCost) AS totalCoinsGifted,
                COUNT(*) AS giftCount
         FROM battle_gift_records
         WHERE battleId = :battleId
         GROUP BY senderId
       ) gifts ON gifts.senderId = bas.userId
       WHERE bas.battleId = :battleId
       ORDER BY totalCoinsGifted DESC, bas.joinedAt ASC`,
      {
        replacements: { battleId: normalizedBattleId },
        type: QueryTypes.SELECT,
      }
    ),
    sequelize.query(
      `SELECT bgr.id,
              bgr.senderId,
              bgr.receiverId,
              bgr.fighterSlot,
              bgr.giftId,
              bgr.giftTitle,
              bgr.giftEmoji,
              bgr.coinCost,
              bgr.createdAt,
              receiver.name AS receiverName,
              receiver.nickname AS receiverNickname,
              receiver.username AS receiverUsername
       FROM battle_gift_records bgr
       LEFT JOIN users receiver ON receiver.id = bgr.receiverId
       WHERE bgr.battleId = :battleId
       ORDER BY bgr.createdAt ASC`,
      {
        replacements: { battleId: normalizedBattleId },
        type: QueryTypes.SELECT,
      }
    ),
  ]);

  const giftsBySender = giftRows.reduce((acc, gift) => {
    const key = String(gift.senderId);
    if (!acc[key]) {
      acc[key] = [];
    }

    acc[key].push({
      id: Number(gift.id),
      giftId: gift.giftId,
      giftTitle: gift.giftTitle,
      giftEmoji: gift.giftEmoji || null,
      coinCost: Number(gift.coinCost) || 0,
      fighterSlot: gift.fighterSlot,
      receiverId: Number(gift.receiverId),
      receiverName: getAdminUserDisplayName({
        name: gift.receiverName,
        nickname: gift.receiverNickname,
        username: gift.receiverUsername,
      }),
      createdAt: gift.createdAt,
    });

    return acc;
  }, {});

  const viewerMap = new Map();

  for (const row of viewerRows) {
    const userId = Number(row.userId);
    viewerMap.set(userId, {
      userId,
      publicUserId: row.publicUserId || null,
      displayName: getAdminUserDisplayName(row),
      phone: row.phone || null,
      avatar: row.avatar || null,
      gender: row.gender || null,
      sessionStatus: row.sessionStatus,
      joinedAt: row.joinedAt,
      leftAt: row.leftAt,
      totalCoinsGifted: Number(row.totalCoinsGifted) || 0,
      giftCount: Number(row.giftCount) || 0,
      gifts: giftsBySender[String(userId)] || [],
    });
  }

  const missingSenderIds = Object.keys(giftsBySender)
    .map(Number)
    .filter((userId) => !viewerMap.has(userId));

  if (missingSenderIds.length > 0) {
    const missingUsers = await sequelize.query(
      `SELECT id, publicUserId, name, nickname, username, phone, avatar, gender
       FROM users
       WHERE id IN (:missingSenderIds)`,
      {
        replacements: { missingSenderIds },
        type: QueryTypes.SELECT,
      }
    );

    for (const userRow of missingUsers) {
      const userId = Number(userRow.id);
      const gifts = giftsBySender[String(userId)] || [];

      viewerMap.set(userId, {
        userId,
        publicUserId: userRow.publicUserId || null,
        displayName: getAdminUserDisplayName(userRow),
        phone: userRow.phone || null,
        avatar: userRow.avatar || null,
        gender: userRow.gender || null,
        sessionStatus: "unknown",
        joinedAt: null,
        leftAt: null,
        totalCoinsGifted: gifts.reduce((sum, gift) => sum + gift.coinCost, 0),
        giftCount: gifts.length,
        gifts,
      });
    }
  }

  const viewers = Array.from(viewerMap.values()).sort(
    (a, b) =>
      b.totalCoinsGifted - a.totalCoinsGifted ||
      String(a.displayName).localeCompare(String(b.displayName))
  );

  const fighterData = fighters.reduce(
    (acc, fighter) => {
      acc[fighter.slot] = {
        id: Number(fighter.id),
        userId: Number(fighter.userId),
        slot: fighter.slot,
        scoreCoins: Number(fighter.scoreCoins) || 0,
        user: {
          id: Number(fighter.userId),
          name: getAdminUserDisplayName(fighter),
          phone: fighter.phone || null,
          avatar: fighter.avatar || null,
        },
      };
      return acc;
    },
    { A: null, B: null }
  );

  let winnerSlot = null;
  if (battleRow.winnerFighterId) {
    const winner = fighters.find(
      (fighter) => Number(fighter.id) === Number(battleRow.winnerFighterId)
    );
    winnerSlot = winner?.slot || null;
  }

  const summary = {
    viewerCount: viewers.length,
    giftersCount: viewers.filter((viewer) => viewer.totalCoinsGifted > 0).length,
    totalCoinsGifted: viewers.reduce(
      (sum, viewer) => sum + viewer.totalCoinsGifted,
      0
    ),
    totalGifts: giftRows.length,
  };

  return {
    battle: {
      id: Number(battleRow.id),
      status: battleRow.status,
      durationSeconds: Number(battleRow.durationSeconds) || 0,
      startsAt: battleRow.startsAt,
      endsAt: battleRow.endsAt,
      settledAt: battleRow.settledAt,
      winnerFighterId: battleRow.winnerFighterId
        ? Number(battleRow.winnerFighterId)
        : null,
      winnerSlot,
      fighters: fighterData,
    },
    summary,
    viewers,
  };
};
