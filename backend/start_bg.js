const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const logPath = path.join(__dirname, '..', 'logs', 'server_bg.log');
try { fs.unlinkSync(logPath); } catch(e) {}

const child = spawn('node', ['backend/server.js'], {
  cwd: path.join(__dirname, '..'),
  detached: true,
  stdio: ['ignore', fs.openSync(logPath, 'w'), fs.openSync(logPath, 'a')]
});

child.unref();
console.log('Server started with PID:', child.pid);
process.exit(0);
