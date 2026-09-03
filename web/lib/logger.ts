type LogLevel = 'error' | 'info' | 'warn';

type LogFields = Record<string, boolean | number | string | null | undefined>;

function serializeError(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message.slice(0, 500),
    };
  }
  return { errorName: 'UnknownError', errorMessage: 'Non-error value thrown' };
}

/** JSON logs stay searchable while avoiding request bodies, credentials, and stack traces. */
function write(level: LogLevel, event: string, fields: LogFields = {}, error?: unknown): void {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
    ...(error === undefined ? {} : serializeError(error)),
  });

  if (level === 'error') console.error(payload);
  else if (level === 'warn') console.warn(payload);
  else console.info(payload);
}

export function logError(event: string, error: unknown, fields?: LogFields): void {
  write('error', event, fields, error);
}

export function logInfo(event: string, fields?: LogFields): void {
  write('info', event, fields);
}

export function logWarn(event: string, fields?: LogFields): void {
  write('warn', event, fields);
}
