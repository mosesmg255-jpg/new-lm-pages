const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Member, sequelize } = require('../models');
const logger = require('../logger');
const { getAdminFromRequest, requireAdmin, getFallbackAdminId } = require('../adminContext');
const { Op } = require('sequelize');

const router = express.Router();

function ok(res, data) {
  return res.json({ status: 'success', message: 'OK', data });
}

function fail(res, statusCode, message, data = null) {
  return res.status(statusCode).json({ status: 'fail', message, data });
}

function toMemberDTO(m) {
  return {
    id: String(m.id),
    full_name: m.full_name,
    name: m.full_name,
    email: m.email,
    phone: m.phone,
    admin_id: m.admin_id || null,
    status: m.status ?? 'approved',
    approved: m.approved ?? true
  };
}

function toPlainApprovedDTO(row) {
  return {
    id: String(row.id),
    full_name: row.full_name,
    name: row.full_name,
    email: row.email,
    phone: row.phone,
    security_pin: row.security_pin || 'N/A',
    admin_id: row.admin_id || null,
    status: 'approved',
    approved: true
  };
}

function toPlainDeniedDTO(row) {
  return {
    id: String(row.id),
    full_name: row.full_name,
    name: row.full_name,
    email: row.email,
    phone: row.phone,
    admin_id: row.admin_id || null,
    status: 'denied',
    approved: false
  };
}

async function verifyAdminPassword(password, adminId) {
  if (!password) return false;
  const replacements = {};
  let sql = `SELECT password_hash FROM admins WHERE password_hash IS NOT NULL`;
  if (adminId) {
    sql += ` AND id = :adminId`;
    replacements.adminId = adminId;
  }
  const admins = await sequelize.query(sql, { type: sequelize.QueryTypes.SELECT, replacements });
  for (const admin of admins) {
    if (admin.password_hash && await bcrypt.compare(String(password), admin.password_hash)) {
      return true;
    }
  }
  return false;
}

/**
 * MySQL DDL (ADD THESE TABLES; keep existing `members` workflow intact)
 *
 * CREATE TABLE approved_members (
 *   id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 *   full_name VARCHAR(100) NOT NULL,
 *   email VARCHAR(150) NOT NULL UNIQUE,
 *   phone VARCHAR(50) NOT NULL DEFAULT '',
 *   verified_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
 * ) ENGINE=InnoDB;
 *
 * CREATE TABLE denied_access (
 *   id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 *   full_name VARCHAR(100) NOT NULL,
 *   email VARCHAR(150) NOT NULL,
 *   phone VARCHAR(50) NOT NULL DEFAULT '',
 *   denied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 *   restriction_reason VARCHAR(255) NOT NULL DEFAULT 'Admin denied'
 * ) ENGINE=InnoDB;
 */

// Ensure member support columns and recovery table exist.
(async () => {
  const statements = [
    `CREATE TABLE IF NOT EXISTS approved_members (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      full_name VARCHAR(100) NOT NULL,
      email VARCHAR(150) NOT NULL UNIQUE,
      phone VARCHAR(50) NOT NULL DEFAULT '',
      password VARCHAR(255) NOT NULL DEFAULT '',
      verified_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS denied_access (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      full_name VARCHAR(100) NOT NULL,
      email VARCHAR(150) NOT NULL,
      phone VARCHAR(50) NOT NULL DEFAULT '',
      denied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      restriction_reason VARCHAR(255) NOT NULL DEFAULT 'Admin denied',
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `ALTER TABLE members ADD COLUMN transaction_pin VARCHAR(255) NULL`,
    `ALTER TABLE members ADD COLUMN security_pin VARCHAR(10) NULL`,
    `ALTER TABLE members ADD COLUMN admin_id VARCHAR(50) NULL`,
    `ALTER TABLE approved_members ADD COLUMN transaction_pin VARCHAR(255) NULL`,
    `ALTER TABLE approved_members ADD COLUMN security_pin VARCHAR(10) NULL`,
    `ALTER TABLE approved_members ADD COLUMN admin_id VARCHAR(50) DEFAULT NULL`,
    `ALTER TABLE approved_members ADD INDEX idx_approved_members_admin (admin_id)`,
    `ALTER TABLE approved_members ADD COLUMN admin_phone VARCHAR(50) DEFAULT NULL`,
    `ALTER TABLE approved_members ADD COLUMN admin_email VARCHAR(150) DEFAULT NULL`,
    `ALTER TABLE approved_members ADD COLUMN admin_name VARCHAR(100) DEFAULT NULL`,
    `ALTER TABLE approved_members ADD COLUMN loanAmount DECIMAL(18,2) NOT NULL DEFAULT 0.00`,
    `ALTER TABLE approved_members ADD COLUMN savingsAmount DECIMAL(18,2) NOT NULL DEFAULT 0.00`,
    `ALTER TABLE denied_access ADD COLUMN admin_id VARCHAR(50) DEFAULT NULL`,
    `ALTER TABLE denied_access ADD INDEX idx_denied_access_admin (admin_id)`,
    `CREATE TABLE IF NOT EXISTS deleted_members (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      original_id INT UNSIGNED NOT NULL,
      full_name VARCHAR(100) NOT NULL,
      email VARCHAR(150) NOT NULL,
      phone VARCHAR(50) NOT NULL DEFAULT '',
      password VARCHAR(255) NOT NULL,
      transaction_pin VARCHAR(255) NULL,
      security_pin VARCHAR(10) NULL,
      loanAmount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
      savingsAmount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
      admin_id VARCHAR(50) DEFAULT NULL,
      deleted_by VARCHAR(100) NOT NULL DEFAULT 'admin',
      deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_deleted_members_original (original_id),
      KEY idx_deleted_members_email (email),
      KEY idx_deleted_members_admin (admin_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  ];

  for (const statement of statements) {
    try { await sequelize.query(statement); } catch (_) {}
  }
  try {
    const fallbackAdminId = await getFallbackAdminId(sequelize);
    if (fallbackAdminId) {
      await sequelize.query(
        `UPDATE approved_members SET admin_id = :adminId WHERE admin_id IS NULL OR admin_id = ''`,
        { replacements: { adminId: fallbackAdminId } }
      );
      await sequelize.query(
        `UPDATE members SET admin_id = :adminId WHERE admin_id IS NULL OR admin_id = ''`,
        { replacements: { adminId: fallbackAdminId } }
      );
      await sequelize.query(
        `UPDATE deleted_members SET admin_id = :adminId WHERE admin_id IS NULL OR admin_id = ''`,
        { replacements: { adminId: fallbackAdminId } }
      );
      await sequelize.query(
        `UPDATE denied_access SET admin_id = :adminId WHERE admin_id IS NULL OR admin_id = ''`,
        { replacements: { adminId: fallbackAdminId } }
      );
    }
  } catch (_) {}
})();

// POST /api/members/create
// { full_name, email, phone, password, pin }
router.post('/create', async (req, res) => {
  const start = process.hrtime();
  let session = '';
  let enc_ip = '';
  try {
    const { full_name, email, phone, password, pin } = req.body || {};
    const admin = getAdminFromRequest(req);
    session = req.headers['x-session-id'] || req.headers['x-sessionid'] || (req.headers.authorization ? 'tok:'+String(req.headers.authorization).slice(0,12) : '');
    const ipRaw = req.ip || req.connection && req.connection.remoteAddress || req.socket && req.socket.remoteAddress || '';
    enc_ip = logger.hashIP(ipRaw);

    if (!full_name || !email || !password || !pin) {
      const diff = process.hrtime(start); const ms = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2);
      logger.log('members.create.fail', { reason: 'missing_fields', duration_ms: ms, session, route: req.originalUrl, enc_ip });
      return fail(res, 400, 'Missing required fields including security PIN');
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const existingPending = await Member.findOne({ where: { email: normalizedEmail } });
    const existingApproved = await sequelize.query(
      `SELECT id FROM approved_members WHERE email = :email LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { email: normalizedEmail } }
    );

    if (existingPending || (existingApproved && existingApproved.length > 0)) {
      const diff = process.hrtime(start); const ms = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2);
      logger.log('members.create.fail', { reason: 'exists', email: normalizedEmail, duration_ms: ms, session, route: req.originalUrl, enc_ip });
      return fail(res, 409, 'Member with that email already exists');
    }

    const password_hash = await bcrypt.hash(String(password), 10);
    const pin_hash = await bcrypt.hash(String(pin), 10);

    const member = await Member.create({
      full_name,
      email: normalizedEmail,
      phone: phone ? String(phone) : '',
      password_hash,
      transaction_pin: pin_hash,
      security_pin: String(pin),
      admin_id: admin?.id || req.body?.admin_id || null,
      status: 'pending',
      approved: false
    });

    const diff = process.hrtime(start);
    const ms = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2);
    logger.log('members.create.success', { full_name, email: normalizedEmail, duration_ms: ms, session, route: req.originalUrl, enc_ip });

    return ok(res, toMemberDTO(member));
  } catch (e) {
    const diff = process.hrtime(start); const ms = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2);
    logger.log('members.create.error', { error: String(e.message || e), duration_ms: ms, session, route: req.originalUrl, enc_ip });
    return fail(res, 500, 'System error creating member');
  }
});

// POST /api/members/login
// { identifier, password }
router.post('/login', async (req, res) => {
  const start = process.hrtime();
  let session = '';
  let enc_ip = '';
  try {
    const { identifier, password } = req.body || {};
    session = req.headers['x-session-id'] || req.headers['x-sessionid'] || (req.headers.authorization ? 'tok:'+String(req.headers.authorization).slice(0,12) : '');
    const ipRaw = req.ip || req.connection && req.connection.remoteAddress || req.socket && req.socket.remoteAddress || '';
    enc_ip = logger.hashIP(ipRaw);

    if (!identifier || !password) {
      const diff = process.hrtime(start); const ms = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2);
      logger.log('members.login.fail', { reason: 'missing_credentials', duration_ms: ms, session, route: req.originalUrl, enc_ip });
      return fail(res, 400, 'Missing credentials');
    }

    const key = String(identifier).trim();
    const email = key.includes('@') ? key.toLowerCase() : null;

    // Check approved_members first
    const approvedRows = await sequelize.query(
      `SELECT id, full_name, email, phone, password AS password_hash, security_pin, admin_id FROM approved_members
       WHERE email = :email OR id = :numKey OR full_name = :key
       LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { email: email || '', numKey: Number(key) || 0, key: key } }
    );

    let foundMember = null;
    let isApprovedTable = false;

    if (approvedRows && approvedRows.length > 0) {
      foundMember = approvedRows[0];
      isApprovedTable = true;
    } else {
      // Check pending/denied queue
      let pendingMember = null;
      if (email) {
          pendingMember = await Member.findOne({ where: { email } });
      } else {
          pendingMember = await Member.findByPk(Number(key));
          if (!pendingMember) {
              pendingMember = await Member.findOne({ where: { full_name: key } });
          }
      }

      if (pendingMember) {
        foundMember = pendingMember.toJSON();
      }
    }

    if (!foundMember) {
      const diff = process.hrtime(start); const ms = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2);
      logger.log('members.login.fail', { reason: 'not_found', identifier, duration_ms: ms, session, route: req.originalUrl, enc_ip });
      return fail(res, 401, 'Invalid email/username or password');
    }

    const okPass = await bcrypt.compare(String(password), foundMember.password_hash);
    if (!okPass) {
      const diff = process.hrtime(start); const ms = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2);
      logger.log('members.login.fail', { reason: 'bad_password', identifier, duration_ms: ms, session, route: req.originalUrl, enc_ip });
      return fail(res, 401, 'Invalid email/username or password');
    }

    const diff = process.hrtime(start); const ms = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2);
    logger.log('members.login.success', { identifier, duration_ms: ms, session, route: req.originalUrl, enc_ip });

    if (isApprovedTable) {
      return ok(res, toPlainApprovedDTO(foundMember));
    } else {
      return ok(res, {
        ...toMemberDTO(foundMember),
        status: foundMember.status,
        approved: false
      });
    }
  } catch (e) {
    const diff = process.hrtime(start); const ms = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2);
    logger.log('members.login.error', { error: String(e.message || e), duration_ms: ms, session, route: req.originalUrl, enc_ip });
    return fail(res, 500, 'System error during login');
  }
});

// GET /api/members/view?id=...
router.get('/view', async (req, res) => {
  try {
    const id = req.query.id;
    if (!id) return fail(res, 400, 'Missing id');

    const approvedRows = await sequelize.query(
      `SELECT id, full_name, email, phone FROM approved_members WHERE id = :id LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { id: Number(id) } }
    );
    if (approvedRows && approvedRows.length > 0) {
      return ok(res, toPlainApprovedDTO(approvedRows[0]));
    }

    const member = await Member.findByPk(Number(id));
    if (!member) return fail(res, 404, 'Member not found');

    return ok(res, toMemberDTO(member));
  } catch (e) {
    return fail(res, 500, 'System error fetching member');
  }
});

// GET /api/members/all?status=approved|pending|denied
router.get('/all', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const status = String(req.query.status || 'approved');
    const valid = ['approved', 'pending', 'denied'];
    if (!valid.includes(status)) return fail(res, 400, 'Invalid status');

    const where = { status, admin_id: admin.id };
    if (status === 'pending') where.admin_id = { [Op.or]: [admin.id, null, ''] };
    const members = await Member.findAll({ where, order: [['created_at', 'DESC']] });
    return ok(res, members.map(toMemberDTO));
  } catch (e) {
    return fail(res, 500, 'System error fetching members');
  }
});

// POST /api/members/approve
router.post('/approve', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { id } = req.body || {};
    if (!id) return fail(res, 400, 'Missing id');

    const member = await Member.findByPk(Number(id));
    if (!member) return fail(res, 404, 'Member not found');
    if (member.admin_id && String(member.admin_id) !== admin.id) return fail(res, 403, 'Forbidden');

    member.status = 'approved';
    member.approved = true;
    member.admin_id = admin.id;
    await member.save();

    return ok(res, toMemberDTO(member));
  } catch (e) {
    return fail(res, 500, 'System error approving member');
  }
});

/**
 * GET /api/members/dashboard-pools
 * Returns pending queue (from `members` where status='pending')
 * and approved/denied pools from raw tables.
 */
router.get('/dashboard-pools', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const pending = await Member.findAll({
      where: { status: 'pending', admin_id: { [Op.or]: [admin.id, null, ''] } },
      order: [['created_at', 'DESC']]
    });

    const approved = await sequelize.query(
      `SELECT id, full_name, email, phone, security_pin, verified_at, admin_id
       FROM approved_members
       WHERE admin_id = :adminId
       ORDER BY id DESC`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: admin.id } }
    );

    const denied = await sequelize.query(
      `SELECT id, full_name, email, phone, denied_at, restriction_reason, admin_id
       FROM denied_access
       WHERE admin_id = :adminId
       ORDER BY denied_at DESC`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: admin.id } }
    );

    return ok(res, {
      pending: pending.map(toMemberDTO),
      approved: (approved || []).map(toPlainApprovedDTO),
      denied: (denied || []).map(toPlainDeniedDTO)
    });
  } catch (e) {
    return fail(res, 500, 'System error fetching verification pools');
  }
});

/**
 * POST /api/members/process-approval
 * body: { id, action } where action is 'approve' | 'deny'
 *
 * ADDITIVE workflow (does not remove existing approve/reject endpoints).
 * - Approve: INSERT into approved_members and UPDATE `members` status='approved'
 * - Deny: INSERT into denied_access and UPDATE `members` status='denied'
 */
router.post('/process-approval', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { id, action } = req.body || {};
    if (!id) return fail(res, 400, 'Missing id');
    if (!action || !['approve', 'deny'].includes(String(action))) return fail(res, 400, 'Invalid action');

    const pendingMember = await Member.findByPk(Number(id));
    if (!pendingMember) return fail(res, 404, 'Member not found');
    if (pendingMember.admin_id && String(pendingMember.admin_id) !== admin.id) return fail(res, 403, 'Forbidden');
    if (pendingMember.status !== 'pending') {
      return fail(res, 400, 'Member is not in pending queue');
    }

    if (String(action) === 'approve') {
      // Get current admin info from session or use default
      const adminInfo = admin;

      const storedPassword = pendingMember.password_hash || pendingMember.password || '';
      const storedPin = pendingMember.transaction_pin || null;
      const securityPin = pendingMember.security_pin || null;

      try {
        await sequelize.query(
          `INSERT INTO approved_members (full_name, email, phone, password, transaction_pin, security_pin, admin_id, admin_phone, admin_email, admin_name)
           VALUES (:full_name, :email, :phone, :password, :transaction_pin, :security_pin, :admin_id, :admin_phone, :admin_email, :admin_name)`,
          {
            type: sequelize.QueryTypes.INSERT,
            replacements: {
              full_name: pendingMember.full_name,
              email: pendingMember.email,
              phone: pendingMember.phone,
              password: storedPassword,
              transaction_pin: storedPin,
              security_pin: securityPin,
              admin_id: adminInfo.id || 'system',
              admin_phone: adminInfo.phone || '',
              admin_email: adminInfo.email || '',
              admin_name: adminInfo.name || 'System Admin'
            }
          }
        );
      } catch (e) {
        if (String(e.message).includes('Unknown column') || String(e.message).includes('ER_BAD_FIELD_ERROR')) {
          await sequelize.query(
            `INSERT INTO approved_members (full_name, email, phone, password)
             VALUES (:full_name, :email, :phone, :password)`,
            {
              type: sequelize.QueryTypes.INSERT,
              replacements: {
                full_name: pendingMember.full_name,
                email: pendingMember.email,
                phone: pendingMember.phone,
                password: storedPassword
              }
            }
          );
        } else {
          throw e;
        }
      }

      pendingMember.status = 'approved';
      pendingMember.approved = true;
      pendingMember.admin_id = admin.id;
      await pendingMember.save();

      return ok(res, { processed: 'approve', member: toMemberDTO(pendingMember) });
    }

    await sequelize.query(
      `INSERT INTO denied_access (full_name, email, phone, admin_id, denied_at, restriction_reason)
       VALUES (:full_name, :email, :phone, :admin_id, NOW(), 'Admin denied')`,
      {
        type: sequelize.QueryTypes.INSERT,
        replacements: {
          full_name: pendingMember.full_name,
          email: pendingMember.email,
          phone: pendingMember.phone,
          admin_id: admin.id
        }
      }
    );

    pendingMember.status = 'denied';
    pendingMember.approved = false;
    pendingMember.admin_id = admin.id;
    await pendingMember.save();

    return ok(res, { processed: 'deny', member: toMemberDTO(pendingMember) });
  } catch (e) {
    console.error('Approval Error:', e);
    return fail(res, 500, 'System error processing approval decision');
  }
});

/**
 * GET /api/members/approver-contact
 * Fetch the admin's contact info who approved the member
 * Query: ?email=member@example.com
 */
router.get('/approver-contact', async (req, res) => {
  try {
    const { email } = req.query || {};
    if (!email) return fail(res, 400, 'Missing member email');

    const approved = await sequelize.query(
      `SELECT admin_id, admin_phone, admin_email, admin_name FROM approved_members WHERE email = :email LIMIT 1`,
      {
        type: sequelize.QueryTypes.SELECT,
        replacements: { email: String(email).toLowerCase().trim() }
      }
    );

    if (!approved || approved.length === 0) {
      return ok(res, {
        admin_id: 'system',
        admin_phone: '',
        admin_email: '',
        admin_name: 'System Admin'
      });
    }

    return ok(res, approved[0]);
  } catch (e) {
    console.error('Approver Contact Error:', e);
    return fail(res, 500, 'System error fetching approver contact');
  }
});

// POST /api/members/reject (legacy endpoint; keeps old workflow intact)
router.post('/reject', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { id } = req.body || {};
    if (!id) return fail(res, 400, 'Missing id');

    const member = await Member.findByPk(Number(id));
    if (!member) return fail(res, 404, 'Member not found');
    if (member.admin_id && String(member.admin_id) !== admin.id) return fail(res, 403, 'Forbidden');

    member.status = 'denied';
    member.approved = false;
    member.admin_id = admin.id;
    await member.save();

    return ok(res, toMemberDTO(member));
  } catch (e) {
    return fail(res, 500, 'System error rejecting member');
  }
});

// DELETE /api/members/approved/:id
router.delete('/approved/:id', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { password } = req.body || {};
    if (!await verifyAdminPassword(password, admin.id)) {
      return fail(res, 403, 'Incorrect admin password.');
    }

    const id = Number(req.params.id);
    if (!id) return fail(res, 400, 'Invalid member id');

    const rows = await sequelize.query(
      `SELECT id, full_name, email, phone, password, transaction_pin, security_pin, loanAmount, savingsAmount, admin_id
       FROM approved_members WHERE id = :id AND admin_id = :adminId LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { id, adminId: admin.id } }
    );
    if (!rows.length) return fail(res, 404, 'Approved member not found');

    const member = rows[0];
    await sequelize.query(
      `INSERT INTO deleted_members
        (original_id, full_name, email, phone, password, transaction_pin, security_pin, loanAmount, savingsAmount, admin_id, deleted_by)
       VALUES
        (:original_id, :full_name, :email, :phone, :password, :transaction_pin, :security_pin, :loanAmount, :savingsAmount, :admin_id, :deleted_by)`,
      {
        type: sequelize.QueryTypes.INSERT,
        replacements: {
          original_id: member.id,
          full_name: member.full_name,
          email: member.email,
          phone: member.phone || '',
          password: member.password || '',
          transaction_pin: member.transaction_pin || null,
          security_pin: member.security_pin || null,
          loanAmount: Number(member.loanAmount || 0),
          savingsAmount: Number(member.savingsAmount || 0),
          admin_id: admin.id,
          deleted_by: admin.email || admin.full_name || 'admin'
        }
      }
    );

    await sequelize.query(
      `DELETE FROM approved_members WHERE id = :id AND admin_id = :adminId`,
      { type: sequelize.QueryTypes.DELETE, replacements: { id, adminId: admin.id } }
    );

    return ok(res, { deleted: true, id });
  } catch (e) {
    console.error('[members/delete-approved]', e);
    return fail(res, 500, 'System error deleting approved member');
  }
});

// GET /api/members/deleted
router.get('/deleted', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const rows = await sequelize.query(
      `SELECT id, original_id, full_name, email, phone, deleted_by, deleted_at, admin_id
       FROM deleted_members
       WHERE admin_id = :adminId
       ORDER BY deleted_at DESC, id DESC`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: admin.id } }
    );
    return ok(res, rows);
  } catch (e) {
    console.error('[members/deleted]', e);
    return fail(res, 500, 'System error fetching deleted members');
  }
});

// POST /api/members/restore
router.post('/restore', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const deletedId = Number((req.body || {}).deletedId);
    if (!deletedId) return fail(res, 400, 'Missing deleted member id');

    const rows = await sequelize.query(
      `SELECT * FROM deleted_members WHERE id = :id AND admin_id = :adminId LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { id: deletedId, adminId: admin.id } }
    );
    if (!rows.length) return fail(res, 404, 'Deleted member record not found');

    const member = rows[0];
    const existing = await sequelize.query(
      `SELECT id FROM approved_members WHERE email = :email AND admin_id = :adminId LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { email: member.email, adminId: admin.id } }
    );
    if (existing.length) return fail(res, 409, 'A member with this email is already approved');

    await sequelize.query(
      `INSERT INTO approved_members
        (full_name, email, phone, password, transaction_pin, security_pin, loanAmount, savingsAmount, admin_id, admin_phone, admin_email, admin_name)
       VALUES
        (:full_name, :email, :phone, :password, :transaction_pin, :security_pin, :loanAmount, :savingsAmount, :admin_id, :admin_phone, :admin_email, :admin_name)`,
      {
        type: sequelize.QueryTypes.INSERT,
        replacements: {
          full_name: member.full_name,
          email: member.email,
          phone: member.phone || '',
          password: member.password || '',
          transaction_pin: member.transaction_pin || null,
          security_pin: member.security_pin || null,
          loanAmount: Number(member.loanAmount || 0),
          savingsAmount: Number(member.savingsAmount || 0),
          admin_id: admin.id,
          admin_phone: admin.phone || '',
          admin_email: admin.email || '',
          admin_name: admin.full_name || admin.name || 'System Admin'
        }
      }
    );

    await sequelize.query(
      `DELETE FROM deleted_members WHERE id = :id AND admin_id = :adminId`,
      { type: sequelize.QueryTypes.DELETE, replacements: { id: deletedId, adminId: admin.id } }
    );

    return ok(res, { restored: true, deletedId });
  } catch (e) {
    console.error('[members/restore]', e);
    return fail(res, 500, 'System error restoring member');
  }
});

// POST /api/members/forgot-password
// { email }
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return fail(res, 400, 'Missing email address');

    const cleanEmail = String(email).toLowerCase().trim();

    // Check if user exists in either table
    const approvedRows = await sequelize.query(
      `SELECT id FROM approved_members WHERE email = :email LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { email: cleanEmail } }
    );
    const pendingMember = await Member.findOne({ where: { email: cleanEmail } });

    if (!pendingMember && (!approvedRows || approvedRows.length === 0)) {
      // Return 200 anyway to prevent email enumeration attacks
      return ok(res, { success: true, message: 'If the email exists, a reset link was generated.' });
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');

    // Insert into password_reset_temp (expires in 30 mins)
    await sequelize.query(
      `INSERT INTO password_reset_temp (email, token, expiry)
       VALUES (:email, :token, DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
      { type: sequelize.QueryTypes.INSERT, replacements: { email: cleanEmail, token } }
    );

    // Return the reset link so the frontend can display it (since we are simulating email delivery)
    const resetLink = `http://localhost:3000/member.html?reset_token=${token}`;
    return ok(res, { success: true, message: 'Reset link generated successfully', resetLink });
  } catch (e) {
    return fail(res, 500, 'System error processing forgot password request');
  }
});

// POST /api/members/recover-password
// { token, new_password }
router.post('/recover-password', async (req, res) => {
  try {
    const { token, new_password } = req.body || {};
    if (!token || !new_password) return fail(res, 400, 'Missing token or new password');

    // Find valid token
    const tokenRows = await sequelize.query(
      `SELECT email FROM password_reset_temp WHERE token = :token AND expiry > NOW() LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { token: String(token) } }
    );

    if (!tokenRows || tokenRows.length === 0) {
      return fail(res, 400, 'Invalid or expired password reset token');
    }

    const email = tokenRows[0].email;

    // Look up member
    let foundMember = null;
    let isApprovedTable = false;

    const approvedRows = await sequelize.query(
      `SELECT id FROM approved_members WHERE email = :email LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { email } }
    );

    if (approvedRows && approvedRows.length > 0) {
      foundMember = approvedRows[0];
      isApprovedTable = true;
    } else {
      foundMember = await Member.findOne({ where: { email } });
    }

    if (!foundMember) return fail(res, 404, 'Account associated with this token no longer exists');

    const password_hash = await bcrypt.hash(String(new_password), 10);

    if (isApprovedTable) {
      await sequelize.query(
        `UPDATE approved_members SET password = :hash WHERE id = :id`,
        { type: sequelize.QueryTypes.UPDATE, replacements: { hash: password_hash, id: foundMember.id } }
      );
    } else {
      foundMember.password_hash = password_hash;
      await foundMember.save();
    }

    // Delete token so it can't be reused
    await sequelize.query(
      `DELETE FROM password_reset_temp WHERE email = :email`,
      { type: sequelize.QueryTypes.DELETE, replacements: { email } }
    );

    return ok(res, { success: true, message: 'Password updated successfully' });
  } catch (e) {
    return fail(res, 500, 'System error recovering password');
  }
});

module.exports = router;
