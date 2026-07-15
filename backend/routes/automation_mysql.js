const express = require('express');
const { sequelize } = require('../models');
const { requireAdmin, getFallbackAdminId } = require('../adminContext');

const router = express.Router();

function ok(res, data) { return res.json({ status: 'success', message: 'OK', data }); }
function fail(res, code, message) { return res.status(code).json({ status: 'fail', message }); }

(async () => {
  const statements = [
    `ALTER TABLE automation_admins ADD COLUMN admin_id VARCHAR(50) DEFAULT NULL`,
    `ALTER TABLE automation_admins ADD INDEX idx_automation_admins_admin (admin_id)`,
    `ALTER TABLE scheduled_meetings ADD COLUMN admin_id VARCHAR(50) DEFAULT NULL`,
    `ALTER TABLE scheduled_meetings ADD INDEX idx_scheduled_meetings_admin (admin_id)`
  ];
  for (const statement of statements) {
    try { await sequelize.query(statement); } catch (_) {}
  }
  try {
    const emailIndexes = await sequelize.query(
      `SELECT INDEX_NAME
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'automation_admins'
         AND COLUMN_NAME = 'email'
         AND NON_UNIQUE = 0
         AND INDEX_NAME <> 'PRIMARY'
       GROUP BY INDEX_NAME`,
      { type: sequelize.QueryTypes.SELECT }
    );
    for (const idx of emailIndexes) {
      try { await sequelize.query(`ALTER TABLE automation_admins DROP INDEX \`${idx.INDEX_NAME}\``); } catch (_) {}
    }
    try { await sequelize.query(`ALTER TABLE automation_admins ADD UNIQUE KEY uniq_automation_admins_admin_email (admin_id, email)`); } catch (_) {}
    const fallbackAdminId = await getFallbackAdminId(sequelize);
    if (fallbackAdminId) {
      await sequelize.query(`UPDATE automation_admins SET admin_id = :adminId WHERE admin_id IS NULL OR admin_id = ''`, { replacements: { adminId: fallbackAdminId } });
      await sequelize.query(`UPDATE scheduled_meetings SET admin_id = :adminId WHERE admin_id IS NULL OR admin_id = ''`, { replacements: { adminId: fallbackAdminId } });
    }
  } catch (_) {}
})();

// GET /api/automation/admins
router.get('/admins', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const rows = await sequelize.query(
      `SELECT id, email, registered_at FROM automation_admins WHERE admin_id = :adminId ORDER BY registered_at ASC`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: admin.id } }
    );
    return ok(res, rows);
  } catch (e) {
    console.error('[automation/admins]', e);
    return fail(res, 500, 'Error fetching admins');
  }
});

// POST /api/automation/admins/add
// body: { email }
router.post('/admins/add', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { email } = req.body || {};
    if (!email) return fail(res, 400, 'Missing email');

    await sequelize.query(
      `INSERT IGNORE INTO automation_admins (email, admin_id) VALUES (:email, :admin_id)`,
      { type: sequelize.QueryTypes.INSERT, replacements: { email: String(email).trim(), admin_id: admin.id } }
    );
    return ok(res, { email });
  } catch (e) {
    console.error('[automation/admins/add]', e);
    return fail(res, 500, 'Error adding admin');
  }
});

// DELETE /api/automation/admins/delete
// body: { email }
router.delete('/admins/delete', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { email } = req.body || {};
    if (!email) return fail(res, 400, 'Missing email');

    await sequelize.query(
      `DELETE FROM automation_admins WHERE email = :email AND admin_id = :adminId`,
      { type: sequelize.QueryTypes.DELETE, replacements: { email: String(email), adminId: admin.id } }
    );
    return ok(res, { deleted: true });
  } catch (e) {
    console.error('[automation/admins/delete]', e);
    return fail(res, 500, 'Error deleting admin');
  }
});

// GET /api/automation/meetings/member/:memberId
// Member-safe meeting feed scoped to the member's approving administrator.
router.get('/meetings/member/:memberId', async (req, res) => {
  try {
    const memberId = Number(req.params.memberId);
    if (!memberId) return fail(res, 400, 'Invalid member id');
    const owners = await sequelize.query(
      `SELECT admin_id FROM approved_members WHERE id = :memberId LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { memberId } }
    );
    if (!owners.length || !owners[0].admin_id) return fail(res, 404, 'Approved member not found');
    const rows = await sequelize.query(
      `SELECT id, title, meeting_date, meeting_time, location, platform, target_group, subsidiary_slug, created_at
       FROM scheduled_meetings WHERE admin_id = :adminId ORDER BY meeting_date DESC, meeting_time DESC`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: String(owners[0].admin_id) } }
    );
    return ok(res, rows);
  } catch (e) {
    console.error('[automation/meetings/member]', e);
    return fail(res, 500, 'Error fetching member meetings');
  }
});

// GET /api/automation/meetings
router.get('/meetings', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const rows = await sequelize.query(
      `SELECT id, title, meeting_date, meeting_time, location, platform, target_group, subsidiary_slug, created_at
       FROM scheduled_meetings WHERE admin_id = :adminId ORDER BY created_at DESC`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: admin.id } }
    );
    return ok(res, rows);
  } catch (e) {
    console.error('[automation/meetings]', e);
    return fail(res, 500, 'Error fetching meetings');
  }
});

// POST /api/automation/meetings/create
// body: { title, meeting_date, meeting_time, location, platform, target_group, subsidiary_slug }
router.post('/meetings/create', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { title, meeting_date, meeting_time, location, platform, target_group, subsidiary_slug } = req.body || {};
    if (!title || !meeting_date || !meeting_time) return fail(res, 400, 'Missing required meeting fields');

    const [result] = await sequelize.query(
      `INSERT INTO scheduled_meetings
         (admin_id, title, meeting_date, meeting_time, location, platform, target_group, subsidiary_slug)
       VALUES (:admin_id, :title, :meeting_date, :meeting_time, :location, :platform, :target_group, :subsidiary_slug)`,
      {
        type: sequelize.QueryTypes.INSERT,
        replacements: {
          admin_id: admin.id,
          title: String(title),
          meeting_date: String(meeting_date),
          meeting_time: String(meeting_time),
          location: String(location || ''),
          platform: String(platform || 'Email Engine'),
          target_group: String(target_group || 'all'),
          subsidiary_slug: String(subsidiary_slug || 'eldoret_main')
        }
      }
    );

    return ok(res, { id: result, title });
  } catch (e) {
    console.error('[automation/meetings/create]', e);
    return fail(res, 500, 'Error creating meeting');
  }
});

module.exports = router;
