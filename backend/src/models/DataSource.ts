/**
 * data_source (db/migrations/0003). Closed lookup table enumerating the
 * external data sources named in EDD Section 13 — see
 * types/enums.ts's DataSourceCode for the current closed set.
 */
export interface DataSource {
  readonly sourceCode: string;
  readonly displayName: string;
  readonly license: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
