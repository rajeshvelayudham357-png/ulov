import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import callRoutes from "./routes/call.routes.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/user.routes.js";
import favoriteRoutes from "./routes/favorite.route.js";
import walletRoutes
from "./routes/wallet.routes.js";

import callHistoryRoutes
from "./routes/callHistoryRoutes.js";
import earningRoutes
from "./routes/earning.route.js";

import femaleRoutes
from "./routes/female.routes.js";

import withdrawRoutes
from "./routes/withdraw.routes.js";

import kycRoutes
from "./routes/kyc.routes.js";

import leaderboardRoutes
from "./routes/leaderboard.routes.js";
import supportRoutes
from "./routes/support.routes.js";


import broadcastRoutes
from "./routes/broadcast.routes.js";

import adminRoutes
from "./routes/admin.routes.js";

import payoutRoutes
from "./routes/payout.routes.js";

import notificationRoutes
from "./routes/notification.routes.js";

import chatRoutes
from "./routes/chat.routes.js";

import ratingRoutes
from "./routes/rating.routes.js";

import blockRoutes
from "./routes/block.routes.js";

import newsRoutes
from "./routes/news.routes.js";

import spinWheelRoutes
from "./routes/spinWheel.routes.js";

import welcomeOfferRoutes
from "./routes/welcomeOffer.routes.js";

import paymentRoutes
from "./routes/payment.routes.js";

import googleBillingRoutes
from "./routes/googleBilling.routes.js";

import accountDeletionRoutes
from "./routes/accountDeletion.routes.js";

import adminAccountDeletionRoutes
from "./routes/adminAccountDeletion.routes.js";

import appSettingsRoutes
from "./routes/appSettings.routes.js";

import growthEventsRoutes
from "./routes/growthEvents.routes.js";

/* 
import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";
import callRoutes from "./routes/call.routes.js";
 */
const app = express();

const __filename =
fileURLToPath(import.meta.url);

const __dirname =
path.dirname(__filename);

app.use(cors());

app.use(express.json());
/* app.use(
    cors({
      origin: "http://localhost:8081", // adjust if Expo Web is using a different port
      credentials: true,
    })
  ); */

app.get("/", (req, res) => {
    res.send("Dating Backend API is running 🚀");
  });

app.use(
  "/uploads",
  express.static(
    path.join(__dirname, "../uploads")
  )
);

  app.use(
    "/api/auth",
    authRoutes
    );
    app.use(
      "/api/users",
      userRoutes
     );
     app.use(
      "/api/favorites",
      favoriteRoutes
     );

     app.use(
      "/api/wallet",
      walletRoutes
     );
     app.use(
      "/api/calls",
      callHistoryRoutes
      );

      app.use(
        "/api/earnings",
        earningRoutes
        );

        app.use(
          "/api/female",
          femaleRoutes
          );
          app.use(
            "/api/withdraw",
            withdrawRoutes
            );

            app.use(
              "/api/kyc",
              kycRoutes
              );
              app.use(
                "/api/leaderboard",
                leaderboardRoutes
                );
                app.use(
                  "/api/support",
                  supportRoutes
                  );
                  
                  
                  app.use(
                  "/api/broadcast",
                  broadcastRoutes
                  );
                  app.use(
                    "/api/admin",
                    adminRoutes
                    );

                    app.use(
                      "/api/admin/payouts",
                      
                      payoutRoutes
                      
                      );

                    app.use(
                      "/api/notifications",
                      notificationRoutes
                      );

                    app.use(
                      "/api/chat",
                      chatRoutes
                      );

                    app.use(
                      "/api/ratings",
                      ratingRoutes
                      );

                    app.use(
                      "/api/blocks",
                      blockRoutes
                      );

                    app.use(
                      "/api/news",
                      newsRoutes
                      );

                    app.use(
                      "/api/spin-wheel",
                      spinWheelRoutes
                      );

                    app.use(
                      "/api/welcome-offer",
                      welcomeOfferRoutes
                      );

                    app.use(
                      "/api/payments",
                      paymentRoutes
                      );

                    app.use(
                      "/api/payment",
                      googleBillingRoutes
                      );

                    app.use(
                      "/api/google-play",
                      googleBillingRoutes
                      );

                    app.use(
                      "/api/account-deletion",
                      accountDeletionRoutes
                      );

                    app.use(
                      "/api/admin/account-deletion",
                      adminAccountDeletionRoutes
                      );

                    app.use(
                      "/api/app",
                      appSettingsRoutes
                      );

                    app.use(
                      "/api/events",
                      growthEventsRoutes
                      );

                   
/* 
app.use("/api/auth", authRoutes);

app.use("/api/users", userRoutes);

app.use("/api/call", callRoutes);
 */
app.use("/api/call", callRoutes);
export default app;