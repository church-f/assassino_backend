const { Redis } = require("ioredis");

const redis = new Redis(process.env.REDIS_URL);

redis.on("connect", () => console.log("[redis] connected"));
redis.on("error", (e) => console.error("[redis] error", e));

module.exports = {
  redis,
};