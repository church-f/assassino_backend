const { Server } = require("socket.io");
const cookie = require("cookie");
const { initFirebaseAdmin } = require("./firebaseAdmin");

const admin = initFirebaseAdmin();
const COOKIE_NAME = process.env.COOKIE_NAME || "session";

function attachSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.WEB_ORIGIN,
      credentials: true
    }
  });

  io.use(async (socket, next) => {
    try {
      const header = socket.request.headers.cookie || "";
      const cookies = cookie.parse(header);
      const sessionCookie = cookies[COOKIE_NAME];
      if (!sessionCookie) return next(new Error("unauthorized"));

      const decoded = await admin.auth().verifySessionCookie(sessionCookie, true);
      socket.user = { uid: decoded.sub };
      next();
    } catch (err) {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.emit("hello", { uid: socket.user.uid });

    socket.on("ping", () => socket.emit("pong"));
  });

  return io;
}

module.exports = { attachSocket };
