/**
 * useSocket — Socket.IO client hook.
 * Mouse control via WebSocket is available in the browser-based web app.
 * In Electron, useMouseControl handles OS control via IPC instead.
 *
 * This hook lazily initializes a Socket.IO connection and provides an emit helper.
 */
import { useEffect, useRef, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';

export function useSocket(): { emit: (event: string, data: unknown) => void } {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Connect to the same origin (Next.js + Socket.IO on the same port)
    const socket = io({ path: '/socket.io' });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Socket.IO connected:', socket.id);
    });

    socket.on('disconnect', () => {
      console.log('Socket.IO disconnected');
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const emit = useCallback((event: string, data: unknown): void => {
    socketRef.current?.emit(event, data);
  }, []);

  return { emit };
}
