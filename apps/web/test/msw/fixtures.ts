import type {
  AccountBalanceJson,
  CompanyJson,
  DataQualityIssueJson,
  DocumentJson,
  PayoutJson,
  PayoutTrailJson,
  SettlementJson,
  TransactionJson,
} from '../../src/shared/api/types';

/**
 * TradeifyPayout001, as the API actually serves it.
 *
 * Every figure here is §10's, copied from the API's own integration tests
 * rather than invented for the browser. That matters: a fixture made up to
 * suit a component test proves the component renders *something*, while these
 * prove it renders the number that will be on screen.
 */

const money = (currency: string, minor: string, amount: string) => ({
  currency,
  minor,
  amount,
});

export const TRADEIFY: CompanyJson = {
  id: 1,
  code: 'Tradeify001',
  name: 'Tradeify',
  notes: null,
};

export const RISE_CO: CompanyJson = {
  id: 2,
  code: 'Rise001',
  name: 'Rise',
  notes: null,
};

export const PAYOUT: PayoutJson = {
  id: 1,
  code: 'TradeifyPayout001',
  companyId: 1,
  payoutDate: '2025-03-10',
  // §9 defect 3: a long platform reference, kept as TEXT.
  reference: 'FTDFYSLX50676373980',
  gross: money('USD', '100801', '1008.01'),
  charges: money('USD', '10079', '100.79'),
  notes: null,
};

const SALE_LEG: TransactionJson = {
  id: 3,
  code: 'Transaction003',
  payoutId: 1,
  parentId: 2,
  txnDate: '2025-03-12',
  kind: 'sale',
  fromAccountId: 4,
  toAccountId: 5,
  fromAmount: money('USDT', '4500000000', '45.00000000'),
  toAmount: money('INR', '442350', '4423.50'),
  rate: '9830000000',
  fromExternalRef: null,
  toExternalRef: null,
  notes: null,
};

const WITHDRAWAL_LEG: TransactionJson = {
  id: 2,
  code: 'Transaction002',
  payoutId: 1,
  parentId: 1,
  txnDate: '2025-03-11',
  kind: 'withdrawal',
  fromAccountId: 2,
  toAccountId: 3,
  fromAmount: money('USD', '22244', '222.44'),
  toAmount: money('USDT', '22244000000', '222.44000000'),
  rate: null,
  fromExternalRef: null,
  toExternalRef: null,
  notes: null,
};

export const TRANSACTIONS: readonly TransactionJson[] = [
  WITHDRAWAL_LEG,
  SALE_LEG,
];

export const TRAIL: PayoutTrailJson = {
  payout: PAYOUT,
  roots: [
    {
      transaction: WITHDRAWAL_LEG,
      fees: [],
      documents: [],
      children: [
        {
          transaction: SALE_LEG,
          fees: [
            {
              id: 1,
              transactionId: 3,
              feeType: 'exchange_fee',
              amount: money('INR', '2212', '22.12'),
            },
          ],
          documents: [],
          children: [],
        },
      ],
    },
  ],
};

/** §10 exactly: gross ₹86,027.56, fees ₹1,384.63, net ₹84,642.93. */
export const SETTLEMENT: SettlementJson = {
  payout: PAYOUT,
  status: 'open',
  currency: 'INR',
  grossProceeds: money('INR', '8602756', '86027.56'),
  feesByType: {
    tds: money('INR', '86888', '868.88'),
    exchange_fee: money('INR', '43709', '437.09'),
    gst: money('INR', '7866', '78.66'),
  },
  totalFees: money('INR', '138463', '1384.63'),
  netCredited: money('INR', '8464293', '84642.93'),
};

/** §10's balances, both dust figures included. */
export const BALANCES: readonly AccountBalanceJson[] = [
  {
    account: {
      id: 5,
      code: 'bank-hdfc',
      name: 'HDFC Bank',
      type: 'bank',
      companyId: null,
      allowedCurrencies: ['INR'],
    },
    balance: money('INR', '8464293', '84642.93'),
  },
  {
    account: {
      id: 4,
      code: 'coindcx',
      name: 'CoinDCX',
      type: 'exchange',
      companyId: null,
      allowedCurrencies: ['USDT'],
    },
    balance: money('USDT', '1409080000', '14.09080000'),
  },
  {
    account: {
      id: 3,
      code: 'trustwallet',
      name: 'Trust Wallet',
      type: 'wallet',
      companyId: null,
      allowedCurrencies: ['USDT'],
    },
    balance: money('USDT', '133230000', '1.33230000'),
  },
  {
    // Negative because the award left this account. The one figure here that
    // exercises sign colouring.
    account: {
      id: 1,
      code: 'tradeify',
      name: 'Tradeify',
      type: 'prop_firm',
      companyId: 1,
      allowedCurrencies: ['USD'],
    },
    balance: money('USD', '-100801', '-1008.01'),
  },
];

export const ISSUES: readonly DataQualityIssueJson[] = [
  {
    subject: 'Transaction0011',
    subjectKind: 'transaction',
    check: 'exceeds_parent',
    detail: 'sends more than its parent delivered',
  },
];

export const DOCUMENTS: readonly DocumentJson[] = [
  {
    id: 10,
    filename: 'coindcx-march.pdf',
    mimeType: 'application/pdf',
    byteSize: 20480,
    sha256: 'a'.repeat(64),
    docType: 'statement',
    docDate: '2025-03-31',
  },
];
