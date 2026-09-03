import mongoose from 'mongoose';
import { logInfo, logWarn } from './logger';

class DatabaseConnectionError extends Error {
  constructor(public readonly cause: unknown) {
    super('Database connection failed.');
    this.name = 'DatabaseConnectionError';
  }
}

declare global {
  var _mongooseConn: typeof mongoose | null;
  var _mongooseConnPromise: Promise<typeof mongoose> | null;
}

/**
 * Singleton MongoDB connection — reuses the connection across hot-reloads in Next.js dev mode.
 */
export async function connectDB(): Promise<typeof mongoose> {
  if (global._mongooseConn) {
    return global._mongooseConn;
  }
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('Please define the MONGODB_URI environment variable');
  }

  if (!global._mongooseConnPromise) {
    global._mongooseConnPromise = mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10_000,
    });
  }

  try {
    const conn = await global._mongooseConnPromise;
    global._mongooseConn = conn;
    logInfo('database.connected', { databaseReady: true });
    return conn;
  } catch (error) {
    // Allow a later request or readiness probe to retry after a transient outage.
    global._mongooseConnPromise = null;
    logWarn('database.connection_failed', { databaseReady: false });
    throw new DatabaseConnectionError(error);
  }
}

export function isDatabaseReady(): boolean {
  return mongoose.connection.readyState === mongoose.ConnectionStates.connected;
}

/** Close the shared connection during process shutdown. Safe to call more than once. */
export async function closeDB(): Promise<void> {
  global._mongooseConnPromise = null;
  global._mongooseConn = null;
  if (mongoose.connection.readyState === mongoose.ConnectionStates.disconnected) return;
  await mongoose.disconnect();
  logInfo('database.disconnected', { databaseReady: false });
}
