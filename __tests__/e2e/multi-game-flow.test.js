const request = require("supertest");
const { io:  ClientIO } = require("socket.io-client");
const { redis } = require("../../redis.client");

let app, server;

beforeAll(() => {
    const modules = require("../../index");
    app = modules.app;
    server = modules.server;
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

// ✅ Helper per creare una stanza completa
async function createGameRoom(baseUrl, roomName, playerCount) {
    console.log(`\n🎮 Creating room:  ${roomName} with ${playerCount} players`);
    
    // Crea la stanza
    const createRes = await request(app)
        .post("/rooms")
        .send({ playerName: `${roomName}-host` })
        .expect(200);

    const { roomCode, playerId:  hostId } = createRes.body;
    console.log(`  ✅ Room ${roomName} created: ${roomCode}`);

    // Aggiungi altri giocatori
    const players = [];
    for (let i = 1; i < playerCount; i++) {
        const joinRes = await request(app)
            .post(`/rooms/${roomCode}/join`)
            .send({ playerName: `${roomName}-p${i}` })
            .expect(200);
        players.push(joinRes.body. playerId);
    }

    // Connetti tutti i socket
    const sockets = [];
    const hostSocket = await connectWs(baseUrl, { roomCode, playerId: hostId });
    sockets.push(hostSocket);

    for (const playerId of players) {
        const socket = await connectWs(baseUrl, { roomCode, playerId });
        sockets.push(socket);
    }

    // Consuma il primo room-updated
    await Promise.all(
        sockets.map(s => onceWithTimeout(s, "room-updated", 3000))
    );

    console.log(`  ✅ All ${playerCount} sockets connected for room ${roomName}`);

    return {
        roomCode,
        hostId,
        playerIds: [hostId, ...players],
        sockets,
        hostSocket,
        playerCount,
    };
}

// ✅ Helper per avviare una partita
async function startGame(roomCode, hostSocket) {
    const inGamePromise = waitForRoomUpdate(
        hostSocket,
        (room) => room.status === "in-game",
        6000
    );

    await request(app)
        .post(`/rooms/${roomCode}/start`)
        .send({})
        .expect(200);

    return await inGamePromise;
}

// ✅ Helper per pulire una stanza
function cleanupRoom(sockets) {
    sockets.forEach(s => s. disconnect());
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
        await redis.quit();
    }, 20000);

    beforeEach(async () => {
        await redis.flushdb();
    }, 20000);

    // ✅ TEST:  3 partite simultanee con minimo 4 giocatori
    test("3 simultaneous games with minimum 4 players each", async () => {
        console.log("\n🚀 Starting test: 3 simultaneous games");

        // Crea 3 stanze con 4, 5 e 6 giocatori
        const game1 = await createGameRoom(baseUrl, "Game-A", 4);
        const game2 = await createGameRoom(baseUrl, "Game-B", 5);
        const game3 = await createGameRoom(baseUrl, "Game-C", 6);

        console.log("\n⏳ Starting all 3 games simultaneously...");

        // Avvia tutte e 3 le partite contemporaneamente
        const startTime = Date.now();
        const [room1, room2, room3] = await Promise.all([
            startGame(game1.roomCode, game1.hostSocket),
            startGame(game2.roomCode, game2.hostSocket),
            startGame(game3.roomCode, game3.hostSocket),
        ]);
        const duration = Date.now() - startTime;

        console. log(`\n✅ All 3 games started in ${duration}ms`);

        // ✅ Verifica Game 1 (4 giocatori)
        console.log(`\n🎮 Game A (${room1.code}):`);
        expect(room1.status).toBe("in-game");
        expect(room1.players.length).toBe(4);
        expect(room1.players.every(p => p.role != null)).toBe(true);
        console.log(`  ✅ Status: ${room1.status}`);
        console.log(`  ✅ Players: ${room1.players.length}`);
        console.log(`  ✅ Roles: ${room1.players.map(p => p.role).join(", ")}`);

        // ✅ Verifica Game 2 (5 giocatori)
        console.log(`\n🎮 Game B (${room2.code}):`);
        expect(room2.status).toBe("in-game");
        expect(room2.players.length).toBe(5);
        expect(room2.players.every(p => p. role != null)).toBe(true);
        console.log(`  ✅ Status: ${room2.status}`);
        console.log(`  ✅ Players: ${room2.players. length}`);
        console.log(`  ✅ Roles: ${room2.players.map(p => p.role).join(", ")}`);

        // ✅ Verifica Game 3 (6 giocatori)
        console.log(`\n🎮 Game C (${room3.code}):`);
        expect(room3.status).toBe("in-game");
        expect(room3.players.length).toBe(6);
        expect(room3.players.every(p => p. role != null)).toBe(true);
        console.log(`  ✅ Status: ${room3.status}`);
        console.log(`  ✅ Players: ${room3.players. length}`);
        console.log(`  ✅ Roles: ${room3.players.map(p => p.role).join(", ")}`);

        // ✅ Verifica che tutti i roomCode siano diversi
        const codes = [room1.code, room2.code, room3.code];
        const uniqueCodes = new Set(codes);
        expect(uniqueCodes.size).toBe(3);
        console.log(`\n✅ All 3 room codes are unique: ${codes.join(", ")}`);

        // ✅ Verifica che ogni partita abbia i giocatori corretti
        expect(room1.players.length).toBeGreaterThanOrEqual(4);
        expect(room2.players.length).toBeGreaterThanOrEqual(4);
        expect(room3.players.length).toBeGreaterThanOrEqual(4);

        // ✅ Verifica isolamento tra partite
        const allPlayerNames = [
            ...room1.players. map(p => p.name),
            ...room2.players. map(p => p.name),
            ...room3.players. map(p => p.name),
        ];
        const uniquePlayerNames = new Set(allPlayerNames);
        expect(uniquePlayerNames.size).toBe(4 + 5 + 6); // Nessun giocatore condiviso
        console.log(`✅ Total unique players across all games: ${uniquePlayerNames.size}`);

        // Cleanup
        cleanupRoom(game1.sockets);
        cleanupRoom(game2.sockets);
        cleanupRoom(game3.sockets);

        console.log(`\n🎉 Test completed successfully!`);
    }, 40000);
});