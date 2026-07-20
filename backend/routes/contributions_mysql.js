const express = require('express');
const path = require('path');
const { Contribution, Member, sequelize } = require('../models');
const { getAdminFromRequest, requireAdmin, getFallbackAdminId, getMemberFromRequest } = require('../adminContext');
const { contributionCreateRules } = require('../validation');
const { upload, handleUploadError } = require('../uploadValidation');

const router = express.Router();

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

router.post('/create', contributionCreateRules, upload.single('receipt'), handleUploadError, async (req, res) => {
  try {
    const admin = getAdminFromRequest(req);
    const member = getMemberFromRequest(req);
    if (!admin && !member) {
      return res.status(401).json({ status: 'fail', message: 'Admin or member session required.' });
    }
    const { member_id, amount, payment_method } = req.body;
    if (!member_id || !amount) {
      return fail(res, 400, 'Missing required fields (member_id, amount)');
    }
    if (member && String(member.id) !== String(member_id)) {
      return fail(res, 403, 'Members can only submit contributions for themselves');
    }

    const memberRecord = await Member.findByPk(Number(member_id));
    const approvedRows = await sequelize.query(
      `SELECT id, full_name, admin_id FROM approved_members WHERE id = :id LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { id: Number(member_id) } }
    );
    const approved = approvedRows[0] || null;
    if (!memberRecord && !approved) return fail(res, 404, 'Member not found');

  // Remove mandatory file check — receipt is optional
  const receipt_url = req.file ? `/uploads/${req.file.filename}` : null;

    const contribution = await Contribution.create({
      member_id: Number(member_id),
      admin_id: admin?.id || approved?.admin_id || null,
      member_name: memberRecord?.full_name || memberRecord?.name || approved?.full_name || 'Member',
      amount: Number(amount),
      payment_method: payment_method || 'Not specified',
      receipt_url
    });

    return ok(res, contribution);
  } catch (err) {
    return fail(res, 500, 'Server error processing contribution');
  }
});

// GET /contributions/member/:id — member fetches their own history
// Requires: admin token OR the member whose ID matches.
router.get('/member/:id', async (req, res) => {
  try {
    const memberId = Number(req.params.id);

    const admin = getAdminFromRequest(req);
    const member = getMemberFromRequest(req);

    if (!admin && !member) {
      return fail(res, 401, 'Authentication required to view contribution data.');
    }
    if (member && !admin && String(member.id) !== String(memberId)) {
      return fail(res, 403, 'You can only view your own contributions.');
    }

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
