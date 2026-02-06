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
  id: string;
  name: string;
  room: string;
  color: string;
}

// Store room state in memory for now
const rooms: Record<string, Player[]> = {};
const roomMeta: Record<string, { started: boolean, hostId?: string }> = {};
const roomStates: Record<string, Record<number, any>> = {}; // room -> seatIndex -> state
const pendingJoins: Record<string, { room: string, name: string, color: string, userId?: string }> = {};

const getSafeColor = (roomPlayers: Player[], requestedColor: string) => {
    const usedColors = new Set(roomPlayers.map(p => p.color));
    if (!usedColors.has(requestedColor)) return requestedColor;
    
    const FALLBACK_COLORS = [
        '#ef4444', '#3b82f6', '#22c55e', '#a855f7', 
        '#eab308', '#ec4899', '#06b6d4', '#f97316',
        '#6366f1', '#14b8a6', '#84cc16', '#d946ef'
    ];
    
    for (const c of FALLBACK_COLORS) {
        if (!usedColors.has(c)) return c;
    }
    return '#' + Math.floor(Math.random()*16777215).toString(16);
};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_room', ({ room, name, color, userId }) => {
    // Check if game started
    if (roomMeta[room]?.started) {
        const host = rooms[room]?.[0];
        if (host) {
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

    socket.join(room);
    
    const newPlayer: Player = { id: socket.id, name, room, color: assignedColor };
    
    if (!rooms[room]) {
        rooms[room] = [];
        roomMeta[room] = { started: false, hostId: socket.id };
    }
    
    rooms[room].push(newPlayer);
    
    console.log(`${name} joined room ${room}`);
    
    // Notify everyone in the room (including sender) about the new player list
    io.to(room).emit('room_players_update', { players: rooms[room], hostId: roomMeta[room].hostId });
    
    // Emit success to the joiner
    socket.emit('join_success', { 
        room, 
        playerId: socket.id, 
        isGameStarted: roomMeta[room]?.started || false 
    });

    // Notify others that a specific player joined
    socket.to(room).emit('player_joined', newPlayer);
  });

  socket.on('resolve_join_request', ({ room, applicantId, approved }) => {
      const applicantSocket = io.sockets.sockets.get(applicantId);
      const pending = pendingJoins[applicantId];
      
      if (!applicantSocket || !pending || pending.room !== room) return;

      if (approved) {
          const assignedColor = getSafeColor(rooms[room] || [], pending.color);

          applicantSocket.join(room);
          const newPlayer: Player = { id: applicantId, name: pending.name, room, color: assignedColor };
          rooms[room].push(newPlayer);
          
          io.to(room).emit('room_players_update', { players: rooms[room], hostId: roomMeta[room].hostId });
          
          io.to(applicantId).emit('join_success', { 
              room, 
              playerId: applicantId, 
              isGameStarted: roomMeta[room]?.started || false 
          });

          applicantSocket.to(room).emit('player_joined', newPlayer);
      } else {
          applicantSocket.emit('join_error', { message: 'Host denied your request to join.' });
      }
      delete pendingJoins[applicantId];
  });

  socket.on('get_players', ({ room }) => {
      if (rooms[room]) {
          socket.emit('room_players_update', { players: rooms[room], hostId: roomMeta[room]?.hostId });
      }
  });

  socket.on('update_player_order', ({ room, players }) => {
      if (rooms[room]) {
          // In a real app, verify sender is host. For now, trust the client.
          rooms[room] = players;
          io.to(room).emit('room_players_update', { players: rooms[room], hostId: roomMeta[room]?.hostId });
      }
  });

  socket.on('update_player_color', ({ room, color }) => {
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
      // Verify sender is host
      if (roomMeta[room]?.hostId === socket.id) {
          const targetSocket = io.sockets.sockets.get(targetId);
          if (targetSocket) {
              targetSocket.leave(room);
              targetSocket.emit('player_kicked');
          }
          
          const index = rooms[room].findIndex(p => p.id === targetId);
          if (index !== -1) {
              const p = rooms[room][index];
              rooms[room].splice(index, 1);
              io.to(room).emit('room_players_update', { players: rooms[room], hostId: roomMeta[room].hostId });
              io.to(room).emit('player_left', targetId);
          }
      }
  });

  socket.on('leave_room', ({ room }) => {
      if (rooms[room]) {
          const index = rooms[room].findIndex(p => p.id === socket.id);
          if (index !== -1) {
              const player = rooms[room][index];
              rooms[room].splice(index, 1);
              socket.leave(room);
              
              if (roomMeta[room] && roomMeta[room].hostId === socket.id) {
                  roomMeta[room].hostId = rooms[room].length > 0 ? rooms[room][0].id : undefined;
              }

              io.to(room).emit('room_players_update', { players: rooms[room], hostId: roomMeta[room]?.hostId });
              io.to(room).emit('player_left', player.id);
              console.log(`${player.name} left room ${room}`);
              
              if (rooms[room].length === 0) {
                  delete rooms[room];
                  delete roomMeta[room];
              }
          }
      }
  });

  socket.on('backup_state', ({ room, seatIndex, state }) => {
      if (!roomStates[room]) roomStates[room] = {};
      roomStates[room][seatIndex] = state;
  });

  socket.on('request_state', ({ room, seatIndex }) => {
      if (roomStates[room] && roomStates[room][seatIndex]) {
          socket.emit('load_state', roomStates[room][seatIndex]);
      }
  });

  socket.on('admin_assign_state', ({ room, targetId, seatIndex }) => {
      // Host instructs a player to load state from a specific seat index
      if (roomStates[room] && roomStates[room][seatIndex]) {
          io.to(targetId).emit('load_state', roomStates[room][seatIndex]);
          io.to(targetId).emit('notification', { message: `Host assigned you to Seat ${seatIndex + 1}. Loading game data...` });
      }
  });

  socket.on('game_action', ({ room, action, data }) => {
    if (action === 'START_GAME') {
        if (roomMeta[room]) roomMeta[room].started = true;
    }
    // Broadcast the action to everyone else in the room
    socket.to(room).emit('game_action', { action, data, playerId: socket.id });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Remove player from their room
    for (const room in rooms) {
        const index = rooms[room].findIndex(p => p.id === socket.id);
        if (index !== -1) {
            const player = rooms[room][index];
            rooms[room].splice(index, 1);
            
            if (roomMeta[room] && roomMeta[room].hostId === socket.id) {
                roomMeta[room].hostId = rooms[room].length > 0 ? rooms[room][0].id : undefined;
            }

            io.to(room).emit('room_players_update', { players: rooms[room], hostId: roomMeta[room]?.hostId });
            io.to(room).emit('player_left', player.id);
            
            if (rooms[room].length === 0) {
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
