const express = require('express');
const { sequelize } = require('../models');
const { requireAdmin, getFallbackAdminId } = require('../adminContext');

const router = express.Router();

function ok(res, data) { return res.json({ status: 'success', message: 'OK', data }); }
function fail(res, code, message) { return res.status(code).json({ status: 'fail', message }); }

//  ENSURE TABLE EXISTS 
(async () => {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS meeting_minutes (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        admin_id        VARCHAR(50) DEFAULT NULL,
        title           VARCHAR(255) NOT NULL,
        date            DATE NOT NULL,
        venue           VARCHAR(255),
        chair           VARCHAR(255),
        attendees       TEXT,
        agenda          TEXT,
        body            TEXT,
        next_meeting_date DATE,
        secretary       VARCHAR(255),
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    try { await sequelize.query(`ALTER TABLE meeting_minutes ADD COLUMN admin_id VARCHAR(50) DEFAULT NULL`); } catch (_) {}
    try { await sequelize.query(`ALTER TABLE meeting_minutes ADD INDEX idx_meeting_minutes_admin (admin_id)`); } catch (_) {}
    const fallbackAdminId = await getFallbackAdminId(sequelize);
    if (fallbackAdminId) {
      await sequelize.query(
        `UPDATE meeting_minutes SET admin_id = :adminId WHERE admin_id IS NULL OR admin_id = ''`,
        { replacements: { adminId: fallbackAdminId } }
      );
    }
    console.log('[minutes] Table ready.');
  } catch (e) {
    console.error('[minutes] Table init error:', e.message);
  }
})();

async function listMinutes(req, res) {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const rows = await sequelize.query(
      `SELECT id, admin_id, title, date, venue, chair, attendees, agenda, body,
              next_meeting_date, secretary, created_at
       FROM meeting_minutes
       WHERE admin_id = :adminId
       ORDER BY date DESC, id DESC`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: admin.id } }
    );
    return ok(res, rows);
  } catch (e) {
    console.error('[minutes/list]', e);
    return fail(res, 500, 'Error fetching minutes');
  }
}

//  GET /api/minutes and /api/minutes/list
router.get('/', listMinutes);
router.get('/list', listMinutes);

//  POST /api/minutes/save 
router.post('/save', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const {
      title, date, venue, chair, attendees,
      agenda, body, next_meeting_date, secretary
    } = req.body || {};

    if (!title || !date || !body) {
      return fail(res, 400, 'Missing required fields: title, date, body');
    }

    const [result] = await sequelize.query(
      `INSERT INTO meeting_minutes
         (admin_id, title, date, venue, chair, attendees, agenda, body, next_meeting_date, secretary)
       VALUES
         (:admin_id, :title, :date, :venue, :chair, :attendees, :agenda, :body, :next_meeting_date, :secretary)`,
      {
        type: sequelize.QueryTypes.INSERT,
        replacements: {
          admin_id:           admin.id,
          title:             String(title),
          date:              String(date),
          venue:             String(venue  || ''),
          chair:             String(chair  || ''),
          attendees:         String(attendees || ''),
          agenda:            String(agenda  || ''),
          body:              String(body),
          next_meeting_date: next_meeting_date || null,
          secretary:         String(secretary || '')
        }
      }
    );

    return ok(res, { id: result, title, date });
  } catch (e) {
    console.error('[minutes/save]', e);
    return fail(res, 500, 'Error saving minutes');
  }
});

//  DELETE /api/minutes/delete/:id 
router.delete('/delete/:id', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const id = Number(req.params.id);
    if (!id) return fail(res, 400, 'Invalid id');

    await sequelize.query(
      `DELETE FROM meeting_minutes WHERE id = :id AND admin_id = :adminId`,
      { type: sequelize.QueryTypes.DELETE, replacements: { id, adminId: admin.id } }
    );

    return ok(res, { deleted: true, id });
  } catch (e) {
    console.error('[minutes/delete]', e);
    return fail(res, 500, 'Error deleting minute record');
  }
});

//  GET /api/minutes/:id  (single record) 
router.get('/:id', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const id = Number(req.params.id);
    if (!id) return fail(res, 400, 'Invalid id');

    const rows = await sequelize.query(
      `SELECT * FROM meeting_minutes WHERE id = :id AND admin_id = :adminId LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { id, adminId: admin.id } }
    );

    if (!rows.length) return fail(res, 404, 'Record not found');
    return ok(res, rows[0]);
  } catch (e) {
    console.error('[minutes/:id]', e);
    return fail(res, 500, 'Error fetching minute record');
  }
});

module.exports = router;
