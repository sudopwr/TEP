import type { CsvReader, CsvTable } from '../../src/ports/csv-reader';

/**
 * A sheet held in memory, already tokenised.
 *
 * The use case's job is interpreting columns, not splitting on commas, so a
 * test that wants to prove something about the duplicate `ToAmount` header
 * should be able to write two columns called `ToAmount` and stop there.
 */
export class FakeCsvReader implements CsvReader {
  readonly #tables: Map<string, CsvTable>;

  constructor(tables: Readonly<Record<string, CsvTable>> = {}) {
    this.#tables = new Map(Object.entries(tables));
  }

  static of(
    headers: readonly string[],
    rows: readonly (readonly string[])[],
    location = 'legacy.csv',
  ): FakeCsvReader {
    return new FakeCsvReader({ [location]: { headers, rows } });
  }

  read(location: string): Promise<CsvTable> {
    const table = this.#tables.get(location);
    if (table === undefined) {
      return Promise.reject(new Error(`no such file: '${location}'`));
    }
    return Promise.resolve(table);
  }
}
