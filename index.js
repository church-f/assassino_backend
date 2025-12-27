require("dotenv").config();

const http = require("http");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const authRoutes = require("./auth.routes");
const meRoutes = require("./me.routes");
const { attachSocket } = require("./socket");
const { createRoles } = require("./utils");
const { randomUUID } = require("crypto");
const { Server } = require("socket.io");
const { Redis } = require("ioredis");
const redis = new Redis(process.env.REDIS_URL);
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "POST"],
  }
});

// let rooms = new Map()

const ROOM_TTL = 60 * 60 * 12; // 12h

const kRoom = (code) => `room:${code}`;
const kPlayers = (code) => `room:${code}:players`;
const kIndex = `rooms:index`;

async function redisRoomExists(code) {
  return (await redis.exists(kRoom(code))) === 1;
}

async function redisGetRoom(code) {
  const [meta, playersHash] = await redis
    .multi()
    .hgetall(kRoom(code))
    .hgetall(kPlayers(code))
    .exec()
    .then(r => r.map(x => x[1]));

  if (!meta || Object.keys(meta).length === 0) return null;

  const players = Object.values(playersHash || {})
    .map((json) => { try { return JSON.parse(json); } catch { return null; } })
    .filter(Boolean);

  return {
    code,
    status: meta.status,
    createdAt: meta.createdAt ? new Date(Number(meta.createdAt)) : null,
    lastActivityAt: meta.lastActivityAt ? new Date(Number(meta.lastActivityAt)) : null,
    players,
  };
}

async function redisSetRoomMeta(code, patch) {
  const toWrite = {};
  for (const [k, v] of Object.entries(patch)) {
    toWrite[k] = v instanceof Date ? String(v.getTime()) : String(v);
  }

  await redis
    .multi()
    .hset(kRoom(code), toWrite)
    .expire(kRoom(code), ROOM_TTL)
    .exec();
}

async function redisAddPlayer(code, player) {
  await redis
    .multi()
    .hset(kPlayers(code), player.playerId, JSON.stringify(player))
    .expire(kPlayers(code), ROOM_TTL)
    .expire(kRoom(code), ROOM_TTL)
    .exec();
}

async function redisUpdatePlayer(code, playerId, patch) {
  const json = await redis.hget(kPlayers(code), playerId);
  if (!json) return null;

  const p = JSON.parse(json);
  Object.assign(p, patch);

  await redis
    .multi()
    .hset(kPlayers(code), playerId, JSON.stringify(p))
    .expire(kPlayers(code), ROOM_TTL)
    .exec();

  return p;
}

async function redisRemovePlayer(code, playerId) {
  await redis
    .multi()
    .hdel(kPlayers(code), playerId)
    .expire(kPlayers(code), ROOM_TTL)
    .exec();
}

async function redisCreateRoom(code, roomObj) {
  // crea stanza solo se non esiste (usiamo createdAt come “marker”)
  const created = await redis.hsetnx(kRoom(code), "createdAt", String(roomObj.createdAt.getTime()));
  if (created === 0) return { ok: false, reason: "ROOM_EXISTS" };

  const meta = {
    code,
    status: roomObj.status,
    lastActivityAt: String(roomObj.lastActivityAt.getTime()),
  };

  const multi = redis.multi();
  multi.hset(kRoom(code), meta);
  multi.sadd(kIndex, code);

  // players
  for (const p of roomObj.players) {
    multi.hset(kPlayers(code), p.playerId, JSON.stringify(p));
  }

  multi.expire(kRoom(code), ROOM_TTL);
  multi.expire(kPlayers(code), ROOM_TTL);

  await multi.exec();
  return { ok: true };
}

async function redisListRoomsAll() {
  const codes = await redis.smembers(kIndex);
  if (!codes.length) return [];

  const multi = redis.multi();
  for (const c of codes) {
    multi.hgetall(kRoom(c));
    multi.hgetall(kPlayers(c));
  }
  const res = await multi.exec();

  const rooms = [];
  const stale = [];

  for (let i = 0; i < codes.length; i++) {
    const meta = res[i * 2]?.[1];
    const playersHash = res[i * 2 + 1]?.[1];

    if (!meta || Object.keys(meta).length === 0) {
      stale.push(codes[i]);
      continue;
    }

    const players = Object.values(playersHash || {})
      .map((json) => { try { return JSON.parse(json); } catch { return null; } })
      .filter(Boolean);

    rooms.push({
      code: codes[i],
      status: meta.status,
      playerCount: players.length,
      players,
      createdAt: meta.createdAt ? new Date(Number(meta.createdAt)) : null,
      lastActivityAt: meta.lastActivityAt ? new Date(Number(meta.lastActivityAt)) : null,
    });
  }

  if (stale.length) await redis.srem(kIndex, ...stale);
  return rooms;
}


app.set("trust proxy", 1);

app.use(cors({
  origin: process.env.WEB_ORIGIN,
  credentials: true,
}));

app.use(express.json());
app.use(cookieParser());

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/health/redis", async (req, res) => {
  try {
    await redis.set("health:test", "ok", "EX", 10);
    const v = await redis.get("health:test");
    res.json({ ok: true, value: v });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});


app.use("/auth", authRoutes);
app.use(meRoutes);

function sanitizeRoom(room) {
  return {
    code: room.code,
    status: room.status,
    players: room.players.map(p => ({
      playerId: p.playerId,
      name: p.name,
      isAdmin: p.isAdmin,
      online: !!p.online,
      role: room.status === 'in-game' ? p.role : null,
      isWaiting: p.isWaiting
    })),
  };
}


io.use(async (socket, next) => {
  const { roomCode, playerId } = socket.handshake.auth || {};

  const room = await redisGetRoom(roomCode);
  const player = room?.players.find(p => p.playerId === playerId);
  if (!room || !player) return next(new Error('not authorized'));

  socket.data.roomCode = roomCode;
  socket.data.playerId = playerId;
  next();
});

io.on('connection', async (socket) => {
  const { roomCode, playerId } = socket.data;
  console.log(`Socket connected to room ${roomCode} with player ID ${playerId}`);
  const room = await redisGetRoom(roomCode);
  const player = room.players.find(p => p.playerId === playerId);

  // aggiorno SEMPRE il socketId alla connessione
  // player.socketId = socket.id;
  // player.online = true;
  await redisUpdatePlayer(roomCode, playerId, { socketId: socket.id, online: true });

  socket.join(roomCode);

  const room2 = await redisGetRoom(roomCode);
  io.to(roomCode).emit("room-updated", sanitizeRoom(room2));
  console.log(JSON.stringify(room));

  socket.on('disconnect', async () => {
    // non lo elimini subito
    // if (player.socketId === socket.id) {
    //   player.online = false;
    // }
    const p = await redisUpdatePlayer(roomCode, playerId, { online: false });
    if (p?.socketId === socket.id) {
      await redisRemovePlayer(roomCode, playerId);
    }

    const room3 = await redisGetRoom(roomCode);
    if (room3) io.to(roomCode).emit("room-updated", sanitizeRoom(room3));
  });
});



app.use((req, res, next) => {
  // res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});

app.options('*', (req, res) => {
  res.sendStatus(204);
});

attachSocket(io);

function generateRoomCode() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += letters.charAt(Math.floor(Math.random() * letters.length));
  }
  return code;
}

async function startGame(req, res, roomCode) {
  const room = await redisGetRoom(roomCode);
  if (!room) return res.status(404).json({ error: "Room not found" });

  if (room.players.length < 1) {
    return res.status(400).json({ error: "Not enough players to start the game" });
  }

  room.status = "in-game";
  room.lastActivityAt = new Date();

  // assegna ruoli (muterà gli oggetti player)
  createRoles(room.players.filter(p => !p.isWaiting));

  // persisti status + lastActivityAt
  await redisSetRoomMeta(roomCode, { status: room.status, lastActivityAt: room.lastActivityAt });

  // persisti tutti i players aggiornati (ruoli)
  const multi = redis.multi();
  for (const p of room.players) {
    multi.hset(kPlayers(roomCode), p.playerId, JSON.stringify(p));
  }
  multi.expire(kPlayers(roomCode), ROOM_TTL);
  await multi.exec();

  const snap = await redisGetRoom(roomCode);
  io.to(roomCode).emit("room-updated", sanitizeRoom(snap));
  res.json({ success: true });
}


app.post('/rooms', async (req, res) => {
  let playerName = req.body.playerName;
  let playerId = randomUUID();
  let roomCode = generateRoomCode();
  let newRoom = {
    code: roomCode, players: [
      {
        name: playerName ?? playerId,
        isAdmin: true,
        socketId: null,
        role: null,
        playerId: playerId,
        isWaiting: false,
        online: true
      }
    ],
    createdAt: new Date(),
    lastActivityAt: new Date(),
    status: 'lobby'
  };
  const r = await redisCreateRoom(roomCode, newRoom);
  if (!r.ok) return res.status(409).json(r);
  res.json({ roomCode, playerId });
})

app.get('/rooms/all', async (req, res) => {
  const rooms = await redisListRoomsAll();
  res.json({ rooms: rooms });
})


app.get("/rooms/:code", async (req, res) => {
  const room = await redisGetRoom(req.params.code);
  if (!room) return res.status(404).json({ error: "Room not found" });

  res.json({ exists: true, status: room.status, players: room.players });
});


app.post("/rooms/:code/join", async (req, res) => {
  const roomCode = req.params.code;
  const playerName = req.body.playerName;
  const playerId = randomUUID();

  const room = await redisGetRoom(roomCode);
  if (!room) return res.status(404).json({ error: "Room not found" });

  const player = {
    name: playerName,
    isAdmin: false,
    socketId: null,
    role: null,
    playerId,
    isWaiting: room.status !== "lobby",
    online: true,
  };

  await redisAddPlayer(roomCode, player);
  await redisSetRoomMeta(roomCode, { lastActivityAt: new Date() });

  res.json({ success: true, playerId, isWaiting: room.status !== "lobby" });
});


app.post('/rooms/:code/start', async (req, res) => {
  let roomCode = req.params.code;
  startGame(req, res, roomCode);
});


app.post("/rooms/:code/end", async (req, res) => {
  const roomCode = req.params.code;
  const room = await redisGetRoom(roomCode);
  if (!room) return res.status(404).json({ error: "Room not found" });

  // status ended
  await redisSetRoomMeta(roomCode, { status: "ended", lastActivityAt: new Date() });

  // reset waiting
  const multi = redis.multi();
  for (const p of room.players) {
    if (p.isWaiting) p.isWaiting = false;
    multi.hset(kPlayers(roomCode), p.playerId, JSON.stringify(p));
  }
  await multi.exec();

  // riparti col game (come fai ora)
  startGame(req, res, roomCode);
});


app.post("/rooms/:code/leave", async (req, res) => {
  const roomCode = req.params.code;
  const playerId = req.body.playerId;

  const exists = await redisRoomExists(roomCode);
  if (!exists) return res.status(404).json({ error: "Room not found" });

  await redisRemovePlayer(roomCode, playerId);
  await redisSetRoomMeta(roomCode, { lastActivityAt: new Date() });

  const snap = await redisGetRoom(roomCode);
  if (snap) io.to(roomCode).emit("room-updated", sanitizeRoom(snap));

  res.json({ success: true });
});


const port = Number(process.env.PORT || 5000);
server.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});
