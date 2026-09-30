import type {
  DocumentPage,
  DocumentRepository,
} from '../ports/document-repository';

export interface ListDocumentsDependencies {
  readonly documents: DocumentRepository;
}

export interface ListDocumentsCommand {
  /** Matches the filename, and the text inside a PDF. Blank means everything. */
  readonly search?: string;
  /** 1-based, because that is what the control at the bottom of a table says. */
  readonly page?: number;
  readonly perPage?: number;
}

/** What a screenful of documents is, here and at the edge. */
export const DOCUMENTS_PER_PAGE = 10;

/** More than this in one request is a download, not a page. */
const MAX_PER_PAGE = 100;

/**
 * UC27 — the document register: newest first, a page at a time.
 *
 * Distinct from UC9, which is a *search* and answers nothing to an empty
 * query. This is the list a person opens to see what is on file at all, and
 * it has to work before they know what they are looking for. A search term
 * narrows it rather than summoning it.
 *
 * **Newest first, by the document's own date.** A statement is dated by the
 * month it covers, not by the evening it was uploaded, and `doc_date` is what
 * a reader recognises; the upload time stands in only when nobody said what
 * the document is dated.
 *
 * **Paged in the database, never in the browser.** Ten rows of a few thousand
 * is the difference between N2's promise and a screen that sends every
 * document it has ever stored so the browser can throw all but ten away.
 *
 * **The count comes first, and it decides.** Asking for page 9 of a list that
 * has since shrunk to two answers with page 2 rather than an empty page 9 —
 * a table that says "showing 81–90 of 14" is lying about its own contents,
 * and the commonest way to see one is to delete your way off the end.
 */
export class ListDocuments {
  readonly #deps: ListDocumentsDependencies;

  constructor(dependencies: ListDocumentsDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: ListDocumentsCommand = {}): Promise<DocumentPage> {
    const { documents } = this.#deps;

    const perPage = clamp(command.perPage ?? DOCUMENTS_PER_PAGE, MAX_PER_PAGE);
    const search = (command.search ?? '').trim();
    const filter = search === '' ? {} : { search };

    const total = await documents.count(filter);
    const pages = Math.max(1, Math.ceil(total / perPage));
    const page = Math.min(pageOf(command.page), pages);

    const found = await documents.list({
      ...filter,
      limit: perPage,
      offset: (page - 1) * perPage,
    });

    return { documents: found, total, page, perPage, pages };
  }
}

function pageOf(page: number | undefined): number {
  return page === undefined || !Number.isFinite(page) || page < 1
    ? 1
    : Math.floor(page);
}

function clamp(perPage: number, max: number): number {
  if (!Number.isFinite(perPage) || perPage < 1) return DOCUMENTS_PER_PAGE;

  return Math.min(Math.floor(perPage), max);
}
