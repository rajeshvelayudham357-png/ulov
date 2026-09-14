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
import {
  BroadcastSchedule
  } from "./BroadcastSchedule.js";

import { AdminNotify } from "./AdminNotify.js";
import { DeviceToken } from "./DeviceToken.js";
import { NotificationRecord } from "./NotificationRecord.js";
import { ChatMessage } from "./ChatMessage.js";
import { CallRating } from "./CallRating.js";
import { Block } from "./Block.js";
import { PaymentOrder } from "./PaymentOrder.js";
import { CallGiftRecord } from "./CallGiftRecord.js";
import { AccountDeletionRequest } from "./AccountDeletionRequest.js";
import { UserOnlineLog } from "./UserOnlineLog.js";
import { VoiceRoom } from "./VoiceRoom.js";
import { VoiceRoomSession } from "./VoiceRoomSession.js";
import { VoiceRoomSeat } from "./VoiceRoomSeat.js";
import { VoiceRoomMemberSession } from "./VoiceRoomMemberSession.js";
import { VoiceRoomBillingTick } from "./VoiceRoomBillingTick.js";
import { VoiceRoomEarning } from "./VoiceRoomEarning.js";
import { VoiceRoomMessage } from "./VoiceRoomMessage.js";
import { VoiceRoomGiftRecord } from "./VoiceRoomGiftRecord.js";
import { BattleInvite } from "./BattleInvite.js";
import { BattleRoom } from "./BattleRoom.js";
import { BattleFighter } from "./BattleFighter.js";
import { BattleAudienceSession } from "./BattleAudienceSession.js";
import { BattleGiftRecord } from "./BattleGiftRecord.js";

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

User.hasMany(
  CallGiftRecord,
  {
    foreignKey: "senderId",
    as: "sentGifts",
  }
);

User.hasMany(
  CallGiftRecord,
  {
    foreignKey: "receiverId",
    as: "receivedGifts",
  }
);

CallGiftRecord.belongsTo(
  User,
  {
    foreignKey: "senderId",
    as: "sender",
  }
);

CallGiftRecord.belongsTo(
  User,
  {
    foreignKey: "receiverId",
    as: "receiver",
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

User.hasMany(
  AccountDeletionRequest,
  {
    foreignKey: "userId",
    as: "accountDeletionRequests",
    constraints: false,
  }
);

AccountDeletionRequest.belongsTo(
  User,
  {
    foreignKey: "userId",
    as: "user",
    constraints: false,
  }
);


// =========================
// USER -> PAYMENT ORDERS
// =========================

User.hasMany(
  PaymentOrder,
  {
    foreignKey: "userId",
    as: "paymentOrders",
    constraints: false,
  }
);

PaymentOrder.belongsTo(
  User,
  {
    foreignKey: "userId",
    as: "user",
    constraints: false,
  }
);

// PaymentOrder -> Wallet (via shared userId, no FK constraint)
PaymentOrder.belongsTo(
  Wallet,
  {
    foreignKey: "userId",
    targetKey: "userId",
    as: "wallet",
    constraints: false,
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
BroadcastSchedule,
AdminNotify,
DeviceToken,
NotificationRecord,
ChatMessage,
CallRating,
Block,
PaymentOrder,
CallGiftRecord,
  AccountDeletionRequest,
  UserOnlineLog,
  VoiceRoom,
  VoiceRoomSession,
  VoiceRoomSeat,
  VoiceRoomMemberSession,
  VoiceRoomBillingTick,
  VoiceRoomEarning,
  VoiceRoomMessage,
  VoiceRoomGiftRecord,
  BattleInvite,
  BattleRoom,
  BattleFighter,
  BattleAudienceSession,
  BattleGiftRecord,

};

User.hasMany(UserOnlineLog, {
  foreignKey: "userId",
  as: "onlineLogs",
});

UserOnlineLog.belongsTo(User, {
  foreignKey: "userId",
  as: "user",
});

VoiceRoom.belongsTo(User, {
  foreignKey: "hostUserId",
  as: "host",
});

User.hasMany(VoiceRoom, {
  foreignKey: "hostUserId",
  as: "voiceRooms",
});

VoiceRoom.hasMany(VoiceRoomSession, {
  foreignKey: "roomId",
  as: "sessions",
});

VoiceRoomSession.belongsTo(VoiceRoom, {
  foreignKey: "roomId",
  as: "room",
});

VoiceRoom.hasMany(VoiceRoomSeat, {
  foreignKey: "roomId",
  as: "seats",
});

VoiceRoomSeat.belongsTo(VoiceRoom, {
  foreignKey: "roomId",
  as: "room",
});

VoiceRoomSeat.belongsTo(VoiceRoomMemberSession, {
  foreignKey: "memberSessionId",
  as: "memberSession",
  constraints: false,
});

VoiceRoomSession.hasMany(VoiceRoomMemberSession, {
  foreignKey: "sessionId",
  as: "memberSessions",
});

VoiceRoomMemberSession.belongsTo(VoiceRoomSession, {
  foreignKey: "sessionId",
  as: "session",
});

VoiceRoomMemberSession.belongsTo(User, {
  foreignKey: "userId",
  as: "user",
});

VoiceRoomMemberSession.hasMany(VoiceRoomBillingTick, {
  foreignKey: "memberSessionId",
  as: "billingTicks",
});

VoiceRoomBillingTick.belongsTo(VoiceRoomMemberSession, {
  foreignKey: "memberSessionId",
  as: "memberSession",
});

VoiceRoomSession.hasOne(VoiceRoomEarning, {
  foreignKey: "sessionId",
  as: "earning",
});

VoiceRoomEarning.belongsTo(VoiceRoomSession, {
  foreignKey: "sessionId",
  as: "session",
});

VoiceRoomSession.hasMany(VoiceRoomMessage, {
  foreignKey: "sessionId",
  as: "messages",
});

VoiceRoomMessage.belongsTo(VoiceRoomSession, {
  foreignKey: "sessionId",
  as: "session",
});

VoiceRoomMessage.belongsTo(User, {
  foreignKey: "userId",
  as: "user",
});

VoiceRoomSession.hasMany(VoiceRoomGiftRecord, {
  foreignKey: "sessionId",
  as: "giftRecords",
});

VoiceRoomGiftRecord.belongsTo(VoiceRoomSession, {
  foreignKey: "sessionId",
  as: "session",
});

BattleInvite.belongsTo(User, {
  foreignKey: "challengerId",
  as: "challenger",
});

BattleInvite.belongsTo(User, {
  foreignKey: "opponentId",
  as: "opponent",
});

BattleRoom.belongsTo(BattleInvite, {
  foreignKey: "inviteId",
  as: "invite",
});

BattleInvite.hasOne(BattleRoom, {
  foreignKey: "inviteId",
  as: "battle",
});

BattleRoom.hasMany(BattleFighter, {
  foreignKey: "battleId",
  as: "fighters",
});

BattleFighter.belongsTo(BattleRoom, {
  foreignKey: "battleId",
  as: "battle",
});

BattleFighter.belongsTo(User, {
  foreignKey: "userId",
  as: "user",
});

BattleRoom.hasMany(BattleAudienceSession, {
  foreignKey: "battleId",
  as: "audienceSessions",
});

BattleAudienceSession.belongsTo(BattleRoom, {
  foreignKey: "battleId",
  as: "battle",
});

BattleAudienceSession.belongsTo(User, {
  foreignKey: "userId",
  as: "user",
});

BattleRoom.hasMany(BattleGiftRecord, {
  foreignKey: "battleId",
  as: "giftRecords",
});

BattleGiftRecord.belongsTo(BattleRoom, {
  foreignKey: "battleId",
  as: "battle",
});