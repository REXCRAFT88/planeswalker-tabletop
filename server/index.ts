import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: process.env.NODE_ENV === 'production' ? false : "http://localhost:5173", // Allow Vite dev server
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3001;

// Serve static files from the React build directory
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../dist')));

    // Use regex literal to match any path
    app.get(/(.*)/, (req, res) => {
        res.sendFile(path.join(__dirname, '../dist/index.html'));
    });
}

interface Player {
    id: string; // socket.id
    userId: string; // persistent user id
    name: string;
    room: string;
    color: string;
    disconnected: boolean;
    disconnectedAt?: number;
}

// Store room state in memory for now
const rooms: Record<string, Player[]> = {};
const roomMeta: Record<string, { started: boolean, hostId?: string, gameType?: 'standard' | 'local_table' }> = {};
const roomStates: Record<string, Record<number, any>> = {}; // room -> seatIndex -> state
const pendingJoins: Record<string, { room: string, name: string, color: string, userId?: string }> = {};

const getSafeColor = (roomPlayers: Player[], requestedColor: string) => {
    const usedColors = new Set(roomPlayers.filter(p => !p.disconnected).map(p => p.color));
    if (!usedColors.has(requestedColor)) return requestedColor;

    const FALLBACK_COLORS = [
        '#ef4444', '#3b82f6', '#22c55e', '#a855f7',
        '#eab308', '#ec4899', '#06b6d4', '#f97316',
        '#6366f1', '#14b8a6', '#84cc16', '#d946ef'
    ];

    for (const c of FALLBACK_COLORS) {
        if (!usedColors.has(c)) return c;
    }
    return '#' + Math.floor(Math.random() * 16777215).toString(16);
};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join_room', ({ room, name, color, userId, isTable }) => {
        if (!room) return;
        room = room.trim().toUpperCase();
        if (!rooms[room]) {
            rooms[room] = [];
        }

        // Attempt to reconnect
        if (userId) {
            const existingPlayer = rooms[room].find(p => p.userId === userId);
            if (existingPlayer) {
                existingPlayer.disconnected = false;
                existingPlayer.id = socket.id; // Update socket id
                socket.join(room);

                // If the reconnected player was the host, re-assign host role
                if (roomMeta[room] && roomMeta[room].hostId === existingPlayer.userId) {
                    roomMeta[room].hostId = existingPlayer.id;
                }

                // Notify everyone about the reconnection (includes the old userId so clients can map)
                io.to(room).emit('room_players_update', { players: rooms[room], hostId: roomMeta[room]?.hostId });
                // Tell the room this is a reconnection, not a new player
                socket.to(room).emit('player_reconnected', {
                    newSocketId: socket.id,
                    userId: existingPlayer.userId,
                    name: existingPlayer.name
                });
                socket.emit('join_success', {
                    room,
                    playerId: socket.id,
                    userId: existingPlayer.userId,
                    isGameStarted: roomMeta[room]?.started || false,
                    isReconnect: true,
                    gameType: roomMeta[room]?.gameType
                });

                // Send back their saved private state if available
                // Find their seat index from the room state
                for (const seatIdx in (roomStates[room] || {})) {
                    const state = roomStates[room][seatIdx];
                    if (state && state.userId === existingPlayer.userId) {
                        socket.emit('load_state', state);
                        break;
                    }
                }

                console.log(`${existingPlayer.name} reconnected to room ${room}`);
                return;
            }
        }

        // Check if game started for new players
        if (roomMeta[room]?.started) {
            const hostId = roomMeta[room].hostId;
            const host = rooms[room].find(p => p.id === hostId);
            if (host && !host.disconnected) {
                pendingJoins[socket.id] = { room, name, color, userId };
                io.to(host.id).emit('host_approval_request', {
                    applicantId: socket.id,
                    name,
                    color
                });
                socket.emit('join_pending', { message: 'Game in progress. Waiting for host approval...' });
                return;
            }
        }

        const assignedColor = getSafeColor(rooms[room] || [], color);
        const newUserId = userId || socket.id + Date.now(); // Create a persistent ID

        socket.join(room);

        const newPlayer: Player = {
            id: socket.id,
            userId: newUserId,
            name,
            room,
            color: assignedColor,
            disconnected: false
        };

        if (rooms[room].length === 0) {
            roomMeta[room] = {
                started: false,
                hostId: socket.id,
                gameType: isTable ? 'local_table' : 'standard'
            };
        }

        rooms[room].push(newPlayer);

        console.log(`${name} joined room ${room}`);

        // Notify everyone in the room (including sender) about the new player list
        io.to(room).emit('room_players_update', { players: rooms[room], hostId: roomMeta[room].hostId });

        // Emit success to the joiner
        socket.emit('join_success', {
            room,
            playerId: socket.id,
            userId: newUserId,
            isGameStarted: roomMeta[room]?.started || false,
            gameType: roomMeta[room]?.gameType
        });

        // Notify others that a specific player joined
        socket.to(room).emit('player_joined', newPlayer);
    });

    socket.on('resolve_join_request', ({ room, applicantId, approved }) => {
        if (room) room = room.trim().toUpperCase();
        const applicantSocket = io.sockets.sockets.get(applicantId);
        const pending = pendingJoins[applicantId];

        if (!applicantSocket || !pending || pending.room !== room) return;

        if (approved) {
            const assignedColor = getSafeColor(rooms[room] || [], pending.color);
            const newUserId = pending.userId || applicantId + Date.now();

            applicantSocket.join(room);
            const newPlayer: Player = {
                id: applicantId,
                userId: newUserId,
                name: pending.name,
                room,
                color: assignedColor,
                disconnected: false
            };
            rooms[room].push(newPlayer);

            io.to(room).emit('room_players_update', { players: rooms[room], hostId: roomMeta[room].hostId });

            io.to(applicantId).emit('join_success', {
                room,
                playerId: applicantId,
                userId: newUserId,
                isGameStarted: roomMeta[room]?.started || false,
                gameType: roomMeta[room]?.gameType
            });

            applicantSocket.to(room).emit('player_joined', newPlayer);
        } else {
            applicantSocket.emit('join_error', { message: 'Host denied your request to join.' });
        }
        delete pendingJoins[applicantId];
    });

    socket.on('get_players', ({ room }) => {
        if (room) room = room.trim().toUpperCase();
        if (rooms[room]) {
            socket.emit('room_players_update', { players: rooms[room], hostId: roomMeta[room]?.hostId });
        }
    });

    socket.on('update_player_order', ({ room, players }) => {
        if (room) room = room.trim().toUpperCase();
        if (rooms[room]) {
            // In a real app, verify sender is host. For now, trust the client.
            rooms[room] = players;
            io.to(room).emit('room_players_update', { players: rooms[room], hostId: roomMeta[room]?.hostId });
        }
    });

    socket.on('update_player_color', ({ room, color }) => {
        if (room) room = room.trim().toUpperCase();
        if (rooms[room]) {
            const isTaken = rooms[room].some(p => p.color === color && p.id !== socket.id);
            if (isTaken) return;

            const player = rooms[room].find(p => p.id === socket.id);
            if (player) {
                player.color = color;
                io.to(room).emit('room_players_update', { players: rooms[room], hostId: roomMeta[room]?.hostId });
            }
        }
    });

    socket.on('kick_player', ({ room, targetId }) => {
        if (room) room = room.trim().toUpperCase();
        // Verify sender is host
        if (roomMeta[room]?.hostId === socket.id) {
            const targetSocket = io.sockets.sockets.get(targetId);
            if (targetSocket) {
                targetSocket.leave(room);
                targetSocket.emit('player_kicked');
            }

            const index = rooms[room].findIndex(p => p.id === targetId);
            if (index !== -1) {
                rooms[room].splice(index, 1);
                io.to(room).emit('room_players_update', { players: rooms[room], hostId: roomMeta[room].hostId });
                io.to(room).emit('notification', { message: `Player has been kicked.` });
            }
        }
    });

    socket.on('leave_room', ({ room }) => {
        if (room) room = room.trim().toUpperCase();
        if (rooms[room]) {
            const index = rooms[room].findIndex(p => p.id === socket.id);
            if (index !== -1) {
                const player = rooms[room][index];
                rooms[room].splice(index, 1);
                socket.leave(room);

                if (roomMeta[room] && roomMeta[room].hostId === socket.id) {
                    roomMeta[room].hostId = rooms[room].find(p => !p.disconnected)?.id;
                }

                io.to(room).emit('room_players_update', { players: rooms[room], hostId: roomMeta[room]?.hostId });
                io.to(room).emit('notification', { message: `${player.name} left the room.` });
                console.log(`${player.name} left room ${room}`);

                if (rooms[room].every(p => p.disconnected)) {
                    delete rooms[room];
                    delete roomMeta[room];
                }
            }
        }
    });

    socket.on('backup_state', ({ room, seatIndex, state, userId }) => {
        if (room) room = room.trim().toUpperCase();
        if (!roomStates[room]) roomStates[room] = {};
        // Store with userId so we can find it on reconnection regardless of seat index
        roomStates[room][seatIndex] = { ...state, userId };
    });

    socket.on('request_state', ({ room, seatIndex }) => {
        if (room) room = room.trim().toUpperCase();
        if (roomStates[room] && roomStates[room][seatIndex]) {
            socket.emit('load_state', roomStates[room][seatIndex]);
        }
    });

    socket.on('admin_assign_state', ({ room, targetId, seatIndex }) => {
        if (room) room = room.trim().toUpperCase();
        // Host instructs a player to load state from a specific seat index
        if (roomStates[room] && roomStates[room][seatIndex]) {
            io.to(targetId).emit('load_state', roomStates[room][seatIndex]);
            io.to(targetId).emit('notification', { message: `Host assigned you to Seat ${seatIndex + 1}. Loading game data...` });
        }
    });

    socket.on('game_action', ({ room, action, data }) => {
        if (room) room = room.trim().toUpperCase();
        if (action === 'START_GAME') {
            if (roomMeta[room]) roomMeta[room].started = true;
        }
        // Broadcast the action to everyone else in the room
        socket.to(room).emit('game_action', { action, data, playerId: socket.id });
    });

    // --- Local Table Slot Logic ---
    socket.on('request_claim_slot', ({ room, slotId, deck, tokens, playerName }) => {
        if (room) room = room.trim().toUpperCase();
        const hostId = roomMeta[room]?.hostId;
        if (hostId) {
            io.to(hostId).emit('slot_claim_request', {
                applicantId: socket.id,
                slotId,
                deck,
                tokens,
                playerName
            });
        }
    });

    socket.on('confirm_slot_claim', ({ room, applicantId, slotId, approved }) => {
        if (room) room = room.trim().toUpperCase();
        const applicantSocket = io.sockets.sockets.get(applicantId);
        if (applicantSocket) {
            if (approved) {
                applicantSocket.emit('slot_claimed', { slotId, success: true });
            } else {
                applicantSocket.emit('slot_claimed', { slotId, success: false, message: "Host denied claim." });
            }
        }
    });

    // --- Mobile Gameplay Events ---
    socket.on('send_hand_update', ({ roomId, targetId, hand, phase, mulliganCount }) => {
        io.to(targetId).emit('hand_update', { hand, phase, mulliganCount });
    });

    socket.on('play_card', ({ room, cardId }) => {
        if (room) room = room.trim().toUpperCase();
        const hostId = roomMeta[room]?.hostId;
        if (hostId) {
            io.to(hostId).emit('mobile_play_card', { playerId: socket.id, cardId });
        }
    });

    socket.on('mulligan_decision', ({ room, keep }) => {
        if (room) room = room.trim().toUpperCase();
        const hostId = roomMeta[room]?.hostId;
        if (hostId) {
            io.to(hostId).emit('mobile_mulligan', { playerId: socket.id, keep });
        }
    });

    socket.on('mobile_update_life', ({ room, amount }) => {
        if (room) room = room.trim().toUpperCase();
        const hostId = roomMeta[room]?.hostId;
        if (hostId) {
            io.to(hostId).emit('mobile_update_life', { playerId: socket.id, amount });
        }
    });

    socket.on('mobile_update_counter', ({ room, type, amount, targetId }) => {
        if (room) room = room.trim().toUpperCase();
        const hostId = roomMeta[room]?.hostId;
        if (hostId) {
            io.to(hostId).emit('mobile_update_counter', { playerId: socket.id, type, amount, targetId });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        setTimeout(() => {
            for (const room in rooms) {
                const player = rooms[room].find(p => p.id === socket.id);
                if (player && player.disconnected) {
                    console.log(`Permanently removing ${player.name} from room ${room}`);
                    rooms[room] = rooms[room].filter(p => p.userId !== player.userId);

                    if (rooms[room].length === 0) {
                        delete rooms[room];
                        delete roomMeta[room];
                        delete roomStates[room];
                    } else {
                        io.to(room).emit('room_players_update', { players: rooms[room], hostId: roomMeta[room]?.hostId });
                        io.to(room).emit('notification', { message: `${player.name} left the room.` });
                    }
                }
            }
        }, 5 * 60 * 1000); // 5 minutes

        // Find player and mark as disconnected
        for (const room in rooms) {
            const player = rooms[room].find(p => p.id === socket.id);
            if (player) {
                player.disconnected = true;
                player.disconnectedAt = Date.now();

                // If the host disconnected, assign a new host
                if (roomMeta[room] && roomMeta[room].hostId === socket.id) {
                    const newHost = rooms[room].find(p => !p.disconnected);
                    if (newHost) {
                        roomMeta[room].hostId = newHost.id;
                    }
                }

                io.to(room).emit('room_players_update', { players: rooms[room], hostId: roomMeta[room].hostId });
                io.to(room).emit('notification', { message: `${player.name} disconnected. They have 5 minutes to reconnect.` });

                if (rooms[room].every(p => p.disconnected)) {
                    delete rooms[room];
                    delete roomMeta[room];
                    delete roomStates[room];
                }
                break;
            }
        }
        delete pendingJoins[socket.id];
    });
});

httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
