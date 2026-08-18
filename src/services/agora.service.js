import AgoraToken from "agora-access-token";
import { getAgoraSettings } from "./agoraSettings.service.js";

const { RtcTokenBuilder, RtcRole } = AgoraToken;

export async function generateAgoraToken(channelName, uid) {
  const { appId, appCertificate, tokenExpirySeconds } = await getAgoraSettings();

  if (!appId || !appCertificate) {
    throw new Error("Agora credentials are not configured.");
  }

  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + tokenExpirySeconds;

  return RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    privilegeExpiredTs
  );
}

export async function getAgoraAppId() {
  const { appId } = await getAgoraSettings();
  return appId;
}
