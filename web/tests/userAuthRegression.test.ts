import { describe, expect, it } from 'vitest';
import User from '../models/User';

describe('User model privilege defaults regression test', () => {
  it('does not escalate unprivileged or legacy accounts missing role to admin on hydration', () => {
    // Legacy documents in mongo created before role schema or without role field
    const legacyDoc = User.hydrate({
      email: 'legacy@example.com',
      passwordHash: '$2b$12$somehashhereexample',
    });

    expect(legacyDoc.role).toBe('user');
    expect(legacyDoc.role).not.toBe('admin');
  });

  it('defaults new user documents to user role rather than admin', () => {
    const newUser = new User({
      email: 'member@example.com',
      passwordHash: '$2b$12$somehashhereexample',
    });

    expect(newUser.role).toBe('user');
    expect(newUser.role).not.toBe('admin');
  });

  it('preserves explicit admin role when explicitly provided', () => {
    const adminUser = new User({
      email: 'admin@example.com',
      passwordHash: '$2b$12$somehashhereexample',
      role: 'admin',
    });

    expect(adminUser.role).toBe('admin');
  });
});
