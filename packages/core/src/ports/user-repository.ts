import type { UserId } from '../domain/ids';
import type { User, UserProps } from '../domain/user';

/** A user that has not been persisted, and so has no id yet. */
export type UserDraft = Omit<UserProps, 'id'>;

export interface UserRepository {
  findById(id: UserId): Promise<User | null>;

  /** Exact match. Usernames are compared as stored, not case-folded. */
  findByUsername(username: string): Promise<User | null>;

  insert(draft: UserDraft): Promise<User>;

  update(user: User): Promise<User>;

  /** How many accounts exist. §5a says one; this is how a test checks. */
  count(): Promise<number>;
}
