const express = require('express');
const { sequelize } = require('../models');
const { requireAdmin, getMemberFromRequest, getAdminFromRequest } = require('../adminContext');

const router = express.Router();

function ok(res, data) { return res.json({ status: 'success', message: 'OK', data }); }
function fail(res, code, message) { return res.status(code).json({ status: 'fail', message }); }

// Auto-create member_messages table
(async () => {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS member_messages (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        admin_id VARCHAR(50) NOT NULL,
        member_id INT UNSIGNED NOT NULL,
        sender_role ENUM('admin','member') NOT NULL DEFAULT 'member',
        subject VARCHAR(255) NOT NULL DEFAULT '',
        body TEXT NOT NULL,
        is_read TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_mm_admin (admin_id),
        INDEX idx_mm_member (member_id),
        INDEX idx_mm_read (is_read)
      ) ENGINE=InnoDB
    `);
    console.log('[messages] Table ready.');
  } catch (e) {
    // Table may already exist — ignore
  }
})();

/**
 * POST /api/messages/send
 * Member sends a message to their admin. Stored in DB.
 * Body: { subject, body }
 */
router.post('/send', async (req, res) => {
  try {
    const member = getMemberFromRequest(req);
    if (!member) return fail(res, 401, 'Member session required.');

    const { subject, body } = req.body || {};
    if (!body || !body.trim()) return fail(res, 400, 'Message body is required.');

    // Get the admin_id for this member
    const approvedRows = await sequelize.query(
      `SELECT admin_id FROM approved_members WHERE id = :id LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { id: Number(member.id) } }
    );

    if (!approvedRows.length || !approvedRows[0].admin_id) {
      return fail(res, 404, 'No admin associated with your account.');
    }
    const adminId = approvedRows[0].admin_id;

    await sequelize.query(
      `INSERT INTO member_messages (admin_id, member_id, sender_role, subject, body, is_read)
       VALUES (:admin_id, :member_id, 'member', :subject, :body, 0)`,
      {
        type: sequelize.QueryTypes.INSERT,
        replacements: {
          admin_id: adminId,
          member_id: Number(member.id),
          subject: String(subject || 'General').trim().substring(0, 255),
          body: String(body).trim()
        }
      }
    );

    return ok(res, { sent: true });
  } catch (e) {
    console.error('[messages/send]', e);
    return fail(res, 500, 'Error sending message.');
  }
});

/**
 * GET /api/messages/inbox
 * Admin reads all messages sent TO them.
 */
router.get('/inbox', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const messages = await sequelize.query(
      `SELECT m.id, m.member_id, m.sender_role, m.subject, m.body, m.is_read, m.created_at,
              COALESCE(am.full_name, 'Unknown Member') AS member_name,
              COALESCE(am.email, '') AS member_email
       FROM member_messages m
       LEFT JOIN approved_members am ON am.id = m.member_id
       WHERE m.admin_id = :adminId
       ORDER BY m.created_at DESC
       LIMIT 200`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: admin.id } }
    );

    return ok(res, messages);
  } catch (e) {
    console.error('[messages/inbox]', e);
    return fail(res, 500, 'Error fetching inbox.');
  }
});

/**
 * GET /api/messages/member-inbox/:memberId
 * Member reads messages in their thread (both sent and received from admin).
 */
router.get('/member-inbox/:memberId', async (req, res) => {
  try {
    const member = getMemberFromRequest(req);
    const admin = getAdminFromRequest(req);
    if (!member && !admin) return fail(res, 401, 'Authentication required.');

    const memberId = Number(req.params.memberId);
    if (member && !admin && String(member.id) !== String(memberId)) {
      return fail(res, 403, 'You can only read your own messages.');
    }

    // Get admin_id for this member
    const approvedRows = await sequelize.query(
      `SELECT admin_id FROM approved_members WHERE id = :id LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { id: memberId } }
    );
    if (!approvedRows.length || !approvedRows[0].admin_id) return ok(res, []);
    const adminId = approvedRows[0].admin_id;

    const messages = await sequelize.query(
      `SELECT id, sender_role, subject, body, is_read, created_at
       FROM member_messages
       WHERE admin_id = :adminId AND member_id = :memberId
       ORDER BY created_at ASC`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId, memberId } }
    );

    // Mark admin-sent messages as read when member views inbox
    await sequelize.query(
      `UPDATE member_messages SET is_read = 1
       WHERE admin_id = :adminId AND member_id = :memberId AND sender_role = 'admin' AND is_read = 0`,
      { replacements: { adminId, memberId } }
    );

    return ok(res, messages);
  } catch (e) {
    console.error('[messages/member-inbox]', e);
    return fail(res, 500, 'Error fetching member inbox.');
  }
});

/**
 * GET /api/messages/unread-count
 * Returns count of unread admin-sent messages for a member.
 * Query: ?member_id=123
 */
router.get('/unread-count', async (req, res) => {
  try {
    const member = getMemberFromRequest(req);
    if (!member) return fail(res, 401, 'Member session required.');

    const rows = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM member_messages
       WHERE member_id = :memberId AND sender_role = 'admin' AND is_read = 0`,
      { type: sequelize.QueryTypes.SELECT, replacements: { memberId: Number(member.id) } }
    );

    const count = rows[0] ? Number(rows[0].cnt) : 0;
    return ok(res, { count });
  } catch (e) {
    console.error('[messages/unread-count]', e);
    return fail(res, 500, 'Error fetching unread count.');
  }
});

/**
 * POST /api/messages/mark-read
 * Admin marks specific messages as read.
 * Body: { ids: [1,2,3] }
 */
router.post('/mark-read', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return fail(res, 400, 'No IDs provided.');

    const placeholders = ids.map(() => '?').join(',');
    await sequelize.query(
      `UPDATE member_messages SET is_read = 1 WHERE admin_id = ? AND id IN (${placeholders})`,
      { replacements: [admin.id, ...ids.map(Number)] }
    );

    return ok(res, { marked: ids.length });
  } catch (e) {
    console.error('[messages/mark-read]', e);
    return fail(res, 500, 'Error marking messages as read.');
  }
});

/**
 * DELETE /api/messages/:id
 * Admin deletes a specific message.
 */
router.delete('/:id', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const msgId = Number(req.params.id);
    await sequelize.query(
      `DELETE FROM member_messages WHERE id = :id AND admin_id = :adminId`,
      { type: sequelize.QueryTypes.DELETE, replacements: { id: msgId, adminId: admin.id } }
    );

    return ok(res, { deleted: true });
  } catch (e) {
    console.error('[messages/delete]', e);
    return fail(res, 500, 'Error deleting message.');
  }
});

module.exports = router;
