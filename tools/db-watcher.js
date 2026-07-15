const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const POLL_DELAY_MS = Number(process.env.DB_WATCH_DELAY_MS || 5000);
const REBOOT_SIGNAL = path.join(__dirname, '..', 'backend', '.reboot');

const dbConfig = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'loanmanagement',
  connectTimeout: 3000,
};

let lastConnected = false;
let lastDbError = null;

async function checkDb() {
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    await conn.query('SELECT 1');
    await conn.end();
    lastDbError = null;
    return true;
  } catch (error) {
    lastDbError = error;
    if (conn) {
      try { await conn.end(); } catch (_) {}
    }
    return false;
  }
}

function triggerRestart() {
  try {
    fs.writeFileSync(REBOOT_SIGNAL, String(Date.now()));
    console.log('[db-watcher] backend/.reboot touched to trigger nodemon restart');
  } catch (err) {
    console.error('[db-watcher] failed to touch reboot file:', err.message || err);
  }
}

async function monitor() {
  console.log('[db-watcher] starting database connectivity monitor');
  while (true) {
    const isConnected = await checkDb();
    if (isConnected && !lastConnected) {
      console.log('[db-watcher] database connection restored');
      triggerRestart();
    } else if (!isConnected && lastConnected) {
      console.warn('[db-watcher] database disconnected; waiting for restore');
    }
    lastConnected = isConnected;
    await new Promise(resolve => setTimeout(resolve, POLL_DELAY_MS));
  }
}

monitor().catch(err => {
  console.error('[db-watcher] fatal error:', err);
  process.exit(1);
});
