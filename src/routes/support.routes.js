import express from "express";

import {
createTicket,
myTickets,
replyTicket
}
from "../controllers/support.controller.js";


const router =
express.Router();


router.post(
"/create",
createTicket
);


router.get(
"/:userId",
myTickets
);


router.put(
"/reply/:id",
replyTicket
);


export default router;