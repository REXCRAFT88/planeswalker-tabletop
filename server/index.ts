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

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_room', ({ room, name, color }) => {
    const existingPlayer = rooms[room]?.find(p => p.color === color);
    if (existingPlayer) {
        socket.emit('join_error', { message: 'Color already taken. Please choose another.' });
        return;
    }

    socket.join(room);
    
    const newPlayer: Player = { id: socket.id, name, room, color };
    
    if (!rooms[room]) {
        rooms[room] = [];
    }
    
    rooms[room].push(newPlayer);
    
    console.log(`${name} joined room ${room}`);
    
    // Notify everyone in the room (including sender) about the new player list
    io.to(room).emit('room_players_update', rooms[room]);
    
    // Notify others that a specific player joined
    socket.to(room).emit('player_joined', newPlayer);
  });

  socket.on('get_players', ({ room }) => {
      if (rooms[room]) {
          socket.emit('room_players_update', rooms[room]);
      }
  });

  socket.on('game_action', ({ room, action, data }) => {
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
            io.to(room).emit('room_players_update', rooms[room]);
            io.to(room).emit('player_left', player.id);
            
            if (rooms[room].length === 0) {
                delete rooms[room];
            }
            break;
        }
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
