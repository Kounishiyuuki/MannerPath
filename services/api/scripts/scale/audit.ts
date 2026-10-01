import { performance } from "node:perf_hooks";
import type { Db, DbStatement } from "../../src/db.ts";
import { SqliteD1 } from "../../test/support/sqlite-d1.ts";
/** Capture exact production reads, including binds, rather than maintaining benchmark copies of SQL. */
export class AuditedDb implements Db {
  readonly base: SqliteD1;
  phase = "setup";
  readonly limits = { maxBoundParameters: 0, maxStatementBytes: 0, maxBatchStatements: 0, statements: 0 };
  readonly reads = new Map<string, { phase:string; sql:string; calls:number; elapsedMs:number; plan:unknown[]; maxParameters:number }>();
  constructor(base = new SqliteD1()) { this.base = base; }
  prepare(sql: string): DbStatement { return this.statement(sql, []); }
  statement(sql: string, values: unknown[]): DbStatement {
    const inner = this.base.prepare(sql).bind(...values);
    const execute = async <T>(kind: "first" | "all" | "run") => {
      const start = performance.now();
      this.limits.maxBoundParameters = Math.max(this.limits.maxBoundParameters,values.length);
      this.limits.maxStatementBytes = Math.max(this.limits.maxStatementBytes,Buffer.byteLength(sql));
      this.limits.statements++;
      try { return await inner[kind]<T>(); }
      finally {
        if (/^\s*(SELECT|WITH)\b/i.test(sql)) {
          const key = this.phase + "\n" + sql;
          let entry = this.reads.get(key);
          if (!entry) {
            let plan: unknown[] = [];
            try { plan = this.base.raw.prepare("EXPLAIN QUERY PLAN " + sql).all(...values as never[]); } catch {}
            entry = { phase: this.phase, sql, calls: 0, elapsedMs: 0, plan, maxParameters: values.length };
            this.reads.set(key, entry);
          }
          entry.calls++; entry.elapsedMs += performance.now() - start;
          entry.maxParameters = Math.max(entry.maxParameters, values.length);
        }
      }
    };
    return { bind: (...args) => this.statement(sql, args), first: <T>() => execute<T>("first") as Promise<T | null>,
      all: <T>() => execute<T>("all") as Promise<{ results: T[] }>, run: () => execute("run") };
  }
  async batch(statements: DbStatement[]): Promise<unknown[]> {
    this.limits.maxBatchStatements = Math.max(this.limits.maxBatchStatements,statements.length);
    this.base.raw.exec("BEGIN");
    try { const out=[]; for (const s of statements) out.push(await s.run()); this.base.raw.exec("COMMIT"); return out; }
    catch (e) { this.base.raw.exec("ROLLBACK"); throw e; }
  }
}
