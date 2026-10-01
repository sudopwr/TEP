import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { TarFormatError, packTar, unpackTar } from './tar';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (data: Uint8Array): string => new TextDecoder().decode(data);

const AT = 1_767_225_600; // 2026-01-01T00:00:00Z, so the bytes are stable.

describe('packTar and unpackTar', () => {
  it('carries an entry out and back unchanged', () => {
    const packed = packTar([{ name: 'manifest.json', bytes: bytes('{}') }], AT);

    expect(unpackTar(packed)).toEqual([
      { name: 'manifest.json', bytes: bytes('{}') },
    ]);
  });

  it('keeps several entries in the order they were packed', () => {
    // Order is part of the format's usefulness: the manifest comes first so a
    // reader can refuse a version it does not know before reading the rest.
    const packed = packTar(
      [
        { name: 'manifest.json', bytes: bytes('{"version":1}') },
        { name: 'ledger.json', bytes: bytes('{"payouts":[]}') },
        { name: 'files/ab/cd/one.pdf', bytes: bytes('%PDF-1.4') },
      ],
      AT,
    );

    expect(unpackTar(packed).map((entry) => entry.name)).toEqual([
      'manifest.json',
      'ledger.json',
      'files/ab/cd/one.pdf',
    ]);
  });

  it('is made of whole 512-byte blocks, and ends with two empty ones', () => {
    const packed = packTar([{ name: 'a', bytes: bytes('x') }], AT);

    // One header, one padded block of contents, two terminators.
    expect(packed.byteLength).toBe(512 * 4);
    expect(packed.subarray(1024).every((byte) => byte === 0)).toBe(true);
  });

  it('packs the same ledger to the same bytes twice', () => {
    // Reproducible, given the same instant: a backup whose bytes wobble for no
    // reason is one nobody can compare against the last one.
    const entries = [{ name: 'ledger.json', bytes: bytes('{"a":1}') }];

    expect(packTar(entries, AT)).toEqual(packTar(entries, AT));
  });

  it('carries bytes that are not text, exactly', () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x7f,
    ]);

    const [entry] = unpackTar(packTar([{ name: 'shot.png', bytes: png }], AT));

    expect(entry?.bytes).toEqual(png);
  });

  it('carries an empty file, which is a fact rather than an absence', () => {
    const [entry] = unpackTar(
      packTar([{ name: 'empty.txt', bytes: new Uint8Array() }], AT),
    );

    expect(entry).toEqual({ name: 'empty.txt', bytes: new Uint8Array() });
  });

  it('carries a file larger than one block', () => {
    const big = bytes('x'.repeat(5000));

    expect(text(unpackTar(packTar([{ name: 'big', bytes: big }], AT))[0]!.bytes))
      .toHaveLength(5000);
  });

  it('splits a path too long for the name field across the prefix', () => {
    // 100 bytes is the ustar name field. A document's extension comes from a
    // filename somebody typed, so this is reachable rather than theoretical.
    const name = `files/${'d'.repeat(60)}/${'n'.repeat(80)}.pdf`;

    expect(unpackTar(packTar([{ name, bytes: bytes('x') }], AT))).toEqual([
      { name, bytes: bytes('x') },
    ]);
  });

  it('refuses a name no split can fit', () => {
    expect(() =>
      packTar([{ name: 'z'.repeat(200), bytes: bytes('x') }], AT),
    ).toThrow(TarFormatError);
  });

  it('refuses an archive whose header does not add up', () => {
    // One byte of a filename changed: the checksum is what notices.
    const packed = packTar([{ name: 'ledger.json', bytes: bytes('{}') }], AT);
    packed[0] = 0x58;

    expect(() => unpackTar(packed)).toThrow(/does not add up/);
  });

  it('refuses something that was never a tar archive', () => {
    // A PDF dropped on the import screen by mistake. Reading it as an archive
    // of nothing and reporting success would be the worst of the options.
    expect(() => unpackTar(bytes('this is a PDF, not an export'))).toThrow(
      /not a tar archive/,
    );
  });

  it('refuses a file that is not a whole number of blocks', () => {
    const packed = packTar([{ name: 'a', bytes: bytes('x') }], AT);

    expect(() => unpackTar(packed.slice(0, packed.byteLength - 3))).toThrow(
      TarFormatError,
    );
  });

  it('refuses an entry that claims more bytes than are there', () => {
    // Truncated mid-contents at a block boundary, as a half-finished download
    // would be: the header survives and says 600 bytes follow, and 512 do.
    const packed = packTar([{ name: 'a', bytes: bytes('x'.repeat(600)) }], AT);

    expect(() => unpackTar(packed.slice(0, 1024))).toThrow(/past the end/);
  });

  it('stops at the terminator rather than reading past it', () => {
    const packed = packTar([{ name: 'a', bytes: bytes('x') }], AT);
    const trailing = new Uint8Array(packed.byteLength + 512);
    trailing.set(packed);
    trailing.fill(0x41, packed.byteLength);

    expect(unpackTar(trailing)).toHaveLength(1);
  });

  it('refuses a symlink, instead of following one out of the store', () => {
    /*
      An archive is untrusted input: it arrives from the owner's disk, but
      nothing says it arrived unaltered. A link entry is the classic way to
      make an extractor write outside where it meant to, and this reader has
      no business carrying one even as data.
    */
    const packed = packTar([{ name: 'escape', bytes: new Uint8Array() }], AT);
    packed[156] = 0x32; // typeflag '2' — symbolic link
    // Re-checksum, so it fails for being a link and not for being damaged.
    const sum = packed
      .subarray(0, 512)
      .reduce(
        (total, byte, at) => total + (at >= 148 && at < 156 ? 0x20 : byte),
        0,
      );
    const digits = sum.toString(8).padStart(6, '0');
    packed.set(new TextEncoder().encode(digits), 148);
    packed[154] = 0x00;
    packed[155] = 0x20;

    expect(() => unpackTar(packed)).toThrow(/not a regular file/);
  });

  it('skips a directory entry, which carries nothing', () => {
    const packed = packTar([{ name: 'files', bytes: new Uint8Array() }], AT);
    packed[156] = 0x35; // typeflag '5' — directory
    const sum = packed
      .subarray(0, 512)
      .reduce(
        (total, byte, at) => total + (at >= 148 && at < 156 ? 0x20 : byte),
        0,
      );
    packed.set(new TextEncoder().encode(sum.toString(8).padStart(6, '0')), 148);
    packed[154] = 0x00;
    packed[155] = 0x20;

    expect(unpackTar(packed)).toEqual([]);
  });
});

/**
 * The assertion this format exists for: something that is not this code can
 * read what this code wrote.
 *
 * A round trip through my own reader would pass just as happily on a format I
 * had invented. `tar` ships with Windows 10 and later and with every Unix, so
 * it is the same check an owner would make by hand — and it is the one that
 * would have caught a wrong checksum convention or an off-by-one field offset.
 */
describe('a real tar can read it', () => {
  const systemTar = (): string | null => {
    try {
      execFileSync('tar', ['--version'], { stdio: 'pipe' });
      return 'tar';
    } catch {
      return null;
    }
  };

  it.skipIf(systemTar() === null)('lists the entries it was given', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'payout-tar-'));
    const archive = path.join(directory, 'export.tar.gz');

    writeFileSync(
      archive,
      gzipSync(
        packTar(
          [
            { name: 'manifest.json', bytes: bytes('{"version":1}') },
            { name: 'files/ab/cd/statement.pdf', bytes: bytes('%PDF-1.4') },
          ],
          AT,
        ),
      ),
    );

    /*
      Run from inside the directory, with a bare filename.

      GNU tar reads `C:\...` as a `host:path` remote spec and tries to resolve
      a machine called `C` — which is how this check first failed for a reason
      that had nothing to do with the archive.
    */
    const run = (...args: readonly string[]) =>
      execFileSync('tar', args, { cwd: directory, encoding: 'utf8' });

    const listed = run('-tzf', 'export.tar.gz');

    expect(listed).toContain('manifest.json');
    expect(listed).toContain('files/ab/cd/statement.pdf');

    // And the contents come out byte for byte, not just the names.
    expect(run('-xzOf', 'export.tar.gz', 'manifest.json')).toBe(
      '{"version":1}',
    );
  });
});
