const { redis } = require("./redis.client.js");

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

module.exports = {
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
};