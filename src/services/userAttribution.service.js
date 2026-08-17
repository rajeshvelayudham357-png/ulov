import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { ensureGrowthEventSchema } from "./growthEventSchema.service.js";

const hasAttributionPayload = (fields) =>
  Boolean(
    fields.source ||
      fields.medium ||
      fields.campaign ||
      fields.term ||
      fields.content ||
      fields.referralCode ||
      fields.referrerUserId
  );

export const upsertAttributionTouch = async (fields = {}) => {
  await ensureGrowthEventSchema();

  if (!hasAttributionPayload(fields)) {
    return null;
  }

  const now = new Date();
  const userId = fields.userId ? Number(fields.userId) : null;
  const anonymousId = fields.anonymousId ? String(fields.anonymousId).trim() : null;
  const installId = fields.installId ? String(fields.installId).trim() : null;

  if (!userId && !anonymousId && !installId) {
    return null;
  }

  let existing = null;

  if (userId) {
    [existing] = await sequelize.query(
      `SELECT * FROM user_attribution WHERE userId = :userId LIMIT 1`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );
  } else if (anonymousId) {
    [existing] = await sequelize.query(
      `SELECT * FROM user_attribution WHERE anonymousId = :anonymousId LIMIT 1`,
      { replacements: { anonymousId }, type: QueryTypes.SELECT }
    );
  } else if (installId) {
    [existing] = await sequelize.query(
      `SELECT * FROM user_attribution WHERE installId = :installId LIMIT 1`,
      { replacements: { installId }, type: QueryTypes.SELECT }
    );
  }

  const touch = {
    source: fields.source || null,
    medium: fields.medium || null,
    campaign: fields.campaign || null,
    term: fields.term || null,
    content: fields.content || null,
    referralCode: fields.referralCode || null,
    referrerUserId: fields.referrerUserId ? Number(fields.referrerUserId) : null,
    platform: fields.platform || null,
    appVersion: fields.appVersion || null,
  };

  if (existing) {
    await sequelize.query(
      `UPDATE user_attribution SET
         lastTouchSource = :source,
         lastTouchMedium = :medium,
         lastTouchCampaign = :campaign,
         lastTouchTerm = :term,
         lastTouchContent = :content,
         lastTouchReferralCode = :referralCode,
         lastTouchReferrerUserId = :referrerUserId,
         platform = COALESCE(:platform, platform),
         appVersion = COALESCE(:appVersion, appVersion),
         lastTouchAt = :now,
         userId = COALESCE(:userId, userId),
         anonymousId = COALESCE(:anonymousId, anonymousId),
         installId = COALESCE(:installId, installId),
         updatedAt = :now
       WHERE id = :id`,
      {
        replacements: {
          ...touch,
          now,
          userId,
          anonymousId,
          installId,
          id: existing.id,
        },
        type: QueryTypes.UPDATE,
      }
    );
    return existing.id;
  }

  await sequelize.query(
    `INSERT INTO user_attribution (
       userId, anonymousId, installId,
       firstTouchSource, firstTouchMedium, firstTouchCampaign, firstTouchTerm, firstTouchContent,
       firstTouchReferralCode, firstTouchReferrerUserId,
       lastTouchSource, lastTouchMedium, lastTouchCampaign, lastTouchTerm, lastTouchContent,
       lastTouchReferralCode, lastTouchReferrerUserId,
       platform, appVersion,
       firstTouchAt, lastTouchAt, registeredAt,
       createdAt, updatedAt
     ) VALUES (
       :userId, :anonymousId, :installId,
       :source, :medium, :campaign, :term, :content,
       :referralCode, :referrerUserId,
       :source, :medium, :campaign, :term, :content,
       :referralCode, :referrerUserId,
       :platform, :appVersion,
       :now, :now, :registeredAt,
       :now, :now
     )`,
    {
      replacements: {
        userId,
        anonymousId,
        installId,
        ...touch,
        platform: touch.platform,
        appVersion: touch.appVersion,
        registeredAt: fields.registeredAt || null,
        now,
      },
      type: QueryTypes.INSERT,
    }
  );

  return true;
};

export const linkAnonymousAttributionToUser = async ({ userId, anonymousId }) => {
  if (!userId || !anonymousId) {
    return;
  }

  await ensureGrowthEventSchema();

  const [anonRow] = await sequelize.query(
    `SELECT * FROM user_attribution WHERE anonymousId = :anonymousId LIMIT 1`,
    { replacements: { anonymousId }, type: QueryTypes.SELECT }
  );

  const [userRow] = await sequelize.query(
    `SELECT * FROM user_attribution WHERE userId = :userId LIMIT 1`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );

  if (anonRow && !userRow) {
    await sequelize.query(
      `UPDATE user_attribution
       SET userId = :userId,
           registeredAt = COALESCE(registeredAt, NOW()),
           updatedAt = NOW()
       WHERE id = :id`,
      { replacements: { userId, id: anonRow.id }, type: QueryTypes.UPDATE }
    );
    return;
  }

  if (anonRow && userRow && anonRow.id !== userRow.id) {
    // Preserve first-touch from anonymous record if user record lacks it
    await sequelize.query(
      `UPDATE user_attribution SET
         firstTouchSource = COALESCE(firstTouchSource, :firstTouchSource),
         firstTouchMedium = COALESCE(firstTouchMedium, :firstTouchMedium),
         firstTouchCampaign = COALESCE(firstTouchCampaign, :firstTouchCampaign),
         firstTouchTerm = COALESCE(firstTouchTerm, :firstTouchTerm),
         firstTouchContent = COALESCE(firstTouchContent, :firstTouchContent),
         firstTouchReferralCode = COALESCE(firstTouchReferralCode, :firstTouchReferralCode),
         firstTouchReferrerUserId = COALESCE(firstTouchReferrerUserId, :firstTouchReferrerUserId),
         firstTouchAt = COALESCE(firstTouchAt, :firstTouchAt),
         anonymousId = COALESCE(anonymousId, :anonymousId),
         installId = COALESCE(installId, :installId),
         updatedAt = NOW()
       WHERE id = :userIdRowId`,
      {
        replacements: {
          firstTouchSource: anonRow.firstTouchSource,
          firstTouchMedium: anonRow.firstTouchMedium,
          firstTouchCampaign: anonRow.firstTouchCampaign,
          firstTouchTerm: anonRow.firstTouchTerm,
          firstTouchContent: anonRow.firstTouchContent,
          firstTouchReferralCode: anonRow.firstTouchReferralCode,
          firstTouchReferrerUserId: anonRow.firstTouchReferrerUserId,
          firstTouchAt: anonRow.firstTouchAt,
          anonymousId,
          installId: anonRow.installId,
          userIdRowId: userRow.id,
        },
        type: QueryTypes.UPDATE,
      }
    );
    await sequelize.query(`DELETE FROM user_attribution WHERE id = :id`, {
      replacements: { id: anonRow.id },
      type: QueryTypes.DELETE,
    });
  }
};

export const getAttributionForUser = async (userId) => {
  await ensureGrowthEventSchema();
  const [row] = await sequelize.query(
    `SELECT * FROM user_attribution WHERE userId = :userId LIMIT 1`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );
  return row || null;
};
