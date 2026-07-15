const express = require('express');
const multer = require('multer');
const path = require('path');
const { Contribution, Member, sequelize } = require('../models');
const { requireAdmin, getFallbackAdminId } = require('../adminContext');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads/')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

function ok(res, data) { return res.json({ status: 'success', message: 'OK', data }); }
function fail(res, code, message) { return res.status(code).json({ status: 'fail', message }); }

(async () => {
  const statements = [
    `ALTER TABLE contributions ADD COLUMN admin_id VARCHAR(50) DEFAULT NULL`,
    `ALTER TABLE contributions ADD INDEX idx_contributions_admin (admin_id)`
  ];
  for (const statement of statements) {
    try { await sequelize.query(statement); } catch (_) {}
  }
  try {
    const fallbackAdminId = await getFallbackAdminId(sequelize);
    if (fallbackAdminId) {
      await sequelize.query(
        `UPDATE contributions c
         LEFT JOIN approved_members m ON m.id = c.member_id
         SET c.admin_id = COALESCE(m.admin_id, :fallbackAdminId)
         WHERE c.admin_id IS NULL OR c.admin_id = ''`,
        { replacements: { fallbackAdminId } }
      );
    }
  } catch (_) {}
})();

router.post('/create', upload.single('receipt'), async (req, res) => {
  try {
    const { member_id, amount, payment_method } = req.body;
    if (!member_id || !amount || !payment_method) {
      return fail(res, 400, 'Missing contribution fields');
    }

    const member = await Member.findByPk(Number(member_id));
    const approvedRows = await sequelize.query(
      `SELECT id, full_name, admin_id FROM approved_members WHERE id = :id LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { id: Number(member_id) } }
    );
    const approved = approvedRows[0] || null;
    if (!member && !approved) return fail(res, 404, 'Member not found');

  // Remove mandatory file check — receipt is optional
  const receipt_url = req.file ? `/uploads/${req.file.filename}` : null;

    const contribution = await Contribution.create({
      member_id: Number(member_id),
      admin_id: member?.admin_id || approved?.admin_id || null,
      member_name: member?.full_name || member?.name || approved?.full_name || 'Member',
      amount: Number(amount),
      payment_method,
      receipt_url
    });

    return ok(res, contribution);
  } catch (err) {
    return fail(res, 500, err.message);
  }
});

// GET /contributions/member/:id — member fetches their own history
router.get('/member/:id', async (req, res) => {
  try {
    const memberId = Number(req.params.id);
    const contributions = await Contribution.findAll({
      where: { member_id: memberId },
      order: [['created_at', 'DESC']]
    });
    return ok(res, contributions);
  } catch (err) {
    return fail(res, 500, err.message);
  }
});

router.get('/all', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const contributions = await Contribution.findAll({ where: { admin_id: admin.id }, order: [['created_at', 'DESC']] });
    return ok(res, contributions);
  } catch (err) {
    return fail(res, 500, err.message);
  }
});

router.post('/reconcile', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { id, action } = req.body;
    if (!id || !['approve', 'reject'].includes(action)) {
      return fail(res, 400, 'Invalid request parameters');
    }

    const contribution = await Contribution.findOne({ where: { id, admin_id: admin.id } });
    if (!contribution) return fail(res, 404, 'Contribution not found');

    contribution.status = action === 'approve' ? 'Reconciled' : 'Rejected';
    await contribution.save();

    return ok(res, contribution);
  } catch (err) {
    return fail(res, 500, err.message);
  }
});

module.exports = router;
