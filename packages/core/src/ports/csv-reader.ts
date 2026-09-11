/**
 * A delimited file, tokenised but not interpreted.
 *
 * `headers` is the first row exactly as it appears, duplicates and all. That
 * matters: the legacy sheet has two columns called `ToAmount` and the first
 * one is the from-side (CLAUDE.md §9, defect 4). An adapter that helpfully
 * deduplicated or renamed them would destroy the only thing that makes the
 * file readable, so it must not. Which column means what is a decision about
 * the ledger, and decisions about the ledger live in core.
 *
 * Every cell is a string. The sheet's numbers have already been through
 * Excel once — `1.43908E+19` used to be a reference id — so nothing here
 * guesses at types.
 */
export interface CsvTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface CsvReader {
  /**
   * Read and tokenise the file at `location`.
   *
   * Quoting is the adapter's problem: a document list like
   * `"proof.pdf, statement.pdf"` is one cell, not two.
   */
  read(location: string): Promise<CsvTable>;
}
