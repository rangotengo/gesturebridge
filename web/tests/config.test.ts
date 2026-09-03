import { describe, expect, it } from 'vitest';
import { ConfigurationError, readServerConfig } from '../lib/config';

const baseEnvironment: NodeJS.ProcessEnv = {
  MONGODB_URI: 'mongodb://127.0.0.1:27017/gesturebridge',
  NODE_ENV: 'test',
};

describe('readServerConfig', () => {
  it('uses loopback and port 3000 as safe defaults', () => {
    expect(readServerConfig(baseEnvironment)).toMatchObject({
      host: '127.0.0.1',
      nodeEnv: 'test',
      port: 3000,
    });
  });

  it.each([
    [{ ...baseEnvironment, PORT: '0' }, 'PORT must be an integer between 1 and 65535'],
    [{ ...baseEnvironment, MONGODB_URI: 'https://database.example' }, 'MONGODB_URI must use'],
    [{ ...baseEnvironment, TRUST_PROXY: 'sometimes' }, 'TRUST_PROXY must be true or false'],
  ])('rejects unsafe startup configuration', (environment, expectedIssue) => {
    expect(() => readServerConfig(environment)).toThrow(ConfigurationError);
    try {
      readServerConfig(environment);
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      if (error instanceof ConfigurationError) {
        expect(error.issues.join('; ')).toContain(expectedIssue);
      }
    }
  });
});
