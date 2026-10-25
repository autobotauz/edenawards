/**
 * A tiny database abstraction with two implementations:
 *  - D1Database (Cloudflare Workers)
 *  - node:sqlite DatabaseSync (local development, tests and Node hosting)
 *
 * Both are SQLite, so the SQL is identical. Every query is parameterized.
 */

export type SqlValue = string | number | null;

export interface Statement {
  sql: string;
  params?: SqlValue[];
}

export interface RunResult {
  changes: number;
  lastRowId: number;
}

export interface Db {
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T | null>;
  run(sql: string, params?: SqlValue[]): Promise<RunResult>;
  /** Executes all statements atomically (single transaction). */
  batch(statements: Statement[]): Promise<RunResult[]>;
}

/** Thrown for SQLite constraint violations so callers can map them to HTTP errors. */
export class ConstraintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConstraintError';
  }
}

export function isConstraintError(err: unknown): boolean {
  if (err instanceof ConstraintError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /constraint/i.test(msg);
}

/* ------------------------------------------------------------------ D1 adapter */

export function d1Db(d1: D1Database): Db {
  const bind = (sql: string, params: SqlValue[] = []) => d1.prepare(sql).bind(...params);
  return {
    async all<T>(sql: string, params?: SqlValue[]) {
      const res = await bind(sql, params).all<T>();
      return res.results ?? [];
    },
    async first<T>(sql: string, params?: SqlValue[]) {
      return (await bind(sql, params).first<T>()) ?? null;
    },
    async run(sql: string, params?: SqlValue[]) {
      const res = await bind(sql, params).run();
      return { changes: res.meta.changes ?? 0, lastRowId: res.meta.last_row_id ?? 0 };
    },
    async batch(statements: Statement[]) {
      if (statements.length === 0) return [];
      const res = await d1.batch(statements.map((s) => bind(s.sql, s.params)));
      return res.map((r) => ({ changes: r.meta.changes ?? 0, lastRowId: r.meta.last_row_id ?? 0 }));
    },
  };
}

/* ------------------------------------------------------- node:sqlite adapter */

/** Minimal structural type for node:sqlite's DatabaseSync, so this file has no hard import. */
export interface SyncSqlite {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: SqlValue[]): unknown[];
    get(...params: SqlValue[]): unknown;
    run(...params: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  };
}

export function sqliteDb(db: SyncSqlite): Db {
  const runOne = (s: Statement): RunResult => {
    const r = db.prepare(s.sql).run(...(s.params ?? []));
    return { changes: Number(r.changes), lastRowId: Number(r.lastInsertRowid) };
  };
  // Plain objects (node:sqlite returns null-prototype rows).
  const plain = <T>(row: unknown): T => ({ ...(row as object) }) as T;
  return {
    async all<T>(sql: string, params: SqlValue[] = []) {
      return db.prepare(sql).all(...params).map((r) => plain<T>(r));
    },
    async first<T>(sql: string, params: SqlValue[] = []) {
      const row = db.prepare(sql).get(...params);
      return row ? plain<T>(row) : null;
    },
    async run(sql: string, params: SqlValue[] = []) {
      return runOne({ sql, params });
    },
    async batch(statements: Statement[]) {
      // node:sqlite is synchronous, so nothing else can interleave inside this transaction.
      db.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(runOne);
        db.exec('COMMIT');
        return results;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
