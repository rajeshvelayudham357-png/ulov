import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import {
  BACKFILL_EPOCH_ARTIFACT,
  ENGAGEMENT_TIMESTAMP_COLUMNS,
} from "./userEngagementBackfillMerge.js";

/**
 * Clears known 1970-01-01 artifacts from user_engagement_stats only.
 * Does not touch source tables. Epoch is not used by allowlisted sources in this project.
 */
export const cleanUserEngagementBackfillEpochArtifacts = async () => {
  const before = await countEpochByColumn();

  let fieldsCleaned = 0;

  for (const column of ENGAGEMENT_TIMESTAMP_COLUMNS) {
    const [, meta] = await sequelize.query(
      `UPDATE user_engagement_stats
       SET ${column} = NULL
       WHERE ${column} = :epoch`,
      {
        replacements: { epoch: BACKFILL_EPOCH_ARTIFACT },
        type: QueryTypes.UPDATE,
      }
    );

    fieldsCleaned += Number(meta?.affectedRows ?? meta ?? 0);
  }

  const after = await countEpochByColumn();

  return {
    epoch: BACKFILL_EPOCH_ARTIFACT,
    before,
    after,
    fieldsCleaned,
  };
};

export const countEpochByColumn = async () => {
  const counts = {};

  for (const column of ENGAGEMENT_TIMESTAMP_COLUMNS) {
    const [row] = await sequelize.query(
      `SELECT COUNT(*) AS total
       FROM user_engagement_stats
       WHERE ${column} = :epoch`,
      {
        replacements: { epoch: BACKFILL_EPOCH_ARTIFACT },
        type: QueryTypes.SELECT,
      }
    );
    counts[column] = Number(row?.total ?? 0);
  }

  return counts;
};

export const snapshotEngagementCounts = async () => {
  const [row] = await sequelize.query(
    `SELECT
       COUNT(*) AS total_rows,
       SUM(last_meaningful_activity_at IS NOT NULL) AS last_meaningful_activity_at,
       SUM(last_app_open_at IS NOT NULL) AS last_app_open_at,
       SUM(last_session_started_at IS NOT NULL) AS last_session_started_at,
       SUM(last_creator_profile_viewed_at IS NOT NULL) AS last_creator_profile_viewed_at,
       SUM(last_chat_at IS NOT NULL) AS last_chat_at,
       SUM(last_call_at IS NOT NULL) AS last_call_at,
       SUM(last_recharge_at IS NOT NULL) AS last_recharge_at,
       SUM(last_auth_login_at IS NOT NULL) AS last_auth_login_at
     FROM user_engagement_stats`,
    { type: QueryTypes.SELECT }
  );

  return Object.fromEntries(
    Object.entries(row ?? {}).map(([key, value]) => [key, Number(value ?? 0)])
  );
};
