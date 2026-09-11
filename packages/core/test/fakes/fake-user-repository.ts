import type { UserId } from '../../src/domain/ids';
import { User } from '../../src/domain/user';
import type {
  UserDraft,
  UserRepository,
} from '../../src/ports/user-repository';

export class FakeUserRepository implements UserRepository {
  readonly #rows = new Map<UserId, User>();
  #nextId = 1;

  seed(...users: readonly User[]): this {
    for (const user of users) {
      this.#rows.set(user.id, user);
      this.#nextId = Math.max(this.#nextId, user.id + 1);
    }
    return this;
  }

  findById(id: UserId): Promise<User | null> {
    return Promise.resolve(this.#rows.get(id) ?? null);
  }

  findByUsername(username: string): Promise<User | null> {
    for (const user of this.#rows.values()) {
      if (user.username === username) {
        return Promise.resolve(user);
      }
    }
    return Promise.resolve(null);
  }

  insert(draft: UserDraft): Promise<User> {
    const user = User.create({ ...draft, id: this.#nextId });
    this.#nextId += 1;
    this.#rows.set(user.id, user);
    return Promise.resolve(user);
  }

  update(user: User): Promise<User> {
    this.#rows.set(user.id, user);
    return Promise.resolve(user);
  }

  count(): Promise<number> {
    return Promise.resolve(this.#rows.size);
  }
}
