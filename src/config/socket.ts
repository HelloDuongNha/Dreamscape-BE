import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import {
  authenticateMessagingSocket,
  AuthenticatedMessagingSocket,
} from '../modules/messaging/services/realtime/socketAuthentication.service';
import { registerMessagingSocketHandlers } from '../modules/messaging/services/realtime/messagingSocketHandlers.service';
import { configuredOrigins } from './security';

let activeSocketServer: SocketIOServer | null = null;

export function initSocket(httpServer: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: configuredOrigins(),
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  activeSocketServer = io;
  io.use(authenticateMessagingSocket);
  io.on('connection', (socket: Socket) => {
    registerMessagingSocketHandlers(
      io,
      socket as AuthenticatedMessagingSocket,
    );
  });
  return io;
}

export function getSocketServer(): SocketIOServer | null {
  return activeSocketServer;
}
