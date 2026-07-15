const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const bcrypt = require('bcryptjs');
const { requireAdmin } = require('../adminContext');

async function ensureSettingsTable() {
    await sequelize.query(`
        CREATE TABLE IF NOT EXISTS app_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            setting_key VARCHAR(100) NOT NULL UNIQUE,
            setting_value MEDIUMTEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
    await sequelize.query(`
        ALTER TABLE app_settings MODIFY COLUMN setting_value MEDIUMTEXT NOT NULL
    `).catch(() => {});
    await sequelize.query(`
        INSERT IGNORE INTO app_settings (setting_key, setting_value)
        VALUES ('blur_enabled', 'true')
    `);
}
ensureSettingsTable().catch(console.error);

async function verifyAdminPassword(password, adminId) {
    if (!password) return false;
    const [admins] = await sequelize.query(
        `SELECT password_hash FROM admins WHERE id = :adminId AND password_hash IS NOT NULL`,
        { replacements: { adminId } }
    );
    for (const admin of admins) {
        if (admin.password_hash && await bcrypt.compare(String(password), admin.password_hash)) {
            return true;
        }
    }
    return false;
}

router.get('/blur', async (req, res) => {
    try {
        const [rows] = await sequelize.query(
            `SELECT setting_value FROM app_settings WHERE setting_key = 'blur_enabled' LIMIT 1`
        );
        const blurEnabled = rows.length > 0 ? rows[0].setting_value === 'true' : true;
        res.json({ blurEnabled });
    } catch (e) {
        console.error(e);
        res.json({ blurEnabled: true });
    }
});

router.post('/verify-admin-password', async (req, res) => {
    try {
        const admin = requireAdmin(req, res);
        if (!admin) return;
        const { password } = req.body || {};
        const isMatch = await verifyAdminPassword(password, admin.id);
        if (!isMatch) return res.json({ status: 'fail', message: 'Incorrect admin password.' });
        return res.json({ status: 'success', message: 'Admin password verified.' });
    } catch (e) {
        console.error(e);
        return res.json({ status: 'error', message: 'System error.' });
    }
});

router.post('/blur', async (req, res) => {
    try {
        const admin = requireAdmin(req, res);
        if (!admin) return;
        const { password, blurEnabled } = req.body || {};
        if (!password || blurEnabled === undefined) {
            return res.json({ status: 'fail', message: 'Missing password or state.' });
        }

        const isMatch = await verifyAdminPassword(password, admin.id);
        if (!isMatch) {
            return res.json({ status: 'fail', message: 'Incorrect admin password.' });
        }

        const newValue = blurEnabled ? 'true' : 'false';
        await sequelize.query(
            `INSERT INTO app_settings (setting_key, setting_value)
             VALUES ('blur_enabled', :val)
             ON DUPLICATE KEY UPDATE setting_value = :val`,
            { replacements: { val: newValue } }
        );
        res.json({ status: 'success', blurEnabled });
    } catch (e) {
        console.error(e);
        res.json({ status: 'error', message: 'System error.' });
    }
});

module.exports = router;
