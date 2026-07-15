const express = require('express');
const { sequelize } = require('../models');
const { requireAdmin, getFallbackAdminId } = require('../adminContext');

const router = express.Router();

function ok(res, data) { return res.json({ status: 'success', message: 'OK', data }); }
function fail(res, code, message) { return res.status(code).json({ status: 'fail', message }); }

const CORPORATE_TABLES = [
  'corporate_users', 'corporate_tasks', 'corporate_rooms', 'corporate_bookings',
  'corporate_documents', 'corporate_signatures', 'corporate_communications',
  'corporate_travel_bookings', 'corporate_expenses', 'corporate_performance_logs'
];

async function seedCorporateDefaultsForAdmin(adminId) {
  const userCount = await sequelize.query(
    'SELECT COUNT(*) AS count FROM corporate_users WHERE admin_id = :adminId',
    { type: sequelize.QueryTypes.SELECT, replacements: { adminId } }
  );
  if (Number(userCount[0]?.count || 0) === 0) {
    await sequelize.query(`
      INSERT INTO corporate_users (full_name, email, role, status, skills, current_workload, admin_id) VALUES
      (:chair, :chair_email, 'Executive', 'Available', 'general,governance', 0, :adminId),
      (:director, :director_email, 'Executive', 'Available', 'general,finance', 0, :adminId),
      (:alice, :alice_email, 'Secretary', 'Available', 'general,legal,travel', 0, :adminId),
      (:bob, :bob_email, 'Secretary', 'Available', 'general,finance,scheduling', 0, :adminId)
    `, {
      replacements: {
        adminId,
        chair: 'Chairman Peter',
        chair_email: `peter+${adminId}@chama.local`,
        director: 'Director Mary',
        director_email: `mary+${adminId}@chama.local`,
        alice: 'Alice Secretary',
        alice_email: `alice+${adminId}@chama.local`,
        bob: 'Bob Secretary',
        bob_email: `bob+${adminId}@chama.local`
      }
    });
  }

  const roomCount = await sequelize.query(
    'SELECT COUNT(*) AS count FROM corporate_rooms WHERE admin_id = :adminId',
    { type: sequelize.QueryTypes.SELECT, replacements: { adminId } }
  );
  if (Number(roomCount[0]?.count || 0) === 0) {
    await sequelize.query(`
      INSERT INTO corporate_rooms (name, capacity, location, admin_id) VALUES
      ('Elgon Boardroom', 12, '1st Floor, Wing A', :adminId),
      ('Cherangany Executive Suite', 6, '2nd Floor, Wing B', :adminId),
      ('Kipchoge Meeting Hall', 30, 'Ground Floor, Main Block', :adminId)
    `, { replacements: { adminId } });
  }
}

(async () => {
  try {
    for (const table of CORPORATE_TABLES) {
      try { await sequelize.query(`ALTER TABLE ${table} ADD COLUMN admin_id VARCHAR(50) DEFAULT NULL`); } catch (_) {}
      try { await sequelize.query(`ALTER TABLE ${table} ADD INDEX idx_${table}_admin (admin_id)`); } catch (_) {}
    }
    const fallbackAdminId = await getFallbackAdminId(sequelize);
    if (fallbackAdminId) {
      for (const table of CORPORATE_TABLES) {
        await sequelize.query(
          `UPDATE ${table} SET admin_id = :adminId WHERE admin_id IS NULL OR admin_id = ''`,
          { replacements: { adminId: fallbackAdminId } }
        ).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('[corporate init] failed:', e.message);
  }
})();

router.use(async (req, res, next) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  req.admin = admin;
  try { await seedCorporateDefaultsForAdmin(admin.id); } catch (e) { console.warn('[corporate seed admin]', e.message); }
  next();
});

// ==========================================
// SEEDING HELPER (RUNS ONCE ON LOAD IF EMPTY)
// ==========================================
async function seedCorporateData() {
  try {
    const userCount = await sequelize.query('SELECT COUNT(*) AS count FROM corporate_users', { type: sequelize.QueryTypes.SELECT });
    if (userCount[0].count === 0) {
      console.log('Seeding corporate_users...');
      await sequelize.query(`
        INSERT INTO corporate_users (full_name, email, role, status, skills, current_workload) VALUES
        ('Chairman Peter', 'peter@chama.local', 'Executive', 'Available', 'general,governance', 0),
        ('Director Mary', 'mary@chama.local', 'Executive', 'Available', 'general,finance', 0),
        ('Alice Secretary', 'alice@chama.local', 'Secretary', 'Available', 'general,legal,travel', 0),
        ('Bob Secretary', 'bob@chama.local', 'Secretary', 'Available', 'general,finance,scheduling', 0)
      `);
    }

    const roomCount = await sequelize.query('SELECT COUNT(*) AS count FROM corporate_rooms', { type: sequelize.QueryTypes.SELECT });
    if (roomCount[0].count === 0) {
      console.log('Seeding corporate_rooms...');
      await sequelize.query(`
        INSERT INTO corporate_rooms (name, capacity, location) VALUES
        ('Elgon Boardroom', 12, '1st Floor, Wing A'),
        ('Cherangany Executive Suite', 6, '2nd Floor, Wing B'),
        ('Kipchoge Meeting Hall', 30, 'Ground Floor, Main Block')
      `);
    }
  } catch (err) {
    console.warn('[seedCorporateData] failed:', err.message);
  }
}
seedCorporateData();

// ==========================================
// 1. TASK & TICKET ROUTING
// ==========================================

// GET /api/corporate/users (Get executives & secretaries)
router.get('/users', async (req, res) => {
  try {
    const rows = await sequelize.query(
      `SELECT id, full_name, email, role, status, skills, current_workload FROM corporate_users WHERE admin_id = :adminId`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: req.admin.id } }
    );
    return ok(res, rows);
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// GET /api/corporate/tasks
router.get('/tasks', async (req, res) => {
  try {
    const rows = await sequelize.query(
      `SELECT t.*, u.full_name AS assignee_name, c.full_name AS creator_name 
       FROM corporate_tasks t 
       LEFT JOIN corporate_users u ON t.assignee_id = u.id 
       LEFT JOIN corporate_users c ON t.creator_id = c.id 
       WHERE t.admin_id = :adminId
       ORDER BY t.created_at DESC`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: req.admin.id } }
    );
    return ok(res, rows);
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// POST /api/corporate/tasks (Create & Auto-Route task)
router.post('/tasks', async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { title, description, priority, sla_deadline, creator_id, idempotency_key } = req.body || {};
    if (!title || !creator_id || !idempotency_key) {
      await t.rollback();
      return fail(res, 400, 'Missing required task fields or idempotency key');
    }

    // Idempotency check
    const existing = await sequelize.query(
      `SELECT id FROM corporate_tasks WHERE idempotency_key = :idempotency_key AND admin_id = :adminId LIMIT 1`,
      { transaction: t, type: sequelize.QueryTypes.SELECT, replacements: { idempotency_key, adminId: req.admin.id } }
    );
    if (existing.length > 0) {
      await t.rollback();
      return fail(res, 400, 'Duplicate submission (idempotency token already processed)');
    }

    // Auto-routing logic: Find available secretary with least workload
    const secretaries = await sequelize.query(
      `SELECT id, full_name, current_workload FROM corporate_users 
       WHERE role = 'Secretary' AND status = 'Available' 
         AND admin_id = :adminId
       ORDER BY current_workload ASC, created_at ASC LIMIT 1`,
      { transaction: t, type: sequelize.QueryTypes.SELECT, replacements: { adminId: req.admin.id } }
    );

    let assignee_id = null;
    let status = 'Unassigned';

    if (secretaries.length > 0) {
      assignee_id = secretaries[0].id;
      status = 'Assigned';

      // Increment workload of assigned secretary (Optimistic check matching)
      await sequelize.query(
        `UPDATE corporate_users SET current_workload = current_workload + 1 WHERE id = :id AND admin_id = :adminId`,
        { transaction: t, replacements: { id: assignee_id, adminId: req.admin.id } }
      );
    }

    const [taskId] = await sequelize.query(
      `INSERT INTO corporate_tasks 
         (title, description, priority, status, creator_id, assignee_id, idempotency_key, sla_deadline, version, admin_id) 
       VALUES (:title, :description, :priority, :status, :creator_id, :assignee_id, :idempotency_key, :sla_deadline, 1, :adminId)`,
      {
        transaction: t,
        type: sequelize.QueryTypes.INSERT,
        replacements: {
          title,
          description: description || '',
          priority: priority || 'Medium',
          status,
          creator_id,
          assignee_id,
          idempotency_key,
          sla_deadline: sla_deadline || new Date(Date.now() + 24 * 3600 * 1000),
          adminId: req.admin.id
        }
      }
    );

    await t.commit();
    return ok(res, { task_id: taskId, status, assignee_id });
  } catch (e) {
    await t.rollback();
    return fail(res, 500, e.message);
  }
});

// POST /api/corporate/tasks/delegate (Reassign/delegate task)
router.post('/tasks/delegate', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { task_id, secretary_id } = req.body || {};
    if (!task_id || !secretary_id) {
      await transaction.rollback();
      return fail(res, 400, 'Missing task_id or secretary_id');
    }

    // Check task current status
    const task = await sequelize.query(
      `SELECT id, assignee_id, version FROM corporate_tasks WHERE id = :task_id AND admin_id = :adminId LIMIT 1`,
      { transaction, type: sequelize.QueryTypes.SELECT, replacements: { task_id, adminId: req.admin.id } }
    );
    if (task.length === 0) {
      await transaction.rollback();
      return fail(res, 404, 'Task not found');
    }

    const old_assignee = task[0].assignee_id;
    const current_version = task[0].version;

    // Decrement old secretary workload
    if (old_assignee) {
      await sequelize.query(
        `UPDATE corporate_users SET current_workload = GREATEST(0, CAST(current_workload AS SIGNED) - 1) WHERE id = :id AND admin_id = :adminId`,
        { transaction, replacements: { id: old_assignee, adminId: req.admin.id } }
      );
    }

    // Increment new secretary workload
    await sequelize.query(
      `UPDATE corporate_users SET current_workload = current_workload + 1 WHERE id = :id AND admin_id = :adminId`,
      { transaction, replacements: { id: secretary_id, adminId: req.admin.id } }
    );

    // Update task (Optimistic locking check using version increment)
    const [updateResult] = await sequelize.query(
      `UPDATE corporate_tasks 
       SET assignee_id = :secretary_id, status = 'Assigned', version = version + 1 
       WHERE id = :task_id AND version = :version AND admin_id = :adminId`,
      {
        transaction,
        replacements: { secretary_id, task_id, version: current_version, adminId: req.admin.id }
      }
    );

    await transaction.commit();
    return ok(res, { success: true });
  } catch (e) {
    await transaction.rollback();
    return fail(res, 500, e.message);
  }
});

// ==========================================
// 2. CALENDAR & ROOM BOOKINGS
// ==========================================

// GET /api/corporate/rooms
router.get('/rooms', async (req, res) => {
  try {
    const rows = await sequelize.query(`SELECT * FROM corporate_rooms WHERE admin_id = :adminId`, { type: sequelize.QueryTypes.SELECT, replacements: { adminId: req.admin.id } });
    return ok(res, rows);
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// GET /api/corporate/bookings
router.get('/bookings', async (req, res) => {
  try {
    const rows = await sequelize.query(
      `SELECT b.*, r.name AS room_name, u.full_name AS organizer_name 
       FROM corporate_bookings b 
       JOIN corporate_rooms r ON b.room_id = r.id 
       JOIN corporate_users u ON b.organizer_id = u.id 
       WHERE b.admin_id = :adminId
       ORDER BY b.start_time ASC`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: req.admin.id } }
    );
    return ok(res, rows);
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// POST /api/corporate/bookings
router.post('/bookings', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { room_id, title, organizer_id, start_time, end_time, timezone } = req.body || {};
    if (!room_id || !title || !organizer_id || !start_time || !end_time) {
      await transaction.rollback();
      return fail(res, 400, 'Missing room booking parameters');
    }

    // Convert ISO 8601 datetime strings to MySQL-compatible DATETIME format
    function toMySQLDatetime(isoStr) {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '').replace('Z', '');
    }
    const mysqlStart = toMySQLDatetime(start_time);
    const mysqlEnd   = toMySQLDatetime(end_time);

    // Overlap validation (Strict concurrency check)
    const conflicts = await sequelize.query(
      `SELECT id FROM corporate_bookings 
       WHERE room_id = :room_id 
         AND admin_id = :adminId
         AND ((start_time < :end_time AND end_time > :start_time)) 
       LIMIT 1`,
      {
        transaction,
        type: sequelize.QueryTypes.SELECT,
        replacements: { room_id, start_time: mysqlStart, end_time: mysqlEnd, adminId: req.admin.id }
      }
    );

    if (conflicts.length > 0) {
      await transaction.rollback();
      return fail(res, 409, 'Conflict: The room is already booked during this timeframe.');
    }

    const [bookingId] = await sequelize.query(
      `INSERT INTO corporate_bookings (room_id, title, organizer_id, start_time, end_time, timezone, version, admin_id)
       VALUES (:room_id, :title, :organizer_id, :start_time, :end_time, :timezone, 1, :adminId)`,
      {
        transaction,
        type: sequelize.QueryTypes.INSERT,
        replacements: { room_id, title, organizer_id, start_time: mysqlStart, end_time: mysqlEnd, timezone: timezone || 'UTC', adminId: req.admin.id }
      }
    );

    await transaction.commit();
    return ok(res, { booking_id: bookingId });
  } catch (e) {
    await transaction.rollback();
    return fail(res, 500, e.message);
  }
});

// ==========================================
// 3. DOCUMENT VAULT (AWS S3 SIMULATION)
// ==========================================

// GET /api/corporate/documents
router.get('/documents', async (req, res) => {
  try {
    const rows = await sequelize.query(
      `SELECT d.*, u.full_name AS locked_by_name 
       FROM corporate_documents d 
       LEFT JOIN corporate_users u ON d.locked_by_id = u.id 
       WHERE d.admin_id = :adminId
       ORDER BY d.created_at DESC`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: req.admin.id } }
    );
    return ok(res, rows);
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// POST /api/corporate/documents/upload
router.post('/documents/upload', async (req, res) => {
  try {
    const { filename, checksum } = req.body || {};
    if (!filename) return fail(res, 400, 'Missing filename');

    // Simulate AWS S3 upload paths
    const s3_bucket = 'shms-corporate-vault';
    const s3_key = `documents/${Date.now()}_${filename.replace(/\s+/g, '_')}`;
    const hash_checksum = checksum || Math.random().toString(36).substring(2, 15);

    const [docId] = await sequelize.query(
      `INSERT INTO corporate_documents (filename, s3_bucket, s3_key, hash_checksum, version, admin_id)
       VALUES (:filename, :s3_bucket, :s3_key, :hash_checksum, 1, :adminId)`,
      {
        type: sequelize.QueryTypes.INSERT,
        replacements: { filename, s3_bucket, s3_key, hash_checksum, adminId: req.admin.id }
      }
    );

    return ok(res, { document_id: docId, s3_bucket, s3_key });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// POST /api/corporate/documents/lock
router.post('/documents/lock', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { document_id, user_id, action } = req.body || {};
    if (!document_id || !user_id || !action) {
      await transaction.rollback();
      return fail(res, 400, 'Missing lock parameters');
    }

    const doc = await sequelize.query(
      `SELECT id, is_locked, locked_by_id, version FROM corporate_documents WHERE id = :document_id AND admin_id = :adminId LIMIT 1`,
      { transaction, type: sequelize.QueryTypes.SELECT, replacements: { document_id, adminId: req.admin.id } }
    );

    if (doc.length === 0) {
      await transaction.rollback();
      return fail(res, 404, 'Document not found');
    }

    const isLocked = doc[0].is_locked;
    const lockedBy = doc[0].locked_by_id;
    const version = doc[0].version;

    if (action === 'lock') {
      if (isLocked) {
        await transaction.rollback();
        return fail(res, 409, 'Document is already locked by another user');
      }
      await sequelize.query(
        `UPDATE corporate_documents SET is_locked = 1, locked_by_id = :user_id, version = version + 1 
         WHERE id = :document_id AND version = :version AND admin_id = :adminId`,
        { transaction, replacements: { user_id, document_id, version, adminId: req.admin.id } }
      );
    } else { // unlock
      if (!isLocked) {
        await transaction.rollback();
        return fail(res, 400, 'Document is already unlocked');
      }
      if (lockedBy !== user_id) {
        await transaction.rollback();
        return fail(res, 403, 'Permission denied: Document locked by another user');
      }
      await sequelize.query(
        `UPDATE corporate_documents SET is_locked = 0, locked_by_id = NULL, version = version + 1 
         WHERE id = :document_id AND version = :version AND admin_id = :adminId`,
        { transaction, replacements: { document_id, version, adminId: req.admin.id } }
      );
    }

    await transaction.commit();
    return ok(res, { success: true });
  } catch (e) {
    await transaction.rollback();
    return fail(res, 500, e.message);
  }
});

// POST /api/corporate/documents/sign
router.post('/documents/sign', async (req, res) => {
  try {
    const { document_id, signer_id, signature_payload } = req.body || {};
    if (!document_id || !signer_id || !signature_payload) {
      return fail(res, 400, 'Missing sign requirements');
    }

    const [sigId] = await sequelize.query(
      `INSERT INTO corporate_signatures (document_id, signer_id, signature_payload, admin_id)
       VALUES (:document_id, :signer_id, :signature_payload, :adminId)`,
      {
        type: sequelize.QueryTypes.INSERT,
        replacements: { document_id, signer_id, signature_payload, adminId: req.admin.id }
      }
    );

    return ok(res, { signature_id: sigId });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// ==========================================
// 4. UNIFIED COMMUNICATIONS
// ==========================================

// GET /api/corporate/communications
router.get('/communications', async (req, res) => {
  try {
    const rows = await sequelize.query(
      `SELECT * FROM corporate_communications WHERE admin_id = :adminId ORDER BY created_at DESC LIMIT 50`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: req.admin.id } }
    );
    return ok(res, rows);
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// POST /api/corporate/communications
router.post('/communications', async (req, res) => {
  try {
    const { source, sender, subject, content } = req.body || {};
    if (!source || !sender) return fail(res, 400, 'Missing source or sender');

    await sequelize.query(
      `INSERT INTO corporate_communications (source, sender, subject, content, admin_id)
       VALUES (:source, :sender, :subject, :content, :adminId)`,
      {
        type: sequelize.QueryTypes.INSERT,
        replacements: { source, sender, subject: subject || null, content: content || '', adminId: req.admin.id }
      }
    );

    return ok(res, { saved: true });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// ==========================================
// 5. TRAVEL & EXPENSES
// ==========================================

// GET /api/corporate/travel
router.get('/travel', async (req, res) => {
  try {
    const rows = await sequelize.query(
      `SELECT t.*, u.full_name AS executive_name 
       FROM corporate_travel_bookings t 
       JOIN corporate_users u ON t.executive_id = u.id 
       WHERE t.admin_id = :adminId
       ORDER BY t.created_at DESC`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: req.admin.id } }
    );
    return ok(res, rows);
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// POST /api/corporate/travel
router.post('/travel', async (req, res) => {
  try {
    const { executive_id, destination, itinerary_details } = req.body || {};
    if (!executive_id || !destination) return fail(res, 400, 'Missing travel details');

    const [travelId] = await sequelize.query(
      `INSERT INTO corporate_travel_bookings (executive_id, destination, itinerary_details, admin_id)
       VALUES (:executive_id, :destination, :itinerary_details, :adminId)`,
      {
        type: sequelize.QueryTypes.INSERT,
        replacements: { executive_id, destination, itinerary_details: JSON.stringify(itinerary_details || {}), adminId: req.admin.id }
      }
    );

    return ok(res, { travel_id: travelId });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// GET /api/corporate/expenses
router.get('/expenses', async (req, res) => {
  try {
    const rows = await sequelize.query(
      `SELECT e.*, t.destination, u.full_name AS executive_name 
       FROM corporate_expenses e 
       LEFT JOIN corporate_travel_bookings t ON e.travel_id = t.id 
       LEFT JOIN corporate_users u ON t.executive_id = u.id 
       WHERE e.admin_id = :adminId
       ORDER BY e.created_at DESC`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: req.admin.id } }
    );
    return ok(res, rows);
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// POST /api/corporate/expenses
router.post('/expenses', async (req, res) => {
  try {
    const { travel_id, amount, currency, receipt_s3_key } = req.body || {};
    if (!amount) return fail(res, 400, 'Missing expense amount');

    const [expenseId] = await sequelize.query(
      `INSERT INTO corporate_expenses (travel_id, amount, currency, receipt_s3_key, admin_id)
       VALUES (:travel_id, :amount, :currency, :receipt_s3_key, :adminId)`,
      {
        type: sequelize.QueryTypes.INSERT,
        replacements: { travel_id: travel_id || null, amount, currency: currency || 'KES', receipt_s3_key: receipt_s3_key || null, adminId: req.admin.id }
      }
    );

    return ok(res, { expense_id: expenseId });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// ==========================================
// 6. PERFORMANCE & TELEMETRY
// ==========================================

// GET /api/corporate/performance
router.get('/performance', async (req, res) => {
  try {
    // Secretary workload
    const workload = await sequelize.query(
      `SELECT id, full_name, current_workload FROM corporate_users WHERE role = 'Secretary' AND admin_id = :adminId`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: req.admin.id } }
    );

    // Avg response times
    const avgResponse = await sequelize.query(
      `SELECT l.secretary_id, u.full_name AS secretary_name, AVG(l.response_time_seconds) AS avg_response_time, COUNT(*) AS completed_count 
       FROM corporate_performance_logs l 
       JOIN corporate_users u ON l.secretary_id = u.id 
       WHERE l.admin_id = :adminId
       GROUP BY l.secretary_id`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: req.admin.id } }
    );

    return ok(res, { workload, avgResponse });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

// POST /api/corporate/performance/log
router.post('/performance/log', async (req, res) => {
  try {
    const { task_id, secretary_id, response_time_seconds } = req.body || {};
    if (!task_id || !secretary_id || response_time_seconds === undefined) {
      return fail(res, 400, 'Missing performance metrics');
    }

    await sequelize.query(
      `INSERT INTO corporate_performance_logs (task_id, secretary_id, response_time_seconds, admin_id)
       VALUES (:task_id, :secretary_id, :response_time_seconds, :adminId)`,
      {
        type: sequelize.QueryTypes.INSERT,
        replacements: { task_id, secretary_id, response_time_seconds, adminId: req.admin.id }
      }
    );

    return ok(res, { saved: true });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

module.exports = router;
