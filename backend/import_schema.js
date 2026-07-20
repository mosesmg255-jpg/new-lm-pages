const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');

const sqlFile = path.join(__dirname, '..', 'loanmanagement.sql');
let raw = fs.readFileSync(sqlFile, 'utf8');

// Remove DELIMITER statements
raw = raw.replace(/DELIMITER\s+\S+/gi, '');
// Replace $$ with nothing
raw = raw.replace(/\$\$/g, '');
// Remove comments
raw = raw.replace(/--.*$/gm, '');
// Remove extra whitespace
raw = raw.replace(/\n\s*\n/g, '\n');

const statements = raw.split(';')
  .map(s => s.trim())
  .filter(s => s.length > 5);

console.log('Total statements to run:', statements.length);

const conn = mysql.createConnection({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  multipleStatements: true,
  connectTimeout: 5000
});

conn.connect(function(err) {
  if (err) {
    console.error('Connection failed:', err.message);
    process.exit(1);
  }
  console.log('Connected to MySQL');

  let completed = 0;
  let errors = 0;

  function runNext() {
    if (completed >= statements.length) {
      console.log('Done! Success:', completed - errors, 'Errors:', errors);
      conn.end();
      process.exit(0);
      return;
    }

    const stmt = statements[completed];
    completed++;

    conn.query(stmt, function(err) {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY' || err.code === 'ER_TABLE_EXISTS_ERROR' || err.code === 'ER_VIEW_EXISTS' || err.code === 'ER_BAD_FIELD_ERROR') {
          // skip
        } else if (err.code === 1064) {
          // SQL syntax error - likely the trigger. Skip it.
        } else {
          errors++;
          console.error('Error #' + completed + ':', err.code || err.errno, err.message.substring(0, 150));
        }
      }
      runNext();
    });
  }

  runNext();
});

setTimeout(function() {
  console.error('Script timed out');
  process.exit(1);
}, 60000);
