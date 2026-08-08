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

    getCallRateConfig,

    updateCallRateConfig,

    getAppSettingsConfig,

    updateAppSettingsConfig,

    getGstSettingsConfig,

    updateGstSettingsConfig,

    getPaymentSettingsConfig,

    updatePaymentSettingsConfig,

    getGiftSettingsConfig,

    updateGiftSettingsConfig,

    getCreatorCallRateConfig,

    updateCreatorCallRateConfig,

    getMasterTasks,

    createMasterTask,

    updateMasterTask,

    dashboard,
    
    users,

    maleUsers,
    
    calls,

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

createBroadcast

} from "../controllers/broadcast.controller.js";

import {
  listNotifyUsers,
  sendAdminNotify,
  listAdminNotifyHistory,
} from "../controllers/adminNotify.controller.js";

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



const router =
express.Router();


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
"/male-users",
requirePageAccess("male-users"),
maleUsers
);


router.get(
"/calls",
requirePageAccess("calls"),
calls
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
"/revenue",
requirePageAccess("recharge-revenue"),
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
      requirePageAccess("users"),
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

export default router;