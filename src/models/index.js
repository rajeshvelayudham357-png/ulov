import { User } from "./User.js";
import { Wallet } from "./Wallet.js";
import { WalletTransaction } from "./WalletTransaction.js";
import { CallHistory } from "./CallHistory.js";
import { Favorite } from "./Favorite.js";
import Otp from "./Otp.js";
import { Earning } from "./Earning.js";
import { Withdraw } from "./Withdraw.js";
import Kyc from "./Kyc.js";
import {
  SupportTicket
  } from "./SupportTicket.js";
import {
  SupportMessage
  } from "./SupportMessage.js";
  
  
  import {
  Broadcast
  } from "./Broadcast.js";

import { DeviceToken } from "./DeviceToken.js";
import { NotificationRecord } from "./NotificationRecord.js";
import { ChatMessage } from "./ChatMessage.js";
import { CallRating } from "./CallRating.js";
import { Block } from "./Block.js";

// =========================
// USER -> WALLET
// =========================

User.hasOne(
  Wallet,
  {
    foreignKey: "userId",
    as: "wallet"
  }
);


Wallet.belongsTo(
  User,
  {
    foreignKey: "userId"
  }
);



// =========================
// USER -> WALLET HISTORY
// =========================

User.hasMany(
  WalletTransaction,
  {
    foreignKey: "userId",
    as: "transactions"
  }
);


WalletTransaction.belongsTo(
  User,
  {
    foreignKey: "userId"
  }
);



// =========================
// USER -> CALL HISTORY
// =========================


// Male side - caller

User.hasMany(
  CallHistory,
  {
    foreignKey:"callerId",
    as:"calls"
  }
);


CallHistory.belongsTo(
  User,
  {
    foreignKey:"callerId",
    as:"caller"
  }
);




// Female side - receiver

User.hasMany(
  CallHistory,
  {
    foreignKey:"receiverId",
    as:"receivedCalls"
  }
);


CallHistory.belongsTo(
  User,
  {
    foreignKey:"receiverId",
    as:"receiver"
  }
);

// =========================
// CALL HISTORY -> EARNING
// =========================


CallHistory.hasOne(
  Earning,
  {
    foreignKey:"callId",
    as:"earning"
  }
);


Earning.belongsTo(
  CallHistory,
  {
    foreignKey:"callId",
    as:"call"
  }
);


// =========================
// USER -> FAVORITES
// =========================

User.hasMany(
  Favorite,
  {
   foreignKey:"userId",
   as:"favoriteList"
  }
 );
 
 
 Favorite.belongsTo(
  User,
  {
   foreignKey:"favoriteUserId",
   as:"profile"
  }
 );

Favorite.belongsTo(
 User,
 {
  foreignKey:"userId",
  as:"fan"
 }
);

User.hasMany(
 Favorite,
 {
  foreignKey:"favoriteUserId",
  as:"fanRecords"
 }
 );

// =========================
// USER -> EARNINGS
// =========================


User.hasMany(
  Earning,
  {
    foreignKey:"userId",
    as:"earnings"
  }
);


Earning.belongsTo(
  User,
  {
    foreignKey:"userId",
    as:"creator"
  }
);
 
  User.hasMany(
    Withdraw,
    {
    foreignKey:"userId"
    }
    );
    
    
    Withdraw.belongsTo(
    User,
    {
    foreignKey:"userId"
    }
    );

    User.hasOne(
      Kyc,
      {
       foreignKey:"userId"
      }
      );
      
      
      Kyc.belongsTo(
      User,
      {
       foreignKey:"userId"
      }
      );

      User.hasMany(
        SupportTicket,
        {
        foreignKey:"userId",
        as:"tickets"
        }
        );
        
        
        SupportTicket.belongsTo(
        User,
        {
        foreignKey:"userId",
        as:"user"
        }
        );

SupportTicket.hasMany(
SupportMessage,
{
foreignKey:"ticketId",
as:"messages"
}
);

SupportMessage.belongsTo(
SupportTicket,
{
foreignKey:"ticketId",
as:"ticket"
}
);

User.hasMany(
  DeviceToken,
  {
    foreignKey:"userId",
    as:"deviceTokens"
  }
);

DeviceToken.belongsTo(
  User,
  {
    foreignKey:"userId"
  }
);

User.hasMany(
  NotificationRecord,
  {
    foreignKey:"userId",
    as:"notifications"
  }
);

NotificationRecord.belongsTo(
  User,
  {
    foreignKey:"userId"
  }
);

User.hasMany(
  ChatMessage,
  {
    foreignKey:"senderId",
    as:"sentMessages"
  }
);

User.hasMany(
  ChatMessage,
  {
    foreignKey:"receiverId",
    as:"receivedMessages"
  }
);

ChatMessage.belongsTo(
  User,
  {
    foreignKey:"senderId",
    as:"sender"
  }
);

ChatMessage.belongsTo(
  User,
  {
    foreignKey:"receiverId",
    as:"receiver"
  }
);

User.hasMany(
 CallRating,
 {
  foreignKey:"callerId",
  as:"submittedRatings"
 }
);

User.hasMany(
 CallRating,
 {
  foreignKey:"femaleId",
  as:"receivedRatings"
 }
);

CallRating.belongsTo(
 User,
 {
  foreignKey:"callerId",
  as:"caller"
 }
);

CallRating.belongsTo(
 User,
 {
  foreignKey:"femaleId",
  as:"female"
 }
);

CallRating.belongsTo(
 CallHistory,
 {
  foreignKey:"callHistoryId",
  as:"callHistory"
 }
);

User.hasMany(
 Block,
 {
  foreignKey:"blockerId",
  as:"blockedList"
 }
);

User.hasMany(
 Block,
 {
  foreignKey:"blockedUserId",
  as:"blockedByList"
 }
);

Block.belongsTo(
 User,
 {
  foreignKey:"blockerId",
  as:"blocker"
 }
);

Block.belongsTo(
 User,
 {
  foreignKey:"blockedUserId",
  as:"blockedUser"
 }
);

      




// =========================
// EXPORTS
// =========================

export {

  User,

  Wallet,

  WalletTransaction,

  CallHistory,

  Favorite,

  Otp,

  Earning,
  Withdraw,
  Kyc,
  SupportTicket,
SupportMessage,
Broadcast,
DeviceToken,
NotificationRecord,
ChatMessage,
CallRating,
Block

};