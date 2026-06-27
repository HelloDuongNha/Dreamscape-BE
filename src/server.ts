import './config/env';
import http from 'http';
import app from './app';
import connectDB from './config/db';
import { initSocket } from './config/socket';

const PORT = Number(process.env.PORT) || 5000;

const startServer = async (): Promise<void> => {
  // 1. Connect to MongoDB before accepting traffic
  await connectDB();

  // 2. Wrap Express app in a raw Node.js HTTP server so Socket.io can share it
  const httpServer = http.createServer(app);

  // 3. Attach Socket.io (JWT-authenticated WebSocket layer)
  const io = initSocket(httpServer);

  // Expose io on the app instance for potential use in route handlers
  app.set('io', io);

  // 4. Start listening
  httpServer.listen(PORT, () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🚀 DreamScape API running on port ${PORT}`);
    console.log(`📖 Swagger Docs → http://localhost:${PORT}/api-docs`);
    console.log(`🩺 Health Check → http://localhost:${PORT}/api/health`);
    console.log(`🔌 Socket.io    → ws://localhost:${PORT}`);
    console.log(`🌍 Environment  → ${process.env.NODE_ENV ?? 'development'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  });
};

startServer().catch((err: Error) => {
  console.error('❌ Failed to start server:', err.message);
  process.exit(1);
});
