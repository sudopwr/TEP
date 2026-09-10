/**
 * Opaque random identifiers.
 *
 * Not for entity ids — those are `INTEGER PRIMARY KEY` values the database
 * allocates on insert. This is for the ids core has to invent and cannot
 * derive: session ids (32 random bytes, base64url, per §5a) and the stored
 * filenames under `data/files`.
 *
 * Randomness lives outside core because `node:crypto` does.
 */
export interface IdGenerator {
  /** A fresh, URL-safe, unguessable identifier. */
  newId(): string;
}
