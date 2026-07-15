const express = require('express');
const multer = require('multer');
const path = require('path');
const { ExpenseClaim, Member, sequelize } = require('../models');
const { requireAdmin, getFallbackAdminId } = require('../adminContext');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads/')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

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

router.post('/create', upload.single('receipt'), async (req, res) => {
  try {
    const { member_id, category, amount } = req.body;
    if (!member_id || !category || !amount) {
      return fail(res, 400, 'Missing expense claim fields');
    }

    // Removed mandatory receipt file check
    const receipt_url = req.file ? `/uploads/${req.file.filename}` : null;

    const member = await Member.findByPk(Number(member_id));
    const approvedRows = await sequelize.query(
      `SELECT id, admin_id FROM approved_members WHERE id = :id LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { id: Number(member_id) } }
    );
    const approved = approvedRows[0] || null;
    if (!member && !approved) return fail(res, 404, 'Member not found');

    const claim = await ExpenseClaim.create({
      member_id: Number(member_id),
      admin_id: member?.admin_id || approved?.admin_id || null,
      category,
      amount: Number(amount),
      receipt_url
    });

    return ok(res, claim);
  } catch (err) {
    return fail(res, 500, err.message);
  }
});

// GET /expenses/member/:id — member fetches their own expense claims
router.get('/member/:id', async (req, res) => {
  try {
    const memberId = Number(req.params.id);
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
