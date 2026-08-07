import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A PostgREST-shaped fake for the publication ledger.
 *
 * The track-record view is mostly a question about *reads*: does a keyset page
 * advance correctly, does a failed read degrade to unavailable rather than to
 * zero, does the summary cover the same rows the table shows. None of that can
 * be exercised against a stub that returns a fixed array — the paging and the
 * window filters have to actually run.
 *
 * So this implements the subset of the query builder the ledger reads use, and
 * applies the filters in memory in the same order PostgREST would. It is
 * deliberately strict: an unsupported operator throws rather than being
 * ignored, because a silently-ignored filter is how a fake starts proving
 * something the real client would not.
 */

export type FakeRow = Record<string, unknown>;

type Comparison = { column: string; op: "eq" | "gte" | "lt" | "in"; value: unknown };

export type FakeLedgerOptions = {
  /** Table names whose reads should fail, with the message they fail with. */
  failing?: Record<string, string>;
};

class FakeQuery implements PromiseLike<{ data: FakeRow[] | null; error: { message: string } | null; count: number | null }> {
  private comparisons: Comparison[] = [];
  private orderings: Array<{ column: string; ascending: boolean }> = [];
  private rowLimit: number | null = null;
  private keyset: { column: string; timestamp: string; id: string } | null = null;

  constructor(
    private readonly rows: FakeRow[],
    private readonly failure: string | null,
    private readonly headOnly: boolean,
    private readonly wantCount: boolean
  ) {}

  eq(column: string, value: unknown): this {
    this.comparisons.push({ column, op: "eq", value });
    return this;
  }
  gte(column: string, value: unknown): this {
    this.comparisons.push({ column, op: "gte", value });
    return this;
  }
  lt(column: string, value: unknown): this {
    this.comparisons.push({ column, op: "lt", value });
    return this;
  }
  in(column: string, value: unknown[]): this {
    this.comparisons.push({ column, op: "in", value });
    return this;
  }
  order(column: string, options?: { ascending?: boolean }): this {
    this.orderings.push({ column, ascending: options?.ascending !== false });
    return this;
  }
  limit(count: number): this {
    this.rowLimit = count;
    return this;
  }
  abortSignal(): this {
    return this;
  }

  /**
   * Only the keyset predicate the ledger emits is understood:
   * `col.lt.T,and(col.eq.T,id.lt.I)`. Anything else is a bug in the caller or
   * in this fake, and both are better surfaced than absorbed.
   */
  or(expression: string): this {
    const match = /^([a-z_]+)\.lt\.(.+),and\(\1\.eq\.\2,id\.lt\.(.+)\)$/.exec(expression);
    if (!match) throw new Error(`FakeLedgerClient cannot interpret or(${expression})`);
    this.keyset = { column: match[1], timestamp: match[2], id: match[3] };
    return this;
  }

  private apply(): FakeRow[] {
    let rows = [...this.rows];
    for (const comparison of this.comparisons) {
      rows = rows.filter((row) => {
        const value = row[comparison.column];
        if (comparison.op === "eq") return value === comparison.value;
        if (comparison.op === "in") return (comparison.value as unknown[]).includes(value);
        if (comparison.op === "gte") return String(value) >= String(comparison.value);
        return String(value) < String(comparison.value);
      });
    }
    if (this.keyset) {
      const { column, timestamp, id } = this.keyset;
      rows = rows.filter((row) => {
        const value = String(row[column]);
        if (value < timestamp) return true;
        return value === timestamp && String(row.id) < id;
      });
    }
    for (const ordering of [...this.orderings].reverse()) {
      rows.sort((left, right) => {
        const a = String(left[ordering.column] ?? "");
        const b = String(right[ordering.column] ?? "");
        if (a === b) return 0;
        return (a < b ? -1 : 1) * (ordering.ascending ? 1 : -1);
      });
    }
    return this.rowLimit === null ? rows : rows.slice(0, this.rowLimit);
  }

  then<TResult1 = { data: FakeRow[] | null; error: { message: string } | null; count: number | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: FakeRow[] | null; error: { message: string } | null; count: number | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    const settle = () => {
      if (this.failure) return { data: null, error: { message: this.failure }, count: null };
      const rows = this.apply();
      return {
        data: this.headOnly ? [] : rows,
        error: null,
        count: this.wantCount ? rows.length : null
      };
    };
    return Promise.resolve(settle()).then(onfulfilled, onrejected);
  }
}

export function fakeLedgerClient(tables: Record<string, FakeRow[]>, options: FakeLedgerOptions = {}): SupabaseClient {
  const client = {
    from(table: string) {
      const rows = tables[table] ?? [];
      const failure = options.failing?.[table] ?? null;
      return {
        select(_columns: string, selectOptions?: { count?: string; head?: boolean }) {
          return new FakeQuery(rows, failure, Boolean(selectOptions?.head), selectOptions?.count === "exact");
        }
      };
    }
  };
  return client as unknown as SupabaseClient;
}
