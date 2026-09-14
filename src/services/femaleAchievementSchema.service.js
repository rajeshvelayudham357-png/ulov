import { QueryTypes } from "sequelize";

import {
  DEFAULT_FEMALE_ACHIEVEMENT_BADGES,
  MAX_WORN_ACHIEVEMENT_BADGES,
} from "../constants/femaleAchievements.js";
import { sequelize } from "../config/database.js";
import { ensureUserSchema } from "./userSchema.service.js";

let schemaReady = false;

export const ensureFemaleAchievementSchema = async () => {
  if (schemaReady) {
    return;
  }

  await ensureUserSchema();

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS female_achievement_badges (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      title VARCHAR(120) NOT NULL,
      category VARCHAR(32) NOT NULL DEFAULT 'achievement',
      previewEmoji VARCHAR(16) NULL,
      iconKey VARCHAR(64) NULL,
      description TEXT NULL,
      points INT NOT NULL DEFAULT 10,
      requirementType VARCHAR(32) NOT NULL,
      requirementValue INT NOT NULL DEFAULT 1,
      sortOrder INT NOT NULL DEFAULT 0,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`
  );

  for (const badge of DEFAULT_FEMALE_ACHIEVEMENT_BADGES) {
    await sequelize.query(
      `INSERT IGNORE INTO female_achievement_badges
        (id, title, category, previewEmoji, iconKey, description, points,
         requirementType, requirementValue, sortOrder, enabled)
       VALUES
        (:id, :title, :category, :previewEmoji, :iconKey, :description, :points,
         :requirementType, :requirementValue, :sortOrder, 1)`,
      {
        replacements: {
          id: badge.id,
          title: badge.title,
          category: badge.category,
          previewEmoji: badge.previewEmoji,
          iconKey: badge.iconKey,
          description: badge.description,
          points: badge.points,
          requirementType: badge.requirementType,
          requirementValue: badge.requirementValue,
          sortOrder: badge.sortOrder,
        },
      }
    );
  }

  schemaReady = true;
};
