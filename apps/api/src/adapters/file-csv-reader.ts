import { readFile } from 'node:fs/promises';

import type { CsvReader, CsvTable } from '@payout/core';

/**
 * Tokenise a delimited file, and do nothing else to it.
 *
 * RFC 4180 with the usual concessions: CRLF or LF, a quoted field may hold
 * commas, newlines and doubled quotes, and a trailing newline is not an empty
 * final row. That is the whole job — the adapter does not know what a column
 * means, does not deduplicate the two `ToAmount` headers, and does not turn
 * anything into a number. Every one of those is a decision about the ledger,
 * and they belong in the use case.
 *
 * Hand-rolled rather than pulled from npm: the grammar is fifty lines, the
 * failure mode of getting it wrong is a silently mis-split document list, and
 * a dependency would still have to be configured not to be clever about types.
 */
export function parseCsv(text: string): CsvTable {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };

  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  // A leading byte-order mark would otherwise become part of the first header.
  const source = text.startsWith('﻿') ? text.slice(1) : text;

  while (index < source.length) {
    const character = source[index] ?? '';

    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += character;
      index += 1;
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
      index += 1;
      continue;
    }

    if (character === ',') {
      endField();
      index += 1;
      continue;
    }

    if (character === '\r') {
      if (source[index + 1] === '\n') {
        index += 1;
      }
      endRow();
      index += 1;
      continue;
    }

    if (character === '\n') {
      endRow();
      index += 1;
      continue;
    }

    field += character;
    index += 1;
  }

  if (field.length > 0 || row.length > 0) {
    endRow();
  }

  const [headers = [], ...body] = rows;

  return {
    headers,
    // A blank line in the middle of a sheet is not a transaction.
    rows: body.filter((cells) => cells.some((cell) => cell.trim().length > 0)),
  };
}

export class FileCsvReader implements CsvReader {
  async read(location: string): Promise<CsvTable> {
    return parseCsv(await readFile(location, 'utf8'));
  }
}
