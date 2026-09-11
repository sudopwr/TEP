import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileCsvReader, parseCsv } from './file-csv-reader';

describe('parseCsv', () => {
  it('splits a plain file into headers and rows', () => {
    const table = parseCsv('a,b,c\n1,2,3\n4,5,6\n');

    expect(table.headers).toEqual(['a', 'b', 'c']);
    expect(table.rows).toEqual([
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('keeps duplicate headers rather than helpfully renaming them', () => {
    // §9 defect 4 depends on this: the sheet has two ToAmount columns and the
    // first is the from-side. A reader that deduplicated would destroy it.
    const table = parseCsv(
      'ToAmount,Currency,ToAmount,Currency\n1,USD,2,INR\n',
    );

    expect(table.headers).toEqual([
      'ToAmount',
      'Currency',
      'ToAmount',
      'Currency',
    ]);
    expect(table.rows[0]).toEqual(['1', 'USD', '2', 'INR']);
  });

  it('treats a quoted comma as part of the field', () => {
    const table = parseCsv('id,docs\n1,"a.pdf, b.pdf"\n');

    expect(table.rows[0]).toEqual(['1', 'a.pdf, b.pdf']);
  });

  it('unescapes a doubled quote inside a quoted field', () => {
    const table = parseCsv('id,note\n1,"she said ""no"""\n');

    expect(table.rows[0]).toEqual(['1', 'she said "no"']);
  });

  it('allows a newline inside a quoted field', () => {
    const table = parseCsv('id,note\n1,"line one\nline two"\n');

    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]?.[1]).toBe('line one\nline two');
  });

  it('reads CRLF the same as LF', () => {
    expect(parseCsv('a,b\r\n1,2\r\n').rows).toEqual([['1', '2']]);
  });

  it('does not invent a row from the trailing newline', () => {
    expect(parseCsv('a,b\n1,2\n').rows).toHaveLength(1);
    expect(parseCsv('a,b\n1,2').rows).toHaveLength(1);
  });

  it('skips a blank line in the middle of a sheet', () => {
    expect(parseCsv('a,b\n1,2\n\n3,4\n').rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('keeps empty cells as empty strings', () => {
    expect(parseCsv('a,b,c\n1,,3\n').rows[0]).toEqual(['1', '', '3']);
  });

  it('does not interpret anything — every cell is text', () => {
    // 1.43908E+19 has already been through Excel once. Parsing it again is
    // how the rest of the digits would go.
    const table = parseCsv('ref\n1.43908E+19\n');

    expect(table.rows[0]?.[0]).toBe('1.43908E+19');
    expect(typeof table.rows[0]?.[0]).toBe('string');
  });

  it('strips a byte-order mark from the first header', () => {
    expect(parseCsv('﻿TxnId,b\n1,2\n').headers[0]).toBe('TxnId');
  });

  it('returns nothing useful for an empty file', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
  });
});

describe('FileCsvReader', () => {
  it('reads a file from disk', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'payout-csv-'));
    const file = path.join(directory, 'sheet.csv');
    writeFileSync(file, 'a,b\n1,"x, y"\n', 'utf8');

    const table = await new FileCsvReader().read(file);

    expect(table.headers).toEqual(['a', 'b']);
    expect(table.rows[0]).toEqual(['1', 'x, y']);
  });

  it('fails loudly when the file is not there', async () => {
    await expect(
      new FileCsvReader().read('no/such/file.csv'),
    ).rejects.toThrow();
  });
});
