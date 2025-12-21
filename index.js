require("dotenv").config();

const http = require("http");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const authRoutes = require("./auth.routes");
const meRoutes = require("./me.routes");
const { attachSocket } = require("./socket");

const app = express();
const server = http.createServer(app);

app.set("trust proxy", 1);

app.use(cors({
  origin: process.env.WEB_ORIGIN,
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/auth", authRoutes);
app.use(meRoutes);

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});

app.options('*', (req, res) => {
  res.sendStatus(204);
});

attachSocket(server);

const port = Number(process.env.PORT || 5000);
server.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});
