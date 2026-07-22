const express = require('express');
const { sequelize } = require('../models');
const { requireAdmin } = require('../adminContext');

const router = express.Router();

function ok(res, data) { return res.json({ status: 'success', message: 'OK', data }); }
function fail(res, code, message) { return res.status(code).json({ status: 'fail', message }); }

// Auto-initialize meetings table
(async () => {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS meetings (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        admin_id        VARCHAR(50) DEFAULT NULL,
        title           VARCHAR(255) NOT NULL,
        description     TEXT,
        date            DATE NOT NULL,
        time            TIME NOT NULL,
        venue           VARCHAR(255),
        type            VARCHAR(50) DEFAULT 'regular',
        status          VARCHAR(50) DEFAULT 'scheduled',
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[meetings] Table ready.');
  } catch (e) {
    console.error('[meetings] Table init error:', e.message);
  }
})();

// GET /api/meetings/all
router.get('/all', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const meetings = await sequelize.query(
      `SELECT * FROM meetings WHERE admin_id = :adminId ORDER BY date DESC, time DESC`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: admin.id } }
    );
    return ok(res, meetings);
  } catch (err) {
    return fail(res, 500, err.message);
  }
});

// POST /api/meetings/create
router.post('/create', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const { title, description, date, time, venue, type } = req.body;
    if (!title || !date || !time) {
      return fail(res, 400, 'Title, date, and time are required.');
    }

    await sequelize.query(
      `INSERT INTO meetings (admin_id, title, description, date, time, venue, type, status, created_at, updated_at)
       VALUES (:adminId, :title, :description, :date, :time, :venue, :type, 'scheduled', NOW(), NOW())`,
      {
        replacements: {
          adminId: admin.id,
          title,
          description: description || '',
          date,
          time,
          venue: venue || '',
          type: type || 'regular'
        }
      }
    );

    return ok(res, { created: true });
  } catch (err) {
    return fail(res, 500, err.message);
  }
});

// POST /api/meetings/update-status
router.post('/update-status', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const { id, status } = req.body;
    if (!id || !status) {
      return fail(res, 400, 'ID and status are required.');
    }

    await sequelize.query(
      `UPDATE meetings SET status = :status WHERE id = :id AND admin_id = :adminId`,
      { replacements: { status, id, adminId: admin.id } }
    );

    return ok(res, { updated: true });
  } catch (err) {
    return fail(res, 500, err.message);
  }
});

// DELETE /api/meetings/delete/:id
router.delete('/delete/:id', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    await sequelize.query(
      `DELETE FROM meetings WHERE id = :id AND admin_id = :adminId`,
      { replacements: { id, adminId: admin.id } }
    );

    return ok(res, { deleted: true });
  } catch (err) {
    return fail(res, 500, err.message);
  }
});

module.exports = router;
