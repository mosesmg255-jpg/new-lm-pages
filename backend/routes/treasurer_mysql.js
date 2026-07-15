const express = require('express');
const { sequelize } = require('../models');
const { requireAdmin, getFallbackAdminId } = require('../adminContext');

const router = express.Router();

function ok(res, data) { return res.json({ status: 'success', message: 'OK', data }); }
function fail(res, code, message) { return res.status(code).json({ status: 'fail', message }); }

(async () => {
  const statements = [
    `ALTER TABLE chama_subsidiaries ADD COLUMN admin_id VARCHAR(50) DEFAULT NULL`,
    `ALTER TABLE chama_subsidiaries ADD INDEX idx_chama_subsidiaries_admin (admin_id)`,
    `ALTER TABLE resolution_votes ADD COLUMN admin_id VARCHAR(50) DEFAULT NULL`,
    `ALTER TABLE resolution_votes ADD INDEX idx_resolution_votes_admin (admin_id)`
  ];
  for (const statement of statements) {
    try { await sequelize.query(statement); } catch (_) {}
  }
  try {
    const slugIndexes = await sequelize.query(
      `SELECT INDEX_NAME
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'chama_subsidiaries'
         AND COLUMN_NAME = 'slug'
         AND NON_UNIQUE = 0
         AND INDEX_NAME <> 'PRIMARY'
       GROUP BY INDEX_NAME`,
      { type: sequelize.QueryTypes.SELECT }
    );
    for (const idx of slugIndexes) {
      try { await sequelize.query(`ALTER TABLE chama_subsidiaries DROP INDEX \`${idx.INDEX_NAME}\``); } catch (_) {}
    }
    try { await sequelize.query(`ALTER TABLE chama_subsidiaries ADD UNIQUE KEY uniq_chama_subsidiaries_admin_slug (admin_id, slug)`); } catch (_) {}
    const fallbackAdminId = await getFallbackAdminId(sequelize);
    if (fallbackAdminId) {
      await sequelize.query(`UPDATE chama_subsidiaries SET admin_id = :adminId WHERE admin_id IS NULL OR admin_id = ''`, { replacements: { adminId: fallbackAdminId } });
      await sequelize.query(`UPDATE resolution_votes SET admin_id = :adminId WHERE admin_id IS NULL OR admin_id = ''`, { replacements: { adminId: fallbackAdminId } });
    }
  } catch (_) {}
})();

//  SUBSIDIARIES 

// GET /api/treasurer/subsidiaries
router.get('/subsidiaries', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    let rows = await sequelize.query(
      `SELECT slug, display_name FROM chama_subsidiaries WHERE admin_id = :adminId ORDER BY created_at ASC`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: admin.id } }
    );
    if (!rows.length) {
      const defaults = [
        ['eldoret_main', 'Eldoret Main Central Chama'],
        ['kapsoya_branch', 'Kapsoya Estate Sub-Group'],
        ['huruma_dev', 'Huruma Development Circle']
      ];
      for (const [slug, display_name] of defaults) {
        await sequelize.query(
          `INSERT IGNORE INTO chama_subsidiaries (slug, display_name, admin_id) VALUES (:slug, :display_name, :admin_id)`,
          { replacements: { slug, display_name, admin_id: admin.id } }
        );
      }
      rows = await sequelize.query(
        `SELECT slug, display_name FROM chama_subsidiaries WHERE admin_id = :adminId ORDER BY created_at ASC`,
        { type: sequelize.QueryTypes.SELECT, replacements: { adminId: admin.id } }
      );
    }
    return ok(res, rows);
  } catch (e) {
    console.error('[treasurer/subsidiaries]', e);
    return fail(res, 500, 'Error fetching subsidiaries');
  }
});

// POST /api/treasurer/subsidiaries/add
// body: { slug, display_name }
router.post('/subsidiaries/add', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { slug, display_name } = req.body || {};
    if (!slug || !display_name) return fail(res, 400, 'Missing slug or display_name');

    await sequelize.query(
      `INSERT IGNORE INTO chama_subsidiaries (slug, display_name, admin_id) VALUES (:slug, :display_name, :admin_id)`,
      { type: sequelize.QueryTypes.INSERT, replacements: { slug: String(slug), display_name: String(display_name), admin_id: admin.id } }
    );
    return ok(res, { slug, display_name });
  } catch (e) {
    console.error('[treasurer/subsidiaries/add]', e);
    return fail(res, 500, 'Error adding subsidiary');
  }
});

// DELETE /api/treasurer/subsidiaries/delete
// body: { slug }
router.delete('/subsidiaries/delete', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { slug } = req.body || {};
    if (!slug) return fail(res, 400, 'Missing slug');

    await sequelize.query(
      `DELETE FROM chama_subsidiaries WHERE slug = :slug AND admin_id = :adminId`,
      { type: sequelize.QueryTypes.DELETE, replacements: { slug: String(slug), adminId: admin.id } }
    );
    return ok(res, { deleted: true });
  } catch (e) {
    console.error('[treasurer/subsidiaries/delete]', e);
    return fail(res, 500, 'Error deleting subsidiary');
  }
});

//  VOTES 

// POST /api/treasurer/vote
// body: { vote_type: 'Approve'|'Abstain'|'Reject', subsidiary_slug }
router.post('/vote', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { vote_type, subsidiary_slug } = req.body || {};
    const valid = ['Approve', 'Abstain', 'Reject'];
    if (!vote_type || !valid.includes(vote_type)) return fail(res, 400, 'Invalid vote_type');

    await sequelize.query(
      `INSERT INTO resolution_votes (vote_type, subsidiary_slug, admin_id) VALUES (:vote_type, :subsidiary_slug, :admin_id)`,
      {
        type: sequelize.QueryTypes.INSERT,
        replacements: { vote_type, subsidiary_slug: String(subsidiary_slug || 'eldoret_main'), admin_id: admin.id }
      }
    );
    return ok(res, { cast: vote_type });
  } catch (e) {
    console.error('[treasurer/vote]', e);
    return fail(res, 500, 'Error casting vote');
  }
});

// GET /api/treasurer/votes?subsidiary_slug=eldoret_main
router.get('/votes', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const slug = String(req.query.subsidiary_slug || 'eldoret_main');
    const rows = await sequelize.query(
      `SELECT vote_type, COUNT(*) AS count
       FROM resolution_votes
       WHERE subsidiary_slug = :slug AND admin_id = :adminId
       GROUP BY vote_type`,
      { type: sequelize.QueryTypes.SELECT, replacements: { slug, adminId: admin.id } }
    );
    const tally = { Approve: 0, Abstain: 0, Reject: 0 };
    rows.forEach(r => { tally[r.vote_type] = Number(r.count); });
    return ok(res, tally);
  } catch (e) {
    console.error('[treasurer/votes]', e);
    return fail(res, 500, 'Error fetching votes');
  }
});

//  MEMBER BALANCE UPDATES 

// POST /api/treasurer/update-balances
// body: { member_id, loanAmount?, savingsAmount? }
router.post('/update-balances', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { member_id, loanAmount, savingsAmount } = req.body || {};
    if (!member_id) return fail(res, 400, 'Missing member_id');

    const updates = [];
    const replacements = { id: Number(member_id), adminId: admin.id };

    if (loanAmount !== undefined && loanAmount !== '') {
      updates.push('loanAmount = :loanAmount');
      replacements.loanAmount = Number(loanAmount);
    }
    if (savingsAmount !== undefined && savingsAmount !== '') {
      updates.push('savingsAmount = :savingsAmount');
      replacements.savingsAmount = Number(savingsAmount);
    }

    if (updates.length === 0) return fail(res, 400, 'No fields to update');

    // Update approved_members
    await sequelize.query(
      `UPDATE approved_members SET ${updates.join(', ')} WHERE id = :id AND admin_id = :adminId`,
      { type: sequelize.QueryTypes.UPDATE, replacements }
    );

    // Fetch updated row to return
    const [rows] = await sequelize.query(
      `SELECT id, full_name, email, loanAmount, savingsAmount FROM approved_members WHERE id = :id AND admin_id = :adminId`,
      { type: sequelize.QueryTypes.SELECT, replacements: { id: Number(member_id), adminId: admin.id } }
    );
    const updated = Array.isArray(rows) ? rows : [rows];

    return ok(res, updated[0] || { id: member_id });
  } catch (e) {
    console.error('[treasurer/update-balances]', e);
    return fail(res, 500, 'Error updating balances');
  }
});

//  ANALYTICS 

// GET /api/treasurer/stats
router.get('/stats', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const [loanRows] = await sequelize.query(
      `SELECT COALESCE(SUM(amount), 0) AS totalLoans FROM loans WHERE status != 'Settled' AND admin_id = :adminId`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: admin.id } }
    );
    const [savingsRows] = await sequelize.query(
      `SELECT COALESCE(SUM(savingsAmount), 0) AS totalSavings FROM approved_members WHERE admin_id = :adminId`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: admin.id } }
    );

    const lR = Array.isArray(loanRows) ? loanRows[0] : loanRows;
    const sR = Array.isArray(savingsRows) ? savingsRows[0] : savingsRows;
    const totalLoans = Number(lR?.totalLoans || 0);
    const totalSavings = Number(sR?.totalSavings || 0);
    const riskFactor = totalLoans === 0 ? 'Stable' : totalLoans > totalSavings ? 'High Risk' : 'Stable';

    return ok(res, { totalLoans, totalSavings, riskFactor });
  } catch (e) {
    console.error('[treasurer/stats]', e);
    return fail(res, 500, 'Error fetching treasurer stats');
  }
});

module.exports = router;
