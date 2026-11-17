import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

async function ensureExtensions(pool: Pool) {
  for (const ext of ['vector', 'pg_trgm']) {
    try {
      await pool.query(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
    } catch (err) {
      const check = await pool
        .query(`SELECT 1 FROM pg_extension WHERE extname = $1`, [ext])
        .catch(() => ({ rows: [] }));
      if (check.rows.length === 0) {
        throw new Error(
          `PostgreSQL extension '${ext}' is required and could not be created: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  }
}

async function main() {
  const sqlHost = process.env.SQL_HOST;
  const sqlDbName = process.env.SQL_DB_NAME;
  const adminUser = process.env.SQL_ADMIN_USER || process.env.SQL_USER;
  const adminPassword = process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD;
  const isUnixSocket = Boolean(sqlHost && sqlHost.startsWith('/'));
  const port = process.env.SQL_PORT ? Number(process.env.SQL_PORT) : 5432;

  if (!sqlHost || !sqlDbName || !adminUser || !adminPassword) {
    throw new Error(
      'Missing required SQL_HOST, SQL_DB_NAME, SQL_ADMIN_USER (or SQL_USER), or SQL_ADMIN_PASSWORD (or SQL_PASSWORD).'
    );
  }

  const pool = new Pool({
    host: sqlHost,
    ...(isUnixSocket ? {} : { port }),
    user: adminUser,
    password: adminPassword,
    database: sqlDbName,
    max: 2,
    connectionTimeoutMillis: 15000,
  });

  try {
    await ensureExtensions(pool);
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('[migrate] All Drizzle SQL migrations applied successfully.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[migrate] Migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
