import { io } from 'socket.io-client';

// In production (when served by the same node server), use relative path.
// In dev, use the localhost:3001 explicit URL.
const SERVER_URL = import.meta.env.PROD ? '/' : 'http://localhost:3001';

export const socket = io(SERVER_URL, {
  autoConnect: false
});

export const connectSocket = () => {
  if (!socket.connected) {
    socket.connect();
  }
  return socket;
};
