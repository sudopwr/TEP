/**
 * The second of §5a's three constraints, and N10.
 *
 * A default credential on a loopback-only socket is a convenience. The same
 * credential on `0.0.0.0` is an open door onto every network the machine is
 * attached to. This is the check that makes the difference structural rather
 * than aspirational — the server does not start, and says exactly why.
 */

/** The only addresses that cannot be reached from another machine. */
const LOOPBACK = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '[::1]',
  '0:0:0:0:0:0:0:1',
]);

export class InsecureBindError extends Error {
  constructor(readonly host: string) {
    super(
      `Refusing to listen on ${host} while the default password is still in place.\n` +
        '\n' +
        'This application ships with admin / admin (CLAUDE.md §5a and F15). That is\n' +
        'only defensible while the socket cannot be reached from another machine.\n' +
        '\n' +
        'Do one of these:\n' +
        '  - start on 127.0.0.1, sign in, and change the password; or\n' +
        '  - change the password first, after which any bind address is allowed.\n' +
        '\n' +
        'If you need to reach this from another machine, CLAUDE.md §11 says put\n' +
        'Tailscale in front of it rather than exposing the port.',
    );
    this.name = 'InsecureBindError';
  }
}

/**
 * True when this address is only reachable from this machine.
 *
 * Anything unrecognised counts as remote. A hostname that happens to resolve
 * to a loopback address is still treated as remote: resolution depends on
 * DNS and a hosts file, neither of which this check should be trusting.
 */
export function isLoopback(host: string): boolean {
  return LOOPBACK.has(host.trim().toLowerCase());
}

/**
 * Throw unless it is safe to listen here.
 *
 * Called from the bootstrap before `listen`, not after: a server that binds
 * and then closes has already been reachable.
 */
export function assertSafeBindAddress(options: {
  readonly host: string;
  readonly mustChangePassword: boolean;
}): void {
  if (options.mustChangePassword && !isLoopback(options.host)) {
    throw new InsecureBindError(options.host);
  }
}
