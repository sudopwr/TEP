/**
 * A tar archive, packed and unpacked by hand.
 *
 * F33 hands the owner one file holding their whole ledger and every document
 * attached to it. That file has to be openable in five years by something
 * nobody has installed yet, which rules out a format of my own invention and
 * argues for the oldest one that still works everywhere.
 *
 * **Why tar rather than zip.** Both are universal; tar is an order of
 * magnitude simpler to get exactly right. A tar file is a sequence of 512-byte
 * headers each followed by its padded contents, and that is the whole of it —
 * no central directory to keep consistent with the entries, no per-entry CRC,
 * no two places recording the same size. Gzip then comes free from `node:zlib`,
 * and `.tar.gz` opens in Windows Explorer, in the `tar` that ships with
 * Windows 10 and later, in Finder, in 7-Zip and in every Unix. A zip writer
 * that is subtly wrong produces an archive that looks fine until the day it is
 * needed, which is the one failure a backup format must not have.
 *
 * **Why not a dependency.** `apps/api` may have dependencies — N3 binds only
 * core — so this is a judgement rather than a rule: a hundred lines of a
 * format frozen since 1988, which this file's tests pin in both directions,
 * against a supply-chain dependency in the one feature whose job is to still
 * work when everything else has been reinstalled.
 *
 * Buffered, not streamed, and deliberately: the archive is read and written in
 * one request on loopback, and the alternative is a streaming pipeline whose
 * failure modes are considerably harder to reason about than the memory of a
 * few thousand rows and the PDFs beside them.
 */

const BLOCK = 512;

/** ustar field offsets, in the order the header lays them out. */
const FIELD = {
  name: 0,
  mode: 100,
  uid: 108,
  gid: 116,
  size: 124,
  mtime: 136,
  checksum: 148,
  typeFlag: 156,
  magic: 257,
  version: 263,
  prefix: 345,
} as const;

const NAME_BYTES = 100;
const PREFIX_BYTES = 155;

export interface TarEntry {
  /** A relative path with forward slashes — `files/ab/cd/<sha>.pdf`. */
  readonly name: string;
  readonly bytes: Uint8Array;
}

export class TarFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TarFormatError';
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function writeText(block: Uint8Array, at: number, text: string, size: number) {
  const encoded = encoder.encode(text);

  if (encoded.byteLength > size) {
    throw new TarFormatError(
      `'${text}' does not fit in ${String(size)} bytes of a tar header.`,
    );
  }

  block.set(encoded, at);
}

/** Octal, NUL-terminated, zero-padded — how tar has written numbers forever. */
function writeOctal(
  block: Uint8Array,
  at: number,
  value: number,
  size: number,
) {
  const digits = value.toString(8).padStart(size - 1, '0');

  if (digits.length > size - 1) {
    throw new TarFormatError(
      `${String(value)} is too large for a ${String(size)}-byte tar field.`,
    );
  }

  writeText(block, at, digits, size - 1);
}

/**
 * Split a path that outgrew the 100-byte name field across `prefix`.
 *
 * Our own entries are hash-derived and comfortably short, but a document's
 * extension comes from a filename somebody typed, so the long case is reachable
 * and refusing to export would be the wrong answer to it. ustar's answer is to
 * put the leading directories in `prefix`, which every reader rejoins with a
 * slash; this picks the split that leaves the name as long as it will go.
 */
function splitName(name: string): { prefix: string; name: string } {
  if (encoder.encode(name).byteLength <= NAME_BYTES) {
    return { prefix: '', name };
  }

  for (let at = name.indexOf('/'); at !== -1; at = name.indexOf('/', at + 1)) {
    const prefix = name.slice(0, at);
    const rest = name.slice(at + 1);

    if (
      encoder.encode(rest).byteLength <= NAME_BYTES &&
      encoder.encode(prefix).byteLength <= PREFIX_BYTES
    ) {
      return { prefix, name: rest };
    }
  }

  throw new TarFormatError(
    `'${name}' is too long for a tar header, even split across its prefix.`,
  );
}

/**
 * The header checksum: every byte summed, with its own field read as spaces.
 *
 * Written as six octal digits, a NUL and a space, which is what GNU tar, bsdtar
 * and every reader since have expected.
 */
function checksum(block: Uint8Array): number {
  let total = 0;

  for (let at = 0; at < BLOCK; at += 1) {
    const inChecksumField =
      at >= FIELD.checksum && at < FIELD.checksum + 8;

    total += inChecksumField ? 0x20 : (block[at] ?? 0);
  }

  return total;
}

function header(entry: TarEntry, mtime: number): Uint8Array {
  const block = new Uint8Array(BLOCK);
  const split = splitName(entry.name);

  writeText(block, FIELD.name, split.name, NAME_BYTES);
  writeText(block, FIELD.prefix, split.prefix, PREFIX_BYTES);
  // Readable and writable by the owner, readable by everyone: what a document
  // extracted from a backup should be, and nothing executable.
  writeOctal(block, FIELD.mode, 0o644, 8);
  writeOctal(block, FIELD.uid, 0, 8);
  writeOctal(block, FIELD.gid, 0, 8);
  writeOctal(block, FIELD.size, entry.bytes.byteLength, 12);
  writeOctal(block, FIELD.mtime, mtime, 12);
  // '0' is a regular file. Nothing here writes any other kind: a symlink or a
  // device node in an archive this application wrote would be a bug, and one
  // in an archive it reads is refused rather than followed.
  writeText(block, FIELD.typeFlag, '0', 1);
  writeText(block, FIELD.magic, 'ustar', 6);
  writeText(block, FIELD.version, '00', 2);

  writeOctal(block, FIELD.checksum, checksum(block), 7);
  block[FIELD.checksum + 6] = 0x00;
  block[FIELD.checksum + 7] = 0x20;

  return block;
}

/** Whole 512-byte blocks, rounded up — tar pads every entry's contents. */
function padded(size: number): number {
  return Math.ceil(size / BLOCK) * BLOCK;
}

/**
 * Pack entries into a tar archive.
 *
 * `mtime` is a parameter because a reproducible archive is a testable one: the
 * same ledger packed twice at the same instant is byte-identical, which is how
 * the round-trip tests can assert on bytes at all.
 */
export function packTar(
  entries: readonly TarEntry[],
  mtime: number = Math.floor(Date.now() / 1000),
): Uint8Array {
  const size =
    entries.reduce(
      (total, entry) => total + BLOCK + padded(entry.bytes.byteLength),
      0,
    ) +
    // Two zero blocks end the archive. Readers stop at the first of them.
    BLOCK * 2;

  const out = new Uint8Array(size);
  let at = 0;

  for (const entry of entries) {
    out.set(header(entry, mtime), at);
    at += BLOCK;
    out.set(entry.bytes, at);
    at += padded(entry.bytes.byteLength);
  }

  return out;
}

function readText(block: Uint8Array, at: number, size: number): string {
  const field = block.subarray(at, at + size);
  const end = field.indexOf(0);

  return decoder.decode(end === -1 ? field : field.subarray(0, end)).trim();
}

function readOctal(block: Uint8Array, at: number, size: number): number {
  const text = readText(block, at, size);

  if (text === '') return 0;
  if (!/^[0-7]+$/.test(text)) {
    throw new TarFormatError(
      `'${text}' is not an octal number, so this is not a tar archive.`,
    );
  }

  return Number.parseInt(text, 8);
}

function isZeroBlock(block: Uint8Array): boolean {
  return block.every((byte) => byte === 0);
}

/**
 * Read a tar archive back into its entries.
 *
 * Every header's checksum is verified, which is the cheap way to find out that
 * a file was truncated, re-encoded by something well-meaning, or never a tar
 * archive at all — and to say so before any of it is written anywhere.
 *
 * Only regular files come back. A directory entry carries no contents and is
 * skipped; anything else — a link, a device, a long-name extension this does
 * not implement — is refused by name, because silently dropping an entry from
 * a restore is how a document goes missing without anybody being told.
 */
export function unpackTar(archive: Uint8Array): readonly TarEntry[] {
  /*
    Refused up front, rather than read as an empty archive.

    A tar file is blocks all the way down, so anything that is not a whole
    number of them is not one — and a file shorter than a single block cannot
    carry even a header. Without these two lines a PDF handed to the import
    screen by mistake unpacks to nothing at all, and "your archive contained no
    documents" is a far worse answer than "this is not an export".
  */
  if (archive.byteLength < BLOCK || archive.byteLength % BLOCK !== 0) {
    throw new TarFormatError(
      'This file is not a tar archive: its length is not a whole number of ' +
        '512-byte blocks.',
    );
  }

  const entries: TarEntry[] = [];
  let at = 0;

  while (at + BLOCK <= archive.byteLength) {
    const block = archive.subarray(at, at + BLOCK);

    if (isZeroBlock(block)) break;

    const claimed = readOctal(block, FIELD.checksum, 8);
    if (claimed !== checksum(block)) {
      throw new TarFormatError(
        'A header in this archive does not add up. The file is damaged, or it ' +
          'is not an export.',
      );
    }

    const size = readOctal(block, FIELD.size, 12);
    const typeFlag = readText(block, FIELD.typeFlag, 1);
    const prefix = readText(block, FIELD.prefix, PREFIX_BYTES);
    const name = readText(block, FIELD.name, NAME_BYTES);
    const full = prefix === '' ? name : `${prefix}/${name}`;

    at += BLOCK;

    if (at + size > archive.byteLength) {
      throw new TarFormatError(
        `'${full}' claims ${String(size)} bytes, which is past the end of the archive.`,
      );
    }

    if (typeFlag === '0' || typeFlag === '') {
      entries.push({ name: full, bytes: archive.slice(at, at + size) });
    } else if (typeFlag !== '5') {
      throw new TarFormatError(
        `'${full}' is not a regular file (type '${typeFlag}'), and this archive should contain nothing else.`,
      );
    }

    at += padded(size);
  }

  return entries;
}
