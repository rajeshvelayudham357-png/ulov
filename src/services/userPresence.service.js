import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";

const toTime = (value) => {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

// Female creators record activity in female_creator_online_stats
// (heartbeats while online and the moment they go offline). users.lastSeen
// is only refreshed when a user comes online, so the newer of the two wins.
export const getLastSeenAtMap = async (users) => {
  const list = (users ?? []).filter(Boolean);
  const result = new Map();

  if (list.length === 0) {
    return result;
  }

  const femaleIds = list
    .filter((user) => String(user.gender || "").toLowerCase() === "female")
    .map((user) => Number(user.id))
    .filter((id) => Number.isFinite(id) && id > 0);

  const heartbeatById = new Map();

  if (femaleIds.length > 0) {
    try {
      const rows = await sequelize.query(
        `SELECT userId, lastHeartbeatAt
FROM female_creator_online_stats
WHERE userId IN (:ids)`,
        {
          replacements: { ids: femaleIds },
          type: QueryTypes.SELECT,
        }
      );

      for (const row of rows) {
        heartbeatById.set(Number(row.userId), row.lastHeartbeatAt);
      }
    } catch (error) {
      console.log("LAST SEEN STATS ERROR", error.message);
    }
  }

  for (const user of list) {
    const id = Number(user.id);
    const times = [toTime(heartbeatById.get(id)), toTime(user.lastSeen)].filter(
      (time) => time !== null
    );

    result.set(
      id,
      times.length ? new Date(Math.max(...times)).toISOString() : null
    );
  }

  return result;
};

export const getLastSeenAt = async (user) => {
  if (!user) {
    return null;
  }

  const map = await getLastSeenAtMap([user]);
  return map.get(Number(user.id)) ?? null;
};
