const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

/**
 * Migration runner - applies SQL migrations in order from backend/migrations/
 * Tracks applied migrations in a schema_migrations table.
 */
async function runMigrations() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
    connectTimeout: 5000
  });

  // Create migrations tracking table
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
    console.log('[MIGRATIONS] Created migrations directory:', migrationsDir);
    await conn.end();
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const [applied] = await conn.execute('SELECT version FROM schema_migrations');
  const appliedVersions = new Set(applied.map(r => r.version));

  let applied_count = 0;

  for (const file of files) {
    const version = file.replace('.sql', '');
    if (appliedVersions.has(version)) continue;

    console.log(`[MIGRATIONS] Applying: ${version}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

    // Split by semicolons but handle DELIMITER for triggers
    let processed = sql.replace(/DELIMITER\s+\S+/gi, '');
    processed = processed.replace(/\$\$/g, '');

    const statements = processed.split(';')
      .map(s => s.trim())
      .filter(s => s.length > 5);

    for (const stmt of statements) {
      try {
        await conn.execute(stmt);
      } catch (err) {
        if (['ER_DUP_ENTRY', 'ER_TABLE_EXISTS_ERROR', 'ER_VIEW_EXISTS', 'ER_CANNOT_ADD_FOREIGN',
             'ER_DROP_DB_WITH_DATA_LOCKED', 'ER_CANT_DROP_FIELD_OR_KEY'].includes(err.code)) {
          // skip
        } else if (err.code === 'ER_CANNOT_RECREATE_FOREIGN_KEY_CONSTRAINT') {
          console.warn(`  [WARN] FK constraint skip: ${err.message.substring(0, 100)}`);
        } else {
          console.error(`  [ERROR] ${err.code}: ${err.message.substring(0, 150)}`);
        }
      }
    }

    await conn.execute('INSERT IGNORE INTO schema_migrations (version) VALUES (?)', [version]);
    applied_count++;
    console.log(`  [OK] Applied ${version}`);
  }

  console.log(`[MIGRATIONS] Done. Applied ${applied_count} new migration(s).`);
  await conn.end();
}

module.exports = { runMigrations };

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  runMigrations().catch(err => {
    console.error('[MIGRATIONS] Fatal:', err);
    process.exit(1);
  });
}
