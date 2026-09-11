import { openDatabase, type SqliteDatabase } from '../src/db/connection';
import { migrate } from '../src/db/migrate';

/**
 * A fresh, fully migrated `:memory:` database.
 *
 * Every test that touches SQL gets one of these in `beforeEach`, so no test
 * can see another's rows and none of them needs cleaning up. It is the real
 * schema, the real pragmas and the real migration runner — the only thing
 * that differs from production is where the bytes live.
 */
export function openTestDatabase(): SqliteDatabase {
  const database = openDatabase(':memory:');
  migrate(database);
  return database;
}
