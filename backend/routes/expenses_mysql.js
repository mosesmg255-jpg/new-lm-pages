const express = require('express');
const path = require('path');
const { ExpenseClaim, Member, sequelize } = require('../models');
const { getAdminFromRequest, requireAdmin, getFallbackAdminId, getMemberFromRequest } = require('../adminContext');
const { expenseCreateRules } = require('../validation');
const { upload, handleUploadError } = require('../uploadValidation');

const router = express.Router();

function ok(res, data) { return res.json({ status: 'success', message: 'OK', data }); }
function fail(res, code, message) { return res.status(code).json({ status: 'fail', message }); }

(async () => {
  const statements = [
    `ALTER TABLE expense_claims MODIFY COLUMN receipt_url VARCHAR(255) NULL`,
    `ALTER TABLE expense_claims ADD COLUMN admin_id VARCHAR(50) DEFAULT NULL`,
    `ALTER TABLE expense_claims ADD INDEX idx_expense_claims_admin (admin_id)`
  ];
  for (const statement of statements) {
    try { await sequelize.query(statement); } catch (_) {}
  }
  try {
    const fallbackAdminId = await getFallbackAdminId(sequelize);
    if (fallbackAdminId) {
      await sequelize.query(
        `UPDATE expense_claims e
         LEFT JOIN approved_members m ON m.id = e.member_id
         SET e.admin_id = COALESCE(m.admin_id, :fallbackAdminId)
         WHERE e.admin_id IS NULL OR e.admin_id = ''`,
        { replacements: { fallbackAdminId } }
      );
    }
  } catch (_) {}
})();

router.post('/create', expenseCreateRules, upload.single('receipt'), handleUploadError, async (req, res) => {
  try {
    const admin = getAdminFromRequest(req);
    const member = getMemberFromRequest(req);
    if (!admin && !member) {
      return res.status(401).json({ status: 'fail', message: 'Admin or member session required.' });
    }
    const { member_id, category, amount } = req.body;
    if (!member_id || !category || !amount) {
      return fail(res, 400, 'Missing expense claim fields');
    }
    if (member && String(member.id) !== String(member_id)) {
      return fail(res, 403, 'Members can only submit expenses for themselves');
    }

    // Removed mandatory receipt file check
    const receipt_url = req.file ? `/uploads/${req.file.filename}` : null;

    const memberRecord = await Member.findByPk(Number(member_id));
    const approvedRows = await sequelize.query(
      `SELECT id, admin_id FROM approved_members WHERE id = :id LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { id: Number(member_id) } }
    );
    const approved = approvedRows[0] || null;
    if (!memberRecord && !approved) return fail(res, 404, 'Member not found');

    const claim = await ExpenseClaim.create({
      member_id: Number(member_id),
      admin_id: admin?.id || approved?.admin_id || null,
      category,
      amount: Number(amount),
      receipt_url
    });

    return ok(res, claim);
  } catch (err) {
    return fail(res, 500, 'Server error processing expense claim');
  }
});

// GET /expenses/member/:id — member fetches their own expense claims
// Requires: admin token OR the member whose ID matches.
router.get('/member/:id', async (req, res) => {
  try {
    const memberId = Number(req.params.id);

    const admin = getAdminFromRequest(req);
    const member = getMemberFromRequest(req);

    if (!admin && !member) {
      return fail(res, 401, 'Authentication required to view expense data.');
    }
    if (member && !admin && String(member.id) !== String(memberId)) {
      return fail(res, 403, 'You can only view your own expense claims.');
    }

    const claims = await ExpenseClaim.findAll({
      where: { member_id: memberId },
      order: [['created_at', 'DESC']]
    });
    return ok(res, claims);
  } catch (err) {
    return fail(res, 500, err.message);
  }
});

router.get('/all', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const claims = await ExpenseClaim.findAll({ where: { admin_id: admin.id }, order: [['created_at', 'DESC']] });
    // Also include member info if needed, but we don't have associations set up in index.js yet
    return ok(res, claims);
  } catch (err) {
    return fail(res, 500, err.message);
  }
});

router.post('/authorize', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { id, action } = req.body;
    if (!id || !['approve', 'reject'].includes(action)) {
      return fail(res, 400, 'Invalid request parameters');
    }

    const claim = await ExpenseClaim.findOne({ where: { id, admin_id: admin.id } });
    if (!claim) return fail(res, 404, 'Expense claim not found');

    claim.status = action === 'approve' ? 'Authorized' : 'Rejected';
    await claim.save();

    return ok(res, claim);
  } catch (err) {
    return fail(res, 500, err.message);
  }
});

module.exports = router;
