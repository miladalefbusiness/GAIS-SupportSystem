import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

async function main() {
  const sqlHost = process.env.SQL_HOST;
  const sqlDbName = process.env.SQL_DB_NAME;
  const adminUser = process.env.SQL_ADMIN_USER;
  const adminPassword = process.env.SQL_ADMIN_PASSWORD;
  const isUnixSocket = Boolean(sqlHost && sqlHost.startsWith('/'));
  const port = process.env.SQL_PORT ? Number(process.env.SQL_PORT) : 5432;

  if (!sqlHost || !sqlDbName || !adminUser || !adminPassword) {
    throw new Error('Missing required SQL_HOST, SQL_DB_NAME, SQL_ADMIN_USER, or SQL_ADMIN_PASSWORD.');
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
