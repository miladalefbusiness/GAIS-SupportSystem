import 'dotenv/config';
import { runInitialBootstrap } from '../src/core/bootstrap/superadmin.ts';
import { pool } from '../src/db/index.ts';

async function main() {
  const report = await runInitialBootstrap();
  console.log('[bootstrap] Completed:', JSON.stringify(report));
}

main()
  .catch((err) => {
    console.error('[bootstrap] Failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
