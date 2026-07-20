const express = require('express');
const router = express.Router();

// Auth / Registration
router.use('/auth', require('./auth_mysql'));

// Members
router.use('/members', require('./members_mysql'));

// Loans
router.use('/loans', require('./loans_mysql'));

// Repayments
router.use('/repayments', require('./repayments_mysql'));

// Contributions & Dues
router.use('/contributions', require('./contributions_mysql'));

// Expenses
router.use('/expenses', require('./expenses_mysql'));

// System Logs (Section 4)
router.use('/logs', require('./system_logs_mysql'));

// Verifications & Portal Config
router.use('/verifications', require('./verifications_mysql'));

// Treasurer Console (Section 2, items 1-7)
router.use('/treasurer', require('./treasurer_mysql'));

// Automation (Section 5, items 1-2)
router.use('/automation', require('./automation_mysql'));

// Corporate Portal Feature Set (SHMS Expansion)
router.use('/corporate', require('./corporate_mysql'));

// Main Safeguard (Treasurer Financial Oversight)
router.use('/safeguard', require('./safeguard_mysql'));

// App Settings (blur gate, etc.)
router.use('/settings', require('./settings_mysql'));

// Meeting Minutes Registry
router.use('/minutes', require('./minutes_mysql'));

// Member Messages (member-to-admin inbox, unread badge)
router.use('/messages', require('./messages_mysql'));

// Live System Updates (real-time event log)
router.use('/live-updates', require('./live_updates_mysql'));

module.exports = router;
