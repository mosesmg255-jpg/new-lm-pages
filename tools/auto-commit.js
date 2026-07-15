#!/usr/bin/env node
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEBOUNCE_MS = 2500;
let timer = null;

function log(...args) { console.log('[auto-commit]', ...args); }

function run(cmd, cb) {
  exec(cmd, { cwd: ROOT, windowsHide: true }, (err, stdout, stderr) => {
    cb && cb(err, stdout, stderr);
  });
}

function gitAvailable(cb) {
  run('git --version', (err) => cb(!err));
}

function ensureGitRepo(cb) {
  if (fs.existsSync(path.join(ROOT, '.git'))) return cb(true);
  run('git init', (err) => cb(!err));
}

function commitChanges() {
  log('Preparing to commit changes...');
  run('git add -A', (err) => {
    if (err) return log('git add failed:', err.message || err);
    const msg = `auto: workspace update ${new Date().toISOString()}`;
    run(`git commit -m "${msg}"`, (err2, stdout, stderr) => {
      if (err2) {
        const out = (stdout||'') + (stderr||'');
        if (/nothing to commit|nothing added to commit/i.test(out)) {
          log('No changes to commit.');
        } else {
          log('git commit failed:', err2.message || out.trim());
        }
      } else {
        log('Auto-committed:', msg);
      }
    });
  });
}

function scheduleCommit() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    commitChanges();
    timer = null;
  }, DEBOUNCE_MS);
}

function startWatcher() {
  log('Starting file watcher in', ROOT);
  try {
    const watcher = fs.watch(ROOT, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const f = filename.replace(/\\/g, '/');
      if (f.startsWith('.git') || f.includes('/.git/')) return;
      if (f.endsWith('~') || f.endsWith('.swp')) return;
      log('change detected:', eventType, f);
      scheduleCommit();
    });
    process.on('SIGINT', () => { log('Stopping watcher'); watcher.close(); process.exit(0); });
  } catch (e) {
    log('Watcher error:', e.message || e);
    process.exitCode = 1;
  }
}

// Entry
gitAvailable((ok) => {
  if (!ok) {
    log('git not available in PATH. Install Git and re-run this script.');
    process.exit(1);
  }
  ensureGitRepo((inRepo) => {
    if (!inRepo) {
      log('Failed to initialize git repo.');
      process.exit(1);
    }
    // initial commit if there are files
    run('git add -A', () => {
      run('git commit -m "auto: initial commit from auto-commit script"', () => {
        startWatcher();
      });
    });
  });
});
