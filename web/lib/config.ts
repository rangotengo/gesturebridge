export interface ServerConfig {
  host: string;
  mongoUri: string;
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
}

export class ConfigurationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid server configuration: ${issues.join('; ')}`);
    this.name = 'ConfigurationError';
  }
}

type Environment = NodeJS.ProcessEnv;

function parsePort(value: string | undefined, issues: string[]): number {
  const candidate = value?.trim() || '3000';
  const port = Number(candidate);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    issues.push('PORT must be an integer between 1 and 65535');
    return 3000;
  }
  return port;
}

function parseNodeEnvironment(value: string | undefined, issues: string[]): ServerConfig['nodeEnv'] {
  const nodeEnv = value ?? 'development';
  if (nodeEnv === 'development' || nodeEnv === 'production' || nodeEnv === 'test') {
    return nodeEnv;
  }
  issues.push('NODE_ENV must be development, production, or test');
  return 'development';
}

/**
 * Parse only the configuration required to safely boot the custom server.
 * Error messages deliberately describe variable names and constraints, never values.
 */
export function readServerConfig(environment: Environment = process.env): ServerConfig {
  const issues: string[] = [];
  const mongoUri = environment.MONGODB_URI?.trim() ?? '';
  if (!mongoUri) {
    issues.push('MONGODB_URI is required');
  } else if (!/^mongodb(?:\+srv)?:\/\//i.test(mongoUri)) {
    issues.push('MONGODB_URI must use mongodb:// or mongodb+srv://');
  }

  const host = environment.HOST?.trim() || '127.0.0.1';
  if (/\s|[\u0000-\u001F]/.test(host)) {
    issues.push('HOST must not contain whitespace or control characters');
  }

  const trustProxy = environment.TRUST_PROXY;
  if (trustProxy !== undefined && trustProxy !== 'true' && trustProxy !== 'false') {
    issues.push('TRUST_PROXY must be true or false when set');
  }

  const config: ServerConfig = {
    host,
    mongoUri,
    nodeEnv: parseNodeEnvironment(environment.NODE_ENV, issues),
    port: parsePort(environment.PORT, issues),
  };

  if (issues.length > 0) throw new ConfigurationError(issues);
  return config;
}

export function getConfigurationHealth(): { ok: true } | { ok: false; issues: string[] } {
  try {
    readServerConfig();
    return { ok: true };
  } catch (error) {
    if (error instanceof ConfigurationError) return { ok: false, issues: error.issues };
    return { ok: false, issues: ['Configuration could not be validated'] };
  }
}
