import express from "express";


import {

    adminLogin,

    requireAdmin,

    requireSuperAdmin,

    requirePageAccess,

    adminMe,

    adminPagePermissions,

    listAdminUsers,

    createAdminUser,

    updateAdminUser,

    deleteAdminUser,

    getCallRateConfig,

    updateCallRateConfig,

    getAppSettingsConfig,

    updateAppSettingsConfig,

    getGstSettingsConfig,

    updateGstSettingsConfig,

    getPaymentSettingsConfig,

    updatePaymentSettingsConfig,

    getAgoraSettingsConfig,

    updateAgoraSettingsConfig,

    getGiftSettingsConfig,

    updateGiftSettingsConfig,

    getCreatorCallRateConfig,

    updateCreatorCallRateConfig,

    getMasterTasks,

    createMasterTask,

    updateMasterTask,

    getTaskClaims,

    dashboard,
    
    users,

    listSuspiciousUsers,

    bulkDeleteSuspiciousUsers,

    maleUsers,

    getMaleWalletCreditPackagesConfig,

    lookupMaleWalletCreditUser,

    createMaleWalletCredit,
    
    calls,

    maleCallHistory,

    repairCallEarnings,

    liveCalls,
    
    creators,
    
    getCreatorDetails,
    
    getCreatorDayCalls,
    analytics,
    peakCallHoursAnalytics,
    getAnalyticsGlobalSummary,
    getAnalyticsOverview,
    getAnalyticsUsers,
    getAnalyticsCalls,
    getAnalyticsRevenue,
    getAnalyticsWallet,
    getAnalyticsCreators,
    getAnalyticsWithdrawals,
    getAnalyticsRankings,
    getAnalyticsSystem,
    revenue,
    rechargeRevenue,
    revenueRecharges,
    revenueSummary,
    revenueAnalytics,
    
    getUserDetails,

    getUserFullProfile,

    resetUserPin,

    forceUserLogout,

    resetUserDevice,

    unblockUser,

    approveCreator,

    rejectCreator,
    
    blockUser,

    deleteUser,
    
    verifyUser,
    streamUserVerificationMedia,
    kycRequests,

approveKyc,

rejectKyc
    
    } from "../controllers/admin.controller.js";


import {
getBroadcasts,

createBroadcast,
listBroadcastFemales,
listBroadcastMales,
listBroadcastUsers,
listFemaleBroadcastLanguages,
getBroadcastAudienceCount,
createIndividualBroadcast

} from "../controllers/broadcast.controller.js";

import {
cancelBroadcastScheduleHandler,
createBroadcastScheduleHandler,
getBroadcastScheduleSummary,
getBroadcastSchedules,
updateBroadcastScheduleHandler
} from "../controllers/broadcastSchedule.controller.js";

import {
  listNotifyUsers,
  sendAdminNotify,
  listAdminNotifyHistory,
  deleteAdminNotify,
} from "../controllers/adminNotify.controller.js";

import {
  listScratchRewardUsers,
  sendScratchReward,
  listScratchRewardHistory,
  listScratchRewardClaims,
} from "../controllers/femaleScratchReward.controller.js";

import {
  listScratchRewardPackages as listMaleScratchRewardPackages,
  listScratchRewardUsers as listMaleScratchRewardUsers,
  getScratchRewardAudienceCount as getMaleScratchRewardAudienceCount,
  sendScratchReward as sendMaleScratchReward,
  listScratchRewardHistory as listMaleScratchRewardHistory,
  listScratchRewardClaims as listMaleScratchRewardClaims,
} from "../controllers/maleScratchReward.controller.js";

import {
  listMaleLoginActivity,
} from "../controllers/maleLoginActivity.controller.js";

import {
  getStarFriendsAdmin,
  searchStarFriendsAdminUsers,
} from "../controllers/starFriends.controller.js";

import {
  listFemaleOnlineStatus,
  offlineFemaleCreator,
  offlineAllFemaleCreators,
  offlineStaleFemaleCreators,
  previewStaleFemaleCreators,
  getFemaleOnlineScheduler,
  updateFemaleOnlineScheduler,
} from "../controllers/femaleOnlineAdmin.controller.js";

import {
getUserOnlineActivity
} from "../controllers/onlineActivity.controller.js";

import {
adminGetTicket,
adminListTickets,
adminSendMessage,
adminUpdateStatus
} from "../controllers/adminSupport.controller.js";

import {
getSpinWheelAdminSettings,
updateSpinWheelAdminSettings,
getMaleUserSpinWheelSettings,
updateMaleUserSpinWheelSettings
} from "../controllers/spinWheel.controller.js";

import {
getVoiceRoomAdminSettingsHandler,
updateVoiceRoomAdminSettingsHandler,
listAdminLiveVoiceRoomsHandler,
deleteAdminVoiceRoomHandler,
} from "../controllers/voiceRoom.controller.js";
import {
getBattleAdminSettingsHandler,
updateBattleAdminSettingsHandler,
listAdminLiveBattlesHandler,
listAdminFinishedBattlesHandler,
getAdminBattleViewersHandler,
deleteAdminBattleHandler,
} from "../controllers/battle.controller.js";

import {
getRegularGoldPackagesAdminConfig,
updateRegularGoldPackagesAdminConfig
} from "../controllers/regularGoldPackages.controller.js";

import {
  getGrowthBootstrap,
  getGrowthCalls,
  getGrowthCreators,
  getGrowthMonetization,
  getGrowthRevenue,
  getGrowthRetention,
  getGrowthActivity,
  getGrowthHealth,
  getGrowthInsights,
  getGrowthAcquisition,
  getGrowthAttribution,
} from "../controllers/adminGrowth.controller.js";
import {
  getExpectedPayouts,
} from "../controllers/expectedPayout.controller.js";
import {
  getDailyRevenue,
} from "../controllers/dailyRevenue.controller.js";
import {
  getRevenueExcludeUsersConfig,
  searchRevenueExcludeUsers,
  updateRevenueExcludeUsersConfig,
} from "../controllers/revenueExcludeUsers.controller.js";
import {
  getDailyPayout,
} from "../controllers/dailyPayout.controller.js";
import {
  getMaleWalletCoins,
} from "../controllers/maleWalletCoins.controller.js";
import {
  getFemaleUserLevelsAdmin,
  getUserLevelsAdmin,
  updateUserLevelsAdmin,
} from "../controllers/userLevel.controller.js";

const router = express.Router();


router.post(
"/login",
adminLogin
);


router.use(
requireAdmin
);


router.get(
"/me",
adminMe
);

router.get(
"/page-permissions",
adminPagePermissions
);

router.get(
"/admin-users",
requireSuperAdmin,
listAdminUsers
);

router.post(
"/admin-users",
requireSuperAdmin,
createAdminUser
);

router.patch(
"/admin-users/:id",
requireSuperAdmin,
updateAdminUser
);

router.delete(
"/admin-users/:id",
requireSuperAdmin,
deleteAdminUser
);


router.get(
"/call-rates",
requirePageAccess("call-rates"),
getCallRateConfig
);


router.patch(
"/call-rates",
requirePageAccess("call-rates"),
updateCallRateConfig
);


router.get(
"/app-settings",
requirePageAccess([
"app-settings",
"auth-settings",
"user-verification"
]),
getAppSettingsConfig
);


router.patch(
"/app-settings",
requirePageAccess([
"app-settings",
"auth-settings",
"user-verification"
]),
updateAppSettingsConfig
);

router.get(
  "/star-friends",
  requirePageAccess("app-settings"),
  getStarFriendsAdmin
);

router.get(
  "/star-friends/users",
  requirePageAccess("app-settings"),
  searchStarFriendsAdminUsers
);


router.get(
"/regular-gold-packages",
requirePageAccess("regular-gold-packages"),
getRegularGoldPackagesAdminConfig
);


router.patch(
"/regular-gold-packages",
requirePageAccess("regular-gold-packages"),
updateRegularGoldPackagesAdminConfig
);

router.get(
"/user-levels",
requirePageAccess("user-levels"),
getUserLevelsAdmin
);

router.get(
"/female-user-levels",
requirePageAccess("female-user-levels"),
getFemaleUserLevelsAdmin
);

router.put(
"/user-levels",
requirePageAccess("user-levels"),
updateUserLevelsAdmin
);


router.get(
"/gst-settings",
requirePageAccess("gst-master"),
getGstSettingsConfig
);


router.patch(
"/gst-settings",
requirePageAccess("gst-master"),
updateGstSettingsConfig
);


router.get(
"/payment-settings",
requirePageAccess("payment-settings"),
getPaymentSettingsConfig
);


router.patch(
"/payment-settings",
requirePageAccess("payment-settings"),
updatePaymentSettingsConfig
);


router.get(
"/agora-settings",
requirePageAccess("agora-settings"),
getAgoraSettingsConfig
);


router.patch(
"/agora-settings",
requirePageAccess("agora-settings"),
updateAgoraSettingsConfig
);


router.get(
"/gift-settings",
requirePageAccess("gift-master"),
getGiftSettingsConfig
);


router.patch(
"/gift-settings",
requirePageAccess("gift-master"),
updateGiftSettingsConfig
);


router.get(
"/spin-wheel",
requirePageAccess("spin-wheel"),
getSpinWheelAdminSettings
);


router.patch(
"/spin-wheel",
requirePageAccess("spin-wheel"),
updateSpinWheelAdminSettings
);


router.get(
"/spin-wheel/male-users",
requirePageAccess("spin-wheel"),
getMaleUserSpinWheelSettings
);


router.patch(
"/spin-wheel/male-users/:id",
requirePageAccess("spin-wheel"),
updateMaleUserSpinWheelSettings
);


router.get(
"/voice-rooms",
requirePageAccess("voice-rooms"),
getVoiceRoomAdminSettingsHandler
);

router.get(
"/voice-rooms/live",
requirePageAccess("voice-rooms"),
listAdminLiveVoiceRoomsHandler
);

router.delete(
"/voice-rooms/:roomId",
requirePageAccess("voice-rooms"),
deleteAdminVoiceRoomHandler
);


router.patch(
"/voice-rooms",
requirePageAccess("voice-rooms"),
updateVoiceRoomAdminSettingsHandler
);


router.get(
"/battles",
requirePageAccess("battles"),
getBattleAdminSettingsHandler
);

router.get(
"/battles/live",
requirePageAccess("live-battles"),
listAdminLiveBattlesHandler
);

router.get(
"/battles/finished",
requirePageAccess("finished-battles"),
listAdminFinishedBattlesHandler
);

router.get(
"/battles/:battleId/viewers",
requirePageAccess("finished-battles"),
getAdminBattleViewersHandler
);

router.delete(
"/battles/:battleId",
requirePageAccess("live-battles"),
deleteAdminBattleHandler
);

router.patch(
"/battles",
requirePageAccess("battles"),
updateBattleAdminSettingsHandler
);


router.get(
"/creator-call-rates",
requirePageAccess("call-rates"),
getCreatorCallRateConfig
);


router.patch(
"/creator-call-rates/:id",
requirePageAccess("call-rates"),
updateCreatorCallRateConfig
);


router.get(
"/master-tasks",
requirePageAccess("daily-tasks"),
getMasterTasks
);


router.post(
"/master-tasks",
requirePageAccess("daily-tasks"),
createMasterTask
);


router.patch(
"/master-tasks/:id",
requirePageAccess("daily-tasks"),
updateMasterTask
);

router.get(
"/task-claims",
requirePageAccess("task-claims"),
getTaskClaims
);



router.get(
"/dashboard",
requirePageAccess("dashboard"),
dashboard
);


router.get(
"/users",
requirePageAccess("users"),
users
);

router.get(
"/suspicious-users",
requirePageAccess("suspicious-users"),
listSuspiciousUsers
);

router.post(
"/suspicious-users/bulk-delete",
requirePageAccess("suspicious-users"),
bulkDeleteSuspiciousUsers
);


router.get(
"/online-activity",
requirePageAccess("online-activity"),
getUserOnlineActivity
);


router.get(
"/male-users",
requirePageAccess("male-users"),
maleUsers
);

router.get(
  "/male-wallet-coins",
  requirePageAccess("male-wallet-coins"),
  getMaleWalletCoins
);


router.get(
"/male-wallet-credit/packages",
requirePageAccess("male-wallet-credit"),
getMaleWalletCreditPackagesConfig
);


router.get(
"/male-wallet-credit/lookup",
requirePageAccess("male-wallet-credit"),
lookupMaleWalletCreditUser
);


router.post(
"/male-wallet-credit",
requirePageAccess("male-wallet-credit"),
createMaleWalletCredit
);


router.get(
"/calls",
requirePageAccess("calls"),
calls
);


router.get(
"/male-call-history",
requirePageAccess("call-history-male"),
maleCallHistory
);


router.post(
"/repair-call-earnings",
requirePageAccess("calls"),
repairCallEarnings
);


router.get(
"/live-calls",
requirePageAccess("live-calls"),
liveCalls
);


router.get(
"/creators",
requirePageAccess("creators"),
creators
);


router.get(
"/creators/:id",
requirePageAccess("creators"),
getCreatorDetails
);


router.get(
"/creators/:id/day-calls",
requirePageAccess("creators"),
getCreatorDayCalls
);


router.get(
  "/analytics",
  requirePageAccess("analytics"),
  analytics
);

router.get(
  "/analytics/summary",
  requirePageAccess("analytics"),
  getAnalyticsGlobalSummary
);

router.get(
  "/analytics/overview",
  requirePageAccess("analytics"),
  getAnalyticsOverview
);

router.get(
  "/analytics/peak-hours",
  requirePageAccess("analytics"),
  peakCallHoursAnalytics
);

router.get(
  "/analytics/users",
  requirePageAccess("analytics"),
  getAnalyticsUsers
);

router.get(
  "/analytics/calls",
  requirePageAccess("analytics"),
  getAnalyticsCalls
);

router.get(
  "/analytics/revenue",
  requirePageAccess("analytics"),
  getAnalyticsRevenue
);

router.get(
  "/analytics/wallet",
  requirePageAccess("analytics"),
  getAnalyticsWallet
);

router.get(
  "/analytics/creators",
  requirePageAccess("analytics"),
  getAnalyticsCreators
);

router.get(
  "/analytics/withdrawals",
  requirePageAccess("analytics"),
  getAnalyticsWithdrawals
);

router.get(
  "/analytics/rankings",
  requirePageAccess("analytics"),
  getAnalyticsRankings
);

router.get(
  "/analytics/system",
  requirePageAccess("analytics"),
  getAnalyticsSystem
);

router.get(
  "/analytics/growth/bootstrap",
  requirePageAccess("analytics-growth"),
  getGrowthBootstrap
);

router.get(
  "/analytics/growth/calls",
  requirePageAccess("analytics-growth"),
  getGrowthCalls
);

router.get(
  "/analytics/growth/creators",
  requirePageAccess("analytics-growth"),
  getGrowthCreators
);

router.get(
  "/analytics/growth/monetization",
  requirePageAccess("analytics-growth"),
  getGrowthMonetization
);

router.get(
  "/analytics/growth/revenue",
  requirePageAccess("analytics-growth"),
  getGrowthRevenue
);

router.get(
  "/analytics/growth/retention",
  requirePageAccess("analytics-growth"),
  getGrowthRetention
);

router.get(
  "/analytics/growth/activity",
  requirePageAccess("analytics-growth"),
  getGrowthActivity
);

router.get(
  "/analytics/growth/health",
  requirePageAccess("analytics-growth"),
  getGrowthHealth
);

router.get(
  "/analytics/growth/insights",
  requirePageAccess("analytics-growth"),
  getGrowthInsights
);

router.get(
  "/analytics/growth/acquisition",
  requirePageAccess("analytics-growth"),
  getGrowthAcquisition
);

router.get(
  "/analytics/growth/attribution",
  requirePageAccess("analytics-growth"),
  getGrowthAttribution
);


router.get(
"/revenue",
requirePageAccess("revenue"),
revenue
);


router.get(
"/recharge-revenue",
requirePageAccess("recharge-revenue"),
rechargeRevenue
);

// USER DETAILS & PROFILE

router.get(
  "/users/:id/profile",
  requirePageAccess("users"),
  getUserFullProfile
);

router.get(
  "/users/:id",
  requirePageAccess("users"),
  getUserDetails
);

// USER MODERATION ACTIONS

router.post(
  "/users/:id/reset-pin",
  requirePageAccess("users"),
  resetUserPin
);

router.post(
  "/users/:id/force-logout",
  requirePageAccess("users"),
  forceUserLogout
);

router.post(
  "/users/:id/reset-device",
  requirePageAccess("users"),
  resetUserDevice
);
    
    
    
    
    // BLOCK / UNBLOCK USER
    
    router.patch(
      "/users/:id/block",
      requirePageAccess("users"),
      blockUser
    );

    router.post(
      "/users/:id/block",
      requirePageAccess("users"),
      blockUser
    );

    router.post(
      "/users/:id/unblock",
      requirePageAccess("users"),
      unblockUser
    );

    router.delete(
      "/users/:id",
      requirePageAccess(["users", "suspicious-users"]),
      deleteUser
    );
    
    // VERIFY / APPROVE / REJECT CREATOR
    
    router.patch(
      "/users/:id/verify",
      requirePageAccess(["users", "kyc", "creators"]),
      verifyUser
    );

    router.post(
      "/users/:id/approve",
      requirePageAccess(["users", "kyc", "creators"]),
      approveCreator
    );

    router.post(
      "/users/:id/reject",
      requirePageAccess(["users", "kyc", "creators"]),
      rejectCreator
    );

    router.get(
      "/users/:id/verification-media/:kind",
      requirePageAccess("users"),
      streamUserVerificationMedia
    );

    router.get(

        "/kyc",

        requirePageAccess("kyc"),
        
        kycRequests
        
        );
        
        
        
        router.patch(
        
        "/kyc/:id/approve",

        requirePageAccess("kyc"),
        
        approveKyc
        
        );
        
        
        
        router.patch(
        
        "/kyc/:id/reject",

        requirePageAccess("kyc"),
        
        rejectKyc
        
        );


router.get(

"/broadcast",

requirePageAccess("broadcast"),

getBroadcasts

);


router.post(

"/broadcast",

requirePageAccess("broadcast"),

createBroadcast

);

router.get(
"/broadcast/females",
requirePageAccess("broadcast"),
listBroadcastFemales
);

router.get(
"/broadcast/female-languages",
requirePageAccess("broadcast"),
listFemaleBroadcastLanguages
);

router.get(
"/broadcast/audience-count",
requirePageAccess("broadcast"),
getBroadcastAudienceCount
);

router.get(
"/broadcast/males",
requirePageAccess("broadcast"),
listBroadcastMales
);

router.post(
"/broadcast/individual",
requirePageAccess("broadcast"),
createIndividualBroadcast
);

router.get(
"/broadcast/schedules/summary",
requirePageAccess("scheduled-broadcast"),
getBroadcastScheduleSummary
);

router.get(
"/broadcast/schedules",
requirePageAccess("scheduled-broadcast"),
getBroadcastSchedules
);

router.post(
"/broadcast/schedules",
requirePageAccess("scheduled-broadcast"),
createBroadcastScheduleHandler
);

router.patch(
"/broadcast/schedules/:id",
requirePageAccess("scheduled-broadcast"),
updateBroadcastScheduleHandler
);

router.delete(
"/broadcast/schedules/:id",
requirePageAccess("scheduled-broadcast"),
cancelBroadcastScheduleHandler
);

router.get(
  "/notify/users",
  requirePageAccess("user-notify"),
  listNotifyUsers
);

router.get(
  "/notify/history",
  requirePageAccess("user-notify"),
  listAdminNotifyHistory
);

router.post(
  "/notify",
  requirePageAccess("user-notify"),
  sendAdminNotify
);

router.delete(
  "/notify/:id",
  requirePageAccess("user-notify"),
  deleteAdminNotify
);

router.get(
  "/female-scratch-rewards/users",
  requirePageAccess("female-scratch-reward"),
  listScratchRewardUsers
);

router.get(
  "/female-scratch-rewards",
  requirePageAccess("female-scratch-reward"),
  listScratchRewardHistory
);

router.post(
  "/female-scratch-rewards",
  requirePageAccess("female-scratch-reward"),
  sendScratchReward
);

router.get(
  "/female-scratch-rewards/:id/claims",
  requirePageAccess("female-scratch-claims"),
  listScratchRewardClaims
);

router.get(
  "/male-scratch-rewards/packages",
  requirePageAccess("male-scratch-reward"),
  listMaleScratchRewardPackages
);

router.get(
  "/male-scratch-rewards/users",
  requirePageAccess("male-scratch-reward"),
  listMaleScratchRewardUsers
);

router.get(
  "/male-scratch-rewards/audience-count",
  requirePageAccess("male-scratch-reward"),
  getMaleScratchRewardAudienceCount
);

router.get(
  "/male-scratch-rewards",
  requirePageAccess("male-scratch-reward"),
  listMaleScratchRewardHistory
);

router.post(
  "/male-scratch-rewards",
  requirePageAccess("male-scratch-reward"),
  sendMaleScratchReward
);

router.get(
  "/male-scratch-rewards/:id/claims",
  requirePageAccess("male-scratch-claims"),
  listMaleScratchRewardClaims
);

router.get(
  "/male-last-login",
  requirePageAccess("male-last-login"),
  listMaleLoginActivity
);

router.get(
  "/female-online",
  requirePageAccess("female-online"),
  listFemaleOnlineStatus
);

router.get(
  "/female-online/stale-preview",
  requirePageAccess("female-online"),
  previewStaleFemaleCreators
);

router.post(
  "/female-online/offline-all",
  requirePageAccess("female-online"),
  offlineAllFemaleCreators
);

router.post(
  "/female-online/offline-stale",
  requirePageAccess("female-online"),
  offlineStaleFemaleCreators
);

router.get(
  "/female-online/scheduler",
  requirePageAccess("female-online"),
  getFemaleOnlineScheduler
);

router.patch(
  "/female-online/scheduler",
  requirePageAccess("female-online"),
  updateFemaleOnlineScheduler
);

router.post(
  "/female-online/:id/offline",
  requirePageAccess("female-online"),
  offlineFemaleCreator
);

router.get(
"/support",
requirePageAccess("support"),
adminListTickets
);

router.get(
"/support/:id",
requirePageAccess("support"),
adminGetTicket
);

router.post(
"/support/:id/messages",
requirePageAccess("support"),
adminSendMessage
);

router.patch(
"/support/:id/status",
requirePageAccess("support"),
adminUpdateStatus
);

// REVENUE MODULE
router.get('/revenue/recharges', requirePageAccess('recharge-revenue'), revenueRecharges);
router.get('/revenue/summary', requirePageAccess('recharge-revenue'), revenueSummary);
router.get('/revenue/analytics', requirePageAccess('recharge-revenue'), revenueAnalytics);
router.get('/revenue/daily', requirePageAccess('daily-revenue'), getDailyRevenue);
router.get('/revenue/exclude-users', requirePageAccess('recharge-revenue'), getRevenueExcludeUsersConfig);
router.get('/revenue/exclude-users/search', requirePageAccess('recharge-revenue'), searchRevenueExcludeUsers);
router.put('/revenue/exclude-users', requirePageAccess('recharge-revenue'), updateRevenueExcludeUsersConfig);

router.get(
  "/expected-payouts",
  requirePageAccess("expected-payouts"),
  getExpectedPayouts
);

router.get(
  "/payouts/daily",
  requirePageAccess("daily-payouts"),
  getDailyPayout
);

export default router;