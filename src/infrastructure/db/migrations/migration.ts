export interface Migration {
  /** Unique, stable, and never reused once applied anywhere — recorded verbatim in
   *  schema_migrations, so renaming it makes migrate.ts re-run it as if it were new. */
  id: string;
  statements: readonly string[];
}
