import { Server as SocketIOServer, type Socket } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import {
  configuredSocketOrigins,
  consumeSocketEventBudget,
  isAllowedSocketOrigin,
  isValidGestureTelemetryPayload,
  isValidModeTogglePayload,
  type EventWindow,
} from './socketSafety';

const SOCKET_MAX_BUFFER_BYTES = 16 * 1024;

let ioInstance: SocketIOServer | null = null;

export function getIO(): SocketIOServer | null {
  return ioInstance;
}

function consumeEventBudget(
  socket: Socket,
  windows: Map<string, EventWindow>,
  event: string
): boolean {
  if (!consumeSocketEventBudget(windows, event)) {
    socket.disconnect(true);
    return false;
  }
  return true;
}

export function setupSocketIO(httpServer: HTTPServer): SocketIOServer {
  if (ioInstance) return ioInstance;

  const allowedOrigins = configuredSocketOrigins();
  ioInstance = new SocketIOServer(httpServer, {
    cors: {
      origin(origin, callback) {
        callback(null, isAllowedSocketOrigin(origin, allowedOrigins));
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    allowRequest(request, callback) {
      const origin = request.headers.origin;
      callback(null, isAllowedSocketOrigin(origin, allowedOrigins));
    },
    maxHttpBufferSize: SOCKET_MAX_BUFFER_BYTES,
    perMessageDeflate: false,
  });

  setupTelemetryHandler(ioInstance);
  return ioInstance;
}

function setupTelemetryHandler(io: SocketIOServer): void {
  io.on('connection', (socket) => {
    const eventWindows = new Map<string, EventWindow>();
    console.log(`Socket client connected (ID: ${socket.id})`);

    socket.on('mode:toggle', (data: unknown) => {
      if (!consumeEventBudget(socket, eventWindows, 'mode:toggle')) return;
      if (!isValidModeTogglePayload(data)) return;
      console.log(`Socket client ${socket.id} mouse control active: ${data.active}`);
    });

    socket.on('gesture', (data: unknown) => {
      if (
        !consumeEventBudget(socket, eventWindows, 'gesture') ||
        !isValidGestureTelemetryPayload(data)
      ) {
        return;
      }

      socket.broadcast.emit('gesture', {
        gesture: data.gesture,
        ...(data.hand === undefined ? {} : { hand: data.hand }),
        ...(data.confidence === undefined ? {} : { confidence: data.confidence }),
      });
    });

    socket.on('disconnect', () => {
      eventWindows.clear();
      console.log(`Socket client disconnected (ID: ${socket.id})`);
    });
  });
}
