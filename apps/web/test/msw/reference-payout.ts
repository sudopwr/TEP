/**
 * TradeifyPayout001, exactly as the API serves it.
 *
 * Not written by hand. Every byte below was dumped from the API's own
 * in-memory test server, seeded with the same
 * `packages/core/src/domain/reference-payout.fixture.ts` tree that the domain
 * tests assert §10's figures against — the real schema, the real use cases,
 * the real serializer.
 *
 * That provenance is the point. A fixture invented to suit a component test
 * proves the component renders *something*; this one proves it renders the
 * number that will be on screen, through a chain that is four levels deep and
 * whose four sales have to add up to ₹86,027.56 gross and ₹84,642.93 net.
 *
 * The tree:
 *
 *   Tradeify --$1,008.01--> Rise            (less $100.79 platform charge)
 *     Rise --4 withdrawals--> TrustWallet   (less $16.31 in flat network fees)
 *       TrustWallet --4 transfers--> CoinDCX (1.3323 USDT left as dust)
 *         CoinDCX --4 sales--> HDFC          (14.0908 USDT left as dust)
 */
import type {
  AccountBalanceJson,
  CompanyJson,
  DataQualityIssueJson,
  FinancialYearReportJson,
  PayoutJson,
  PayoutTrailJson,
  SettlementJson,
  TransactionJson,
} from '../../src/shared/api/types';

export const REFERENCE_COMPANIES: readonly CompanyJson[] = [
  {
    id: 1,
    code: 'Tradeify001',
    name: 'Tradeify',
    notes: null,
  },
  {
    id: 2,
    code: 'Rise001',
    name: 'Rise',
    notes: null,
  },
];

export const REFERENCE_PAYOUT: PayoutJson = {
  id: 1,
  code: 'TradeifyPayout001',
  companyId: 1,
  traderId: 1,
  payoutDate: '2025-03-10',
  reference: 'FTDFYSLX50676373980',
  gross: {
    currency: 'USD',
    minor: '100801',
    amount: '1008.01',
  },
  charges: {
    currency: 'USD',
    minor: '10079',
    amount: '100.79',
  },
  notes: null,
};

export const REFERENCE_TRAIL: PayoutTrailJson = {
  payout: {
    id: 1,
    code: 'TradeifyPayout001',
    companyId: 1,
    traderId: 1,
    payoutDate: '2025-03-10',
    reference: 'FTDFYSLX50676373980',
    gross: {
      currency: 'USD',
      minor: '100801',
      amount: '1008.01',
    },
    charges: {
      currency: 'USD',
      minor: '10079',
      amount: '100.79',
    },
    notes: null,
  },
  roots: [
    {
      transaction: {
        id: 1,
        code: 'Transaction001',
        payoutId: 1,
        parentId: null,
        txnDate: '2025-03-10',
        kind: 'payout_credit',
        fromAccountId: 1,
        toAccountId: 2,
        fromAmount: {
          currency: 'USD',
          minor: '100801',
          amount: '1008.01',
        },
        toAmount: {
          currency: 'USD',
          minor: '90722',
          amount: '907.22',
        },
        rate: null,
        fromExternalRef: null,
        toExternalRef: null,
        notes: null,
      },
      fees: [],
      documents: [],
      children: [
        {
          transaction: {
            id: 2,
            code: 'Transaction002',
            payoutId: 1,
            parentId: 1,
            txnDate: '2025-03-11',
            kind: 'withdrawal',
            fromAccountId: 2,
            toAccountId: 3,
            fromAmount: {
              currency: 'USD',
              minor: '22681',
              amount: '226.81',
            },
            toAmount: {
              currency: 'USDT',
              minor: '22278000000',
              amount: '222.78000000',
            },
            rate: '100000000',
            fromExternalRef: null,
            toExternalRef: null,
            notes: null,
          },
          fees: [
            {
              id: 1,
              transactionId: 2,
              feeType: 'network_fee',
              amount: {
                currency: 'USD',
                minor: '403',
                amount: '4.03',
              },
            },
          ],
          documents: [],
          children: [
            {
              transaction: {
                id: 7,
                code: 'Transaction007',
                payoutId: 1,
                parentId: 2,
                txnDate: '2025-03-15',
                kind: 'transfer',
                fromAccountId: 3,
                toAccountId: 4,
                fromAmount: {
                  currency: 'USDT',
                  minor: '22244000000',
                  amount: '222.44000000',
                },
                toAmount: {
                  currency: 'USDT',
                  minor: '22244000000',
                  amount: '222.44000000',
                },
                rate: null,
                fromExternalRef: null,
                toExternalRef: null,
                notes: null,
              },
              fees: [],
              documents: [],
              children: [
                {
                  transaction: {
                    id: 3,
                    code: 'Transaction003',
                    payoutId: 1,
                    parentId: 7,
                    txnDate: '2025-03-16',
                    kind: 'sale',
                    fromAccountId: 4,
                    toAccountId: 5,
                    fromAmount: {
                      currency: 'USDT',
                      minor: '4522920000',
                      amount: '45.22920000',
                    },
                    toAmount: {
                      currency: 'INR',
                      minor: '444428',
                      amount: '4444.28',
                    },
                    rate: '9826120000',
                    fromExternalRef: null,
                    toExternalRef: null,
                    notes: null,
                  },
                  fees: [
                    {
                      id: 5,
                      transactionId: 3,
                      feeType: 'tds',
                      amount: {
                        currency: 'INR',
                        minor: '4489',
                        amount: '44.89',
                      },
                    },
                    {
                      id: 6,
                      transactionId: 3,
                      feeType: 'exchange_fee',
                      amount: {
                        currency: 'INR',
                        minor: '2258',
                        amount: '22.58',
                      },
                    },
                    {
                      id: 7,
                      transactionId: 3,
                      feeType: 'gst',
                      amount: {
                        currency: 'INR',
                        minor: '406',
                        amount: '4.06',
                      },
                    },
                  ],
                  documents: [],
                  children: [],
                },
              ],
            },
          ],
        },
        {
          transaction: {
            id: 4,
            code: 'Transaction004',
            payoutId: 1,
            parentId: 1,
            txnDate: '2025-03-11',
            kind: 'withdrawal',
            fromAccountId: 2,
            toAccountId: 3,
            fromAmount: {
              currency: 'USD',
              minor: '22680',
              amount: '226.80',
            },
            toAmount: {
              currency: 'USDT',
              minor: '22271000000',
              amount: '222.71000000',
            },
            rate: '100000000',
            fromExternalRef: null,
            toExternalRef: null,
            notes: null,
          },
          fees: [
            {
              id: 2,
              transactionId: 4,
              feeType: 'network_fee',
              amount: {
                currency: 'USD',
                minor: '409',
                amount: '4.09',
              },
            },
          ],
          documents: [],
          children: [
            {
              transaction: {
                id: 12,
                code: 'Transaction0012',
                payoutId: 1,
                parentId: 4,
                txnDate: '2025-03-15',
                kind: 'transfer',
                fromAccountId: 3,
                toAccountId: 4,
                fromAmount: {
                  currency: 'USDT',
                  minor: '22238000000',
                  amount: '222.38000000',
                },
                toAmount: {
                  currency: 'USDT',
                  minor: '22238000000',
                  amount: '222.38000000',
                },
                rate: null,
                fromExternalRef: null,
                toExternalRef: null,
                notes: null,
              },
              fees: [],
              documents: [],
              children: [
                {
                  transaction: {
                    id: 5,
                    code: 'Transaction005',
                    payoutId: 1,
                    parentId: 12,
                    txnDate: '2025-03-16',
                    kind: 'sale',
                    fromAccountId: 4,
                    toAccountId: 5,
                    fromAmount: {
                      currency: 'USDT',
                      minor: '4500000000',
                      amount: '45.00000000',
                    },
                    toAmount: {
                      currency: 'INR',
                      minor: '442125',
                      amount: '4421.25',
                    },
                    rate: '9825000000',
                    fromExternalRef: null,
                    toExternalRef: null,
                    notes: null,
                  },
                  fees: [
                    {
                      id: 8,
                      transactionId: 5,
                      feeType: 'tds',
                      amount: {
                        currency: 'INR',
                        minor: '4465',
                        amount: '44.65',
                      },
                    },
                    {
                      id: 9,
                      transactionId: 5,
                      feeType: 'exchange_fee',
                      amount: {
                        currency: 'INR',
                        minor: '2151',
                        amount: '21.51',
                      },
                    },
                    {
                      id: 10,
                      transactionId: 5,
                      feeType: 'gst',
                      amount: {
                        currency: 'INR',
                        minor: '387',
                        amount: '3.87',
                      },
                    },
                  ],
                  documents: [],
                  children: [],
                },
              ],
            },
          ],
        },
        {
          transaction: {
            id: 6,
            code: 'Transaction006',
            payoutId: 1,
            parentId: 1,
            txnDate: '2025-03-12',
            kind: 'withdrawal',
            fromAccountId: 2,
            toAccountId: 3,
            fromAmount: {
              currency: 'USD',
              minor: '22680',
              amount: '226.80',
            },
            toAmount: {
              currency: 'USDT',
              minor: '22270000000',
              amount: '222.70000000',
            },
            rate: '100000000',
            fromExternalRef: null,
            toExternalRef: null,
            notes: null,
          },
          fees: [
            {
              id: 3,
              transactionId: 6,
              feeType: 'network_fee',
              amount: {
                currency: 'USD',
                minor: '410',
                amount: '4.10',
              },
            },
          ],
          documents: [],
          children: [
            {
              transaction: {
                id: 10,
                code: 'Transaction0010',
                payoutId: 1,
                parentId: 6,
                txnDate: '2025-03-18',
                kind: 'transfer',
                fromAccountId: 3,
                toAccountId: 4,
                fromAmount: {
                  currency: 'USDT',
                  minor: '22237000000',
                  amount: '222.37000000',
                },
                toAmount: {
                  currency: 'USDT',
                  minor: '22237000000',
                  amount: '222.37000000',
                },
                rate: null,
                fromExternalRef: null,
                toExternalRef: null,
                notes: null,
              },
              fees: [],
              documents: [],
              children: [
                {
                  transaction: {
                    id: 8,
                    code: 'Transaction008',
                    payoutId: 1,
                    parentId: 10,
                    txnDate: '2025-03-19',
                    kind: 'sale',
                    fromAccountId: 4,
                    toAccountId: 5,
                    fromAmount: {
                      currency: 'USDT',
                      minor: '4353770000',
                      amount: '43.53770000',
                    },
                    toAmount: {
                      currency: 'INR',
                      minor: '427845',
                      amount: '4278.45',
                    },
                    rate: '9827000000',
                    fromExternalRef: null,
                    toExternalRef: null,
                    notes: null,
                  },
                  fees: [
                    {
                      id: 11,
                      transactionId: 8,
                      feeType: 'tds',
                      amount: {
                        currency: 'INR',
                        minor: '4321',
                        amount: '43.21',
                      },
                    },
                    {
                      id: 12,
                      transactionId: 8,
                      feeType: 'exchange_fee',
                      amount: {
                        currency: 'INR',
                        minor: '2271',
                        amount: '22.71',
                      },
                    },
                    {
                      id: 13,
                      transactionId: 8,
                      feeType: 'gst',
                      amount: {
                        currency: 'INR',
                        minor: '409',
                        amount: '4.09',
                      },
                    },
                  ],
                  documents: [],
                  children: [],
                },
              ],
            },
          ],
        },
        {
          transaction: {
            id: 9,
            code: 'Transaction009',
            payoutId: 1,
            parentId: 1,
            txnDate: '2025-03-12',
            kind: 'withdrawal',
            fromAccountId: 2,
            toAccountId: 3,
            fromAmount: {
              currency: 'USD',
              minor: '22681',
              amount: '226.81',
            },
            toAmount: {
              currency: 'USDT',
              minor: '22272000000',
              amount: '222.72000000',
            },
            rate: '100000000',
            fromExternalRef: null,
            toExternalRef: null,
            notes: null,
          },
          fees: [
            {
              id: 4,
              transactionId: 9,
              feeType: 'network_fee',
              amount: {
                currency: 'USD',
                minor: '409',
                amount: '4.09',
              },
            },
          ],
          documents: [],
          children: [
            {
              transaction: {
                id: 13,
                code: 'Transaction0013',
                payoutId: 1,
                parentId: 9,
                txnDate: '2025-03-18',
                kind: 'transfer',
                fromAccountId: 3,
                toAccountId: 4,
                fromAmount: {
                  currency: 'USDT',
                  minor: '22238770000',
                  amount: '222.38770000',
                },
                toAmount: {
                  currency: 'USDT',
                  minor: '22238770000',
                  amount: '222.38770000',
                },
                rate: null,
                fromExternalRef: null,
                toExternalRef: null,
                notes: null,
              },
              fees: [],
              documents: [],
              children: [
                {
                  transaction: {
                    id: 11,
                    code: 'Transaction0011',
                    payoutId: 1,
                    parentId: 13,
                    txnDate: '2025-03-20',
                    kind: 'sale',
                    fromAccountId: 4,
                    toAccountId: 5,
                    fromAmount: {
                      currency: 'USDT',
                      minor: '74172000000',
                      amount: '741.72000000',
                    },
                    toAmount: {
                      currency: 'INR',
                      minor: '7288358',
                      amount: '72883.58',
                    },
                    rate: '9826292937',
                    fromExternalRef: null,
                    toExternalRef: null,
                    notes: null,
                  },
                  fees: [
                    {
                      id: 14,
                      transactionId: 11,
                      feeType: 'tds',
                      amount: {
                        currency: 'INR',
                        minor: '73613',
                        amount: '736.13',
                      },
                    },
                    {
                      id: 15,
                      transactionId: 11,
                      feeType: 'exchange_fee',
                      amount: {
                        currency: 'INR',
                        minor: '37029',
                        amount: '370.29',
                      },
                    },
                    {
                      id: 16,
                      transactionId: 11,
                      feeType: 'gst',
                      amount: {
                        currency: 'INR',
                        minor: '6664',
                        amount: '66.64',
                      },
                    },
                  ],
                  documents: [],
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

export const REFERENCE_TRANSACTIONS: readonly TransactionJson[] = [
  {
    id: 1,
    code: 'Transaction001',
    payoutId: 1,
    parentId: null,
    txnDate: '2025-03-10',
    kind: 'payout_credit',
    fromAccountId: 1,
    toAccountId: 2,
    fromAmount: {
      currency: 'USD',
      minor: '100801',
      amount: '1008.01',
    },
    toAmount: {
      currency: 'USD',
      minor: '90722',
      amount: '907.22',
    },
    rate: null,
    fromExternalRef: null,
    toExternalRef: null,
    notes: null,
  },
  {
    id: 2,
    code: 'Transaction002',
    payoutId: 1,
    parentId: 1,
    txnDate: '2025-03-11',
    kind: 'withdrawal',
    fromAccountId: 2,
    toAccountId: 3,
    fromAmount: {
      currency: 'USD',
      minor: '22681',
      amount: '226.81',
    },
    toAmount: {
      currency: 'USDT',
      minor: '22278000000',
      amount: '222.78000000',
    },
    rate: '100000000',
    fromExternalRef: null,
    toExternalRef: null,
    notes: null,
  },
  {
    id: 3,
    code: 'Transaction003',
    payoutId: 1,
    parentId: 7,
    txnDate: '2025-03-16',
    kind: 'sale',
    fromAccountId: 4,
    toAccountId: 5,
    fromAmount: {
      currency: 'USDT',
      minor: '4522920000',
      amount: '45.22920000',
    },
    toAmount: {
      currency: 'INR',
      minor: '444428',
      amount: '4444.28',
    },
    rate: '9826120000',
    fromExternalRef: null,
    toExternalRef: null,
    notes: null,
  },
  {
    id: 4,
    code: 'Transaction004',
    payoutId: 1,
    parentId: 1,
    txnDate: '2025-03-11',
    kind: 'withdrawal',
    fromAccountId: 2,
    toAccountId: 3,
    fromAmount: {
      currency: 'USD',
      minor: '22680',
      amount: '226.80',
    },
    toAmount: {
      currency: 'USDT',
      minor: '22271000000',
      amount: '222.71000000',
    },
    rate: '100000000',
    fromExternalRef: null,
    toExternalRef: null,
    notes: null,
  },
  {
    id: 5,
    code: 'Transaction005',
    payoutId: 1,
    parentId: 12,
    txnDate: '2025-03-16',
    kind: 'sale',
    fromAccountId: 4,
    toAccountId: 5,
    fromAmount: {
      currency: 'USDT',
      minor: '4500000000',
      amount: '45.00000000',
    },
    toAmount: {
      currency: 'INR',
      minor: '442125',
      amount: '4421.25',
    },
    rate: '9825000000',
    fromExternalRef: null,
    toExternalRef: null,
    notes: null,
  },
  {
    id: 6,
    code: 'Transaction006',
    payoutId: 1,
    parentId: 1,
    txnDate: '2025-03-12',
    kind: 'withdrawal',
    fromAccountId: 2,
    toAccountId: 3,
    fromAmount: {
      currency: 'USD',
      minor: '22680',
      amount: '226.80',
    },
    toAmount: {
      currency: 'USDT',
      minor: '22270000000',
      amount: '222.70000000',
    },
    rate: '100000000',
    fromExternalRef: null,
    toExternalRef: null,
    notes: null,
  },
  {
    id: 7,
    code: 'Transaction007',
    payoutId: 1,
    parentId: 2,
    txnDate: '2025-03-15',
    kind: 'transfer',
    fromAccountId: 3,
    toAccountId: 4,
    fromAmount: {
      currency: 'USDT',
      minor: '22244000000',
      amount: '222.44000000',
    },
    toAmount: {
      currency: 'USDT',
      minor: '22244000000',
      amount: '222.44000000',
    },
    rate: null,
    fromExternalRef: null,
    toExternalRef: null,
    notes: null,
  },
  {
    id: 8,
    code: 'Transaction008',
    payoutId: 1,
    parentId: 10,
    txnDate: '2025-03-19',
    kind: 'sale',
    fromAccountId: 4,
    toAccountId: 5,
    fromAmount: {
      currency: 'USDT',
      minor: '4353770000',
      amount: '43.53770000',
    },
    toAmount: {
      currency: 'INR',
      minor: '427845',
      amount: '4278.45',
    },
    rate: '9827000000',
    fromExternalRef: null,
    toExternalRef: null,
    notes: null,
  },
  {
    id: 9,
    code: 'Transaction009',
    payoutId: 1,
    parentId: 1,
    txnDate: '2025-03-12',
    kind: 'withdrawal',
    fromAccountId: 2,
    toAccountId: 3,
    fromAmount: {
      currency: 'USD',
      minor: '22681',
      amount: '226.81',
    },
    toAmount: {
      currency: 'USDT',
      minor: '22272000000',
      amount: '222.72000000',
    },
    rate: '100000000',
    fromExternalRef: null,
    toExternalRef: null,
    notes: null,
  },
  {
    id: 10,
    code: 'Transaction0010',
    payoutId: 1,
    parentId: 6,
    txnDate: '2025-03-18',
    kind: 'transfer',
    fromAccountId: 3,
    toAccountId: 4,
    fromAmount: {
      currency: 'USDT',
      minor: '22237000000',
      amount: '222.37000000',
    },
    toAmount: {
      currency: 'USDT',
      minor: '22237000000',
      amount: '222.37000000',
    },
    rate: null,
    fromExternalRef: null,
    toExternalRef: null,
    notes: null,
  },
  {
    id: 11,
    code: 'Transaction0011',
    payoutId: 1,
    parentId: 13,
    txnDate: '2025-03-20',
    kind: 'sale',
    fromAccountId: 4,
    toAccountId: 5,
    fromAmount: {
      currency: 'USDT',
      minor: '74172000000',
      amount: '741.72000000',
    },
    toAmount: {
      currency: 'INR',
      minor: '7288358',
      amount: '72883.58',
    },
    rate: '9826292937',
    fromExternalRef: null,
    toExternalRef: null,
    notes: null,
  },
  {
    id: 12,
    code: 'Transaction0012',
    payoutId: 1,
    parentId: 4,
    txnDate: '2025-03-15',
    kind: 'transfer',
    fromAccountId: 3,
    toAccountId: 4,
    fromAmount: {
      currency: 'USDT',
      minor: '22238000000',
      amount: '222.38000000',
    },
    toAmount: {
      currency: 'USDT',
      minor: '22238000000',
      amount: '222.38000000',
    },
    rate: null,
    fromExternalRef: null,
    toExternalRef: null,
    notes: null,
  },
  {
    id: 13,
    code: 'Transaction0013',
    payoutId: 1,
    parentId: 9,
    txnDate: '2025-03-18',
    kind: 'transfer',
    fromAccountId: 3,
    toAccountId: 4,
    fromAmount: {
      currency: 'USDT',
      minor: '22238770000',
      amount: '222.38770000',
    },
    toAmount: {
      currency: 'USDT',
      minor: '22238770000',
      amount: '222.38770000',
    },
    rate: null,
    fromExternalRef: null,
    toExternalRef: null,
    notes: null,
  },
];

export const REFERENCE_SETTLEMENT: SettlementJson = {
  payout: {
    id: 1,
    code: 'TradeifyPayout001',
    companyId: 1,
    traderId: 1,
    payoutDate: '2025-03-10',
    reference: 'FTDFYSLX50676373980',
    gross: {
      currency: 'USD',
      minor: '100801',
      amount: '1008.01',
    },
    charges: {
      currency: 'USD',
      minor: '10079',
      amount: '100.79',
    },
    notes: null,
  },
  status: 'settled',
  currency: 'INR',
  grossProceeds: {
    currency: 'INR',
    minor: '8602756',
    amount: '86027.56',
  },
  feesByType: {
    tds: {
      currency: 'INR',
      minor: '86888',
      amount: '868.88',
    },
    exchange_fee: {
      currency: 'INR',
      minor: '43709',
      amount: '437.09',
    },
    gst: {
      currency: 'INR',
      minor: '7866',
      amount: '78.66',
    },
  },
  totalFees: {
    currency: 'INR',
    minor: '138463',
    amount: '1384.63',
  },
  netCredited: {
    currency: 'INR',
    minor: '8464293',
    amount: '84642.93',
  },
};

export const REFERENCE_ACCOUNT_BALANCES: readonly AccountBalanceJson[] = [
  {
    account: {
      id: 1,
      code: 'tradeify',
      name: 'Tradeify',
      type: 'prop_firm',
      companyId: 1,
      allowedCurrencies: ['USD'],
    },
    balance: {
      currency: 'USD',
      minor: '-100801',
      amount: '-1008.01',
    },
  },
  {
    account: {
      id: 3,
      code: 'trustwallet',
      name: 'TrustWallet',
      type: 'wallet',
      companyId: null,
      allowedCurrencies: ['USDT'],
    },
    balance: {
      currency: 'USDT',
      minor: '133230000',
      amount: '1.33230000',
    },
  },
  {
    account: {
      id: 5,
      code: 'bank-hdfc',
      name: 'HDFC',
      type: 'bank',
      companyId: null,
      allowedCurrencies: ['INR'],
    },
    balance: {
      currency: 'INR',
      minor: '8464293',
      amount: '84642.93',
    },
  },
  {
    account: {
      id: 4,
      code: 'coindcx',
      name: 'CoinDCX',
      type: 'exchange',
      companyId: null,
      allowedCurrencies: ['INR', 'USDT'],
    },
    balance: {
      currency: 'USDT',
      minor: '1409080000',
      amount: '14.09080000',
    },
  },
];

export const REFERENCE_ISSUES: readonly DataQualityIssueJson[] = [
  {
    subject: 'Transaction004',
    subjectKind: 'transaction',
    check: 'fee_off_schedule',
    detail:
      'network_fee: amount_off_schedule, schedule says 4.00 USD, recorded 4.09 USD',
  },
  {
    subject: 'Transaction005',
    subjectKind: 'transaction',
    check: 'fee_off_schedule',
    detail:
      'exchange_fee: amount_off_schedule, schedule says 22.11 INR, recorded 21.51 INR',
  },
  {
    subject: 'Transaction005',
    subjectKind: 'transaction',
    check: 'fee_off_schedule',
    detail:
      'gst: amount_off_schedule, schedule says 3.98 INR, recorded 3.87 INR',
  },
  {
    subject: 'Transaction006',
    subjectKind: 'transaction',
    check: 'fee_off_schedule',
    detail:
      'network_fee: amount_off_schedule, schedule says 4.00 USD, recorded 4.10 USD',
  },
  {
    subject: 'Transaction008',
    subjectKind: 'transaction',
    check: 'fee_off_schedule',
    detail:
      'exchange_fee: amount_off_schedule, schedule says 21.39 INR, recorded 22.71 INR',
  },
  {
    subject: 'Transaction008',
    subjectKind: 'transaction',
    check: 'fee_off_schedule',
    detail:
      'gst: amount_off_schedule, schedule says 3.85 INR, recorded 4.09 INR',
  },
  {
    subject: 'Transaction009',
    subjectKind: 'transaction',
    check: 'fee_off_schedule',
    detail:
      'network_fee: amount_off_schedule, schedule says 4.00 USD, recorded 4.09 USD',
  },
  {
    subject: 'Transaction0011',
    subjectKind: 'transaction',
    check: 'exceeds_parent',
    detail:
      "sends 741.72000000 USDT but 'Transaction0013' delivered only 222.38770000 USDT — legitimate if earlier dust was still in the account",
  },
];

export const REFERENCE_REPORT: FinancialYearReportJson = {
  range: {
    from: '2024-04-01',
    to: '2025-03-31',
  },
  currency: 'INR',
  totalCredited: {
    currency: 'INR',
    minor: '8464293',
    amount: '84642.93',
  },
  totalTds: {
    currency: 'INR',
    minor: '86888',
    amount: '868.88',
  },
  totalFees: {
    currency: 'INR',
    minor: '138463',
    amount: '1384.63',
  },
  byCompany: [
    {
      company: {
        id: 1,
        code: 'Tradeify001',
        name: 'Tradeify',
        notes: null,
      },
      payoutCount: 1,
      credited: {
        currency: 'INR',
        minor: '8464293',
        amount: '84642.93',
      },
      tds: {
        currency: 'INR',
        minor: '86888',
        amount: '868.88',
      },
      fees: {
        currency: 'INR',
        minor: '138463',
        amount: '1384.63',
      },
    },
  ],
};
