import * as core from '@payout/core';
import { DomainError } from '@payout/core';
import { describe, expect, it } from 'vitest';

import { safeFilename } from './api';
import { mappedErrorNames, statusForDomainError } from './errors';

/** Every DomainError subclass core exports, by name. */
function exportedDomainErrorNames(): readonly string[] {
  const names: string[] = [];

  for (const exported of Object.values(core)) {
    if (
      typeof exported === 'function' &&
      exported !== DomainError &&
      exported.prototype instanceof DomainError
    ) {
      names.push(exported.name);
    }
  }

  return names.sort();
}

describe('the domain error to status map', () => {
  it('covers every DomainError subclass core exports', () => {
    // The point of this test. An unmapped error falls through to a 500, which
    // is the safe direction and the wrong answer — a new `...NotFoundError`
    // would read as "the server is broken" instead of "that is not here".
    // Adding an error to core fails this until somebody decides what it means.
    const unmapped = exportedDomainErrorNames().filter(
      (name) => !mappedErrorNames().includes(name),
    );

    expect(unmapped).toEqual([]);
  });

  it('maps nothing that is not an error core exports', () => {
    const stale = mappedErrorNames().filter(
      (name) => !exportedDomainErrorNames().includes(name),
    );

    expect(stale).toEqual([]);
  });

  it('found a non-trivial number of errors, so the sweep really ran', () => {
    // A reflection-based test that silently matches zero against zero is
    // worse than no test.
    expect(exportedDomainErrorNames().length).toBeGreaterThan(20);
  });

  describe('the statuses themselves', () => {
    it('calls a missing row a 404', () => {
      expect(statusForDomainError(new core.PayoutNotFoundError(1))).toBe(404);
      expect(statusForDomainError(new core.CompanyNotFoundError(1))).toBe(404);
      expect(statusForDomainError(new core.DocumentNotFoundError(1))).toBe(404);
    });

    it('calls a bad request a 400', () => {
      expect(
        statusForDomainError(new core.SameAccountTransferError('T1', 3)),
      ).toBe(400);
      expect(statusForDomainError(new core.UnknownCurrencyError('XYZ'))).toBe(
        400,
      );
    });

    it('calls a credential failure a 401', () => {
      expect(
        statusForDomainError(
          new core.AuthenticationFailedError('wrong_password'),
        ),
      ).toBe(401);
      expect(
        statusForDomainError(new core.SessionInvalidError('expired')),
      ).toBe(401);
    });

    it('calls a clash a 409', () => {
      expect(statusForDomainError(new core.CompanyCodeTakenError('A'))).toBe(
        409,
      );
      expect(statusForDomainError(new core.UsernameTakenError('admin'))).toBe(
        409,
      );
    });

    it('calls unfixable stored data a 422, not a 500', () => {
      // The request was fine and a retry will not help, but the server is
      // working. 500 would send someone looking at logs for a crash.
      expect(
        statusForDomainError(new core.DocumentFileMissingError(1, 'a/b.pdf')),
      ).toBe(422);
    });

    it('falls back to 500 for something it has never seen', () => {
      class UnheardOfError extends DomainError {
        constructor() {
          super('UnheardOfError', 'nobody has mapped this');
        }
      }

      expect(statusForDomainError(new UnheardOfError())).toBe(500);
    });
  });
});

describe('safeFilename', () => {
  it('leaves an ordinary filename alone', () => {
    expect(safeFilename('coindcx-march.pdf')).toBe('coindcx-march.pdf');
  });

  it('keeps spaces, which are legal inside a quoted value', () => {
    expect(safeFilename('march statement.pdf')).toBe('march statement.pdf');
  });

  it('removes a quote, which would end the header field early', () => {
    expect(safeFilename('we"ird.pdf')).toBe('weird.pdf');
  });

  it('removes a backslash, which would escape the closing quote', () => {
    expect(safeFilename(`back${String.fromCharCode(92)}slash.pdf`)).toBe(
      'backslash.pdf',
    );
  });

  it('removes a newline, which would end the header', () => {
    // Header injection: everything after the newline would be read as its
    // own header by anything parsing the response.
    expect(safeFilename('evil.pdf\r\nSet-Cookie: a=b')).toBe(
      'evil.pdfSet-Cookie: a=b',
    );
  });

  it('removes other control characters', () => {
    expect(
      safeFilename(`a${String.fromCharCode(0)}b${String.fromCharCode(127)}c`),
    ).toBe('abc');
  });

  it('keeps non-ASCII characters, which are ordinary in a filename', () => {
    expect(safeFilename('reçu-mars.pdf')).toBe('reçu-mars.pdf');
  });

  it('falls back to a name rather than producing an empty one', () => {
    // `filename=""` is not a filename.
    expect(safeFilename('"""')).toBe('document');
    expect(safeFilename('')).toBe('document');
  });
});
