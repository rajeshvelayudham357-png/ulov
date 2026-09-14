import { Op } from "sequelize";

import {
  ACTIVE_BATTLE_AUDIENCE_STATUSES,
  ACTIVE_BATTLE_FIGHTER_STATUSES,
  BATTLE_ROOM_STATUSES,
  getBattleChannelName,
} from "../constants/battle.js";
import {
  BattleAudienceSession,
  BattleFighter,
  BattleRoom,
} from "../models/index.js";
import { generateAgoraToken, getAgoraAppId } from "./agora.service.js";
import {
  assertBattleFeatureEnabled,
} from "./battle.service.js";
import {
  BattleAgoraAuthorizationError,
  BattleAgoraNotFoundError,
  BattleAgoraUnavailableError,
  BattleFeatureDisabledError,
} from "./battle.errors.js";
import { ensureBattleSchema } from "./battleSchema.service.js";

export const resolveBattleAgoraUid = (userId) => Number(userId);

export const getBattleAgoraCredentials = async (userId, battleId) => {
  await assertBattleFeatureEnabled();
  await ensureBattleSchema();

  const normalizedUserId = Number(userId);
  const normalizedBattleId = Number(battleId);

  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    throw new BattleAgoraAuthorizationError("Authentication required");
  }

  if (!Number.isFinite(normalizedBattleId) || normalizedBattleId <= 0) {
    throw new BattleAgoraNotFoundError();
  }

  const battle = await BattleRoom.findByPk(normalizedBattleId);

  if (!battle) {
    throw new BattleAgoraNotFoundError();
  }

  if (
    battle.status !== BATTLE_ROOM_STATUSES.ACCEPTED &&
    battle.status !== BATTLE_ROOM_STATUSES.LIVE
  ) {
    throw new BattleAgoraUnavailableError("Battle is not active");
  }

  const fighter = await BattleFighter.findOne({
    where: {
      battleId: normalizedBattleId,
      userId: normalizedUserId,
      status: {
        [Op.in]: ACTIVE_BATTLE_FIGHTER_STATUSES,
      },
    },
  });

  const audience = fighter
    ? null
    : await BattleAudienceSession.findOne({
        where: {
          battleId: normalizedBattleId,
          userId: normalizedUserId,
          status: {
            [Op.in]: ACTIVE_BATTLE_AUDIENCE_STATUSES,
          },
        },
      });

  if (!fighter && !audience) {
    throw new BattleAgoraAuthorizationError();
  }

  const channelName = String(battle.agoraChannelName || "").trim();
  const expectedChannelName = getBattleChannelName(battle.id);

  if (!channelName || channelName !== expectedChannelName) {
    throw new BattleAgoraUnavailableError("Battle audio channel is not available");
  }

  const uid = resolveBattleAgoraUid(fighter?.agoraUid ?? normalizedUserId);

  if (!Number.isFinite(uid) || uid <= 0) {
    throw new BattleAgoraUnavailableError("Invalid Agora UID");
  }

  const [token, appId] = await Promise.all([
    generateAgoraToken(channelName, uid),
    getAgoraAppId(),
  ]);

  return {
    appId,
    channelName,
    token,
    uid,
    battleId: normalizedBattleId,
    role: fighter ? "fighter" : "audience",
    fighterSlot: fighter?.slot ?? null,
  };
};

export { BattleFeatureDisabledError };
