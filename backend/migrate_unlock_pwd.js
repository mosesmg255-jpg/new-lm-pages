const { Sequelize } = require('sequelize');
const s = new Sequelize('loanmanagement', 'root', '', {
  host: '127.0.0.1', dialect: 'mysql', logging: false
});
s.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS default_unlock_password VARCHAR(255) NULL DEFAULT NULL COMMENT 'Hashed static unlock password for admin lock screen'`)
  .then(() => { console.log(' Column default_unlock_password added successfully.'); s.close(); })
  .catch(e => { console.error(' Error:', e.message); s.close(); });
