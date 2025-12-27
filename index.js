require("dotenv").config();

const http = require("http");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const authRoutes = require("./auth.routes");
const meRoutes = require("./me.routes");
const { attachSocket } = require("./socket");
const { createRoles, updatePlayerStats } = require("./utils");
const { randomUUID } = require("crypto");
const { Server } = require("socket.io");
// const { Redis } = require("ioredis");
// const redis = new Redis(process.env.REDIS_URL);
const app = express();
const {
  kRoom,
  kPlayers,
  kIndex,
  ROOM_TTL,
  redisRoomExists,
  redisGetRoom,
  redisSetRoomMeta,
  redisAddPlayer,
  redisUpdatePlayer,
  redisRemovePlayer,
  redisCreateRoom,
  redisListRoomsAll,
} = require("./rooms.redis");
const { redis } = require("./redis.client");
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "POST"],
  }
});

// let rooms = new Map()


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

async function generateRoomCode() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += letters.charAt(Math.floor(Math.random() * letters.length));
  }
  // Controlla che non ci siano stanze con lo stesso codice
  const exists = await redisRoomExists(code);
  if (exists) {
    return generateRoomCode();
  }
  console.log(`Generated room code: ${code}`);
  return code;
}

async function startGame(req, res, roomCode) {
  const room = await redisGetRoom(roomCode);
  if (!room) return res.status(404).json({ error: "Room not found" });

  if (room.players.length < (process.env.NODE_ENV === 'production' ? 4 : 1)) {
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
  let playerFirebaseUid = req.body.playerFirebaseUid;
  let playerId = randomUUID();
  let roomCode = await generateRoomCode();
  let newRoom = {
    code: roomCode, players: [
      {
        name: playerName ?? playerId,
        isAdmin: true,
        socketId: null,
        role: null,
        playerId: playerId,
        isWaiting: false,
        online: true,
        firebaseUid: playerFirebaseUid || null
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
  const playerFirebaseUid = req.body.playerFirebaseUid;
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
    firebaseUid: playerFirebaseUid || null
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

  // aggiorna statistiche
  const winningRole = req.body.winningRole;
  await updatePlayerStats(room, winningRole);

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
