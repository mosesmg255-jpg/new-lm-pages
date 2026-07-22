const express = require('express');
const bcrypt = require('bcryptjs');
const { Loan, Member, sequelize } = require('../models');
const { getAdminFromRequest, requireAdmin, getMemberFromRequest, getFallbackAdminId } = require('../adminContext');
const { loanCreateRules } = require('../validation');

const router = express.Router();

function ok(res, data) { return res.json({ status: 'success', message: 'OK', data }); }
function fail(res, code, message) { return res.status(code).json({ status: 'fail', message }); }

function loanDTO(l) {
  return {
    id: String(l.id),
    borrower_id: String(l.borrower_id),
    admin_id: l.admin_id || null,
    borrower_name: l.borrower_name,
    amount: Number(l.amount),
    duration: l.duration,
    interest_rate: Number(l.interest_rate),
    status: l.status,
    timestamp: l.created_at
  };
}

(async () => {
  const statements = [
    `ALTER TABLE loans ADD COLUMN admin_id VARCHAR(50) DEFAULT NULL`,
    `ALTER TABLE loans ADD INDEX idx_loans_admin (admin_id)`
  ];
  for (const statement of statements) {
    try { await sequelize.query(statement); } catch (_) {}
  }
  try {
    const fallbackAdminId = await getFallbackAdminId(sequelize);
    if (fallbackAdminId) {
      await sequelize.query(
        `UPDATE loans l
         LEFT JOIN approved_members m ON m.id = l.borrower_id
         SET l.admin_id = COALESCE(m.admin_id, :fallbackAdminId)
         WHERE l.admin_id IS NULL OR l.admin_id = ''`,
        { replacements: { fallbackAdminId } }
      );
    }
  } catch (_) {}
})();

// POST /api/loans/create
router.post('/create', loanCreateRules, async (req, res) => {
  try {
    const admin = getAdminFromRequest(req);
    const member = getMemberFromRequest(req);
    if (!admin && !member) {
      return res.status(401).json({ status: 'fail', message: 'Admin or member session required.' });
    }
    const { member_id, amount, duration, interest_rate, borrower_name, pin, admin_override } = req.body || {};
    if (!member_id || !amount) return fail(res, 400, 'Missing loan fields');
    if (admin_override && !admin) return fail(res, 401, 'Admin session expired. Please log in again.');
    if (!admin && !admin_override && member && String(member.id) !== String(member_id)) {
      return fail(res, 403, 'Members can only create loans for themselves');
    }

    let borrowerNameClean = borrower_name;
    let pinValid = false;
    let ownerAdminId = admin?.id || null;

    // Admin/Treasurer direct assignment - skip PIN verification
    if (admin_override) {
      pinValid = true;
    }

    // Check members table first
    const memberRec = await Member.findByPk(member_id);
    if (memberRec) {
      if (!ownerAdminId) ownerAdminId = memberRec.admin_id || null;
      if (!admin_override && admin && memberRec.admin_id && String(memberRec.admin_id) !== admin.id) return fail(res, 403, 'Forbidden');
      if (!pinValid && pin && memberRec.transaction_pin) {
        pinValid = await bcrypt.compare(String(pin), memberRec.transaction_pin);
      }
      if (!borrowerNameClean) borrowerNameClean = memberRec.full_name;
    }

    // Fallback to approved_members
    if (!pinValid && pin) {
      const [approved] = await sequelize.query(
        `SELECT full_name, transaction_pin, security_pin, admin_id FROM approved_members WHERE id = :id LIMIT 1`,
        { replacements: { id: member_id } }
      );
      if (approved.length) {
        if (!ownerAdminId) ownerAdminId = approved[0].admin_id || null;
        if (!admin_override && admin && approved[0].admin_id && String(approved[0].admin_id) !== admin.id) return fail(res, 403, 'Forbidden');
        if (!borrowerNameClean) borrowerNameClean = approved[0].full_name;
        if (approved[0].transaction_pin) {
          pinValid = await bcrypt.compare(String(pin), approved[0].transaction_pin);
        }
        if (!pinValid && approved[0].security_pin) {
            if (String(approved[0].security_pin).startsWith('$2')) {
                pinValid = await bcrypt.compare(String(pin), approved[0].security_pin);
            } else {
                pinValid = String(pin) === String(approved[0].security_pin);
            }
        }
      }
    }

    // If no admin_override and no valid pin, also try to resolve borrower name
    if (!pinValid && !admin_override) {
      if (!borrowerNameClean) {
        const [approved] = await sequelize.query(
          `SELECT full_name, admin_id FROM approved_members WHERE id = :id LIMIT 1`,
          { replacements: { id: member_id } }
        );
        if (approved.length) {
          borrowerNameClean = approved[0].full_name;
          if (!ownerAdminId) ownerAdminId = approved[0].admin_id || null;
        }
      }
      if (!member) {
        return fail(res, 403, 'Missing or incorrect security PIN');
      }
      // Members with valid sessions can create loans without PIN
      if (member) {
        pinValid = true;
        if (!borrowerNameClean) borrowerNameClean = member.full_name;
      }
    }

    const loan = await Loan.create({
      borrower_id: Number(member_id),
      admin_id: ownerAdminId,
      borrower_name: String(borrowerNameClean || 'Member'),
      amount: Number(amount),
      duration: duration ? Number(duration) : 0,
      interest_rate: interest_rate ? Number(interest_rate) : 0,
      status: 'Active'
    });

    return ok(res, loanDTO(loan));
  } catch (e) {
    console.error('[loans/create]', e);
    return fail(res, 500, 'System error creating loan');
  }
});

// GET /api/loans/all
router.get('/all', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const loans = await Loan.findAll({ where: { admin_id: admin.id }, order: [['created_at', 'DESC']] });
    return ok(res, loans.map(loanDTO));
  } catch (e) {
    console.error('[loans/all]', e);
    return fail(res, 500, 'System error fetching loans');
  }
});

// GET /api/loans/member/:memberId
// Member-safe read path used by member.html.
// Requires: admin token OR the member whose ID matches.
router.get('/member/:memberId', async (req, res) => {
  try {
    const memberId = Number(req.params.memberId);
    if (!memberId) return fail(res, 400, 'Invalid member id');

    const admin = getAdminFromRequest(req);
    const member = getMemberFromRequest(req);

    if (!admin && !member) {
      return fail(res, 401, 'Authentication required to view loan data.');
    }
    if (member && !admin && String(member.id) !== String(memberId)) {
      return fail(res, 403, 'You can only view your own loans.');
    }

    const owners = await sequelize.query(
      `SELECT admin_id FROM approved_members WHERE id = :memberId LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { memberId } }
    );
    if (!owners.length || !owners[0].admin_id) return fail(res, 404, 'Approved member not found');

    const loans = await Loan.findAll({
      where: { borrower_id: memberId, admin_id: String(owners[0].admin_id) },
      order: [['created_at', 'DESC']]
    });
    return ok(res, loans.map(loanDTO));
  } catch (e) {
    console.error('[loans/member]', e);
    return fail(res, 500, 'System error fetching member loans');
  }
});

// GET /api/loans/stats
// Returns tile counts for Control Sector dashboard
router.get('/stats', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const [rows] = await sequelize.query(`
      SELECT
        COUNT(*)                                             AS total,
        SUM(status = 'Active')                              AS loan_applications,
        SUM(status = 'Approved')                            AS approved_loans,
        SUM(status = 'Disbursed')                           AS disbursed_loans,
        SUM(status = 'Overdue')                             AS overdue_loans,
        SUM(status = 'Settled')                             AS settled_loans,
        COUNT(DISTINCT borrower_id)                         AS borrowers,
        (SELECT COUNT(*) FROM repayments WHERE admin_id = :adminId) AS repayment_records,
        (SELECT COUNT(*) FROM admins)                       AS users,
        (SELECT COUNT(*) FROM approved_members WHERE admin_id = :adminId) AS approved_members_count
      FROM loans
      WHERE admin_id = :adminId
    `, { replacements: { adminId: admin.id } });
    const s = rows[0] || {};
    return ok(res, {
      loan_applications:  Number(s.loan_applications  || 0),
      approved_loans:     Number(s.approved_loans     || 0),
      disbursed_loans:    Number(s.disbursed_loans    || 0),
      repayment_records:  Number(s.repayment_records  || 0),
      overdue_loans:      Number(s.overdue_loans      || 0),
      borrowers:          Number(s.approved_members_count || 0),
      loan_products:      Number(s.total              || 0),
      users:              Number(s.users              || 0),
      settled_loans:      Number(s.settled_loans      || 0)
    });
  } catch (e) {
    console.error('[loans/stats]', e);
    return fail(res, 500, 'System error fetching loan stats');
  }
});

// POST /api/loans/settle  { id }
router.post('/settle', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { id } = req.body || {};
    if (!id) return fail(res, 400, 'Missing id');
    const loan = await Loan.findOne({ where: { id: Number(id), admin_id: admin.id } });
    if (!loan) return fail(res, 404, 'Loan not found');
    loan.amount = 0;
    loan.status = 'Settled';
    await loan.save();
    return ok(res, loanDTO(loan));
  } catch (e) {
    console.error('[loans/settle]', e);
    return fail(res, 500, 'System error settling loan');
  }
});

// DELETE /api/loans/drop  { id }
router.delete('/drop', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { id } = req.body || {};
    if (!id) return fail(res, 400, 'Missing id');
    const deleted = await Loan.destroy({ where: { id: Number(id), admin_id: admin.id } });
    if (!deleted) return fail(res, 404, 'Loan not found');
    return ok(res, { deleted: true });
  } catch (e) {
    console.error('[loans/drop]', e);
    return fail(res, 500, 'System error dropping loan');
  }
});

// DELETE /api/loans/drop-many  { ids: [] }
router.delete('/drop-many', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { ids } = req.body || {};
    if (!ids || !Array.isArray(ids) || ids.length === 0) return fail(res, 400, 'Missing ids array');
    const { Op } = require('sequelize');
    await Loan.destroy({ where: { id: { [Op.in]: ids.map(Number) }, admin_id: admin.id } });
    return ok(res, { deleted: true, count: ids.length });
  } catch (e) {
    console.error('[loans/drop-many]', e);
    return fail(res, 500, 'System error dropping loans');
  }
});

module.exports = router;
