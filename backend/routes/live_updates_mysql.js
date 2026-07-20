const express = require('express');
const { sequelize } = require('../models');
const { requireAdmin, getMemberFromRequest } = require('../adminContext');

const router = express.Router();

function ok(res, data) { return res.json({ status: 'success', message: 'OK', data }); }
function fail(res, code, message) { return res.status(code).json({ status: 'fail', message }); }

// Auto-create live_system_updates table
(async () => {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS live_system_updates (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        admin_id VARCHAR(50) NOT NULL,
        member_id INT UNSIGNED DEFAULT NULL,
        member_name VARCHAR(150) DEFAULT NULL,
        event_type VARCHAR(100) NOT NULL,
        event_body TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_lsu_admin (admin_id),
        INDEX idx_lsu_member (member_id),
        INDEX idx_lsu_type (event_type)
      ) ENGINE=InnoDB
    `);
    console.log('[live-updates] Table ready.');
  } catch (e) {
    // ignore if table already exists
  }
})();

/**
 * POST /api/live-updates/log
 * Member logs an action (meeting join, page navigation, payment, etc.)
 * Body: { event_type, event_body }
 */
router.post('/log', async (req, res) => {
  try {
    const member = getMemberFromRequest(req);
    if (!member) return fail(res, 401, 'Member session required.');

    const { event_type, event_body } = req.body || {};
    if (!event_type || !event_body) return fail(res, 400, 'event_type and event_body are required.');

    // Get admin_id for this member
    const approvedRows = await sequelize.query(
      `SELECT admin_id FROM approved_members WHERE id = :id LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { id: Number(member.id) } }
    );
    if (!approvedRows.length || !approvedRows[0].admin_id) {
      return fail(res, 404, 'Member not found in approved list.');
    }
    const adminId = approvedRows[0].admin_id;

    await sequelize.query(
      `INSERT INTO live_system_updates (admin_id, member_id, member_name, event_type, event_body)
       VALUES (:adminId, :memberId, :memberName, :eventType, :eventBody)`,
      {
        type: sequelize.QueryTypes.INSERT,
        replacements: {
          adminId,
          memberId: Number(member.id),
          memberName: String(member.full_name || member.name || 'Unknown'),
          eventType: String(event_type).trim().substring(0, 100),
          eventBody: String(event_body).trim()
        }
      }
    );

    return ok(res, { logged: true });
  } catch (e) {
    console.error('[live-updates/log]', e);
    return fail(res, 500, 'Error logging event.');
  }
});

/**
 * GET /api/live-updates/all
 * Admin reads all live system updates for their account.
 */
router.get('/all', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const rows = await sequelize.query(
      `SELECT id, member_id, member_name, event_type, event_body, created_at
       FROM live_system_updates
       WHERE admin_id = :adminId
       ORDER BY created_at DESC
       LIMIT 500`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: admin.id } }
    );

    return ok(res, rows);
  } catch (e) {
    console.error('[live-updates/all]', e);
    return fail(res, 500, 'Error fetching live updates.');
  }
});

/**
 * GET /api/live-updates/member
 * Member reads their own live system updates.
 */
router.get('/member', async (req, res) => {
  try {
    const member = getMemberFromRequest(req);
    if (!member) return fail(res, 401, 'Member session required.');

    const rows = await sequelize.query(
      `SELECT id, event_type, event_body, created_at
       FROM live_system_updates
       WHERE member_id = :memberId
       ORDER BY created_at DESC
       LIMIT 200`,
      { type: sequelize.QueryTypes.SELECT, replacements: { memberId: Number(member.id) } }
    );

    return ok(res, rows);
  } catch (e) {
    console.error('[live-updates/member]', e);
    return fail(res, 500, 'Error fetching member live updates.');
  }
});

/**
 * DELETE /api/live-updates/:id
 * Admin deletes a specific live update entry.
 */
router.delete('/:id', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const updateId = Number(req.params.id);
    await sequelize.query(
      `DELETE FROM live_system_updates WHERE id = :id AND admin_id = :adminId`,
      { type: sequelize.QueryTypes.DELETE, replacements: { id: updateId, adminId: admin.id } }
    );
    return ok(res, { deleted: true });
  } catch (e) {
    console.error('[live-updates/delete]', e);
    return fail(res, 500, 'Error deleting update.');
  }
});

module.exports = router;
