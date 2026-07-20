const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const bcrypt = require('bcryptjs');
const { signAdminToken } = require('../adminContext');
const { registerRules, loginRules } = require('../validation');

(async () => {
    try {
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS admins (
                id INT AUTO_INCREMENT PRIMARY KEY,
                full_name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL UNIQUE,
                phone VARCHAR(50) DEFAULT '',
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        const [existingPhoneColumn] = await sequelize.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admins' AND COLUMN_NAME = 'phone'`
        );
        if (!existingPhoneColumn || existingPhoneColumn.length === 0) {
            await sequelize.query(`ALTER TABLE admins ADD COLUMN phone VARCHAR(50) DEFAULT ''`);
        }
    } catch (e) {
        console.error('[auth_mysql] ensure admins table:', e.message);
    }
})();

router.post('/register', async (req, res) => {
    try {
        const { adminName, adminEmail, adminPassword, adminConfirm, adminPhone } = req.body;

        if (!adminName || !adminEmail || !adminPassword || !adminConfirm) {
            return res.json({ success: false, redirect: 'invalidcredentials.html' });
        }

        // Basic email regex validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(adminEmail)) {
            return res.json({ success: false, redirect: 'invalidcredentials.html' });
        }

        let phoneNormalized = '';
        if (adminPhone) {
            phoneNormalized = String(adminPhone).trim().replace(/[^0-9]/g, '');
            if (phoneNormalized.length < 9) {
                return res.json({ success: false, redirect: 'invalidcredentials.html' });
            }
        }

        if (adminPassword !== adminConfirm || adminPassword.length < 6) {
            return res.json({ success: false, redirect: 'invalidcredentials.html' });
        }

        // Ensure the admins table exists (just in case)
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS admins (
                id INT AUTO_INCREMENT PRIMARY KEY,
                full_name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL UNIQUE,
                phone VARCHAR(50) DEFAULT '',
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Check if admin exists
        const [existing] = await sequelize.query(
            `SELECT id FROM admins WHERE email = :email LIMIT 1`,
            { replacements: { email: adminEmail } }
        );

        if (existing.length > 0) {
            // User already exists
            return res.json({ success: false, redirect: 'popup.html' });
        }

        const passwordHash = await bcrypt.hash(adminPassword, 10);

        await sequelize.query(
            `INSERT INTO admins (full_name, email, phone, password_hash) VALUES (:name, :email, :phone, :password)`,
            { replacements: { name: adminName, email: adminEmail, phone: phoneNormalized, password: passwordHash } }
        );

        const [newAdminRows] = await sequelize.query(
            `SELECT id FROM admins WHERE email = :email LIMIT 1`,
            { replacements: { email: adminEmail } }
        );
        const newAdminId = newAdminRows && newAdminRows[0] && newAdminRows[0].id;
        const [countRows] = await sequelize.query(`SELECT COUNT(*) AS total FROM admins`);
        const totalAdmins = Number((countRows && countRows[0] && countRows[0].total) || 0);
        if (totalAdmins === 1 && newAdminId) {
            const tables = [
                'members', 'approved_members', 'deleted_members', 'denied_access',
                'loans', 'repayments', 'contributions', 'expense_claims',
                'member_savings', 'transaction_verifications', 'system_logs',
                'meeting_minutes', 'chama_subsidiaries', 'resolution_votes',
                'automation_admins', 'scheduled_meetings'
            ];
            for (const table of tables) {
                try {
                    await sequelize.query(
                        `UPDATE ${table} SET admin_id = :adminId WHERE admin_id IS NULL OR admin_id = ''`,
                        { replacements: { adminId: String(newAdminId) } }
                    );
                } catch (_) {}
            }
        }

        return res.json({ success: true, redirect: 'login.html' });
    } catch (err) {
        console.error('Registration Error:', err);
        return res.json({ success: false, redirect: 'erroredit.html' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { identifier, email, password } = req.body;
        const loginIdentifier = identifier || email;

        if (!loginIdentifier || !password) {
            return res.json({ status: 'fail', message: 'Please enter a valid email and password.', redirect: 'invalidcredentials.html' });
        }

        const [users] = await sequelize.query(
            `SELECT id, full_name, email, phone, password_hash FROM admins WHERE email = :identifier OR full_name = :identifier LIMIT 1`,
            { replacements: { identifier: loginIdentifier } }
        );

        if (users.length === 0) {
            return res.json({ status: 'fail', message: 'Invalid email or password.', redirect: 'invalidcredentials.html' });
        }

        const admin = users[0];
        const isMatch = await bcrypt.compare(password, admin.password_hash);

        if (!isMatch) {
            return res.json({ status: 'fail', message: 'Invalid email or password.', redirect: 'invalidcredentials.html' });
        }

        const token = signAdminToken(admin);
        return res.json({
            status: 'success',
            message: 'Successfully logged in. Opening your session...',
            redirect: 'home.html',
            token,
            admin: {
                id: String(admin.id),
                full_name: admin.full_name,
                name: admin.full_name,
                email: admin.email,
                phone: admin.phone || ''
            }
        });

    } catch (err) {
        console.error('Login Error:', err);
        return res.json({ status: 'error', message: 'A system error occurred.', redirect: 'erroredit.html' });
    }
});

// Admin Forgot Password
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.json({ status: 'fail', message: 'Missing email' });

        const [users] = await sequelize.query(
            `SELECT id FROM admins WHERE email = :email LIMIT 1`,
            { replacements: { email } }
        );

        if (users.length === 0) {
            return res.json({ status: 'fail', message: 'No admin account found with that email' });
        }

        const crypto = require('crypto');
        const token = crypto.randomBytes(32).toString('hex');

        // Create table if not exists (reused from members logic ideally, but ensuring safety)
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS password_reset_temp (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) NOT NULL,
                token VARCHAR(255) NOT NULL,
                expiry DATETIME NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Clean old tokens
        await sequelize.query(
            `DELETE FROM password_reset_temp WHERE email = :email`,
            { replacements: { email } }
        );

        // Insert new token (expires in 1 hour)
        await sequelize.query(
            `INSERT INTO password_reset_temp (email, token, expiry) VALUES (:email, :token, DATE_ADD(NOW(), INTERVAL 1 HOUR))`,
            { replacements: { email, token } }
        );

        return res.json({ status: 'success', message: 'If an account exists with that email, a reset link has been generated.', token });
    } catch (e) {
        console.error(e);
        return res.json({ status: 'error', message: 'System error' });
    }
});

// Admin Recover Password
router.post('/recover-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) return res.json({ status: 'fail', message: 'Missing token or password' });

        const [tokenRows] = await sequelize.query(
            `SELECT email FROM password_reset_temp WHERE token = :token AND expiry > NOW() LIMIT 1`,
            { replacements: { token: String(token) } }
        );

        if (tokenRows.length === 0) {
            return res.json({ status: 'fail', message: 'Invalid or expired token' });
        }

        const email = tokenRows[0].email;
        const password_hash = await bcrypt.hash(String(newPassword), 10);
        
        await sequelize.query(
            `UPDATE admins SET password_hash = :hash WHERE email = :email`,
            { replacements: { hash: password_hash, email } }
        );

        await sequelize.query(
            `DELETE FROM password_reset_temp WHERE email = :email`,
            { replacements: { email } }
        );

        return res.json({ status: 'success', message: 'Password updated successfully' });
    } catch (e) {
        console.error(e);
        return res.json({ status: 'error', message: 'System error' });
    }
});

router.get('/admin-phone', async (req, res) => {
    try {
        const [rows] = await sequelize.query(
            `SELECT phone FROM admins WHERE phone <> '' LIMIT 1`
        );
        const phone = rows && rows.length ? rows[0].phone : '';
        if (!phone) return res.json({ status: 'fail', message: 'No admin phone configured' });
        return res.json({ status: 'success', data: { phone } });
    } catch (err) {
        console.error('[auth_mysql admin-phone]', err.message);
        return res.status(500).json({ status: 'error', message: 'Unable to retrieve admin phone' });
    }
});

module.exports = router;
