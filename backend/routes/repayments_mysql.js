const express = require('express');
const bcrypt = require('bcryptjs');
const { Repayment, Loan, Member, sequelize } = require('../models');
const { requireAdmin, getFallbackAdminId } = require('../adminContext');

const router = express.Router();

function ok(res, data) { return res.json({ status: 'success', message: 'OK', data }); }
function fail(res, code, message) { return res.status(code).json({ status: 'fail', message }); }

(async () => {
  const statements = [
    `ALTER TABLE repayments ADD COLUMN admin_id VARCHAR(50) DEFAULT NULL`,
    `ALTER TABLE repayments ADD INDEX idx_repayments_admin (admin_id)`
  ];
  for (const statement of statements) {
    try { await sequelize.query(statement); } catch (_) {}
  }
  try {
    const fallbackAdminId = await getFallbackAdminId(sequelize);
    if (fallbackAdminId) {
      await sequelize.query(
        `UPDATE repayments r
         LEFT JOIN loans l ON l.id = r.loan_id
         LEFT JOIN approved_members m ON m.id = r.member_id
         SET r.admin_id = COALESCE(l.admin_id, m.admin_id, :fallbackAdminId)
         WHERE r.admin_id IS NULL OR r.admin_id = ''`,
        { replacements: { fallbackAdminId } }
      );
    }
  } catch (_) {}
})();

// POST /api/repayments/create
router.post('/create', async (req, res) => {
  try {
    const { loan_id, member_id, amount, payment_method, pin } = req.body || {};
    if (!loan_id || !member_id || !amount || !pin) return fail(res, 400, 'Missing repayment fields or security PIN');

    let pinValid = false;

    // Check members table first
    const member = await Member.findByPk(member_id);
    if (member && member.transaction_pin) {
      pinValid = await bcrypt.compare(String(pin), member.transaction_pin);
    }

    // Fallback to approved_members
    if (!pinValid) {
      const [approved] = await sequelize.query(
        `SELECT password FROM approved_members WHERE id = :id LIMIT 1`,
        { replacements: { id: member_id } }
      );
      if (approved.length && approved[0].password) {
        pinValid = await bcrypt.compare(String(pin), approved[0].password);
      }
    }

    if (!pinValid) {
      return fail(res, 403, 'Invalid member or incorrect security PIN');
    }

    const loan = await Loan.findByPk(Number(loan_id));
    if (!loan) return fail(res, 404, 'Loan not found');

    const repayment = await Repayment.create({
      loan_id: Number(loan_id),
      member_id: Number(member_id),
      admin_id: loan.admin_id || null,
      member_name: loan.borrower_name,
      amount: Number(amount),
      payment_method: payment_method ? String(payment_method) : ''
    });

    const [row] = await Repayment.findAll({
      where: { loan_id: Number(loan_id) },
      attributes: [[Repayment.sequelize.fn('SUM', Repayment.sequelize.col('amount')), 'totalPaid']]
    });

    const totalPaid = row?.get('totalPaid') ? Number(row.get('totalPaid')) : 0;
    if (totalPaid >= Number(loan.amount) && loan.status !== 'Settled') {
      loan.status = 'Settled';
      await loan.save();
    }

    return ok(res, {
      id: String(repayment.id),
      loan: { id: String(loan.id), status: loan.status }
    });
  } catch (e) {
    console.error('[repayments/create]', e);
    return fail(res, 500, 'System error creating repayment');
  }
});

// GET /api/repayments/member/:memberId
// Member-safe read path used by member.html. Ownership is resolved from approved_members.
router.get('/member/:memberId', async (req, res) => {
  try {
    const memberId = Number(req.params.memberId);
    if (!memberId) return fail(res, 400, 'Invalid member id');

    const owners = await sequelize.query(
      `SELECT admin_id FROM approved_members WHERE id = :memberId LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { memberId } }
    );
    if (!owners.length || !owners[0].admin_id) return fail(res, 404, 'Approved member not found');

    const repayments = await Repayment.findAll({
      where: { member_id: memberId, admin_id: String(owners[0].admin_id) },
      order: [['created_at', 'DESC']]
    });
    return ok(res, repayments.map(r => ({
      id: String(r.id),
      loan_id: String(r.loan_id),
      member_id: String(r.member_id),
      admin_id: r.admin_id || null,
      member_name: r.member_name,
      amount: Number(r.amount),
      payment_method: r.payment_method,
      created_at: r.created_at
    })));
  } catch (e) {
    console.error('[repayments/member]', e);
    return fail(res, 500, 'System error fetching member repayments');
  }
});

// GET /api/repayments/all
// Returns repayments joined with loan/member savings data for Repayments Ledger
router.get('/all', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    // Fetch all repayments
    const repayments = await Repayment.findAll({ where: { admin_id: admin.id }, order: [['created_at', 'DESC']] });

    // Fetch approved_members balances for policy checks
    const approvedRows = await sequelize.query(
      `SELECT id, full_name, email, loanAmount, savingsAmount FROM approved_members WHERE admin_id = :adminId ORDER BY full_name ASC`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: admin.id } }
    );

    // Build repayment DTOs
    const repData = repayments.map(r => ({
      id: String(r.id),
      loan_id: String(r.loan_id),
      member_id: String(r.member_id),
      admin_id: r.admin_id || null,
      member_name: r.member_name,
      amount: Number(r.amount),
      payment_method: r.payment_method,
      created_at: r.created_at
    }));

    // Build member balance ledger for the Repayments Ledger section
    const memberLedger = approvedRows.map(m => ({
      id: String(m.id),
      full_name: m.full_name,
      email: m.email,
      loanAmount: Number(m.loanAmount || 0),
      savingsAmount: Number(m.savingsAmount || 0),
      maxPolicyCap: Number(m.savingsAmount || 0) * 3
    }));

    return ok(res, { repayments: repData, memberLedger });
  } catch (e) {
    console.error('[repayments/all]', e);
    return fail(res, 500, 'System error fetching repayments');
  }
});

module.exports = router;
