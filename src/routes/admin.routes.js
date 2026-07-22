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

    revenue,

    rechargeRevenue,
    
    getUserDetails,
    
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
"/revenue",
requirePageAccess("recharge-revenue"),
revenue
);


router.get(
"/recharge-revenue",
requirePageAccess("recharge-revenue"),
rechargeRevenue
);

// USER DETAILS

router.get(

    "/users/:id",

    requirePageAccess("users"),
    
    getUserDetails
    
    );
    
    
    
    
    // BLOCK / UNBLOCK USER
    
    router.patch(
    
    "/users/:id/block",

    requirePageAccess("users"),
    
    blockUser
    
    );


    router.delete(
    
    "/users/:id",

    requirePageAccess("users"),
    
    deleteUser
    
    );
    
    
    
    
    // VERIFY CREATOR
    
    router.patch(
    
    "/users/:id/verify",

    requirePageAccess("kyc"),
    
    verifyUser
    
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

export default router;