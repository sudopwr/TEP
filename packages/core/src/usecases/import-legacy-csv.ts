import type { Account, AccountType } from '../domain/account';
import type { Company } from '../domain/company';
import type { Currency, CurrencyRegistry } from '../domain/currency';
import type { IsoDate, TraderId, TransactionId } from '../domain/ids';
import { Money, type RoundingMode } from '../domain/money';
import type { Payout } from '../domain/payout';
import type { Transaction, TransactionKind } from '../domain/transaction';
import type { FeeType } from '../domain/transaction-fee';
import type { AccountRepository } from '../ports/account-repository';
import type { CompanyRepository } from '../ports/company-repository';
import type { CsvReader } from '../ports/csv-reader';
import type { DocumentRepository } from '../ports/document-repository';
import type { PayoutRepository } from '../ports/payout-repository';
import type { TransactionRepository } from '../ports/transaction-repository';

export interface ImportLegacyCsvDependencies {
  readonly csv: CsvReader;
  readonly companies: CompanyRepository;
  readonly accounts: AccountRepository;
  readonly payouts: PayoutRepository;
  readonly transactions: TransactionRepository;
  readonly documents: DocumentRepository;
  readonly currencies: CurrencyRegistry;
}

export interface ImportLegacyCsvCommand {
  readonly location: string;
  /** How a recomputed from-amount resolves. Defaults to half-up. */
  readonly rounding?: RoundingMode;
  /**
   * Whose sheet this is (F24).
   *
   * The legacy CSV is one person's history and carries no column saying
   * whose, so the caller says. `cli/import.ts` passes the trader `004`
   * created, which is the one every payout already belonged to.
   */
  readonly traderId: TraderId;
}

/** One defect from CLAUDE.md §9, and what was done about it. */
export interface AppliedCorrection {
  readonly defect: 1 | 2 | 3 | 4 | 5;
  readonly subject: string;
  readonly detail: string;
}

export interface ImportTally {
  readonly created: number;
  readonly reused: number;
}

/** The same shape while it is still being counted up. */
interface MutableTally {
  created: number;
  reused: number;
}

export interface ImportLegacyCsvResult {
  readonly rowsRead: number;
  readonly companies: ImportTally;
  readonly accounts: ImportTally;
  readonly payouts: ImportTally;
  readonly transactions: ImportTally;
  readonly documents: ImportTally;
  readonly feesRecorded: number;
  readonly documentLinks: number;
  readonly corrections: readonly AppliedCorrection[];
}

export class LegacyCsvError extends Error {
  constructor(
    readonly rowNumber: number,
    readonly column: string,
    reason: string,
  ) {
    super(`Row ${String(rowNumber)}, column '${column}': ${reason}.`);
    this.name = 'LegacyCsvError';
  }
}

/** The two sale rows §9 says had their exchange fee and GST swapped. */
const SWAPPED_PAIR = ['Transaction003', 'Transaction0011'] as const;

const FEE_COLUMNS: readonly (readonly [string, FeeType])[] = [
  ['TDS', 'tds'],
  ['ExchangeFee', 'exchange_fee'],
  ['GST', 'gst'],
  ['NetworkFee', 'network_fee'],
  ['PlatformCharge', 'platform_charge'],
];

/** Fees the sheet quotes in the leg's own source currency rather than INR. */
const SOURCE_CURRENCY_FEES = new Set<FeeType>([
  'network_fee',
  'platform_charge',
]);

const DDMMYYYY = /^(\d{2})-(\d{2})-(\d{4})$/;

/** What Excel leaves behind when it decides an id was a number. */
const SCIENTIFIC_NOTATION = /^[+-]?\d(?:\.\d+)?[Ee][+-]?\d+$/;

/** `02-04-2025` is the second of April, not the fourth of February. */
export function toIsoDate(text: string): string | null {
  const match = DDMMYYYY.exec(text.trim());
  if (match === null) {
    return null;
  }
  const [, day, month, year] = match;
  return `${String(year)}-${String(month)}-${String(day)}`;
}

/** A rate as written in the sheet, scaled to the 1e8 the schema stores. */
export function toScaledRate(text: string): bigint | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (match === null) {
    return null;
  }
  const whole = match[1] ?? '0';
  const fraction = (match[2] ?? '').padEnd(8, '0').slice(0, 8);
  return BigInt(`${whole}${fraction}`);
}

/**
 * A row addressed by header name, with duplicates kept.
 *
 * `at(name, occurrence)` is how §9's duplicate `ToAmount` is read: occurrence
 * 0 is the from-side, occurrence 1 is the to-side. Nothing renames a column,
 * so the sheet stays recognisable to whoever has to check this against it.
 */
class HeaderedRow {
  readonly #positions: ReadonlyMap<string, readonly number[]>;
  readonly #cells: readonly string[];
  readonly #rowNumber: number;

  constructor(
    positions: ReadonlyMap<string, readonly number[]>,
    cells: readonly string[],
    rowNumber: number,
  ) {
    this.#positions = positions;
    this.#cells = cells;
    this.#rowNumber = rowNumber;
  }

  get rowNumber(): number {
    return this.#rowNumber;
  }

  at(name: string, occurrence = 0): string {
    const columns = this.#positions.get(name);
    const index = columns?.[occurrence];

    if (index === undefined) {
      throw new LegacyCsvError(
        this.#rowNumber,
        name,
        occurrence === 0
          ? 'the sheet has no such column'
          : `the sheet has no ${String(occurrence + 1)} occurrence of it`,
      );
    }

    return (this.#cells[index] ?? '').trim();
  }

  has(name: string): boolean {
    return this.#positions.has(name);
  }

  require(name: string, occurrence = 0): string {
    const value = this.at(name, occurrence);
    if (value.length === 0) {
      throw new LegacyCsvError(this.#rowNumber, name, 'it is empty');
    }
    return value;
  }
}

function indexHeaders(
  headers: readonly string[],
): ReadonlyMap<string, readonly number[]> {
  const positions = new Map<string, number[]>();

  headers.forEach((header, index) => {
    const name = header.trim();
    const bucket = positions.get(name) ?? [];
    bucket.push(index);
    positions.set(name, bucket);
  });

  return positions;
}

/**
 * F12 — import the legacy CSV once, correcting it on the way in.
 *
 * F12 rather than a UC number: CLAUDE.md §3 numbers UC1-UC14 and none of
 * them is this. The importer is a one-off requirement, not part of the
 * running application.
 *
 * Every defect in CLAUDE.md §9 is corrected here rather than in the database
 * or by hand, and every correction is reported in the result so the import
 * can be checked against the sheet afterwards. The sheet itself is never
 * trusted on the four points §9 records as wrong.
 *
 * Idempotent by natural key. Companies, accounts, payouts and transactions
 * all carry a unique code, documents a unique stored path, and a fee is
 * unique per type per transaction — so a second run finds everything already
 * there and inserts nothing. That is what makes this safe to re-run after it
 * fails half way, which is the only honest assumption about a one-off import.
 */
export class ImportLegacyCsv {
  readonly #deps: ImportLegacyCsvDependencies;

  constructor(dependencies: ImportLegacyCsvDependencies) {
    this.#deps = dependencies;
  }

  async execute(
    command: ImportLegacyCsvCommand,
  ): Promise<ImportLegacyCsvResult> {
    const rounding = command.rounding ?? 'half-up';
    const table = await this.#deps.csv.read(command.location);
    const positions = indexHeaders(table.headers);
    const corrections: AppliedCorrection[] = [];

    this.#reportDuplicateHeaders(positions, corrections);

    const rows = table.rows.map(
      (cells, index) => new HeaderedRow(positions, cells, index + 2),
    );

    // §9 defect 5: 'Transaction0010' sorts before 'Transaction002' as text.
    // Rows are taken in file order and parents resolved by code, so no
    // ordering is ever inferred from the id. The sheet id becomes `code`.
    const parentsByCode = new Map<string, TransactionId>();

    const tally = {
      companies: { created: 0, reused: 0 },
      accounts: { created: 0, reused: 0 },
      payouts: { created: 0, reused: 0 },
      transactions: { created: 0, reused: 0 },
      documents: { created: 0, reused: 0 },
    };
    let feesRecorded = 0;
    let documentLinks = 0;

    const swapped = this.#swappedFees(rows, corrections);

    for (const row of rows) {
      const company = await this.#company(row, tally.companies);
      const payout = await this.#payout(
        row,
        company,
        command.traderId,
        tally.payouts,
        corrections,
      );

      const fromAccount = await this.#account(
        row,
        'FromAccount',
        this.#currencyOf(row, 'FromCurrency'),
        tally.accounts,
      );
      const toAccount = await this.#account(
        row,
        'ToAccount',
        this.#currencyOf(row, 'ToCurrency'),
        tally.accounts,
      );

      const transaction = await this.#transaction(
        row,
        payout,
        fromAccount,
        toAccount,
        parentsByCode,
        rounding,
        corrections,
        tally.transactions,
      );
      parentsByCode.set(transaction.code, transaction.id);

      feesRecorded += await this.#fees(row, transaction, swapped);
      documentLinks += await this.#documents(row, transaction, tally.documents);
    }

    return {
      rowsRead: rows.length,
      ...tally,
      feesRecorded,
      documentLinks,
      corrections,
    };
  }

  #reportDuplicateHeaders(
    positions: ReadonlyMap<string, readonly number[]>,
    corrections: AppliedCorrection[],
  ): void {
    for (const [name, columns] of positions) {
      if (columns.length > 1) {
        corrections.push({
          defect: 4,
          subject: name,
          detail: `column appears ${String(columns.length)} times; the first occurrence is read as the from-side`,
        });
      }
    }
  }

  /**
   * §9 defect 2 — the exchange fee and GST of Transaction003 and
   * Transaction0011 were written into each other's rows. Read both, then give
   * each row the other's pair.
   */
  #swappedFees(
    rows: readonly HeaderedRow[],
    corrections: AppliedCorrection[],
  ): ReadonlyMap<string, ReadonlyMap<FeeType, string>> {
    const found = new Map<string, HeaderedRow>();

    for (const row of rows) {
      const code = row.at('TxnId');
      if ((SWAPPED_PAIR as readonly string[]).includes(code)) {
        found.set(code, row);
      }
    }

    const [first, second] = SWAPPED_PAIR;
    const firstRow = found.get(first);
    const secondRow = found.get(second);

    if (firstRow === undefined || secondRow === undefined) {
      return new Map();
    }

    const pairOf = (row: HeaderedRow): ReadonlyMap<FeeType, string> =>
      new Map<FeeType, string>([
        ['exchange_fee', row.at('ExchangeFee')],
        ['gst', row.at('GST')],
      ]);

    corrections.push({
      defect: 2,
      subject: `${first} / ${second}`,
      detail:
        'exchange_fee and gst were written into each other’s rows; both are taken from the other row',
    });

    // Each code gets the OTHER row's values.
    return new Map([
      [first, pairOf(secondRow)],
      [second, pairOf(firstRow)],
    ]);
  }

  #currencyOf(row: HeaderedRow, column: string): Currency {
    return this.#deps.currencies.get(row.require(column));
  }

  async #company(row: HeaderedRow, tally: MutableTally): Promise<Company> {
    const code = row.require('CompanyCode');
    const existing = await this.#deps.companies.findByCode(code);

    if (existing !== null) {
      tally.reused += 1;
      return existing;
    }

    tally.created += 1;
    return this.#deps.companies.insert({
      code,
      name: row.at('CompanyName') || code,
      notes: null,
    });
  }

  /**
   * Accounts are created as they are met. The allow-list is what the sheet
   * actually shows moving through the account — observed rather than
   * declared, because the sheet declares nothing.
   */
  async #account(
    row: HeaderedRow,
    column: string,
    currency: Currency,
    tally: MutableTally,
  ): Promise<Account> {
    const code = row.require(column);
    const existing = await this.#deps.accounts.findByCode(code);

    if (existing !== null) {
      if (existing.allows(currency.code)) {
        tally.reused += 1;
        return existing;
      }
      tally.reused += 1;
      return this.#deps.accounts.update(existing.allowCurrency(currency.code));
    }

    tally.created += 1;
    return this.#deps.accounts.insert({
      code,
      name: row.at(`${column}Name`) || code,
      type: row.require(`${column}Type`) as AccountType,
      companyId: null,
      allowedCurrencies: [currency.code],
    });
  }

  async #payout(
    row: HeaderedRow,
    company: Company,
    traderId: TraderId,
    tally: MutableTally,
    corrections: AppliedCorrection[],
  ): Promise<Payout> {
    const code = row.require('PayoutCode');
    const existing = await this.#deps.payouts.findByCode(code);

    if (existing !== null) {
      tally.reused += 1;
      return existing;
    }

    const currency = this.#currencyOf(row, 'PayoutCurrency');
    const reference = row.at('PayoutRef') || null;

    if (reference !== null && SCIENTIFIC_NOTATION.test(reference)) {
      corrections.push({
        defect: 3,
        subject: code,
        detail: `reference '${reference}' was already a float before it reached us; the digits are unrecoverable, so it is stored as text unchanged`,
      });
    }

    tally.created += 1;

    return this.#deps.payouts.insert({
      code,
      companyId: company.id,
      traderId,
      payoutDate: this.#date(row, 'PayoutDate'),
      // §9 defect 3: whatever Excel left of the reference is kept verbatim.
      reference: reference,
      gross: this.#money(row, 'PayoutGross', currency),
      charges:
        row.at('PayoutCharges').length === 0
          ? Money.zero(currency)
          : this.#money(row, 'PayoutCharges', currency),
      notes: null,
    });
  }

  async #transaction(
    row: HeaderedRow,
    payout: Payout,
    fromAccount: Account,
    toAccount: Account,
    parentsByCode: ReadonlyMap<string, TransactionId>,
    rounding: RoundingMode,
    corrections: AppliedCorrection[],
    tally: MutableTally,
  ): Promise<Transaction> {
    const code = row.require('TxnId');
    const existing = await this.#deps.transactions.findByCode(code);

    if (existing !== null) {
      tally.reused += 1;
      return existing;
    }

    const kind = row.require('Kind') as TransactionKind;
    const fromCurrency = this.#currencyOf(row, 'FromCurrency');
    const toCurrency = this.#currencyOf(row, 'ToCurrency');
    const toAmount = this.#money(row, 'ToAmount', toCurrency, 1);
    const rate = this.#rate(row);

    const fromAmount = this.#fromAmount(
      row,
      kind,
      code,
      fromCurrency,
      toAmount,
      rate,
      rounding,
      corrections,
    );

    const parentCode = row.at('ParentId');
    const parentId =
      parentCode.length === 0 ? null : (parentsByCode.get(parentCode) ?? null);

    if (parentCode.length > 0 && parentId === null) {
      throw new LegacyCsvError(
        row.rowNumber,
        'ParentId',
        `'${parentCode}' has not appeared above this row`,
      );
    }

    tally.created += 1;

    return this.#deps.transactions.insert({
      code,
      payoutId: payout.id,
      parentId,
      txnDate: this.#date(row, 'Date'),
      kind,
      fromAccountId: fromAccount.id,
      toAccountId: toAccount.id,
      fromAmount,
      toAmount,
      rate,
      // §9 defect 3: references are carried across as text, whatever Excel
      // already did to them. Nothing here parses or repairs one.
      fromExternalRef: row.has('FromRef') ? row.at('FromRef') || null : null,
      toExternalRef: row.has('ToRef') ? row.at('ToRef') || null : null,
      notes: null,
    });
  }

  /**
   * §9 defect 1 — the From column on every sale row is `45.957`, copy-pasted.
   * The proceeds and the rate are sound, so the quantity sold is recovered
   * from them and the sheet's own figure is discarded.
   */
  #fromAmount(
    row: HeaderedRow,
    kind: TransactionKind,
    code: string,
    fromCurrency: Currency,
    toAmount: Money,
    rate: bigint | null,
    rounding: RoundingMode,
    corrections: AppliedCorrection[],
  ): Money {
    const asWritten = this.#money(row, 'ToAmount', fromCurrency, 0);

    if (kind !== 'sale') {
      return asWritten;
    }

    if (rate === null) {
      throw new LegacyCsvError(
        row.rowNumber,
        'Rate',
        'a sale with no rate cannot have its from-amount recomputed',
      );
    }

    const recomputed = toAmount.divideByRate(rate, fromCurrency, rounding);

    corrections.push({
      defect: 1,
      subject: code,
      detail: `from-amount ${asWritten.toString()} discarded; recomputed from proceeds and rate as ${recomputed.toString()}`,
    });

    return recomputed;
  }

  async #fees(
    row: HeaderedRow,
    transaction: Transaction,
    swapped: ReadonlyMap<string, ReadonlyMap<FeeType, string>>,
  ): Promise<number> {
    const corrected = swapped.get(transaction.code);
    const settlement = transaction.toAmount.currency;
    const source = transaction.fromAmount.currency;
    let recorded = 0;

    for (const [column, feeType] of FEE_COLUMNS) {
      if (!row.has(column)) {
        continue;
      }

      const text = corrected?.get(feeType) ?? row.at(column);
      if (text.length === 0) {
        continue;
      }

      const currency = SOURCE_CURRENCY_FEES.has(feeType) ? source : settlement;
      await this.#deps.transactions.recordFee({
        transactionId: transaction.id,
        feeType,
        amount: Money.fromDecimalString(text, currency),
      });
      recorded += 1;
    }

    return recorded;
  }

  /**
   * The Documents cell is a comma-separated list of filenames. Each becomes
   * one document, deduped by filename across the whole file, and one link to
   * the leg that named it.
   *
   * The sheet has filenames and no bytes, so the document is a reference with
   * no content hash until UC4 attaches the real file.
   */
  async #documents(
    row: HeaderedRow,
    transaction: Transaction,
    tally: MutableTally,
  ): Promise<number> {
    if (!row.has('Documents')) {
      return 0;
    }

    const filenames = row
      .at('Documents')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0);

    let links = 0;
    const seen = new Set<string>();

    for (const filename of filenames) {
      if (seen.has(filename)) {
        continue;
      }
      seen.add(filename);

      const storedPath = `legacy/${filename}`;
      const existing = await this.#deps.documents.findByStoredPath(storedPath);

      const document =
        existing ??
        (await this.#deps.documents.insert({
          filename,
          storedPath,
          mimeType: null,
          byteSize: null,
          sha256: null,
          docType: null,
          docDate: null,
          extractedText: null,
        }));

      if (existing === null) {
        tally.created += 1;
      } else {
        tally.reused += 1;
      }

      await this.#deps.documents.link(
        document.id,
        { kind: 'transaction', id: transaction.id },
        'legacy-import',
      );
      links += 1;
    }

    return links;
  }

  #date(row: HeaderedRow, column: string): IsoDate {
    const iso = toIsoDate(row.require(column));
    if (iso === null) {
      throw new LegacyCsvError(
        row.rowNumber,
        column,
        `'${row.at(column)}' is not DD-MM-YYYY`,
      );
    }
    return iso;
  }

  #money(
    row: HeaderedRow,
    column: string,
    currency: Currency,
    occurrence = 0,
  ): Money {
    const text = row.require(column, occurrence);
    try {
      return Money.fromDecimalString(text, currency);
    } catch (error) {
      throw new LegacyCsvError(
        row.rowNumber,
        column,
        `'${text}' is not an amount in ${currency.code} (${(error as Error).message})`,
      );
    }
  }

  #rate(row: HeaderedRow): bigint | null {
    const text = row.at('Rate');
    if (text.length === 0) {
      return null;
    }

    const scaled = toScaledRate(text);
    if (scaled === null) {
      throw new LegacyCsvError(
        row.rowNumber,
        'Rate',
        `'${text}' is not a rate`,
      );
    }
    return scaled;
  }
}
