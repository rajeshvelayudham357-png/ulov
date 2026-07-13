import express from "express";

import {
createTicket,
getTicketMessages,
myTickets,
sendTicketMessage
} from "../controllers/support.controller.js";

const router =
express.Router();

router.post(
"/create",
createTicket
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
