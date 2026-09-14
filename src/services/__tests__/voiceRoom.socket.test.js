import test from "node:test";
import assert from "node:assert/strict";
import { Op } from "sequelize";

import { sequelize } from "../../config/database.js";
import {
  closeVoiceRoomHandler,
  createVoiceRoomHandler,
  joinVoiceRoomSeatHandler,
  leaveVoiceRoomSeatHandler,
  startVoiceRoomHandler,
} from "../../controllers/voiceRoom.controller.js";
import { CallHistory } from "../../models/index.js";
import {
  VoiceRoom,
  VoiceRoomMemberSession,
  VoiceRoomSeat,
  VoiceRoomSession,
} from "../../models/index.js";
import {
  getVoiceRoomSocketRoomName,
  initVoiceRoomRealtime,
  resolveSocketUserId,
} from "../voiceRoomRealtime.service.js";
import { registerVoiceRoomSocketHandlers } from "../voiceRoomSocket.handlers.js";
import {
  ensureVoiceRoomSchema,
  resetVoiceRoomSchemaCacheForTests,
} from "../voiceRoomSchema.service.js";

const TEST_HOST_ID = 884001;
const TEST_USER_A = 884002;
const TEST_USER_B = 884003;
const TEST_IDS = [TEST_HOST_ID, TEST_USER_A, TEST_USER_B];

const createMockRes = () => {
  let statusCode = 200;
  let body = null;

  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
};

const authReq = (userId, params = {}, body = {}) => ({
  user: { id: userId },
  params,
  body,
});

const cleanup = async () => {
  await CallHistory.destroy({
    where: {
      [Op.or]: [
        { callerId: { [Op.in]: TEST_IDS } },
        { receiverId: { [Op.in]: TEST_IDS } },
      ],
    },
  });

  await VoiceRoomMemberSession.destroy({
    where: { userId: { [Op.in]: TEST_IDS } },
  });

  const hostedRooms = await VoiceRoom.findAll({
    where: { hostUserId: { [Op.in]: TEST_IDS } },
    attributes: ["id"],
  });
  const roomIds = hostedRooms.map((room) => room.id);

  if (roomIds.length) {
    await VoiceRoomSession.destroy({ where: { roomId: roomIds } });
    await VoiceRoomSeat.destroy({ where: { roomId: roomIds } });
    await VoiceRoom.destroy({ where: { id: roomIds } });
  }

  await sequelize.query("DELETE FROM users WHERE id IN (:userIds)", {
    replacements: { userIds: TEST_IDS },
  });
};

const seedUsers = async () => {
  for (const userId of TEST_IDS) {
    await sequelize.query(
      `INSERT INTO users (id, phone, username, name, gender, profileCompleted, createdAt, updatedAt)
       VALUES (:userId, :phone, :username, :name, :gender, 1, NOW(), NOW())
       ON DUPLICATE KEY UPDATE username = VALUES(username), updatedAt = NOW()`,
      {
        replacements: {
          userId,
          phone: `9200${userId}`,
          username: `vr_socket_${userId}`,
          name: `VR Socket ${userId}`,
          gender: userId === TEST_HOST_ID ? "male" : "female",
        },
      }
    );
  }
};

const enableFeature = async () => {
  await sequelize.query(
    "UPDATE admin_voice_room_settings SET enabled = 1 WHERE id = 1"
  );
  resetVoiceRoomSchemaCacheForTests();
};

const disableFeature = async () => {
  await sequelize.query(
    "UPDATE admin_voice_room_settings SET enabled = 0 WHERE id = 1"
  );
  resetVoiceRoomSchemaCacheForTests();
};

const createStartedRoom = async () => {
  const createRes = createMockRes();
  await createVoiceRoomHandler(
    authReq(TEST_HOST_ID, {}, { title: "Socket Room", maxSeats: 4 }),
    createRes
  );

  const roomId = createRes.body.room.id;
  const startRes = createMockRes();
  await startVoiceRoomHandler(authReq(TEST_HOST_ID, { roomId }), startRes);

  return { roomId, sessionId: startRes.body.room.session.id };
};

test.before(async () => {
  resetVoiceRoomSchemaCacheForTests();
  await ensureVoiceRoomSchema();
  await cleanup();
  await seedUsers();
});

test.beforeEach(async () => {
  await cleanup();
  await seedUsers();
  await enableFeature();
});

test.after(async () => {
  await disableFeature();
  await cleanup();
  await sequelize.close();
});

test("voice room socket room names stay isolated from call rooms", () => {
  assert.equal(getVoiceRoomSocketRoomName(15), "voice-room:15");
  assert.notEqual(getVoiceRoomSocketRoomName(15), "call_15");
});

test("resolveSocketUserId maps registered online users to sockets", () => {
  const onlineUsers = new Map([
    ["884001", "socket-a"],
    ["884002", "socket-b"],
  ]);

  assert.equal(resolveSocketUserId("socket-a", onlineUsers), "884001");
  assert.equal(resolveSocketUserId("missing", onlineUsers), null);
});

test("voice-room:join rejects unauthenticated sockets", async () => {
  const emitted = [];
  const io = {
    to: () => ({
      emit: (event, payload) => {
        emitted.push({ event, payload });
      },
    }),
  };
  const onlineUsers = new Map();
  const handlers = {};
  const socket = {
    id: "socket-unauth",
    data: {},
    async join() {},
    async leave() {},
    emit(event, payload) {
      emitted.push({ event, payload, target: "self" });
    },
    on(event, handler) {
      handlers[event] = handler;
    },
  };

  initVoiceRoomRealtime(io, onlineUsers);
  registerVoiceRoomSocketHandlers(io, socket, onlineUsers);

  let ackPayload = null;
  await handlers["voice-room:join"]({ roomId: 1 }, (payload) => {
    ackPayload = payload;
  });

  assert.equal(ackPayload.ok, false);
  assert.equal(ackPayload.code, "UNAUTHORIZED");
  assert.equal(emitted.length, 0);
});

test("voice-room:join succeeds for active members and emits authoritative state", async () => {
  const { roomId } = await createStartedRoom();

  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "2" }),
    createMockRes()
  );

  const emitted = [];
  const io = {
    to: (roomName) => ({
      emit: (event, payload) => {
        emitted.push({ event, payload, roomName });
      },
    }),
  };
  const onlineUsers = new Map([[String(TEST_USER_A), "socket-user-a"]]);
  const handlers = {};
  const joinedRooms = new Set();
  const socket = {
    id: "socket-user-a",
    data: {},
    async join(roomName) {
      joinedRooms.add(roomName);
    },
    async leave(roomName) {
      joinedRooms.delete(roomName);
    },
    emit(event, payload) {
      emitted.push({ event, payload, target: "self" });
    },
    on(event, handler) {
      handlers[event] = handler;
    },
  };

  initVoiceRoomRealtime(io, onlineUsers);
  registerVoiceRoomSocketHandlers(io, socket, onlineUsers);

  let ackPayload = null;
  await handlers["voice-room:join"]({ roomId }, (payload) => {
    ackPayload = payload;
  });

  assert.equal(ackPayload.ok, true);
  assert.equal(joinedRooms.has(getVoiceRoomSocketRoomName(roomId)), true);
  assert.equal(
    emitted.some(
      (item) => item.event === "voice-room:state" && item.target === "self"
    ),
    true
  );
  assert.equal(ackPayload.room.id, roomId);
});

test("duplicate voice-room:join is idempotent and does not create duplicate membership", async () => {
  const { roomId } = await createStartedRoom();

  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "3" }),
    createMockRes()
  );

  const io = { to: () => ({ emit: () => undefined }) };
  const onlineUsers = new Map([[String(TEST_USER_A), "socket-a"]]);
  const handlers = {};
  const socket = {
    id: "socket-a",
    data: {},
    async join() {},
    async leave() {},
    emit() {},
    on(event, handler) {
      handlers[event] = handler;
    },
  };

  initVoiceRoomRealtime(io, onlineUsers);
  registerVoiceRoomSocketHandlers(io, socket, onlineUsers);

  await handlers["voice-room:join"]({ roomId }, () => undefined);
  await handlers["voice-room:join"]({ roomId }, () => undefined);

  const activeCount = await VoiceRoomMemberSession.count({
    where: {
      roomId,
      userId: TEST_USER_A,
      status: { [Op.in]: ["joining", "connected", "billing"] },
    },
  });

  assert.equal(activeCount, 1);
});

test("API seat join emits voice-room:seat-taken after database success", async () => {
  const { roomId, sessionId } = await createStartedRoom();
  const emitted = [];

  initVoiceRoomRealtime(
    {
      to: (roomName) => ({
        emit: (event, payload) => {
          emitted.push({ event, payload, roomName });
        },
      }),
    },
    new Map()
  );

  const joinRes = createMockRes();
  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "2" }),
    joinRes
  );

  assert.equal(joinRes.statusCode, 200);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event, "voice-room:seat-taken");
  assert.equal(emitted[0].roomName, getVoiceRoomSocketRoomName(roomId));
  assert.equal(emitted[0].payload.seatIndex, 2);
  assert.equal(emitted[0].payload.userId, TEST_USER_A);
  assert.equal(emitted[0].payload.sessionId, sessionId);
});

test("API seat leave emits voice-room:seat-left after database success", async () => {
  const { roomId } = await createStartedRoom();
  const emitted = [];

  initVoiceRoomRealtime(
    {
      to: (roomName) => ({
        emit: (event, payload) => {
          emitted.push({ event, payload, roomName });
        },
      }),
    },
    new Map()
  );

  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "2" }),
    createMockRes()
  );

  emitted.length = 0;

  const leaveRes = createMockRes();
  await leaveVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "2" }),
    leaveRes
  );

  assert.equal(leaveRes.statusCode, 200);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event, "voice-room:seat-left");
  assert.equal(emitted[0].payload.seatIndex, 2);
});

test("room close emits voice-room:closed", async () => {
  const { roomId, sessionId } = await createStartedRoom();
  const emitted = [];

  initVoiceRoomRealtime(
    {
      to: (roomName) => ({
        emit: (event, payload) => {
          emitted.push({ event, payload, roomName });
        },
      }),
    },
    new Map()
  );

  await closeVoiceRoomHandler(authReq(TEST_HOST_ID, { roomId }), createMockRes());

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event, "voice-room:closed");
  assert.equal(emitted[0].payload.roomId, roomId);
  assert.equal(emitted[0].payload.sessionId, sessionId);
});

test("voice-room:join rejects closed rooms", async () => {
  const { roomId } = await createStartedRoom();
  await closeVoiceRoomHandler(authReq(TEST_HOST_ID, { roomId }), createMockRes());

  const io = { to: () => ({ emit: () => undefined }) };
  const onlineUsers = new Map([[String(TEST_HOST_ID), "socket-host"]]);
  const handlers = {};
  const socket = {
    id: "socket-host",
    data: {},
    async join() {},
    async leave() {},
    emit() {},
    on(event, handler) {
      handlers[event] = handler;
    },
  };

  initVoiceRoomRealtime(io, onlineUsers);
  registerVoiceRoomSocketHandlers(io, socket, onlineUsers);

  let ackPayload = null;
  await handlers["voice-room:join"]({ roomId }, (payload) => {
    ackPayload = payload;
  });

  assert.equal(ackPayload.ok, false);
  assert.match(ackPayload.message, /not live/i);
});

test("voice-room:leave only leaves socket room and preserves database membership", async () => {
  const { roomId } = await createStartedRoom();

  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "2" }),
    createMockRes()
  );

  const io = { to: () => ({ emit: () => undefined }) };
  const onlineUsers = new Map([[String(TEST_USER_A), "socket-a"]]);
  const handlers = {};
  const joinedRooms = new Set();
  const socket = {
    id: "socket-a",
    data: { voiceRoomSubscriptions: new Set([String(roomId)]) },
    async join(roomName) {
      joinedRooms.add(roomName);
    },
    async leave(roomName) {
      joinedRooms.delete(roomName);
    },
    emit() {},
    on(event, handler) {
      handlers[event] = handler;
    },
  };

  initVoiceRoomRealtime(io, onlineUsers);
  registerVoiceRoomSocketHandlers(io, socket, onlineUsers);

  await handlers["voice-room:join"]({ roomId }, () => undefined);

  let ackPayload = null;
  await handlers["voice-room:leave"]({ roomId }, (payload) => {
    ackPayload = payload;
  });

  assert.equal(ackPayload.ok, true);
  assert.equal(joinedRooms.has(getVoiceRoomSocketRoomName(roomId)), false);

  const activeCount = await VoiceRoomMemberSession.count({
    where: {
      roomId,
      userId: TEST_USER_A,
      status: { [Op.in]: ["joining", "connected", "billing"] },
    },
  });

  assert.equal(activeCount, 1);
});

test("voice-room:join allows live-room viewers without a seat so chat stays realtime", async () => {
  const { roomId } = await createStartedRoom();

  const emitted = [];
  const io = { to: () => ({ emit: () => undefined }) };
  const onlineUsers = new Map([[String(TEST_USER_A), "socket-a"]]);
  const handlers = {};
  const joinedRooms = new Set();
  const socket = {
    id: "socket-a",
    data: {},
    async join(roomName) {
      joinedRooms.add(roomName);
    },
    async leave(roomName) {
      joinedRooms.delete(roomName);
    },
    emit(event, payload) {
      emitted.push({ event, payload });
    },
    on(event, handler) {
      handlers[event] = handler;
    },
  };

  initVoiceRoomRealtime(io, onlineUsers);
  registerVoiceRoomSocketHandlers(io, socket, onlineUsers);

  let ackPayload = null;
  await handlers["voice-room:join"]({ roomId }, (payload) => {
    ackPayload = payload;
  });

  assert.equal(ackPayload.ok, true);
  assert.equal(joinedRooms.has(getVoiceRoomSocketRoomName(roomId)), true);
});

test("reconnect rejoins socket room without duplicate database membership", async () => {
  const { roomId } = await createStartedRoom();

  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "2" }),
    createMockRes()
  );

  const io = { to: () => ({ emit: () => undefined }) };
  const onlineUsers = new Map();

  const createTrackedSocket = (socketId) => {
    const handlers = {};
    const joinedRooms = new Set();

    const socket = {
      id: socketId,
      data: {},
      async join(roomName) {
        joinedRooms.add(roomName);
      },
      async leave(roomName) {
        joinedRooms.delete(roomName);
      },
      emit() {},
      on(event, handler) {
        handlers[event] = handler;
      },
    };

    return { socket, handlers, joinedRooms };
  };

  initVoiceRoomRealtime(io, onlineUsers);

  const oldConnection = createTrackedSocket("socket-old");
  onlineUsers.set(String(TEST_USER_A), "socket-old");
  registerVoiceRoomSocketHandlers(io, oldConnection.socket, onlineUsers);
  await oldConnection.handlers["voice-room:join"]({ roomId }, () => undefined);

  if (oldConnection.handlers.disconnect) {
    oldConnection.handlers.disconnect();
  }

  const newConnection = createTrackedSocket("socket-new");
  onlineUsers.set(String(TEST_USER_A), "socket-new");
  registerVoiceRoomSocketHandlers(io, newConnection.socket, onlineUsers);

  let ackPayload = null;
  await newConnection.handlers["voice-room:request-state"]({ roomId }, (payload) => {
    ackPayload = payload;
  });

  assert.equal(ackPayload.ok, true);
  assert.equal(
    newConnection.joinedRooms.has(getVoiceRoomSocketRoomName(roomId)),
    false
  );

  await newConnection.handlers["voice-room:join"]({ roomId }, (payload) => {
    ackPayload = payload;
  });

  assert.equal(ackPayload.ok, true);
  assert.equal(
    newConnection.joinedRooms.has(getVoiceRoomSocketRoomName(roomId)),
    true
  );

  const activeCount = await VoiceRoomMemberSession.count({
    where: {
      roomId,
      userId: TEST_USER_A,
      status: { [Op.in]: ["joining", "connected", "billing"] },
    },
  });

  assert.equal(activeCount, 1);
});

test("voice room handlers do not register existing call socket events", async () => {
  const registeredEvents = [];
  const io = { to: () => ({ emit: () => undefined }) };
  const onlineUsers = new Map();
  const socket = {
    id: "socket-isolation",
    data: {},
    async join() {},
    async leave() {},
    emit() {},
    on(event) {
      registeredEvents.push(event);
    },
  };

  registerVoiceRoomSocketHandlers(io, socket, onlineUsers);

  const forbiddenEvents = [
    "register-user",
    "call-user",
    "accept-call",
    "reject-call",
    "end-call",
  ];

  for (const event of forbiddenEvents) {
    assert.equal(
      registeredEvents.includes(event),
      false,
      `Voice Room must not register ${event}`
    );
  }

  assert.equal(registeredEvents.includes("voice-room:join"), true);
  assert.equal(registeredEvents.includes("voice-room:leave"), true);
  assert.equal(registeredEvents.includes("voice-room:request-state"), true);
});
