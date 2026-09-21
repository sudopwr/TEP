/**
 * TradeifyPayout001 — the reference tree from CLAUDE.md §10.
 *
 * WHAT IS AUTHORITATIVE AND WHAT IS NOT
 *
 * Authoritative, straight from §10, and asserted by the tests:
 *
 *   payout gross    $1,008.01     gross proceeds  ₹86,027.56
 *   total fees      ₹ 1,384.63    net credited    ₹84,642.93
 *   TDS             ₹   868.88    exchange_fee    ₹   437.09
 *   GST             ₹    78.66    network_fee     $    16.31
 *   platform_charge $   100.79
 *   balances        Bank 84,642.93 INR, CoinDCX 14.0908 USDT,
 *                   TrustWallet 1.3323 USDT
 *
 * NOT authoritative: the split of those totals across individual legs, the
 * per-leg rates and dates, and the shape of the tree. §10 records aggregates
 * only. Everything below is a reconstruction chosen so that each total comes
 * out exactly right and every intermediate balance reconciles. It honours the
 * per-leg facts the document does give:
 *
 *   - §9  Transaction0011's true from-amount is 741.72 USDT
 *   - §9  Transaction003 and Transaction0011 both work out at 0.508%
 *   - §11 Transaction005 computes to 0.4866%, Transaction008 to 0.5308%
 *   - §8  the Rise withdrawal fee is flat, and four of them cost $16.31
 *
 * When the legacy CSV is imported for real (F12), replace this file with the
 * corrected rows and the assertions should not move.
 */
import { Account } from './account';
import { Company } from './company';
import { FeeSchedule } from './fee-schedule';
import { INR, USD, USDT } from './currency';
import type { AccountId } from './ids';
import { Money } from './money';
import { Payout } from './payout';
import { Trader } from './trader';
import { Transaction } from './transaction';
import { TransactionFee } from './transaction-fee';

const inr = (text: string): Money => Money.fromDecimalString(text, INR);
const usd = (text: string): Money => Money.fromDecimalString(text, USD);
const usdt = (text: string): Money => Money.fromDecimalString(text, USDT);

// ---------- Fee schedules (CLAUDE.md §8) ----------
//
// Declared here rather than in a test helper so that the in-memory world and
// the SQLite world are demonstrably running the same schedules.

export const COINDCX_EXCHANGE_FEE = FeeSchedule.create({
  id: 1,
  accountId: 4,
  feeType: 'exchange_fee',
  basis: 'to_amount',
  rateBps: 50,
  flatAmount: null,
  effectiveFrom: '2024-01-01',
  effectiveTo: null,
});

export const COINDCX_GST = FeeSchedule.create({
  id: 2,
  accountId: 4,
  feeType: 'gst',
  basis: 'exchange_fee',
  rateBps: 1800,
  flatAmount: null,
  effectiveFrom: '2024-01-01',
  effectiveTo: null,
});

export const RISE_NETWORK_FEE = FeeSchedule.create({
  id: 3,
  accountId: 2,
  feeType: 'network_fee',
  basis: 'flat',
  rateBps: null,
  flatAmount: usd('4.00'),
  effectiveFrom: '2024-01-01',
  effectiveTo: null,
});

export const FEE_SCHEDULES: readonly FeeSchedule[] = [
  COINDCX_EXCHANGE_FEE,
  COINDCX_GST,
  RISE_NETWORK_FEE,
];

// ---------- Counterparties ----------

/**
 * The trader every payout in this fixture belongs to (F24).
 *
 * Id 1 and code `default`, matching what `004_traders.sql` creates, so the
 * fake world and a migrated database agree about whose money §10 is.
 */
export const DEFAULT_TRADER = Trader.create({
  id: 1,
  code: 'default',
  name: 'Me',
  notes: null,
});

export const TRADEIFY = Company.create({
  id: 1,
  code: 'Tradeify001',
  name: 'Tradeify',
  notes: null,
});

export const RISE_CO = Company.create({
  id: 2,
  code: 'Rise001',
  name: 'Rise',
  notes: null,
});

export const TRADEIFY_ACCOUNT = Account.create({
  id: 1,
  code: 'tradeify',
  name: 'Tradeify',
  type: 'prop_firm',
  companyId: 1,
  allowedCurrencies: ['USD'],
});

export const RISE = Account.create({
  id: 2,
  code: 'rise',
  name: 'Rise',
  type: 'processor',
  companyId: 2,
  allowedCurrencies: ['USD', 'USDT'],
});

export const TRUSTWALLET = Account.create({
  id: 3,
  code: 'trustwallet',
  name: 'TrustWallet',
  type: 'wallet',
  companyId: null,
  allowedCurrencies: ['USDT'],
});

export const COINDCX = Account.create({
  id: 4,
  code: 'coindcx',
  name: 'CoinDCX',
  type: 'exchange',
  companyId: null,
  allowedCurrencies: ['USDT', 'INR'],
});

export const BANK = Account.create({
  id: 5,
  code: 'bank-hdfc',
  name: 'HDFC',
  type: 'bank',
  companyId: null,
  allowedCurrencies: ['INR'],
});

export const ACCOUNTS: ReadonlyMap<AccountId, Account> = new Map([
  [1, TRADEIFY_ACCOUNT],
  [2, RISE],
  [3, TRUSTWALLET],
  [4, COINDCX],
  [5, BANK],
]);

// ---------- The payout ----------

export const PAYOUT = Payout.create({
  id: 1,
  code: 'TradeifyPayout001',
  companyId: 1,
  traderId: 1,
  payoutDate: '2025-03-10',
  reference: 'FTDFYSLX50676373980',
  gross: usd('1008.01'),
  charges: usd('100.79'),
  notes: null,
});

// ---------- The tree ----------
//
// Tradeify --$1,008.01--> Rise            (less $100.79 platform charge)
//   Rise --4 withdrawals--> TrustWallet    (less $16.31 in flat network fees)
//     TrustWallet --4 transfers--> CoinDCX (1.3323 USDT left as dust)
//       CoinDCX --4 sales--> HDFC          (14.0908 USDT left as dust)

/** Tradeify credits the award to Rise, less the platform charge. */
export const CREDIT = Transaction.record({
  id: 1,
  code: 'Transaction001',
  payoutId: 1,
  parentId: null,
  txnDate: '2025-03-10',
  kind: 'payout_credit',
  fromAccountId: 1,
  toAccountId: 2,
  fromAmount: usd('1008.01'),
  toAmount: usd('907.22'),
  rate: null,
});

/**
 * Four withdrawals from Rise. Each pays the same flat network fee whether it
 * carries $4 or $400 — which is the whole of §8's complaint: these four cost
 * $16.31 where a single withdrawal would have cost $4.03.
 */
export const WITHDRAWAL_A = Transaction.record({
  id: 2,
  code: 'Transaction002',
  payoutId: 1,
  parentId: 1,
  txnDate: '2025-03-11',
  kind: 'withdrawal',
  fromAccountId: 2,
  toAccountId: 3,
  fromAmount: usd('226.81'),
  toAmount: usdt('222.78'),
  rate: 100000000n,
});

export const WITHDRAWAL_B = Transaction.record({
  id: 4,
  code: 'Transaction004',
  payoutId: 1,
  parentId: 1,
  txnDate: '2025-03-11',
  kind: 'withdrawal',
  fromAccountId: 2,
  toAccountId: 3,
  fromAmount: usd('226.80'),
  toAmount: usdt('222.71'),
  rate: 100000000n,
});

export const WITHDRAWAL_C = Transaction.record({
  id: 6,
  code: 'Transaction006',
  payoutId: 1,
  parentId: 1,
  txnDate: '2025-03-12',
  kind: 'withdrawal',
  fromAccountId: 2,
  toAccountId: 3,
  fromAmount: usd('226.80'),
  toAmount: usdt('222.70'),
  rate: 100000000n,
});

export const WITHDRAWAL_D = Transaction.record({
  id: 9,
  code: 'Transaction009',
  payoutId: 1,
  parentId: 1,
  txnDate: '2025-03-12',
  kind: 'withdrawal',
  fromAccountId: 2,
  toAccountId: 3,
  fromAmount: usd('226.81'),
  toAmount: usdt('222.72'),
  rate: 100000000n,
});

/** Four transfers to the exchange, each leaving a little dust behind. */
export const TRANSFER_A = Transaction.record({
  id: 7,
  code: 'Transaction007',
  payoutId: 1,
  parentId: 2,
  txnDate: '2025-03-15',
  kind: 'transfer',
  fromAccountId: 3,
  toAccountId: 4,
  fromAmount: usdt('222.44'),
  toAmount: usdt('222.44'),
  rate: null,
});

export const TRANSFER_B = Transaction.record({
  id: 12,
  code: 'Transaction0012',
  payoutId: 1,
  parentId: 4,
  txnDate: '2025-03-15',
  kind: 'transfer',
  fromAccountId: 3,
  toAccountId: 4,
  fromAmount: usdt('222.38'),
  toAmount: usdt('222.38'),
  rate: null,
});

export const TRANSFER_C = Transaction.record({
  id: 10,
  code: 'Transaction0010',
  payoutId: 1,
  parentId: 6,
  txnDate: '2025-03-18',
  kind: 'transfer',
  fromAccountId: 3,
  toAccountId: 4,
  fromAmount: usdt('222.37'),
  toAmount: usdt('222.37'),
  rate: null,
});

export const TRANSFER_D = Transaction.record({
  id: 13,
  code: 'Transaction0013',
  payoutId: 1,
  parentId: 9,
  txnDate: '2025-03-18',
  kind: 'transfer',
  fromAccountId: 3,
  toAccountId: 4,
  fromAmount: usdt('222.3877'),
  toAmount: usdt('222.3877'),
  rate: null,
});

/**
 * Four sales. `toAmount` is gross proceeds, matching the exchange statement
 * (§13); TDS, exchange fee and GST are separate rows and net is derived.
 */
export const SALE_003 = Transaction.record({
  id: 3,
  code: 'Transaction003',
  payoutId: 1,
  parentId: 7,
  txnDate: '2025-03-16',
  kind: 'sale',
  fromAccountId: 4,
  toAccountId: 5,
  fromAmount: usdt('45.2292'),
  toAmount: inr('4444.28'),
  rate: 9826120000n, // 98.2612
});

export const SALE_005 = Transaction.record({
  id: 5,
  code: 'Transaction005',
  payoutId: 1,
  parentId: 12,
  txnDate: '2025-03-16',
  kind: 'sale',
  fromAccountId: 4,
  toAccountId: 5,
  fromAmount: usdt('45'),
  toAmount: inr('4421.25'),
  rate: 9825000000n, // 98.25
});

export const SALE_008 = Transaction.record({
  id: 8,
  code: 'Transaction008',
  payoutId: 1,
  parentId: 10,
  txnDate: '2025-03-19',
  kind: 'sale',
  fromAccountId: 4,
  toAccountId: 5,
  fromAmount: usdt('43.5377'),
  toAmount: inr('4278.45'),
  rate: 9827000000n, // 98.27
});

/** §9 defect 1: the sheet said 45.957. The true from-amount is 741.72. */
export const SALE_0011 = Transaction.record({
  id: 11,
  code: 'Transaction0011',
  payoutId: 1,
  parentId: 13,
  txnDate: '2025-03-20',
  kind: 'sale',
  fromAccountId: 4,
  toAccountId: 5,
  fromAmount: usdt('741.72'),
  toAmount: inr('72883.58'),
  rate: 9826292937n, // 98.26292937
});

export const TRANSACTIONS: readonly Transaction[] = [
  CREDIT,
  WITHDRAWAL_A,
  WITHDRAWAL_B,
  WITHDRAWAL_C,
  WITHDRAWAL_D,
  TRANSFER_A,
  TRANSFER_B,
  TRANSFER_C,
  TRANSFER_D,
  SALE_003,
  SALE_005,
  SALE_008,
  SALE_0011,
];

export const SALES: readonly Transaction[] = [
  SALE_003,
  SALE_005,
  SALE_008,
  SALE_0011,
];

// ---------- Fees ----------
//
// The flat network fee is USD and rides the withdrawals; TDS, exchange fee
// and GST are INR and ride the sales. Only the INR ones reduce net credited.

export const FEES: readonly TransactionFee[] = [
  TransactionFee.record({
    id: 1,
    transactionId: 2,
    feeType: 'network_fee',
    amount: usd('4.03'),
  }),
  TransactionFee.record({
    id: 2,
    transactionId: 4,
    feeType: 'network_fee',
    amount: usd('4.09'),
  }),
  TransactionFee.record({
    id: 3,
    transactionId: 6,
    feeType: 'network_fee',
    amount: usd('4.10'),
  }),
  TransactionFee.record({
    id: 4,
    transactionId: 9,
    feeType: 'network_fee',
    amount: usd('4.09'),
  }),

  // Transaction003 — exchange fee 0.508% of proceeds (§9).
  TransactionFee.record({
    id: 5,
    transactionId: 3,
    feeType: 'tds',
    amount: inr('44.89'),
  }),
  TransactionFee.record({
    id: 6,
    transactionId: 3,
    feeType: 'exchange_fee',
    amount: inr('22.58'),
  }),
  TransactionFee.record({
    id: 7,
    transactionId: 3,
    feeType: 'gst',
    amount: inr('4.06'),
  }),

  // Transaction005 — exchange fee 0.4866% of proceeds (§11).
  TransactionFee.record({
    id: 8,
    transactionId: 5,
    feeType: 'tds',
    amount: inr('44.65'),
  }),
  TransactionFee.record({
    id: 9,
    transactionId: 5,
    feeType: 'exchange_fee',
    amount: inr('21.51'),
  }),
  TransactionFee.record({
    id: 10,
    transactionId: 5,
    feeType: 'gst',
    amount: inr('3.87'),
  }),

  // Transaction008 — exchange fee 0.5307% of proceeds (§11).
  TransactionFee.record({
    id: 11,
    transactionId: 8,
    feeType: 'tds',
    amount: inr('43.21'),
  }),
  TransactionFee.record({
    id: 12,
    transactionId: 8,
    feeType: 'exchange_fee',
    amount: inr('22.71'),
  }),
  TransactionFee.record({
    id: 13,
    transactionId: 8,
    feeType: 'gst',
    amount: inr('4.09'),
  }),

  // Transaction0011 — exchange fee 0.508% of proceeds (§9).
  TransactionFee.record({
    id: 14,
    transactionId: 11,
    feeType: 'tds',
    amount: inr('736.13'),
  }),
  TransactionFee.record({
    id: 15,
    transactionId: 11,
    feeType: 'exchange_fee',
    amount: inr('370.29'),
  }),
  TransactionFee.record({
    id: 16,
    transactionId: 11,
    feeType: 'gst',
    amount: inr('66.64'),
  }),
];
