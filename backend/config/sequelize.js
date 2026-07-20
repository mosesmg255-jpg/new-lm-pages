const path = require('path');
const dotenv = require('dotenv');
const { Sequelize } = require('sequelize');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

function numberFromEnv(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

const DB_HOST = process.env.MYSQL_HOST || process.env.MYSQLHOST || process.env.DB_HOST || '127.0.0.1';
const DB_PORT = numberFromEnv(process.env.MYSQL_PORT || process.env.MYSQLPORT || process.env.DB_PORT, 3306);
const DB_NAME = process.env.MYSQL_DATABASE || process.env.MYSQLDATABASE || process.env.DB_NAME || 'loanmanagement';
const DB_USER = process.env.MYSQL_USER || process.env.MYSQLUSER || process.env.DB_USER || 'root';
const DB_PASS = process.env.MYSQL_PASSWORD || process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '';
const DB_CONNECT_TIMEOUT_MS = numberFromEnv(process.env.MYSQL_CONNECT_TIMEOUT_MS, 5000);

const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASS, {
  host: DB_HOST,
  port: DB_PORT,
  dialect: 'mysql',
  logging: process.env.DB_LOGGING === 'true' ? console.log : false,
  timezone: '+00:00',
  dialectOptions: {
    connectTimeout: DB_CONNECT_TIMEOUT_MS
  },
  pool: {
    max: numberFromEnv(process.env.DB_POOL_MAX, 10),
    min: numberFromEnv(process.env.DB_POOL_MIN, 2),
    acquire: numberFromEnv(process.env.DB_POOL_ACQUIRE, 20000),
    idle: numberFromEnv(process.env.DB_POOL_IDLE, 10000)
  },
  retry: {
    max: 0
  }
});

sequelize.connectionDetails = {
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  connectTimeoutMs: DB_CONNECT_TIMEOUT_MS
};

module.exports = sequelize;
