const request = require("supertest");
const { io: ClientIO } = require("socket.io-client");
const { redis } = require("../../redis.client");

// ✅ Import corretto
let app, server, io;

beforeAll(() => {
    // Carica i moduli DOPO aver configurato l'ambiente
    const modules = require("../../index");
    app = modules.app;
    server = modules.server;
    io = modules.io;
});

function onceWithTimeout(socket, event, ms = 2500) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => {
            socket.off(event, handler);
            reject(new Error(`Timeout waiting "${event}"`));
        }, ms);

        function handler(payload) {
            clearTimeout(t);
            socket.off(event, handler);
            resolve(payload);
        }

        socket.on(event, handler);
    });
}

async function waitForRoomUpdate(socket, condition, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            socket.off("room-updated", handler);
            reject(new Error(`Timeout waiting for room-updated condition within ${timeoutMs}ms`));
        }, timeoutMs);

        function handler(payload) {
            console.log("[waitForRoomUpdate] received:", payload?.status);

            if (condition(payload)) {
                clearTimeout(timeout);
                socket.off("room-updated", handler);
                resolve(payload);
            }
        }

        socket.on("room-updated", handler);
    });
}

async function connectWs(baseUrl, { roomCode, playerId }) {
    const s = ClientIO(baseUrl, {
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
        auth: { roomCode, playerId },
    });



    await onceWithTimeout(s, "connect", 2000);

    return s;
}

describe("E2E - game flow", () => {
    let httpServer;
    let baseUrl;

    beforeAll(async () => {
        await new Promise((res) => {
            httpServer = server.listen(0, res);
        });
        const { port } = httpServer.address();
        baseUrl = `http://localhost:${port}`;
        console.log(`Test server running on ${baseUrl}`);
    }, 30000);

    afterAll(async () => {
        if (httpServer) {
            await new Promise((res) => httpServer.close(res));
        }
        // ✅ Chiudi anche le connessioni Redis
        await redis.quit();
    }, 20000);

    beforeEach(async () => {
        await redis.flushdb();
    }, 20000);

    test("create -> join -> ws connect -> start -> room-updated (in-game)", async () => {
        const createRes = await request(app)
            .post("/rooms")
            .send({ playerName: "host" })
            .expect(200);

        const { roomCode, playerId: hostId } = createRes.body;
        console.log(`Created room: ${roomCode}`);

        const j1 = await request(app)
            .post(`/rooms/${roomCode}/join`)
            .send({ playerName: "p1" })
            .expect(200);

        const j2 = await request(app)
            .post(`/rooms/${roomCode}/join`)
            .send({ playerName: "p2" })
            .expect(200);

        const j3 = await request(app)
            .post(`/rooms/${roomCode}/join`)
            .send({ playerName: "p3" })
            .expect(200);

        const j4 = await request(app)
            .post(`/rooms/${roomCode}/join`)
            .send({ playerName: "p4" })
            .expect(200);

        const p1Id = j1.body.playerId;
        const p2Id = j2.body.playerId;
        const p3Id = j3.body.playerId;
        const p4Id = j4.body.playerId;

        const host = await connectWs(baseUrl, { roomCode, playerId: hostId });
        const p1 = await connectWs(baseUrl, { roomCode, playerId: p1Id });
        const p2 = await connectWs(baseUrl, { roomCode, playerId: p2Id });
        const p3 = await connectWs(baseUrl, { roomCode, playerId: p3Id });
        const p4 = await connectWs(baseUrl, { roomCode, playerId: p4Id });

        // Consuma il primo room-updated
        await Promise.all([
            onceWithTimeout(host, "room-updated", 3000),
            onceWithTimeout(p1, "room-updated", 3000),
            onceWithTimeout(p2, "room-updated", 3000),
            onceWithTimeout(p3, "room-updated", 3000),
            onceWithTimeout(p4, "room-updated", 3000),
        ]);

        console.log("✅ All sockets received initial room-updated");

        // Prepara l'ascolto PRIMA di /start
        const hostInGamePromise = waitForRoomUpdate(
            host,
            (room) => room.status === "in-game",
            6000
        );

        await request(app).post(`/rooms/${roomCode}/start`).send({}).expect(200);

        const updated = await hostInGamePromise;

        expect(updated).toBeTruthy();
        expect(updated.status).toBe("in-game");
        expect(updated.players.length).toBe(5);

        const roles = updated.players.map((p) => p.role);
        expect(roles.every((r) => r != null)).toBe(true);

        host.disconnect();
        p1.disconnect();
        p2.disconnect();
        p3.disconnect();
        p4.disconnect();
    });
});