import express from "express";


import {

    adminLogin,

    requireAdmin,

    adminMe,

    getCallRateConfig,

    updateCallRateConfig,

    getAppSettingsConfig,

    updateAppSettingsConfig,

    getGstSettingsConfig,

    updateGstSettingsConfig,

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
    
    verifyUser,
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
"/call-rates",
getCallRateConfig
);


router.patch(
"/call-rates",
updateCallRateConfig
);


router.get(
"/app-settings",
getAppSettingsConfig
);


router.patch(
"/app-settings",
updateAppSettingsConfig
);


router.get(
"/gst-settings",
getGstSettingsConfig
);


router.patch(
"/gst-settings",
updateGstSettingsConfig
);


router.get(
"/gift-settings",
getGiftSettingsConfig
);


router.patch(
"/gift-settings",
updateGiftSettingsConfig
);


router.get(
"/spin-wheel",
getSpinWheelAdminSettings
);


router.patch(
"/spin-wheel",
updateSpinWheelAdminSettings
);


router.get(
"/spin-wheel/male-users",
getMaleUserSpinWheelSettings
);


router.patch(
"/spin-wheel/male-users/:id",
updateMaleUserSpinWheelSettings
);


router.get(
"/creator-call-rates",
getCreatorCallRateConfig
);


router.patch(
"/creator-call-rates/:id",
updateCreatorCallRateConfig
);


router.get(
"/master-tasks",
getMasterTasks
);


router.post(
"/master-tasks",
createMasterTask
);


router.patch(
"/master-tasks/:id",
updateMasterTask
);



router.get(
"/dashboard",
dashboard
);


router.get(
"/users",
users
);


router.get(
"/male-users",
maleUsers
);


router.get(
"/calls",
calls
);


router.get(
"/live-calls",
liveCalls
);


router.get(
"/creators",
creators
);


router.get(
"/creators/:id",
getCreatorDetails
);


router.get(
"/creators/:id/day-calls",
getCreatorDayCalls
);


router.get(
"/analytics",
analytics
);


router.get(
"/revenue",
revenue
);


router.get(
"/recharge-revenue",
rechargeRevenue
);

// USER DETAILS

router.get(

    "/users/:id",
    
    getUserDetails
    
    );
    
    
    
    
    // BLOCK / UNBLOCK USER
    
    router.patch(
    
    "/users/:id/block",
    
    blockUser
    
    );
    
    
    
    
    // VERIFY CREATOR
    
    router.patch(
    
    "/users/:id/verify",
    
    verifyUser
    
    );

    router.get(

        "/kyc",
        
        kycRequests
        
        );
        
        
        
        router.patch(
        
        "/kyc/:id/approve",
        
        approveKyc
        
        );
        
        
        
        router.patch(
        
        "/kyc/:id/reject",
        
        rejectKyc
        
        );


router.get(

"/broadcast",

getBroadcasts

);


router.post(

"/broadcast",

createBroadcast

);

router.get(
"/support",
adminListTickets
);

router.get(
"/support/:id",
adminGetTicket
);

router.post(
"/support/:id/messages",
adminSendMessage
);

router.patch(
"/support/:id/status",
adminUpdateStatus
);

export default router;