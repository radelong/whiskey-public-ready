// A tiny shim that gives Node's built-in SQLite (node:sqlite) the same surface
// the Worker code expects from Cloudflare D1: prepare().bind().all()/first()/run()
// and db.batch([...]). Only the parts this app actually uses are implemented.

import type { DatabaseSync, StatementSync } from "node:sqlite";

type Bindable = string | number | bigint | null | Uint8Array;

function normalize(v: unknown): Bindable {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Uint8Array || typeof v === "bigint") return v;
  if (typeof v === "number" || typeof v === "string") return v;
  return String(v);
}

export class D1Statement {
  constructor(
    private readonly d1: D1Database,
    private readonly sql: string,
    private readonly params: Bindable[] = [],
  ) {}

  bind(...params: unknown[]): D1Statement {
    return new D1Statement(this.d1, this.sql, params.map(normalize));
  }

  private stmt(): StatementSync {
    return this.d1._prepare(this.sql);
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true; meta: object }> {
    const results = this.stmt().all(...this.params) as T[];
    return { results, success: true, meta: {} };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.stmt().get(...this.params);
    return (row ?? null) as T | null;
  }

  async run(): Promise<{ success: true; meta: { changes: number; last_row_id: number } }> {
    const r = this.stmt().run(...this.params);
    return {
      success: true,
      meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) },
    };
  }

  /** internal — used by D1Database.batch() */
  _exec(): { changes: number; last_row_id: number } {
    const result = this.stmt().run(...this.params);
    return { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) };
  }
}

export class D1Database {
  #db: DatabaseSync;
  #cache = new Map<string, StatementSync>();

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** internal — cached prepared statement */
  _prepare(sql: string): StatementSync {
    let s = this.#cache.get(sql);
    if (!s) {
      s = this.#db.prepare(sql);
      this.#cache.set(sql, s);
    }
    return s;
  }

  prepare(sql: string): D1Statement {
    return new D1Statement(this, sql);
  }

  async batch<T = unknown>(statements: D1Statement[]): Promise<T[]> {
    this.#db.exec("BEGIN");
    try {
      const results = statements.map((s) => s._exec());
      this.#db.exec("COMMIT");
      return results.map((meta) => ({ success: true, results: [], meta })) as T[];
    } catch (e) {
      this.#db.exec("ROLLBACK");
      throw e;
    }
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.#db.exec(sql);
    return { count: 0, duration: 0 };
  }
}
