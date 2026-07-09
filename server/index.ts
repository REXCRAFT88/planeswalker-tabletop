import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import { createAiRouter } from './ai/router';
import { aiEnabled } from './ai/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Security headers (CSP disabled — requires careful tuning for CDN scripts)
app.use(helmet({ contentSecurityPolicy: false }));

// In dev the client (Vite on :3000) and this API server (:3001) are different
// origins, so the HTTP API routes need CORS headers (Socket.IO's CORS config does
// not cover Express routes). In production the client is served from this same
// origin, so no CORS is needed.
if (process.env.NODE_ENV !== 'production') {
    const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:3000'];
    app.use('/api', (req, res, next) => {
        const origin = req.headers.origin;
        if (origin && DEV_ORIGINS.includes(origin)) {
            res.header('Access-Control-Allow-Origin', origin);
            res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type');
        }
        if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
        next();
    });
}

// AI opponent endpoints (Claude API proxy). Mounted before the production
// catch-all so /api/ai/* isn't swallowed by the SPA fallback.
app.use('/api/ai', createAiRouter());
console.log(`AI opponents: ${aiEnabled() ? 'ENABLED' : 'disabled (set ANTHROPIC_API_KEY to enable)'}`);

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        // In production the client is served from the same origin, so CORS is disabled.
        // In dev, allow the Vite dev server on either its default port (5173) or the
        // port configured in vite.config.ts (3000).
        origin: process.env.NODE_ENV === 'production'
            ? false
            : ["http://localhost:5173", "http://localhost:3000"],
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

interface RoomMeta {
    started: boolean;
    hostId?: string;
    gameType?: 'standard' | 'local_table';
    // --- Server-authoritative game meta (Phase 0 sync) ---
    seq: number;                 // monotonic action sequence for this room
    turnNumber: number;          // authoritative turn counter
    currentTurnUserId?: string;  // whose turn it is, by stable userId (survives reconnect)
    turnOrder: string[];         // seat order, by stable userId
}

interface LoggedAction {
    seq: number;
    action: string;
    data: any;
    playerId: string | null; // socket.id of origin, or null for server-generated actions
}

// Store room state in memory for now
const rooms: Record<string, Player[]> = {};
const roomMeta: Record<string, RoomMeta> = {};
const roomStates: Record<string, Record<number, any>> = {}; // room -> seatIndex -> state
const roomActionLog: Record<string, LoggedAction[]> = {}; // room -> ring buffer of recent actions
const pendingJoins: Record<string, { room: string, name: string, color: string, userId?: string }> = {};

// --- Security Helpers ---
const MAX_STATE_SIZE = 1 * 1024 * 1024; // 1MB max for state backups
const ACTION_LOG_LIMIT = 500; // how many recent actions we retain for gap replay

// Actions that are broadcast peer-to-peer and applied optimistically by their
// origin. Everything the server sequences flows through the same channel, but
// these are the client-originated ones; server-generated actions use playerId=null.
const newMeta = (hostSocketId: string, gameType: 'standard' | 'local_table'): RoomMeta => ({
    started: false,
    hostId: hostSocketId,
    gameType,
    seq: 0,
    turnNumber: 1,
    currentTurnUserId: undefined,
    turnOrder: [],
});

const isInRoom = (socketId: string, room: string): boolean => {
    return rooms[room]?.some(p => p.id === socketId) ?? false;
};

const isHost = (socketId: string, room: string): boolean => {
    return roomMeta[room]?.hostId === socketId;
};

const sanitizeName = (name: string): string => {
    if (typeof name !== 'string') return 'Unknown';
    return name.trim().slice(0, 32).replace(/[<>"']/g, '');
};

const isValidRoom = (room: string): boolean => {
    if (typeof room !== 'string') return false;
    return /^[A-Z0-9]{1,10}$/.test(room.trim().toUpperCase());
};

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

// --- Server-authoritative sync helpers (Phase 0) ---

const socketIdForUser = (room: string, userId?: string): string | undefined => {
    if (!userId) return undefined;
    return rooms[room]?.find(p => p.userId === userId && !p.disconnected)?.id;
};

const userIdForSocket = (room: string, socketId: string): string | undefined => {
    return rooms[room]?.find(p => p.id === socketId)?.userId;
};

// Snapshot of the authoritative turn/order meta, translated to live socket ids so
// existing socket-id-keyed client code keeps working. currentTurnPlayerId is the
// live socket id of whoever's turn it is; currentTurnUserId is the stable id.
const buildMeta = (room: string) => {
    const meta = roomMeta[room];
    if (!meta) return null;
    return {
        seq: meta.seq,
        turnNumber: meta.turnNumber,
        currentTurnUserId: meta.currentTurnUserId,
        currentTurnPlayerId: socketIdForUser(room, meta.currentTurnUserId),
        turnOrder: meta.turnOrder,
        started: meta.started,
        hostId: meta.hostId,
    };
};

const emitMeta = (room: string) => {
    const payload = buildMeta(room);
    if (payload) io.to(room).emit('game_meta', payload);
};

// Append an action to the room's ordered log and return the sequenced entry.
const pushAction = (room: string, action: string, data: any, playerId: string | null): LoggedAction => {
    const meta = roomMeta[room];
    const seq = meta ? ++meta.seq : 0;
    const entry: LoggedAction = { seq, action, data, playerId };
    if (!roomActionLog[room]) roomActionLog[room] = [];
    const log = roomActionLog[room];
    log.push(entry);
    if (log.length > ACTION_LOG_LIMIT) log.splice(0, log.length - ACTION_LOG_LIMIT);
    return entry;
};

// Broadcast a server-generated (authoritative) action to the whole room. Unlike
// peer actions, these carry playerId=null so every client applies them.
const serverBroadcast = (room: string, action: string, data: any) => {
    const entry = pushAction(room, action, data, null);
    io.to(room).emit('game_action', entry);
    return entry;
};

// Append a player to the authoritative seat order if they aren't already in it.
// Used when someone joins a game that's already started, so the turn rotation
// includes them instead of skipping their seat forever.
const ensureInTurnOrder = (room: string, userId: string) => {
    const meta = roomMeta[room];
    if (!meta || !meta.started) return;
    if (!meta.turnOrder.includes(userId)) {
        meta.turnOrder.push(userId);
        emitMeta(room);
    }
};

// Advance the turn to the next CONNECTED player in seat order, skipping
// disconnected seats. Server-authoritative: emits a sequenced PASS_TURN so every
// client (including the passer) converges on the same pointer.
const advanceTurnServer = (room: string, prevDuration?: string) => {
    const meta = roomMeta[room];
    if (!meta || meta.turnOrder.length === 0) return;

    const order = meta.turnOrder;
    const connected = (uid: string) => rooms[room]?.some(p => p.userId === uid && !p.disconnected);
    const currentIdx = meta.currentTurnUserId ? order.indexOf(meta.currentTurnUserId) : -1;

    let nextUserId: string | undefined;
    for (let step = 1; step <= order.length; step++) {
        const cand = order[(currentIdx + step) % order.length];
        if (connected(cand)) { nextUserId = cand; break; }
    }
    // Everyone else is disconnected — keep the turn where it is (or leave undefined).
    if (!nextUserId) nextUserId = meta.currentTurnUserId ?? order.find(connected);
    if (!nextUserId) return;

    // Capture who is ending their turn BEFORE we reassign, so the log names the
    // right player on every client (server actions have no sender to infer from).
    const prevUserId = meta.currentTurnUserId;
    const prevPlayer = prevUserId ? rooms[room]?.find(p => p.userId === prevUserId) : undefined;

    meta.currentTurnUserId = nextUserId;
    meta.turnNumber += 1;

    serverBroadcast(room, 'PASS_TURN', {
        nextPlayerSocketId: socketIdForUser(room, nextUserId),
        nextPlayerUserId: nextUserId,
        prevPlayerName: prevPlayer?.name,
        turnNumber: meta.turnNumber,
        prevDuration,
    });
    emitMeta(room);
};

// Remove a player's objects from the shared board for everyone, and if it was
// their turn, hand it to the next connected seat. Used on leave/kick/timeout.
const cleanupDepartedPlayer = (room: string, player: Player) => {
    const meta = roomMeta[room];
    if (!meta) return;
    serverBroadcast(room, 'REMOVE_PLAYER_OBJECTS', { playerId: player.id, userId: player.userId });
    const wasTheirTurn = meta.currentTurnUserId === player.userId;
    meta.turnOrder = meta.turnOrder.filter(uid => uid !== player.userId);
    if (wasTheirTurn && meta.turnOrder.length > 0) {
        // Point at the seat before the removed one so advanceTurnServer lands on the
        // intended next player after the removal.
        meta.currentTurnUserId = undefined;
        advanceTurnServer(room);
    } else {
        emitMeta(room);
    }
};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join_room', ({ room, name, color, userId, isTable }) => {
        if (!room) return;
        const rawRoom = room;
        room = room.trim().toUpperCase();
        name = sanitizeName(name);
        if (!isValidRoom(room)) return;
        console.log(`[JOIN_ROOM] Socket: ${socket.id}, RawRoom: "${rawRoom}", ProcessedRoom: "${room}", Name: "${name}", UserId: "${userId}"`);
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
                // Re-broadcast authoritative meta: the reconnected player's live socket
                // id changed, so the turn pointer needs re-deriving from their userId.
                emitMeta(room);
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
            roomMeta[room] = newMeta(socket.id, isTable ? 'local_table' : 'standard');
        }

        rooms[room].push(newPlayer);
        // If this room's game is already running (e.g. host was gone so approval was
        // skipped), add the newcomer to the turn rotation.
        ensureInTurnOrder(room, newUserId);

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
        if (!isHost(socket.id, room)) return; // Only host can approve/deny
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

            // A player approved into an in-progress game joins the turn rotation.
            ensureInTurnOrder(room, newUserId);
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
        if (!rooms[room] || !isHost(socket.id, room)) return; // Host-only
        if (!Array.isArray(players)) return;

        // Treat the payload as an ORDERING only. Reorder the existing roster by the
        // supplied ids and keep the server-side player objects authoritative — never
        // trust client-supplied fields (userId, color, disconnected) or inject
        // players that aren't already in the room.
        const current = rooms[room];
        const seen = new Set<string>();
        const ordered: Player[] = [];
        for (const p of players) {
            const id = p && typeof p.id === 'string' ? p.id : null;
            if (!id || seen.has(id)) continue;
            const existing = current.find(cp => cp.id === id);
            if (existing) {
                ordered.push(existing);
                seen.add(id);
            }
        }
        // Append any existing players the client omitted, preserving them.
        for (const cp of current) {
            if (!seen.has(cp.id)) ordered.push(cp);
        }

        rooms[room] = ordered;
        // Keep the authoritative seat order (by stable userId) aligned with the roster.
        if (roomMeta[room]) {
            roomMeta[room].turnOrder = ordered.map(p => p.userId);
        }
        io.to(room).emit('room_players_update', { players: rooms[room], hostId: roomMeta[room]?.hostId });
        emitMeta(room);
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
                const kicked = rooms[room][index];
                rooms[room].splice(index, 1);
                io.to(room).emit('room_players_update', { players: rooms[room], hostId: roomMeta[room].hostId });
                io.to(room).emit('notification', { message: `Player has been kicked.` });
                // Remove their board objects for everyone and reflow the turn.
                if (roomMeta[room]?.started) cleanupDepartedPlayer(room, kicked);
                else emitMeta(room);
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

                // Explicit leave is permanent: strip their board objects and reflow the
                // turn so the rest of the table stays consistent.
                if (rooms[room] && roomMeta[room]?.started) cleanupDepartedPlayer(room, player);
                else if (rooms[room]) emitMeta(room);

                if (rooms[room].every(p => p.disconnected)) {
                    delete rooms[room];
                    delete roomMeta[room];
                }
            }
        }
    });

    socket.on('backup_state', ({ room, seatIndex, state, userId }) => {
        if (room) room = room.trim().toUpperCase();
        if (!isInRoom(socket.id, room)) return; // Must be in the room
        // Limit state size to prevent memory abuse
        const stateStr = JSON.stringify(state);
        if (stateStr.length > MAX_STATE_SIZE) return;
        if (!roomStates[room]) roomStates[room] = {};
        // Store with userId so we can find it on reconnection regardless of seat index
        roomStates[room][seatIndex] = { ...state, userId };
    });

    socket.on('request_state', ({ room, seatIndex }) => {
        if (room) room = room.trim().toUpperCase();
        if (!isInRoom(socket.id, room)) return; // Must be in the room
        if (roomStates[room] && roomStates[room][seatIndex]) {
            socket.emit('load_state', roomStates[room][seatIndex]);
        }
    });

    socket.on('admin_assign_state', ({ room, targetId, seatIndex }) => {
        if (room) room = room.trim().toUpperCase();
        if (!isHost(socket.id, room)) return; // Host-only action
        if (roomStates[room] && roomStates[room][seatIndex]) {
            io.to(targetId).emit('load_state', roomStates[room][seatIndex]);
            io.to(targetId).emit('notification', { message: `Host assigned you to Seat ${seatIndex + 1}. Loading game data...` });
        }
    });

    socket.on('game_action', ({ room, action, data }) => {
        if (room) room = room.trim().toUpperCase();
        if (!isInRoom(socket.id, room)) return; // Must be in the room
        const meta = roomMeta[room];

        if (action === 'START_GAME') {
            if (!isHost(socket.id, room)) return; // Only host can start
            if (meta) {
                meta.started = true;
                // Seed authoritative turn order + pointer from the host's start payload.
                // playerOrder / firstPlayerId arrive as live socket ids; translate to
                // stable userIds so the meta survives reconnects.
                if (Array.isArray(data?.playerOrder)) {
                    meta.turnOrder = data.playerOrder
                        .map((sid: string) => userIdForSocket(room, sid))
                        .filter((uid: string | undefined): uid is string => !!uid);
                }
                if (data?.firstPlayerId) {
                    meta.currentTurnUserId = userIdForSocket(room, data.firstPlayerId) ?? meta.turnOrder[0];
                }
                meta.turnNumber = 1;
            }
        }

        // START_GAME establishes the authoritative turn pointer — broadcast the fresh
        // meta so late queries / reconnects see it immediately (the action is still
        // sequenced below for the primary path).
        if (action === 'START_GAME') {
            const entry = pushAction(room, action, data, socket.id);
            io.to(room).emit('game_action', entry);
            emitMeta(room);
            return;
        }

        // PASS_TURN is server-authoritative: the client asks to end its turn and the
        // server decides the next connected seat. Ignore any client-computed target.
        if (action === 'PASS_TURN') {
            if (meta && meta.currentTurnUserId && meta.currentTurnUserId !== userIdForSocket(room, socket.id)) {
                // Only the current-turn player may pass — unless the host is stepping in,
                // or the current-turn seat is disconnected and stalling the table.
                const currentDisconnected = !socketIdForUser(room, meta.currentTurnUserId);
                if (!isHost(socket.id, room) && !currentDisconnected) return;
            }
            advanceTurnServer(room, data?.prevDuration);
            return;
        }

        // Sequence the peer action and echo it to EVERYONE (including the sender) so
        // all clients — the origin included — can track the ordered stream and detect
        // gaps. The origin recognises its own actions by playerId and skips re-applying.
        const entry = pushAction(room, action, data, socket.id);
        io.to(room).emit('game_action', entry);
    });

    // Gap recovery: a client that detects a missed sequence number asks for
    // everything after `sinceSeq`. If we still hold it in the ring buffer, replay
    // in order; otherwise the gap is too old and the client needs a full snapshot.
    socket.on('request_sync', ({ room, sinceSeq }) => {
        if (room) room = room.trim().toUpperCase();
        if (!isInRoom(socket.id, room)) return;
        const meta = roomMeta[room];
        const log = roomActionLog[room] || [];
        const since = typeof sinceSeq === 'number' ? sinceSeq : 0;

        const oldestSeq = log.length ? log[0].seq : (meta?.seq ?? 0) + 1;
        if (since + 1 < oldestSeq && (meta?.seq ?? 0) > since) {
            // We've evicted the actions this client is missing — fall back to a
            // full snapshot from the host.
            const host = rooms[room]?.find(p => p.id === meta?.hostId && !p.disconnected)
                ?? rooms[room]?.find(p => !p.disconnected);
            if (host) io.to(host.id).emit('provide_snapshot', { requesterId: socket.id });
            else socket.emit('sync_replay', { actions: [], upToSeq: meta?.seq ?? 0 });
            return;
        }

        const missed = log.filter(a => a.seq > since);
        socket.emit('sync_replay', { actions: missed, upToSeq: meta?.seq ?? since });
    });

    // The host answers a snapshot request with the full public game state, which the
    // server forwards to the requester tagged with the current sequence number.
    socket.on('submit_snapshot', ({ room, requesterId, state }) => {
        if (room) room = room.trim().toUpperCase();
        if (!isHost(socket.id, room)) return; // Only the host is the snapshot source
        const stateStr = JSON.stringify(state ?? {});
        if (stateStr.length > MAX_STATE_SIZE) return;
        const seq = roomMeta[room]?.seq ?? 0;
        io.to(requesterId).emit('full_sync', { state, seq, meta: buildMeta(room) });
    });

    // Explicit request for the current authoritative meta (turn/order pointer).
    socket.on('request_meta', ({ room }) => {
        if (room) room = room.trim().toUpperCase();
        if (!isInRoom(socket.id, room)) return;
        const payload = buildMeta(room);
        if (payload) socket.emit('game_meta', payload);
    });

    // --- Local Table Slot Logic ---
    // A mobile controller asks the table host for the list of available seats.
    socket.on('get_slots', ({ room }) => {
        if (room) room = room.trim().toUpperCase();
        if (!isInRoom(socket.id, room)) return;
        const hostId = roomMeta[room]?.hostId;
        if (hostId) io.to(hostId).emit('get_slots', { requesterId: socket.id });
    });

    // The table host answers with the seat list, targeting the requester (or
    // broadcasting to the room when a claim changes availability for everyone).
    socket.on('slots_update', ({ room, targetId, slots }) => {
        if (room) room = room.trim().toUpperCase();
        if (!isHost(socket.id, room)) return; // Only the host is the source of truth
        if (targetId) io.to(targetId).emit('slots_update', slots);
        else socket.to(room).emit('slots_update', slots);
    });

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
        if (!isHost(socket.id, room)) return; // Only host can confirm
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
    // --- Mobile Gameplay Events (all require room membership) ---
    socket.on('send_hand_update', ({ roomId, targetId, hand, phase, mulliganCount }) => {
        if (roomId) {
            const r = roomId.trim().toUpperCase();
            if (!isInRoom(socket.id, r)) return;
        }
        io.to(targetId).emit('hand_update', { hand, phase, mulliganCount });
    });

    // Table host pushes life/poison/commander-damage down to a specific mobile controller.
    socket.on('send_stats_update', ({ roomId, targetId, life, poison, commanderDamage }) => {
        if (!roomId || !targetId) return;
        const r = roomId.trim().toUpperCase();
        if (!isInRoom(socket.id, r)) return;
        io.to(targetId).emit('send_stats_update', { life, poison, commanderDamage });
    });

    socket.on('play_card', ({ room, cardId }) => {
        if (room) room = room.trim().toUpperCase();
        if (!isInRoom(socket.id, room)) return;
        const hostId = roomMeta[room]?.hostId;
        if (hostId) {
            io.to(hostId).emit('mobile_play_card', { playerId: socket.id, cardId });
        }
    });

    socket.on('mulligan_decision', ({ room, keep }) => {
        if (room) room = room.trim().toUpperCase();
        if (!isInRoom(socket.id, room)) return;
        const hostId = roomMeta[room]?.hostId;
        if (hostId) {
            io.to(hostId).emit('mobile_mulligan', { playerId: socket.id, keep });
        }
    });

    socket.on('mobile_update_life', ({ room, amount }) => {
        if (room) room = room.trim().toUpperCase();
        if (!isInRoom(socket.id, room)) return;
        const hostId = roomMeta[room]?.hostId;
        if (hostId) {
            io.to(hostId).emit('mobile_update_life', { playerId: socket.id, amount });
        }
    });

    socket.on('mobile_update_counter', ({ room, type, amount, targetId }) => {
        if (room) room = room.trim().toUpperCase();
        if (!isInRoom(socket.id, room)) return;
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
                        delete roomActionLog[room];
                    } else {
                        io.to(room).emit('room_players_update', { players: rooms[room], hostId: roomMeta[room]?.hostId });
                        io.to(room).emit('notification', { message: `${player.name} left the room.` });
                        // Their reconnect window expired — treat as a permanent departure.
                        if (roomMeta[room]?.started) cleanupDepartedPlayer(room, player);
                        else emitMeta(room);
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

                io.to(room).emit('room_players_update', { players: rooms[room], hostId: roomMeta[room]?.hostId });
                io.to(room).emit('notification', { message: `${player.name} disconnected. They have 5 minutes to reconnect.` });
                // Refresh presence-aware meta (their live socket id is gone now). If it
                // was their turn, other seats / the host can pass past them; the turn is
                // deliberately NOT auto-skipped here so a quick reconnect keeps its place.
                emitMeta(room);

                // Keep the room and its saved state alive so disconnected players can
                // reconnect. The 5-minute per-player timeout above removes stragglers,
                // and the periodic cleanup interval collects fully-disconnected rooms
                // after 10 minutes. Deleting immediately here would defeat both.
                break;
            }
        }
        delete pendingJoins[socket.id];
    });
});

// Periodic cleanup of stale rooms (every 60 seconds)
setInterval(() => {
    const now = Date.now();
    for (const room in rooms) {
        if (rooms[room].every(p => p.disconnected)) {
            const oldest = Math.min(...rooms[room].map(p => p.disconnectedAt || now));
            if (now - oldest > 10 * 60 * 1000) { // 10 min fully-disconnected = remove
                console.log(`[CLEANUP] Removing stale room: ${room}`);
                delete rooms[room];
                delete roomMeta[room];
                delete roomStates[room];
            }
        }
    }
    // Clean up dangling pending joins from disconnected sockets
    for (const socketId in pendingJoins) {
        if (!io.sockets.sockets.has(socketId)) {
            delete pendingJoins[socketId];
        }
    }
}, 60 * 1000);

httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
