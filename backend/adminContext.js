const crypto = require('crypto');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function getSecret() {
  const secret = process.env.ADMIN_TOKEN_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: ADMIN_TOKEN_SECRET or SESSION_SECRET must be set in environment for production.');
    }
    console.warn('[SECURITY] WARNING: Using auto-generated token secret. Set ADMIN_TOKEN_SECRET in .env for persistent sessions.');
    // Generate a per-process random secret so tokens don't survive restarts
    return crypto.randomBytes(32).toString('hex');
  }
  return secret;
}

const SECRET = getSecret();

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signPayload(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

function signAdminToken(admin) {
  const payload = base64url(JSON.stringify({
    id: String(admin.id),
    full_name: admin.full_name || admin.name || '',
    email: admin.email || '',
    phone: admin.phone || '',
    exp: Date.now() + TOKEN_TTL_MS
  }));
  return `${payload}.${signPayload(payload)}`;
}

function readBearerToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return req.headers['x-admin-token'] || '';
}

function getAdminFromRequest(req) {
  try {
    const token = readBearerToken(req);
    if (!token || !token.includes('.')) return null;
    const [payload, signature] = token.split('.');
    const expected = signPayload(payload);
    const sigBuf = Buffer.from(String(signature));
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const admin = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (admin.type === 'member') return null;
    if (!admin.id || !admin.exp || Date.now() > Number(admin.exp)) return null;
    return {
      id: String(admin.id),
      full_name: admin.full_name || '',
      name: admin.full_name || '',
      email: admin.email || '',
      phone: admin.phone || ''
    };
  } catch (_) {
    return null;
  }
}

function requireAdmin(req, res) {
  const admin = getAdminFromRequest(req);
  if (!admin) {
    res.status(401).json({ status: 'fail', message: 'Admin session expired. Please log in again.' });
    return null;
  }
  return admin;
}

async function getFallbackAdminId(sequelize) {
  const rows = await sequelize.query(
    `SELECT id FROM admins ORDER BY id ASC LIMIT 1`,
    { type: sequelize.QueryTypes.SELECT }
  );
  return rows && rows.length ? String(rows[0].id) : null;
}

function signMemberToken(member) {
  const payload = base64url(JSON.stringify({
    type: 'member',
    id: String(member.id),
    full_name: member.full_name || member.name || '',
    email: member.email || '',
    exp: Date.now() + TOKEN_TTL_MS
  }));
  return `${payload}.${signPayload(payload)}`;
}

function getMemberFromRequest(req) {
  try {
    const token = readBearerToken(req);
    if (!token || !token.includes('.')) return null;
    const [payload, signature] = token.split('.');
    const expected = signPayload(payload);
    const sigBuf = Buffer.from(String(signature));
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.type !== 'member' || !data.id || !data.exp || Date.now() > Number(data.exp)) return null;
    return { id: String(data.id), full_name: data.full_name || '', email: data.email || '' };
  } catch (_) {
    return null;
  }
}

function requireMember(req, res) {
  const member = getMemberFromRequest(req);
  if (!member) {
    res.status(401).json({ status: 'fail', message: 'Member session expired. Please log in again.' });
    return null;
  }
  return member;
}

module.exports = {
  signAdminToken,
  signMemberToken,
  getAdminFromRequest,
  getMemberFromRequest,
  requireAdmin,
  requireMember,
  getFallbackAdminId
};
