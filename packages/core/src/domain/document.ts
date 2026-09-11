import type { DocumentId, IsoDate } from './ids';

/**
 * The runtime list, with the type derived from it rather than beside it.
 *
 * Written this way round so the validation layer at the edge cannot drift:
 * a zod enum built from this array is the same set by construction, where a
 * hand-copied list is the same set until somebody adds a member.
 */
export const DOCUMENT_TYPES = [
  'agreement',
  'invoice',
  'receipt',
  'screenshot',
  'statement',
  'other',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface DocumentProps {
  readonly id: DocumentId;
  readonly filename: string;
  readonly storedPath: string;
  readonly mimeType: string | null;
  readonly byteSize: number | null;
  /**
   * The content hash, or null when the ledger names a file whose bytes have
   * not been ingested. The legacy sheet lists filenames and nothing else, so
   * an imported document is a reference until UC4 attaches the real thing.
   */
  readonly sha256: string | null;
  readonly docType: DocumentType | null;
  readonly docDate: IsoDate | null;
  readonly extractedText: string | null;
}

/**
 * An attached file. `filename` is what the user called it, `storedPath` is
 * where it landed, and `sha256` is what it actually is — which is why
 * re-uploading the same bytes links the existing row instead of making a
 * second one (UC4).
 */
export class Document {
  readonly #props: DocumentProps;

  private constructor(props: DocumentProps) {
    this.#props = Object.freeze({ ...props });
  }

  static create(props: DocumentProps): Document {
    return new Document(props);
  }

  get id(): DocumentId {
    return this.#props.id;
  }

  get filename(): string {
    return this.#props.filename;
  }

  get storedPath(): string {
    return this.#props.storedPath;
  }

  get mimeType(): string | null {
    return this.#props.mimeType;
  }

  get byteSize(): number | null {
    return this.#props.byteSize;
  }

  get sha256(): string | null {
    return this.#props.sha256;
  }

  get docType(): DocumentType | null {
    return this.#props.docType;
  }

  get docDate(): IsoDate | null {
    return this.#props.docDate;
  }

  get extractedText(): string | null {
    return this.#props.extractedText;
  }

  /** Content identity, which is the only identity that matters for dedupe. */
  hasSameContentAs(other: Document): boolean {
    // Two documents whose content nobody has seen are not known to match.
    return this.#props.sha256 !== null && this.#props.sha256 === other.sha256;
  }

  rename(filename: string): Document {
    return new Document({ ...this.#props, filename });
  }

  withExtractedText(text: string | null): Document {
    return new Document({ ...this.#props, extractedText: text });
  }
}
