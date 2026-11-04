import express from "express";

import {
createTicket,
getTicketMessages,
myTickets,
sendTicketMessage
} from "../controllers/support.controller.js";
import {
askSupportAssistant,
escalateSupportAssistant,
getSupportAssistant
} from "../controllers/supportAssistant.controller.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router =
express.Router();

router.post(
"/create",
createTicket
);

// Creator support assistant (must stay above "/:userId").
router.get(
"/assistant",
authMiddleware,
getSupportAssistant
);

router.post(
"/assistant/ask",
authMiddleware,
askSupportAssistant
);

router.post(
"/assistant/escalate",
authMiddleware,
escalateSupportAssistant
);

router.get(
"/ticket/:ticketId/messages",
getTicketMessages
);

router.post(
"/ticket/:ticketId/messages",
sendTicketMessage
);

router.get(
"/:userId",
myTickets
);

export default router;
