import express from "express";


import {

    adminLogin,

    requireAdmin,

    adminMe,

    getCallRateConfig,

    updateCallRateConfig,

    getCreatorCallRateConfig,

    updateCreatorCallRateConfig,

    getMasterTasks,

    createMasterTask,

    updateMasterTask,

    dashboard,
    
    users,
    
    calls,

    liveCalls,
    
    creators,
    
    getCreatorDetails,
    
    getCreatorDayCalls,
    
    analytics,

    revenue,
    
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