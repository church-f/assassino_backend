const {
    redisCreateRoom,
    redisGetRoom,
    redisAddPlayer,
    redisRemovePlayer,
    redisRoomExists
} = require('../../rooms.redis');
const { redis } = require('../../redis.client');

const roomCode = 'TEST123';
let newRoom = {
    code: roomCode, 
    players: [
        {
            name: 'testAdmin',
            isAdmin: true,
            socketId: null,
            role: null,
            playerId: 'testAdmin123',
            isWaiting: false,
            online: true,
            firebaseUid: null,
            entrance: 0,
            avatar: 0,
            color: 1
        }
    ],
    createdAt: new Date(),
    lastActivityAt: new Date(),
    status: 'lobby'
};

describe('Redis Room Management', () => {
    beforeEach(async () => {
        // Pulisci Redis prima di ogni test
        await redis.flushdb();
    });

    afterAll(async () => {
        await redis.quit();
    });

    test('should create a new room', async () => {
        await redisCreateRoom(roomCode, newRoom);

        const exists = await redisRoomExists(roomCode);
        expect(exists).toBe(true);
    });

    test('should add player to room', async () => {
        // const roomCode = 'TEST123';
        await redisCreateRoom(roomCode, newRoom);

        const player = {
            playerId: 'player1',
            name: 'Test Player',
            isAdmin: false
        };

        await redisAddPlayer(roomCode, player);
        const room = await redisGetRoom(roomCode);

        expect(room.players).toHaveLength(2); // 1 admin + 1 player
        expect(room.players[0].name).toBe('Test Player');
    });

    test('should remove player from room', async () => {
        await redisCreateRoom(roomCode, newRoom);

        const player = { playerId: 'player1', name: 'Test' };
        await redisAddPlayer(roomCode, player);
        await redisRemovePlayer(roomCode, 'player1');

        const room = await redisGetRoom(roomCode);
        expect(room.players).toHaveLength(1); // Solo l'admin rimane
        expect(room.players[0].playerId).toBe('testAdmin123');
    });
});