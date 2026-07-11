import AgoraToken from "agora-access-token";

const { RtcTokenBuilder, RtcRole } = AgoraToken;

export function generateAgoraToken(channelName, uid) {

    const APP_ID = 'bfe5c7d54d67451a9a13437bd3f4143b';
    const APP_CERTIFICATE = 'bcdf531feb854154930eef5232d08a42';

    console.log(APP_ID);
    console.log(APP_CERTIFICATE);

    const expirationTime = 3600;

    const currentTimestamp = Math.floor(Date.now() / 1000);

    const privilegeExpiredTs =
        currentTimestamp + expirationTime;

    return RtcTokenBuilder.buildTokenWithUid(
        APP_ID,
        APP_CERTIFICATE,
        channelName,
        uid,
        RtcRole.PUBLISHER,
        privilegeExpiredTs
    );
}