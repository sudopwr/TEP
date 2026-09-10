/**
 * Identity types.
 *
 * Plain aliases rather than branded types: the entities already carry the
 * meaning, and the extra ceremony would show up in every construction site
 * for a class of mistake the compiler catches anyway once ids live inside
 * entities rather than being passed around loose.
 */
export type CompanyId = number;
export type AccountId = number;
export type PayoutId = number;
export type TransactionId = number;
export type TransactionFeeId = number;
export type DocumentId = number;

/**
 * A calendar date as `YYYY-MM-DD`.
 *
 * Not validated here. Per CLAUDE.md §7 the date format is a database
 * constraint, and the domain does not duplicate constraints unless the
 * message needs to be friendlier.
 */
export type IsoDate = string;
