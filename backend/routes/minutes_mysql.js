const express = require('express');
const { sequelize } = require('../models');
const { requireAdmin, getFallbackAdminId } = require('../adminContext');

const router = express.Router();

function ok(res, data) { return res.json({ status: 'success', message: 'OK', data }); }
function fail(res, code, message) { return res.status(code).json({ status: 'fail', message }); }

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
        meeting_url     VARCHAR(500) DEFAULT NULL,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    try { await sequelize.query(`ALTER TABLE meeting_minutes ADD COLUMN admin_id VARCHAR(50) DEFAULT NULL`); } catch (_) {}
    try { await sequelize.query(`ALTER TABLE meeting_minutes ADD COLUMN meeting_url VARCHAR(500) DEFAULT NULL`); } catch (_) {}
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

// ── LIST ─────────────────────────────────────────────────────────────────────
async function listMinutes(req, res) {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const rows = await sequelize.query(
      `SELECT id, admin_id, title, date, venue, chair, attendees, agenda, body,
              next_meeting_date, secretary, meeting_url, created_at
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

router.get('/', listMinutes);
router.get('/list', listMinutes);

// ── PUBLIC: LATEST LINK (must be before /:id) ────────────────────────────────
router.get('/latest-link', async (req, res) => {
  try {
    const rows = await sequelize.query(
      `SELECT id, title, date, meeting_url
       FROM meeting_minutes
       WHERE meeting_url IS NOT NULL AND meeting_url != ''
       ORDER BY date DESC, id DESC LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT }
    );
    if (!rows.length) return ok(res, { meeting_url: null, title: null, date: null });
    return ok(res, rows[0]);
  } catch (e) {
    console.error('[minutes/latest-link]', e);
    return fail(res, 500, 'Error fetching latest meeting link');
  }
});

// ── SAVE ─────────────────────────────────────────────────────────────────────
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

// ── UPDATE URL ───────────────────────────────────────────────────────────────
router.post('/update-url', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { id, meeting_url } = req.body || {};
    if (!id) return fail(res, 400, 'Missing minute record id');

    await sequelize.query(
      `UPDATE meeting_minutes SET meeting_url = :url WHERE id = :id AND admin_id = :adminId`,
      { type: sequelize.QueryTypes.UPDATE, replacements: { url: meeting_url || null, id: Number(id), adminId: admin.id } }
    );

    return ok(res, { updated: true, id: Number(id), meeting_url: meeting_url || null });
  } catch (e) {
    console.error('[minutes/update-url]', e);
    return fail(res, 500, 'Error updating meeting URL');
  }
});

// ── DELETE MANY ──────────────────────────────────────────────────────────────
router.post('/delete-many', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return fail(res, 400, 'No ids provided');

    const numIds = ids.map(Number).filter(n => n > 0);
    if (!numIds.length) return fail(res, 400, 'No valid ids provided');

    const placeholders = numIds.map((_, i) => ':id' + i).join(',');
    const replacements = { adminId: admin.id };
    numIds.forEach((n, i) => { replacements['id' + i] = n; });

    const deleted = await sequelize.query(
      `DELETE FROM meeting_minutes WHERE id IN (${placeholders}) AND admin_id = :adminId`,
      { type: sequelize.QueryTypes.DELETE, replacements }
    );

    return ok(res, { deleted: true, count: numIds.length });
  } catch (e) {
    console.error('[minutes/delete-many]', e);
    return fail(res, 500, 'Error deleting minute records');
  }
});

// ── DELETE ALL ───────────────────────────────────────────────────────────────
router.delete('/delete-all', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const result = await sequelize.query(
      `DELETE FROM meeting_minutes WHERE admin_id = :adminId`,
      { type: sequelize.QueryTypes.DELETE, replacements: { adminId: admin.id } }
    );

    return ok(res, { deleted: true, count: result });
  } catch (e) {
    console.error('[minutes/delete-all]', e);
    return fail(res, 500, 'Error deleting all minute records');
  }
});

// ── DELETE SINGLE (must be before /:id) ─────────────────────────────────────
router.delete('/delete/:id', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const id = Number(req.params.id);
    if (!id) return fail(res, 400, 'Invalid id');

    const existing = await sequelize.query(
      `SELECT id FROM meeting_minutes WHERE id = :id AND admin_id = :adminId LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT, replacements: { id, adminId: admin.id } }
    );
    if (!existing || !existing.length) return fail(res, 404, 'Record not found');

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

// ── SINGLE RECORD (catch-all :id — MUST BE LAST) ────────────────────────────
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
