const express = require('express');
const { sequelize } = require('../models');
const { requireAdmin, getFallbackAdminId } = require('../adminContext');

const router = express.Router();

function ok(res, data) { return res.json({ status: 'success', message: 'OK', data }); }
function fail(res, code, message) { return res.status(code).json({ status: 'fail', message }); }

(async () => {
  const statements = [
    `ALTER TABLE system_logs ADD COLUMN admin_id VARCHAR(50) DEFAULT NULL`,
    `ALTER TABLE system_logs ADD INDEX idx_system_logs_admin (admin_id)`
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
      `SELECT id, message, timestamp_str FROM system_logs WHERE admin_id = :adminId ORDER BY created_at DESC LIMIT 500`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: admin.id } }
    );
    return ok(res, rows);
  } catch (e) {
    console.error('[logs/all]', e);
    return fail(res, 500, 'System error fetching logs');
  }
});

// DELETE /api/logs/delete
// body: { ids: [...] }  - delete only selected
router.delete('/delete', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { ids } = req.body || {};
    if (!ids || !Array.isArray(ids) || ids.length === 0) return fail(res, 400, 'Missing ids');

    const placeholders = ids.map(() => '?').join(',');
    await sequelize.query(
      `DELETE FROM system_logs WHERE admin_id = ? AND id IN (${placeholders})`,
      { type: sequelize.QueryTypes.DELETE, replacements: [admin.id, ...ids] }
    );
    return ok(res, { deleted: ids.length });
  } catch (e) {
    console.error('[logs/delete]', e);
    return fail(res, 500, 'System error deleting logs');
  }
});

// DELETE /api/logs/keep
// body: { ids: [...] }  - keep only selected, delete all others
router.delete('/keep', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { ids } = req.body || {};
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      // Keep nothing = delete all
      await sequelize.query(`DELETE FROM system_logs WHERE admin_id = :adminId`, { type: sequelize.QueryTypes.DELETE, replacements: { adminId: admin.id } });
      return ok(res, { kept: 0 });
    }
    const placeholders = ids.map(() => '?').join(',');
    await sequelize.query(
      `DELETE FROM system_logs WHERE admin_id = ? AND id NOT IN (${placeholders})`,
      { type: sequelize.QueryTypes.DELETE, replacements: [admin.id, ...ids] }
    );
    return ok(res, { kept: ids.length });
  } catch (e) {
    console.error('[logs/keep]', e);
    return fail(res, 500, 'System error keeping logs');
  }
});

module.exports = router;
