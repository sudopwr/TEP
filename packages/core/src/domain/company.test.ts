import { describe, expect, it } from 'vitest';

import { Company } from './company';

const tradeify = () =>
  Company.create({
    id: 1,
    code: 'Tradeify001',
    name: 'Tradeify',
    notes: null,
  });

describe('Company', () => {
  it('holds the sheet code and the display name separately', () => {
    const company = tradeify();

    expect(company.id).toBe(1);
    expect(company.code).toBe('Tradeify001');
    expect(company.name).toBe('Tradeify');
    expect(company.notes).toBeNull();
  });

  it('renames into a new instance and leaves the original alone', () => {
    const original = tradeify();
    const renamed = original.rename('Tradeify LLC');

    expect(renamed.name).toBe('Tradeify LLC');
    expect(original.name).toBe('Tradeify');
    expect(renamed).not.toBe(original);
  });

  it('keeps every other field across a rename', () => {
    const renamed = tradeify().rename('Tradeify LLC');

    expect(renamed.id).toBe(1);
    expect(renamed.code).toBe('Tradeify001');
  });

  it('attaches notes into a new instance', () => {
    const noted = tradeify().withNotes('Pays via Rise');

    expect(noted.notes).toBe('Pays via Rise');
    expect(tradeify().notes).toBeNull();
  });

  it('compares by identity, not by reference', () => {
    expect(tradeify().equals(tradeify())).toBe(true);
    expect(tradeify().equals(tradeify().rename('Other'))).toBe(true);
    expect(
      tradeify().equals(
        Company.create({ id: 2, code: 'Rise001', name: 'Rise', notes: null }),
      ),
    ).toBe(false);
  });
});
