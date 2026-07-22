const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
    if (transporter) return transporter;

    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
        console.warn('[mailer] SMTP_HOST/SMTP_USER/SMTP_PASS not set — emails will be logged to console instead of sent.');
        return null;
    }

    transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT) || 587,
        secure: Number(SMTP_PORT) === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS }
    });

    return transporter;
}

async function sendPasswordResetEmail(toEmail, token) {
    const resetUrl = `${process.env.APP_URL || ''}/recover-password.html?token=${encodeURIComponent(token)}`;
    const subject = 'Password reset request';
    const text = `A password reset was requested for this account.\n\nReset link (valid 1 hour):\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`;

    const t = getTransporter();

    if (!t) {
        // Dev/fallback mode: never expose the token via the API response.
        // Log it server-side only so a developer can retrieve it manually if needed.
        console.warn(`[mailer] SMTP not configured. Password reset link for ${toEmail}: ${resetUrl}`);
        return { delivered: false };
    }

    await t.sendMail({
        from: process.env.SMTP_FROM || SMTP_USER_FALLBACK(),
        to: toEmail,
        subject,
        text
    });

    return { delivered: true };
}

function SMTP_USER_FALLBACK() {
    return process.env.SMTP_USER || 'no-reply@example.com';
}

module.exports = { sendPasswordResetEmail };
