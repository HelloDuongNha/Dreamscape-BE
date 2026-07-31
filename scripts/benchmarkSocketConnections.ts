import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { io, type Socket } from 'socket.io-client';

interface WorkloadResult {
  connections: number;
  successfulConnections: number;
  failedConnections: number;
  acknowledgedEvents: number;
  failedEvents: number;
  connectionP50Ms: number;
  connectionP95Ms: number;
  deliveryP50Ms: number;
  deliveryP95Ms: number;
}

const socketUrl = (process.env.SOCKET_BENCHMARK_URL
  || 'https://dreamscape-backend-d2an.onrender.com').replace(/\/+$/, '');
const token = process.env.SOCKET_BENCHMARK_TOKEN?.trim();
const conversationId = process.env.SOCKET_BENCHMARK_CONVERSATION_ID?.trim();
const timeoutMs = positiveInteger(process.env.SOCKET_BENCHMARK_TIMEOUT_MS, 30_000);
const outputPath = resolve(
  process.env.SOCKET_BENCHMARK_OUTPUT
  || '../docs/evidence/chapter6/socket-benchmark-evidence.json',
);

async function main(): Promise<void> {
  if (!token) throw new Error('SOCKET_BENCHMARK_TOKEN is required.');
  if (!conversationId) throw new Error('SOCKET_BENCHMARK_CONVERSATION_ID is required.');

  const results: WorkloadResult[] = [];
  for (const connectionCount of [5, 10]) {
    results.push(await runWorkload(connectionCount));
  }

  const evidence = {
    evidence: 'Figure C.28 - Socket.IO Connection Benchmark',
    measuredAt: new Date().toISOString(),
    socketUrl,
    event: 'send_message with acknowledgement',
    messagesCreated: results.reduce((sum, result) => sum + result.acknowledgedEvents, 0),
    results,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ...evidence, output: outputPath }, null, 2)}\n`);

  if (results.some(result => result.failedConnections > 0 || result.failedEvents > 0)) {
    process.exitCode = 1;
  }
}

async function runWorkload(connectionCount: number): Promise<WorkloadResult> {
  const connectionDurations: number[] = [];
  const sockets = await Promise.all(
    Array.from({ length: connectionCount }, async () => {
      const startedAt = performance.now();
      const socket = io(socketUrl, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
        timeout: timeoutMs,
      });
      await waitForConnection(socket);
      connectionDurations.push(performance.now() - startedAt);
      socket.emit('join_room', { conversationId });
      return socket;
    }),
  );

  const deliveryDurations: number[] = [];
  let acknowledgedEvents = 0;
  let failedEvents = 0;
  await Promise.all(sockets.map(async (socket, index) => {
    const marker = `SOCKET-BENCH-C${connectionCount}-${index + 1}-${randomUUID().slice(0, 8)}`;
    const startedAt = performance.now();
    try {
      const acknowledgement = await emitWithAcknowledgement(socket, {
        conversationId,
        content: marker,
        messageType: 'text',
        tempId: marker,
        clientMessageId: randomUUID(),
      });
      deliveryDurations.push(performance.now() - startedAt);
      if (acknowledgement?.success) acknowledgedEvents += 1;
      else failedEvents += 1;
    } catch {
      deliveryDurations.push(performance.now() - startedAt);
      failedEvents += 1;
    }
  }));

  sockets.forEach(socket => socket.disconnect());
  return {
    connections: connectionCount,
    successfulConnections: sockets.length,
    failedConnections: connectionCount - sockets.length,
    acknowledgedEvents,
    failedEvents,
    connectionP50Ms: percentile(connectionDurations, 0.5),
    connectionP95Ms: percentile(connectionDurations, 0.95),
    deliveryP50Ms: percentile(deliveryDurations, 0.5),
    deliveryP95Ms: percentile(deliveryDurations, 0.95),
  };
}

function waitForConnection(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Socket connection timed out.'));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function emitWithAcknowledgement(
  socket: Socket,
  payload: Record<string, unknown>,
): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    socket.timeout(timeoutMs).emit(
      'send_message',
      payload,
      (error: Error | null, acknowledgement: Record<string, any>) => {
        if (error) reject(error);
        else resolve(acknowledgement);
      },
    );
  });
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return Math.round(sorted[index] * 100) / 100;
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
