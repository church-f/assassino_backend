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
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "POST"],
  }
});

let rooms = new Map()

app.set("trust proxy", 1);

app.use(cors({
  origin: process.env.WEB_ORIGIN,
  credentials: true,
}));

app.use(express.json());
app.use(cookieParser());

app.get("/health", (req, res) => res.json({ ok: true }));

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


io.use((socket, next) => {
  const { roomCode, playerId } = socket.handshake.auth || {};

  const room = rooms.get(roomCode);
  const player = room?.players.find(p => p.playerId === playerId);
  if (!room || !player) return next(new Error('not authorized'));

  socket.data.roomCode = roomCode;
  socket.data.playerId = playerId;
  next();
});

io.on('connection', (socket) => {
  const { roomCode, playerId } = socket.data;
  console.log(`Socket connected to room ${roomCode} with player ID ${playerId}`);
  const room = rooms.get(roomCode);
  const player = room.players.find(p => p.playerId === playerId);

  // aggiorno SEMPRE il socketId alla connessione
  player.socketId = socket.id;
  player.online = true;

  socket.join(roomCode);

  io.to(roomCode).emit('room-updated', sanitizeRoom(room));
  console.log(JSON.stringify(room));

  socket.on('disconnect', () => {
    // non lo elimini subito
    // if (player.socketId === socket.id) {
    //   player.online = false;
    // }
    if (player.socketId === socket.id) {
      player.online = false;
    }
    room.players = room.players.filter(p => p.playerId !== playerId);
    console.log(`Socket disconnected from room ${roomCode} with player ID ${playerId}`);
    io.to(roomCode).emit('room-updated', sanitizeRoom(room));
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

function startGame(req, res, roomCode) {
  if (rooms.has(roomCode)) {
    if (rooms.get(roomCode).players.length < 1) {
      return res.status(400).json({ error: 'Not enough players to start the game' });
    }
    let room = rooms.get(roomCode);
    room.status = 'in-game';
    room.lastActivityAt = new Date();
    createRoles(room.players.filter(p => !p.isWaiting));
    console.log(`Game started in room: ${JSON.stringify(room)}`);
    io.to(roomCode).emit('room-updated', sanitizeRoom(room));
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Room not found' });
  }
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
  rooms.set(roomCode, newRoom);
  console.log(`Room created: ${JSON.stringify(newRoom)}`);
  res.json({ roomCode, playerId });
})

app.get('/rooms/all', async (req, res) => {
  const allRooms = Array.from(rooms.values()).map(room => ({
    code: room.code,
    status: room.status,
    playerCount: room.players.length,
    players: room.players.map(p => ({
      playerId: p.playerId,
      name: p.name,
      isAdmin: p.isAdmin,
      online: p.online,
      isWaiting: p.isWaiting
    })),
    createdAt: room.createdAt,
    lastActivityAt: room.lastActivityAt
  }));
  res.json({ rooms: allRooms });
})


app.get('/rooms/:code', async (req, res) => {
  let roomCode = req.params.code;
  if (rooms.has(roomCode)) {
    let room = rooms.get(roomCode);
    res.json({ exists: true, status: room.status, players: room.players });
  } else {
    res.status(404).json({ error: 'Room not found' });
  }
});

app.post('/rooms/:code/join', async (req, res) => {
  let roomCode = req.params.code;
  let playerName = req.body.playerName;
  let playerId = randomUUID();
  if (rooms.has(roomCode)) {
    let room = rooms.get(roomCode);
    // if (room.status == 'lobby') {


    room.players.push({
      name: playerName,
      isAdmin: false,
      socketId: null,
      role: null,
      playerId: playerId,
      isWaiting: room.status !== 'lobby',
      online: true
    });
    room.lastActivityAt = new Date();
    console.log(`Player joined room: ${JSON.stringify(room)}`);
    res.json({ success: true, playerId, isWaiting: room.status !== 'lobby' });
    // } else {
    //   res.status(400).json({ error: 'Cannot join, game already started' });
    // }
  } else {
    res.status(404).json({ error: 'Room not found' });
  }
});

app.post('/rooms/:code/start', async (req, res) => {
  let roomCode = req.params.code;
  startGame(req, res, roomCode);
});


app.post('/rooms/:code/end', async (req, res) => {
  let roomCode = req.params.code;
  if (rooms.has(roomCode)) {
    let room = rooms.get(roomCode);
    room.lastActivityAt = new Date();
    room.status = 'ended';
    room.players.map(p => {
      if (p.isWaiting) p.isWaiting = false
    })
    startGame(req, res, roomCode)
  } else {
    res.status(404).json({ error: 'Room not found' });
  }
})

app.post('/rooms/:code/leave', async (req, res) => {
  let roomCode = req.params.code;
  let playerId = req.body.playerId;
  if (rooms.has(roomCode)) {
    let room = rooms.get(roomCode);
    room.players = room.players.filter(p => p.playerId !== playerId);
    room.lastActivityAt = new Date();
    rooms.set(roomCode, room);
    io.to(roomCode).emit('room-updated', sanitizeRoom(room));
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Room not found' });
  }
});

const port = Number(process.env.PORT || 5000);
server.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});
