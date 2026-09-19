// node:sqlite adapter with the D1 subset in src/db.ts, applying the real migrations. D1 enforces
// foreign keys and runs batch() as one transaction; this adapter does the same.
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { Db, DbStatement } from "../../src/db.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
}

/** Like `wrangler d1 migrations apply`, each migration runs in one transaction. */
export function applyMigration(db: DatabaseSync, sql: string): void {
  db.exec("BEGIN");
  try {
    db.exec(sql);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function migratedSqlite(upTo?: string): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const file of migrationFiles()) {
    applyMigration(db, readFileSync(new URL(file, MIGRATIONS_DIR), "utf8"));
    if (file === upTo) break;
  }
  return db;
}

class Statement implements DbStatement {
  readonly db: DatabaseSync;
  readonly sql: string;
  readonly values: unknown[];
  constructor(db: DatabaseSync, sql: string, values: unknown[] = []) {
    this.db = db;
    this.sql = sql;
    this.values = values;
  }
  bind(...values: unknown[]): DbStatement {
    return new Statement(this.db, this.sql, values);
  }
  stmt(): StatementSync {
    return this.db.prepare(this.sql);
  }
  execFirst<T>(): T | null {
    return (this.stmt().get(...(this.values as never[])) as T | undefined) ?? null;
  }
  execAll<T>(): { results: T[] } {
    return { results: this.stmt().all(...(this.values as never[])) as T[] };
  }
  execRun(): unknown {
    return this.stmt().run(...(this.values as never[]));
  }
  async first<T>(): Promise<T | null> { return this.execFirst<T>(); }
  async all<T>(): Promise<{ results: T[] }> { return this.execAll<T>(); }
  async run(): Promise<unknown> { return this.execRun(); }
}

export class SqliteD1 implements Db {
  readonly raw: DatabaseSync;
  constructor(raw: DatabaseSync = migratedSqlite()) {
    this.raw = raw;
  }
  prepare(sql: string): DbStatement {
    return new Statement(this.raw, sql);
  }
  async batch(statements: DbStatement[]): Promise<unknown[]> {
    this.raw.exec("BEGIN");
    try {
      const out = statements.map((s) => (s as Statement).execRun());
      this.raw.exec("COMMIT");
      return out;
    } catch (e) {
      this.raw.exec("ROLLBACK");
      throw e;
    }
  }
}
