const express = require('express');
const bcrypt = require('bcryptjs');
const { Loan, Member, sequelize } = require('../models');
const { requireAdmin, getFallbackAdminId } = require('../adminContext');

const router = express.Router();

function ok(res, data) { return res.json({ status: 'success', message: 'OK', data }); }
function fail(res, code, message) { return res.status(code).json({ status: 'fail', message }); }

const DEFAULT_PORTAL_CONFIG = {
  requestLoan: [
    'Loan eligibility calculator',
    'Interest rate preview',
    'Application status tracker',
    'Loan purpose category',
    'Guarantor / collateral notes'
  ],
  repayments: [
    'Repayment schedule view',
    'Partial payment calculator',
    'Payment history summary',
    'Auto-pay reminder toggle',
    'Receipt export (CSV/PDF)'
  ],
  assemblies: [
    'Upcoming assembly calendar',
    'Meeting attendance log',
    'Group roster view',
    'Assembly agenda preview',
    'Online video connect link'
  ],
  liveLedger: [
    'Transaction filter by type/date',
    'Balance summary card',
    'Export ledger CSV',
    'Monthly statement view',
    'Verification status badges'
  ],
  systemSettings: [
    'Change security PIN',
    'Notification preferences',
    'Profile update form',
    'Session timeout config',
    'Theme & display sync'
  ]
};

function parsePortalConfig(value) {
  if (!value) return null;
  const raw = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...DEFAULT_PORTAL_CONFIG, ...parsed };
    }
  } catch (_) {}
  return null;
}

async function savePortalConfig(config) {
  const merged = { ...DEFAULT_PORTAL_CONFIG, ...(config || {}) };
  await sequelize.query(
    `INSERT INTO app_settings (setting_key, setting_value) VALUES ('member_portal_config', :val)
     ON DUPLICATE KEY UPDATE setting_value = :val`,
    { replacements: { val: JSON.stringify(merged) } }
  );
  return merged;
}

async function ensureTables() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS transaction_verifications (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      member_id INT UNSIGNED NOT NULL,
      admin_id VARCHAR(50) DEFAULT NULL,
      member_name VARCHAR(150) NOT NULL,
      email VARCHAR(150) NOT NULL DEFAULT '',
      phone VARCHAR(50) NOT NULL DEFAULT '',
      security_pin VARCHAR(10) NOT NULL DEFAULT '',
      transaction_type ENUM('loan_request','loan_assignment','repayment') NOT NULL DEFAULT 'loan_request',
      amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
      duration INT UNSIGNED DEFAULT 0,
      interest_rate DECIMAL(8,2) DEFAULT 0.00,
      extra_data JSON DEFAULT NULL,
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TIMESTAMP NULL DEFAULT NULL,
      PRIMARY KEY (id),
      KEY idx_verifications_status (status),
      KEY idx_verifications_member (member_id),
      KEY idx_verifications_admin (admin_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  try { await sequelize.query(`ALTER TABLE transaction_verifications ADD COLUMN admin_id VARCHAR(50) DEFAULT NULL`); } catch (_) {}
  try { await sequelize.query(`ALTER TABLE transaction_verifications ADD INDEX idx_verifications_admin (admin_id)`); } catch (_) {}
  try {
    const fallbackAdminId = await getFallbackAdminId(sequelize);
    if (fallbackAdminId) {
      await sequelize.query(
        `UPDATE transaction_verifications v
         LEFT JOIN approved_members m ON m.id = v.member_id
         SET v.admin_id = COALESCE(m.admin_id, :fallbackAdminId)
         WHERE v.admin_id IS NULL OR v.admin_id = ''`,
        { replacements: { fallbackAdminId } }
      );
    }
  } catch (_) {}

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      setting_key VARCHAR(100) NOT NULL UNIQUE,
      setting_value MEDIUMTEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  // Upgrade TEXT -> MEDIUMTEXT if table already existed with TEXT column
  try {
    await sequelize.query(
      `ALTER TABLE app_settings MODIFY COLUMN setting_value MEDIUMTEXT NOT NULL`
    );
  } catch (_) { /* already MEDIUMTEXT or ALTER not needed */ }

  const [rows] = await sequelize.query(
    `SELECT id, setting_value FROM app_settings WHERE setting_key = 'member_portal_config' LIMIT 1`
  );
  if (!rows.length) {
    await sequelize.query(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES ('member_portal_config', :val)`,
      { replacements: { val: JSON.stringify(DEFAULT_PORTAL_CONFIG) } }
    );
  } else {
    // Repair any corrupt JSON stored previously
    try { JSON.parse(rows[0].setting_value); } catch (_) {
      console.warn('[app_settings] Corrupt member_portal_config detected - resetting to defaults.');
      await sequelize.query(
        `UPDATE app_settings SET setting_value = :val WHERE setting_key = 'member_portal_config'`,
        { replacements: { val: JSON.stringify(DEFAULT_PORTAL_CONFIG) } }
      );
    }
  }
}

ensureTables().catch(console.error);

function verificationDTO(v) {
  return {
    id: String(v.id),
    member_id: String(v.member_id),
    admin_id: v.admin_id || null,
    member_name: v.member_name,
    email: v.email,
    phone: v.phone,
    security_pin: v.security_pin,
    transaction_type: v.transaction_type,
    amount: Number(v.amount),
    duration: v.duration,
    interest_rate: Number(v.interest_rate || 0),
    extra_data: v.extra_data,
    status: v.status,
    created_at: v.created_at
  };
}

async function getMemberContact(memberId) {
  const [approved] = await sequelize.query(
    `SELECT id, full_name, email, phone, admin_id FROM approved_members WHERE id = :id LIMIT 1`,
    { replacements: { id: memberId } }
  );
  if (approved.length) return approved[0];

  const member = await Member.findByPk(memberId);
  if (member) return { id: member.id, full_name: member.full_name, email: member.email, phone: member.phone, admin_id: member.admin_id || null };
  return null;
}

async function verifyMemberPin(memberId, pin) {
  const cleanPin = String(pin || '').trim();
  const member = await Member.findByPk(memberId);
  if (member && member.transaction_pin) {
    const match = await bcrypt.compare(cleanPin, member.transaction_pin);
    if (match) return true;
  }
  if (member && member.security_pin) {
    const stored = String(member.security_pin).trim();
    const match = stored.startsWith('$2') ? await bcrypt.compare(cleanPin, stored) : cleanPin === stored;
    if (match) return true;
  }

  const [approved] = await sequelize.query(
    `SELECT security_pin, transaction_pin, password FROM approved_members WHERE id = :id LIMIT 1`,
    { replacements: { id: memberId } }
  );
  if (!approved.length) return false;

  const row = approved[0];
  if (row.transaction_pin && await bcrypt.compare(cleanPin, row.transaction_pin)) return true;
  if (row.security_pin) {
    const stored = String(row.security_pin).trim();
    const match = stored.startsWith('$2') ? await bcrypt.compare(cleanPin, stored) : cleanPin === stored;
    if (match) return true;
  }

  return false;
}

async function finalizeLoan(verification) {
  const loan = await Loan.create({
    borrower_id: Number(verification.member_id),
    admin_id: verification.admin_id || null,
    borrower_name: verification.member_name,
    amount: Number(verification.amount),
    duration: verification.duration ? Number(verification.duration) : 0,
    interest_rate: verification.interest_rate ? Number(verification.interest_rate) : 0,
    status: 'Active'
  });

  await sequelize.query(
    `UPDATE approved_members SET loanAmount = loanAmount + :amt WHERE id = :id AND admin_id = :admin_id`,
    { replacements: { amt: Number(verification.amount), id: verification.member_id, admin_id: verification.admin_id || '' } }
  );

  await sequelize.query(
    `UPDATE members SET loanAmount = loanAmount + :amt, loanTaken = 1 WHERE id = :id AND admin_id = :admin_id`,
    { replacements: { amt: Number(verification.amount), id: verification.member_id, admin_id: verification.admin_id || '' } }
  );

  return loan;
}

// GET /api/verifications/portal-config
router.get('/portal-config', async (req, res) => {
  try {
    const [rows] = await sequelize.query(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'member_portal_config' LIMIT 1`
    );

    let config = rows.length ? parsePortalConfig(rows[0].setting_value) : null;
    if (!config) {
      config = await savePortalConfig(DEFAULT_PORTAL_CONFIG);
    }
    return ok(res, config);
  } catch (e) {
    console.error('[verifications/portal-config GET]', e.message || e);
    return ok(res, DEFAULT_PORTAL_CONFIG);
  }
});

// POST /api/verifications/portal-config
router.post('/portal-config', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const merged = await savePortalConfig(req.body || {});
    return ok(res, merged);
  } catch (e) {
    console.error('[verifications/portal-config POST]', e);
    return fail(res, 500, 'Failed to save portal config');
  }
});

// POST /api/verifications/create
router.post('/create', async (req, res) => {
  try {
    const {
      member_id, member_name, email, phone, security_pin,
      transaction_type, amount, duration, interest_rate, extra_data
    } = req.body || {};

    if (!member_id || !security_pin || !amount) {
      return fail(res, 400, 'Missing verification fields');
    }

    const pinValid = await verifyMemberPin(member_id, security_pin);
    if (!pinValid) return fail(res, 403, 'Incorrect Security PIN');

    const contact = await getMemberContact(member_id);
    const adminId = contact?.admin_id || null;
    const [result] = await sequelize.query(
      `INSERT INTO transaction_verifications
        (member_id, admin_id, member_name, email, phone, security_pin, transaction_type, amount, duration, interest_rate, extra_data, status)
       VALUES (:member_id, :admin_id, :member_name, :email, :phone, :security_pin, :transaction_type, :amount, :duration, :interest_rate, :extra_data, 'pending')`,
      {
        replacements: {
          member_id: Number(member_id),
          admin_id: adminId,
          member_name: member_name || contact?.full_name || 'Member',
          email: email || contact?.email || '',
          phone: phone || contact?.phone || '',
          security_pin: security_pin ? await bcrypt.hash(String(security_pin), 10) : '',
          transaction_type: transaction_type || 'loan_request',
          amount: Number(amount),
          duration: duration ? Number(duration) : 0,
          interest_rate: interest_rate ? Number(interest_rate) : 0,
          extra_data: extra_data ? JSON.stringify(extra_data) : null
        }
      }
    );

    const [rows] = await sequelize.query(
      `SELECT * FROM transaction_verifications WHERE id = :id LIMIT 1`,
      { replacements: { id: result } }
    );

    return ok(res, verificationDTO(rows[0]));
  } catch (e) {
    console.error('[verifications/create]', e);
    return fail(res, 500, 'Failed to create verification');
  }
});

// GET /api/verifications/pending
router.get('/pending', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const [rows] = await sequelize.query(
      `SELECT * FROM transaction_verifications WHERE status = 'pending' AND admin_id = :adminId ORDER BY created_at ASC`,
      { replacements: { adminId: admin.id } }
    );
    return ok(res, rows.map(verificationDTO));
  } catch (e) {
    console.error('[verifications/pending]', e);
    return fail(res, 500, 'Failed to fetch pending verifications');
  }
});

// POST /api/verifications/approve
router.post('/approve', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { id } = req.body || {};
    if (!id) return fail(res, 400, 'Missing verification id');

    const [rows] = await sequelize.query(
      `SELECT * FROM transaction_verifications WHERE id = :id AND admin_id = :adminId AND status = 'pending' LIMIT 1`,
      { replacements: { id: Number(id), adminId: admin.id } }
    );
    if (!rows.length) return fail(res, 404, 'Pending verification not found');

    const verification = rows[0];
    let loan = null;

    if (verification.transaction_type === 'loan_request' || verification.transaction_type === 'loan_assignment') {
      loan = await finalizeLoan(verification);
    }

    await sequelize.query(
      `UPDATE transaction_verifications SET status = 'approved', resolved_at = NOW() WHERE id = :id AND admin_id = :adminId`,
      { replacements: { id: Number(id), adminId: admin.id } }
    );

    return ok(res, { verification: verificationDTO({ ...verification, status: 'approved' }), loan_id: loan ? String(loan.id) : null });
  } catch (e) {
    console.error('[verifications/approve]', e);
    return fail(res, 500, 'Failed to approve verification');
  }
});

// POST /api/verifications/reject
router.post('/reject', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { id } = req.body || {};
    if (!id) return fail(res, 400, 'Missing verification id');

    const [updated] = await sequelize.query(
      `UPDATE transaction_verifications SET status = 'rejected', resolved_at = NOW() WHERE id = :id AND admin_id = :adminId AND status = 'pending'`,
      { replacements: { id: Number(id), adminId: admin.id } }
    );

    if (!updated.affectedRows) return fail(res, 404, 'Pending verification not found');

    const [rows] = await sequelize.query(
      `SELECT * FROM transaction_verifications WHERE id = :id AND admin_id = :adminId LIMIT 1`,
      { replacements: { id: Number(id), adminId: admin.id } }
    );

    return ok(res, verificationDTO(rows[0]));
  } catch (e) {
    console.error('[verifications/reject]', e);
    return fail(res, 500, 'Failed to reject verification');
  }
});

module.exports = router;
