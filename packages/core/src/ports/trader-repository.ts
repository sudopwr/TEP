import type { TraderId } from '../domain/ids';
import type { Trader, TraderProps } from '../domain/trader';

export type TraderDraft = Omit<TraderProps, 'id'>;

/**
 * The people whose payouts these are (F24).
 *
 * No `delete`. A trader with payouts cannot go — `payouts.trader_id` is ON
 * DELETE RESTRICT, and the alternative would be a ledger of awards to nobody
 * — and a trader without payouts is a name in a dropdown that costs nothing
 * to leave. §5 says a port earns its methods; this one has no caller yet, so
 * it is not here.
 */
export interface TraderRepository {
  findById(id: TraderId): Promise<Trader | null>;

  findByCode(code: string): Promise<Trader | null>;

  list(): Promise<readonly Trader[]>;

  insert(draft: TraderDraft): Promise<Trader>;

  update(trader: Trader): Promise<Trader>;
}
