const express = require('express');
const { sequelize } = require('../models');
const { requireAdmin, getFallbackAdminId, getMemberFromRequest } = require('../adminContext');

const router = express.Router();

function ok(res, data) { return res.json({ status: 'success', message: 'OK', data }); }
function fail(res, code, message) { return res.status(code).json({ status: 'fail', message }); }

(async () => {
  const statements = [
    `ALTER TABLE system_logs ADD COLUMN admin_id VARCHAR(50) DEFAULT NULL`,
    `ALTER TABLE system_logs ADD INDEX idx_system_logs_admin (admin_id)`,
    `ALTER TABLE system_logs ADD COLUMN deleted_at DATETIME DEFAULT NULL`
  ];
  for (const statement of statements) {
    try { await sequelize.query(statement); } catch (_) {}
  }
  try {
    const fallbackAdminId = await getFallbackAdminId(sequelize);
    if (fallbackAdminId) {
      await sequelize.query(
        `UPDATE system_logs SET admin_id = :adminId WHERE admin_id IS NULL OR admin_id = ''`,
        { replacements: { adminId: fallbackAdminId } }
      );
    }
  } catch (_) {}
})();

// POST /api/logs/create
// body: { id, message, timestamp_str }
router.post('/create', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { id, message, timestamp_str } = req.body || {};
    if (!id || !message) return fail(res, 400, 'Missing log fields');

    await sequelize.query(
      `INSERT IGNORE INTO system_logs (id, message, timestamp_str, admin_id, created_at)
       VALUES (:id, :message, :timestamp_str, :admin_id, NOW())`,
      {
        type: sequelize.QueryTypes.INSERT,
        replacements: {
          id: String(id),
          message: String(message),
          timestamp_str: String(timestamp_str || new Date().toLocaleString()),
          admin_id: admin.id
        }
      }
    );

    return ok(res, { saved: true });
  } catch (e) {
    console.error('[logs/create]', e);
    return fail(res, 500, 'System error saving log');
  }
});

// GET /api/logs/member/:id
// Gets logs for the admin that owns this member
router.get('/member/:id', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const memberId = Number(req.params.id);
    const approvedRows = await sequelize.query(
      `SELECT admin_id FROM approved_members WHERE id = :id LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { id: memberId } }
    );
    if (!approvedRows.length || !approvedRows[0].admin_id) {
       return ok(res, []);
    }
    const adminId = approvedRows[0].admin_id;
    const logs = await sequelize.query(
      `SELECT * FROM system_logs WHERE admin_id = :adminId ORDER BY created_at DESC LIMIT 50`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId } }
    );
    return ok(res, logs);
  } catch (e) {
    return fail(res, 500, 'Error fetching member logs');
  }
});

// GET /api/logs/all
router.get('/all', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const rows = await sequelize.query(
      `SELECT id, message, timestamp_str FROM system_logs WHERE admin_id = :adminId AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 500`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: admin.id } }
    );
    return ok(res, rows);
  } catch (e) {
    console.error('[logs/all]', e);
    return fail(res, 500, 'System error fetching logs');
  }
});

// DELETE /api/logs/delete
// body: { ids: [...] }  - soft-delete selected
router.delete('/delete', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return fail(res, 400, 'No IDs provided');

    const placeholders = ids.map(() => '?').join(',');
    await sequelize.query(
      `UPDATE system_logs SET deleted_at = NOW() WHERE admin_id = ? AND id IN (${placeholders}) AND deleted_at IS NULL`,
      { type: sequelize.QueryTypes.UPDATE, replacements: [admin.id, ...ids] }
    );
    return ok(res, { deleted: ids.length });
  } catch (e) {
    console.error('[logs/delete]', e);
    return fail(res, 500, 'System error deleting logs');
  }
});

// DELETE /api/logs/keep
// body: { ids: [...] }  - soft-delete all except selected
router.delete('/keep', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return fail(res, 400, 'No IDs provided');
    const placeholders = ids.map(() => '?').join(',');
    await sequelize.query(
      `UPDATE system_logs SET deleted_at = NOW() WHERE admin_id = ? AND id NOT IN (${placeholders}) AND deleted_at IS NULL`,
      { type: sequelize.QueryTypes.UPDATE, replacements: [admin.id, ...ids] }
    );
    return ok(res, { kept: ids.length });
  } catch (e) {
    console.error('[logs/keep]', e);
    return fail(res, 500, 'System error keeping logs');
  }
});

// GET /api/logs/member-activity/:id
// Member-safe route: accepts a MEMBER token.
// Returns the admin's logs for the member's account (used by notifications feed).
router.get('/member-activity/:id', async (req, res) => {
  try {
    const member = getMemberFromRequest(req);
    if (!member) return fail(res, 401, 'Member session required.');

    const memberId = Number(req.params.id);
    // Ensure member is only fetching their own logs
    if (String(member.id) !== String(memberId)) {
      return fail(res, 403, 'You can only view your own activity logs.');
    }

    const approvedRows = await sequelize.query(
      `SELECT admin_id FROM approved_members WHERE id = :id LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { id: memberId } }
    );
    if (!approvedRows.length || !approvedRows[0].admin_id) {
      return ok(res, []);
    }
    const adminId = approvedRows[0].admin_id;
    const logs = await sequelize.query(
      `SELECT id, message, timestamp_str, created_at FROM system_logs WHERE admin_id = :adminId ORDER BY created_at DESC LIMIT 50`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId } }
    );
    return ok(res, logs);
  } catch (e) {
    console.error('[logs/member-activity]', e);
    return fail(res, 500, 'Error fetching member activity logs');
  }
});

// GET /api/logs/deleted
// List soft-deleted notifications for this admin
router.get('/deleted', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const rows = await sequelize.query(
      `SELECT id, message, timestamp_str, deleted_at FROM system_logs WHERE admin_id = :adminId AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 500`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: admin.id } }
    );
    return ok(res, rows);
  } catch (e) {
    console.error('[logs/deleted]', e);
    return fail(res, 500, 'System error fetching deleted logs');
  }
});

// POST /api/logs/restore
// body: { ids: [...] }  - restore soft-deleted notifications (empty array = restore all)
router.post('/restore', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { ids } = req.body || {};

    let restored;
    if (Array.isArray(ids) && ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      const [result] = await sequelize.query(
        `UPDATE system_logs SET deleted_at = NULL WHERE admin_id = ? AND id IN (${placeholders}) AND deleted_at IS NOT NULL`,
        { type: sequelize.QueryTypes.UPDATE, replacements: [admin.id, ...ids] }
      );
      restored = result.affectedRows || 0;
    } else {
      const [result] = await sequelize.query(
        `UPDATE system_logs SET deleted_at = NULL WHERE admin_id = ? AND deleted_at IS NOT NULL`,
        { type: sequelize.QueryTypes.UPDATE, replacements: [admin.id] }
      );
      restored = result.affectedRows || 0;
    }

    return ok(res, { restored });
  } catch (e) {
    console.error('[logs/restore]', e);
    return fail(res, 500, 'System error restoring logs');
  }
});

module.exports = router;
