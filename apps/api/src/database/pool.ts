import pg from "pg";

const { Pool } = pg;

export function createDatabasePool(connectionString: string) {
  return new Pool({ connectionString, max: 10 });
}

export type DatabasePool = ReturnType<typeof createDatabasePool>;
