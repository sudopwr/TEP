/**
 * Identity types.
 *
 * Plain aliases rather than branded types: the entities already carry the
 * meaning, and the extra ceremony would show up in every construction site
 * for a class of mistake the compiler catches anyway once ids live inside
 * entities rather than being passed around loose.
 */
export type CompanyId = number;
/**
 * A person a payout belongs to — never `UserId`.
 *
 * §5a's `users` table is the one sign-in account: a credential, a session,
 * an admin. A trader is who the *money* is for, has no password and never
 * signs in, and one admin manages several of them.
 */
export type TraderId = number;
export type AccountId = number;
export type PayoutId = number;
export type TransactionId = number;
export type TransactionFeeId = number;
export type FeeScheduleId = number;
export type DocumentId = number;

/**
 * A calendar date as `YYYY-MM-DD`.
 *
 * Not validated here. Per CLAUDE.md §7 the date format is a database
 * constraint, and the domain does not duplicate constraints unless the
 * message needs to be friendlier.
 */
export type IsoDate = string;

export type UserId = number;

/**
 * A session identifier: 32 random bytes, base64url (§5a).
 *
 * A string rather than a number because it is a bearer secret, not a row
 * number — it travels in a cookie and must be unguessable.
 */
export type SessionId = string;

/**
 * An instant as an ISO-8601 string in UTC, as `Date#toISOString` writes it.
 *
 * Distinct from `IsoDate`: a payout happens on a date, a session expires at a
 * moment. Stored as TEXT so a lexicographic comparison is also a chronological
 * one, which is what lets SQLite index `sessions(expires_at)` usefully.
 */
export type IsoInstant = string;
