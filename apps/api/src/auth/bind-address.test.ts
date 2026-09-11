import { describe, expect, it } from 'vitest';

import {
  InsecureBindError,
  assertSafeBindAddress,
  isLoopback,
} from './bind-address';

describe('isLoopback', () => {
  it.each(['127.0.0.1', 'localhost', '::1', '[::1]', '0:0:0:0:0:0:0:1'])(
    'accepts %s',
    (host) => {
      expect(isLoopback(host)).toBe(true);
    },
  );

  it.each(['0.0.0.0', '::', '192.168.1.10', '10.0.0.4', 'payouts.local'])(
    'rejects %s',
    (host) => {
      expect(isLoopback(host)).toBe(false);
    },
  );

  it('ignores case and surrounding whitespace', () => {
    expect(isLoopback(' LocalHost ')).toBe(true);
  });

  it('treats an unrecognised host as remote', () => {
    // Fail closed. A hostname that happens to resolve to 127.0.0.1 still
    // counts as remote: that resolution depends on DNS and a hosts file,
    // neither of which this check should be trusting.
    expect(isLoopback('loopback.example.com')).toBe(false);
    expect(isLoopback('')).toBe(false);
  });
});

describe('assertSafeBindAddress', () => {
  it('refuses 0.0.0.0 while the default password is in place', () => {
    expect(() => {
      assertSafeBindAddress({ host: '0.0.0.0', mustChangePassword: true });
    }).toThrow(InsecureBindError);
  });

  it('refuses a LAN address while the default password is in place', () => {
    expect(() => {
      assertSafeBindAddress({ host: '192.168.1.10', mustChangePassword: true });
    }).toThrow(InsecureBindError);
  });

  it('allows 127.0.0.1 while the default password is in place', () => {
    expect(() => {
      assertSafeBindAddress({ host: '127.0.0.1', mustChangePassword: true });
    }).not.toThrow();
  });

  it('allows any address once the password has been changed', () => {
    expect(() => {
      assertSafeBindAddress({ host: '0.0.0.0', mustChangePassword: false });
    }).not.toThrow();
  });

  it('says which address it refused, and why', () => {
    const error = (() => {
      try {
        assertSafeBindAddress({ host: '0.0.0.0', mustChangePassword: true });
        return null;
      } catch (thrown: unknown) {
        return thrown as InsecureBindError;
      }
    })();

    expect(error?.host).toBe('0.0.0.0');
    expect(error?.message).toContain('0.0.0.0');
    expect(error?.message).toContain('default password');
    // It has to tell you how to get out of the situation, not just refuse.
    expect(error?.message).toContain('127.0.0.1');
  });

  it('names the shipped default, which is documentation rather than a leak', () => {
    // admin / admin is in CLAUDE.md and in F15 — it is the published default,
    // not a secret, and somebody reading this refusal at 2am needs to know
    // which credential is blocking them. A *changed* password would never
    // appear here: by then this check does not fire at all.
    const error = (() => {
      try {
        assertSafeBindAddress({ host: '0.0.0.0', mustChangePassword: true });
        return null;
      } catch (thrown: unknown) {
        return thrown as Error;
      }
    })();

    expect(error?.message).toContain('admin / admin');
  });
});
