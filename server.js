/**
 * server.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Express.js API wrapper for emailReplyService.js
 * Provides HTTP endpoints to test all email service features
 * ─────────────────────────────────────────────────────────────────────────────
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const { body, validationResult, param } = require('express-validator');

const emailService = require('./emailReplyService');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression({ level: 6, threshold: 1024 })); // Turbo compression
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CRITICAL FIX: Set trust proxy for multi-region deployment
// This allows express-rate-limit to correctly identify clients behind proxies
app.set('trust proxy', 1);

// Rate limiting - FIXED: Now works with trust proxy setting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  keyGenerator: (req, res) => {
    return req.ip; // Will use X-Forwarded-For if trust proxy is set
  },
  skip: (req, res) => {
    // Skip rate limiting for health checks
    return req.path === '/health' || req.path === '/api/health';
  }
});
app.use('/api/', limiter);

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0'
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0'
  });
});

// Service status endpoint
app.get('/api/email/status', async (req, res) => {
  try {
    const status = emailService.getServiceStatus();
    const health = emailService.getHealthCheck();
    const otpStatus = emailService.secureOTPService ? emailService.secureOTPService.getServiceStatus() : null;
    const trackingStats = emailService.emailTrackingService ? emailService.emailTrackingService.getDeliveryStats() : null;
    const analytics = emailService.analyticsService ? emailService.analyticsService.getAggregatedMetrics() : null;

    res.json({
      service: status,
      health: health,
      otp: otpStatus,
      tracking: trackingStats,
      analytics: analytics
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start email service - wrapped in try-catch
app.post('/api/email/start', async (req, res) => {
  try {
    // Check if emailReplyService exists and has startEmailReplyService method
    if (emailService && typeof emailService.startEmailReplyService === 'function') {
      const success = await emailService.startEmailReplyService();
      res.json({ success, message: success ? 'Email service started' : 'Failed to start email service' });
    } else {
      res.json({ success: false, message: 'Email reply service not available' });
    }
  } catch (err) {
    console.error('[emailService] Start error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Stop email service - wrapped in try-catch
app.post('/api/email/stop', async (req, res) => {
  try {
    if (emailService && typeof emailService.stopEmailReplyService === 'function') {
      emailService.stopEmailReplyService();
      res.json({ success: true, message: 'Email service stopped' });
    } else {
      res.json({ success: false, message: 'Email reply service not available' });
    }
  } catch (err) {
    console.error('[emailService] Stop error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Email Verification Endpoints
app.post('/api/email/verify', [
  body('email').isEmail().normalizeEmail(),
  body('memberName').optional().isString()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { email, memberName } = req.body;
    if (emailService.emailVerificationService) {
      const result = await emailService.emailVerificationService.sendVerificationEmail(email, memberName);
      res.json(result);
    } else {
      res.status(503).json({ error: 'Email verification service unavailable' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/email/verify/:token', [
  param('token').isString().isLength({ min: 64, max: 64 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { token } = req.params;
    if (emailService.emailVerificationService) {
      const result = await emailService.emailVerificationService.verifyEmailToken(token);
      res.json(result);
    } else {
      res.status(503).json({ error: 'Email verification service unavailable' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// OTP Password Reset Endpoints
app.post('/api/otp/request', [
  body('email').isEmail().normalizeEmail(),
  body('ipAddress').optional().isIP()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { email, ipAddress } = req.body;
    if (emailService.secureOTPService) {
      const result = await emailService.secureOTPService.requestPasswordResetOTP(email, ipAddress);
      res.json(result);
    } else {
      res.status(503).json({ error: 'OTP service unavailable' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/otp/verify', [
  body('email').isEmail().normalizeEmail(),
  body('otp').isString().isLength({ min: 6, max: 6 }),
  body('newPassword').isString().isLength({ min: 8 }),
  body('ipAddress').optional().isIP()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { email, otp, newPassword, ipAddress } = req.body;
    if (emailService.secureOTPService) {
      const result = await emailService.secureOTPService.verifyOTPAndResetPassword(email, otp, newPassword, ipAddress);
      res.json(result);
    } else {
      res.status(503).json({ error: 'OTP service unavailable' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Contribution Reminder Endpoints
app.post('/api/contribution/remind', [
  body('memberId').isInt()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { memberId } = req.body;
    if (emailService.databaseManager) {
      const member = await emailService.databaseManager.getMemberById(memberId);
      
      if (!member) {
        return res.status(404).json({ error: 'Member not found' });
      }

      if (emailService.contributionReminderService) {
        const contributionData = await emailService.contributionReminderService.getMemberContributionData(memberId);
        await emailService.contributionReminderService.sendContributionReminderEmail(member, contributionData);
      }
      
      res.json({ success: true, message: 'Contribution reminder sent' });
    } else {
      res.status(503).json({ error: 'Database manager unavailable' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dashboard Integration Endpoints
app.post('/api/dashboard/loan/request', [
  body('memberId').isInt(),
  body('amount').isFloat(),
  body('purpose').optional().isString()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { memberId, amount, purpose } = req.body;
    if (emailService.dashboardEmailService) {
      const result = await emailService.dashboardEmailService.requestLoanApproval(memberId, { amount, purpose });
      res.json(result);
    } else {
      res.status(503).json({ error: 'Dashboard email service unavailable' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/dashboard/loan/approve', [
  body('loanId').isInt(),
  body('adminId').isInt(),
  body('approved').isBoolean(),
  body('rejectionReason').optional().isString()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { loanId, adminId, approved, rejectionReason } = req.body;
    if (emailService.dashboardEmailService) {
      const result = await emailService.dashboardEmailService.processLoanApproval(loanId, adminId, approved, rejectionReason);
      res.json(result);
    } else {
      res.status(503).json({ error: 'Dashboard email service unavailable' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Member Approval Endpoints
app.post('/api/dashboard/member/approve', [
  body('memberId').isInt(),
  body('adminId').isInt(),
  body('approved').isBoolean(),
  body('denialReason').optional().isString()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { memberId, adminId, approved, denialReason } = req.body;
    if (emailService.dashboardEmailService) {
      const result = await emailService.dashboardEmailService.processMemberApproval(memberId, adminId, approved, denialReason);
      res.json(result);
    } else {
      res.status(503).json({ error: 'Dashboard email service unavailable' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SMS Fallback Endpoints
app.post('/api/sms/send', [
  body('phoneNumber').isString(),
  body('message').isString(),
  body('priority').optional().isIn(['urgent', 'critical', 'emergency'])
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { phoneNumber, message, priority } = req.body;
    if (emailService.smsFallbackService) {
      const result = await emailService.smsFallbackService.sendSMS(phoneNumber, message, priority);
      res.json(result);
    } else {
      res.status(503).json({ error: 'SMS service unavailable' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Analytics Endpoints
app.get('/api/analytics', async (req, res) => {
  try {
    const { timeRange } = req.query;
    if (emailService.analyticsService) {
      const report = emailService.analyticsService.generateReport(timeRange || '24h');
      res.json(report);
    } else {
      res.status(503).json({ error: 'Analytics service unavailable' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analytics/metrics', async (req, res) => {
  try {
    if (emailService.analyticsService) {
      const metrics = emailService.analyticsService.getAllMetrics();
      res.json(metrics);
    } else {
      res.status(503).json({ error: 'Analytics service unavailable' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cache Endpoints
app.post('/api/cache/set', [
  body('key').isString(),
  body('value').isObject(),
  body('ttl').optional().isInt()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { key, value, ttl } = req.body;
    if (emailService.redisCacheService) {
      const result = await emailService.redisCacheService.set(key, value, ttl);
      res.json({ success: result });
    } else {
      res.status(503).json({ error: 'Cache service unavailable' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cache/get/:key', [
  param('key').isString()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { key } = req.params;
    if (emailService.redisCacheService) {
      const value = await emailService.redisCacheService.get(key);
      res.json({ key, value });
    } else {
      res.status(503).json({ error: 'Cache service unavailable' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Webhook Endpoints
app.post('/api/webhook/register', [
  body('event').isString(),
  body('url').isURL(),
  body('secret').optional().isString()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { event, url, secret } = req.body;
    if (emailService.webhookService) {
      const webhook = emailService.webhookService.registerWebhook(event, url, secret);
      res.json({ success: true, webhook });
    } else {
      res.status(503).json({ error: 'Webhook service unavailable' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/webhook/trigger', [
  body('event').isString(),
  body('payload').isObject()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { event, payload } = req.body;
    if (emailService.webhookService) {
      const result = await emailService.webhookService.triggerWebhook(event, payload);
      res.json(result);
    } else {
      res.status(503).json({ error: 'Webhook service unavailable' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Multi-Language Endpoints
app.get('/api/language/available', (req, res) => {
  try {
    if (emailService.multiLanguageService) {
      const languages = emailService.multiLanguageService.getAvailableLanguages();
      res.json({ languages });
    } else {
      res.json({ languages: [] });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/language/translate/:lang/:key', [
  param('lang').isString(),
  param('key').isString()
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { lang, key } = req.params;
    if (emailService.multiLanguageService) {
      const translation = emailService.multiLanguageService.getTranslation(lang, key);
      res.json({ key, translation, language: lang });
    } else {
      res.status(503).json({ error: 'Language service unavailable' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PDF Generation Endpoints
app.post('/api/pdf/loan-statement', [
  body('loanId').isInt(),
  body('memberId').isInt()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { loanId, memberId } = req.body;
    if (emailService.databaseManager && emailService.pdfAttachmentService) {
      const loanData = await emailService.databaseManager.getLoanById(loanId);
      const memberData = await emailService.databaseManager.getMemberById(memberId);
      
      const pdfBuffer = await emailService.pdfAttachmentService.generateLoanStatementPDF(loanData, memberData);
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=loan-statement.pdf');
      res.send(pdfBuffer);
    } else {
      res.status(503).json({ error: 'PDF service unavailable' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Email Tracking Endpoints
app.post('/api/track/open/:trackingId', [
  param('trackingId').isString()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { trackingId } = req.params;
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip;
    
    if (emailService.emailTrackingService) {
      emailService.emailTrackingService.trackEmailOpen(trackingId, userAgent, ipAddress);
    }
    
    // Return a 1x1 transparent pixel
    const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.setHeader('Content-Type', 'image/gif');
    res.send(pixel);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Email Service API Server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔧 API endpoints: http://localhost:${PORT}/api/`);
  console.log(`✅ trust proxy: ENABLED (ready for multi-region deployment)`);
});

module.exports = app;

