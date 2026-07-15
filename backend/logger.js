const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, 'activity.log');
let lastActivityKey = '';
let lastActivityAt = 0;

function summarize(info) {
  if (!info) return '';
  if (typeof info === 'string') return info;
  const parts = [];
  if (info.full_name) parts.push(info.full_name);
  if (info.email) parts.push(info.email);
  if (info.identifier) parts.push(info.identifier);
  if (info.reason) parts.push(`reason=${info.reason}`);
  if (info.admin_id) parts.push(`admin=${info.admin_id}`);
  if (info.session) parts.push(`session=${info.session}`);
  if (info.route) parts.push(`route=${info.route}`);
  if (info.enc_ip) parts.push(`enc_ip=${info.enc_ip}`);
  if (info.duration_ms !== undefined) parts.push(`took=${info.duration_ms}ms`);
  return parts.join(' | ');
}

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  white: '\x1b[37m'
};

function colorize(text, color) {
  if (!process.stdout || !process.stdout.isTTY) return text;
  return `${color}${text}${ANSI.reset}`;
}

function renderSummary(info, isHighlighted = false) {
  if (!info) return '';
  if (typeof info === 'string') return colorize(info, ANSI.white);
  const parts = [];
  const palette = [ANSI.cyan, ANSI.yellow, ANSI.green, ANSI.magenta, ANSI.white];
  const pushField = (value, label, idx) => {
    if (!value) return;
    const color = isHighlighted && (label === 'route' || label === 'enc_ip')
      ? ANSI.magenta
      : palette[idx % palette.length];
    parts.push(colorize(`${label}=${value}`, color));
  };

  let idx = 0;
  if (info.full_name) pushField(info.full_name, 'name', idx++);
  if (info.email) pushField(info.email, 'email', idx++);
  if (info.identifier) pushField(info.identifier, 'identifier', idx++);
  if (info.reason) pushField(info.reason, 'reason', idx++);
  if (info.admin_id) pushField(info.admin_id, 'admin', idx++);
  if (info.session) pushField(info.session, 'session', idx++);
  if (info.route) pushField(info.route, 'route', idx++);
  if (info.enc_ip) pushField(info.enc_ip, 'enc_ip', idx++);
  if (info.duration_ms !== undefined) pushField(`${info.duration_ms}ms`, 'took', idx++);
  return parts.join(colorize(' | ', ANSI.dim));
}

function getEventColor(event, info = {}) {
  if (!event) return ANSI.yellow;
  if (event.includes('http_request')) {
    if (info && info.route === '/home.html') return ANSI.yellow;
    return ANSI.green;
  }
  if (event.includes('create') || event.includes('approved') || event.includes('success')) return ANSI.cyan;
  if (event.includes('fail') || event.includes('error') || event.includes('denied')) return ANSI.red;
  return ANSI.magenta;
}

function log(event, info = {}) {
  const normalizedSummary = summarize(info);
  const signature = `${event}|${normalizedSummary || ''}`;
  const now = Date.now();
  if (signature === lastActivityKey && now - lastActivityAt < 2000) {
    return;
  }
  lastActivityKey = signature;
  lastActivityAt = now;

  const isHighlighted = event && event.includes('http_request') && info && info.route === '/home.html';
  const time = new Date().toISOString();
  const timeText = colorize(time, isHighlighted ? ANSI.cyan : ANSI.blue);
  const eventText = colorize(event, getEventColor(event, info));
  const summary = renderSummary(info, isHighlighted);
  const line = summary
    ? `${colorize('[', ANSI.dim)}${timeText}${colorize(']', ANSI.dim)} ${eventText}${colorize(':', ANSI.dim)} ${summary}`
    : `${colorize('[', ANSI.dim)}${timeText}${colorize(']', ANSI.dim)} ${eventText}`;

  try { fs.appendFileSync(LOG_FILE, `${time} ${event}: ${normalizedSummary ? normalizedSummary : ''}\n`); } catch (e) { /* ignore write errors */ }
  console.log(line);
}

function hashIP(ip) {
  try {
    if (!ip) return '';
    return crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0,12);
  } catch (e) { return '' }
}

module.exports = { log, hashIP };
