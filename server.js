/**
 * server.js
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Express.js API wrapper for emailReplyService.js
 * Provides HTTP endpoints to test all email service features
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const { body, validationResult, param } = require('express-validator');

const emailService = require('./backend/emailReplyService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false // Disable CSP for testing
}));
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(compression({ level: 6, threshold: 1024 })); // Turbo compression
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
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
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    port: PORT
  });
});

// Debug endpoint to test all endpoints
app.get('/api/debug', (req, res) => {
  res.json({
    message: 'Debug endpoint working',
    timestamp: new Date().toISOString(),
    availableEndpoints: [
      'GET /health',
      'POST /api/auth/login',
      'POST /api/auth/member/login',
      'POST /api/auth/member/register',
      'POST /api/auth/logout',
      'GET /api/auth/verify',
      'GET /api/members/approved',
      'POST /api/meeting/send-link'
    ]
  });
});

// Service status endpoint
app.get('/api/email/status', async (req, res) => {
  try {
    const status = emailService.getServiceStatus();
    const health = emailService.getHealthCheck();
    const otpStatus = emailService.secureOTPService.getServiceStatus();
    const trackingStats = emailService.emailTrackingService.getDeliveryStats();
    const analytics = emailService.analyticsService.getAggregatedMetrics();

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

// Login endpoint for admin authentication
app.post('/api/auth/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').isString().isLength({ min: 1 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { email, password } = req.body;
    
    // Mock authentication - replace with actual database authentication
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@eldorethama.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    
    if (email === adminEmail && password === adminPassword) {
      const token = Buffer.from(`${email}:${Date.now()}`).toString('base64');
      res.json({
        success: true,
        token: token,
        user: {
          email: email,
          role: 'admin',
          name: 'Administrator'
        },
        message: 'Login successful'
      });
    } else {
      res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify token endpoint
app.get('/api/auth/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ valid: false, message: 'No token provided' });
    }
    
    // Mock token verification - replace with actual JWT verification
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const [email] = decoded.split(':');
    
    if (email) {
      res.json({
        valid: true,
        user: {
          email: email,
          role: 'admin',
          name: 'Administrator'
        }
      });
    } else {
      res.status(401).json({ valid: false, message: 'Invalid token' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Logout endpoint
app.post('/api/auth/logout', async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Member Login endpoint
app.post('/api/auth/member/login', [
  body('identity').isString(),
  body('password').isString().isLength({ min: 1 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { identity, password } = req.body;
    
    // Mock member authentication - replace with actual database authentication
    // Check if identity matches email or username
    const mockMembers = [
      { id: 1, email: 'member1@example.com', username: 'member1', password: 'password123', name: 'John Doe', status: 'approved' },
      { id: 2, email: 'member2@example.com', username: 'member2', password: 'password123', name: 'Jane Smith', status: 'approved' }
    ];
    
    const member = mockMembers.find(m => 
      (m.email === identity || m.username === identity) && m.password === password
    );
    
    if (member) {
      if (member.status !== 'approved') {
        return res.status(403).json({
          success: false,
          message: 'Your account is pending admin approval'
        });
      }
      
      const token = Buffer.from(`${member.id}:${member.email}:${Date.now()}`).toString('base64');
      res.json({
        success: true,
        token: token,
        user: {
          id: member.id,
          email: member.email,
          name: member.name,
          username: member.username,
          role: 'member'
        },
        message: 'Login successful'
      });
    } else {
      res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Member Registration endpoint
app.post('/api/auth/member/register', [
  body('name').isString().isLength({ min: 2 }),
  body('email').isEmail().normalizeEmail(),
  body('phone').isString().isLength({ min: 10 }),
  body('password').isString().isLength({ min: 6 }),
  body('pin').isString().isLength({ min: 4, max: 6 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { name, email, phone, password, pin } = req.body;
    
    // Mock member registration - replace with actual database storage
    const newMember = {
      id: Date.now(),
      name: name,
      email: email,
      phone: phone,
      password: password,
      pin: pin,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    
    // Send registration notification to admin via email service
    try {
      // Mock email notification - replace with actual email service call
      console.log('Registration notification sent to admin for:', newMember.email);
    } catch (emailError) {
      console.error('Failed to send registration notification:', emailError);
    }
    
    res.json({
      success: true,
      message: 'Registration successful. Your account is pending admin approval.',
      member: {
        id: newMember.id,
        name: newMember.name,
        email: newMember.email,
        status: newMember.status
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start email service
app.post('/api/email/start', async (req, res) => {
  try {
    const success = await emailService.startEmailReplyService();
    res.json({ success, message: success ? 'Email service started' : 'Failed to start email service' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stop email service
app.post('/api/email/stop', async (req, res) => {
  try {
    emailService.stopEmailReplyService();
    res.json({ success: true, message: 'Email service stopped' });
  } catch (err) {
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
    const result = await emailService.emailVerificationService.sendVerificationEmail(email, memberName);
    res.json(result);
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
    const result = await emailService.emailVerificationService.verifyEmailToken(token);
    res.json(result);
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
    const result = await emailService.secureOTPService.requestPasswordResetOTP(email, ipAddress);
    res.json(result);
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
    const result = await emailService.secureOTPService.verifyOTPAndResetPassword(email, otp, newPassword, ipAddress);
    res.json(result);
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
    const member = await emailService.databaseManager.getMemberById(memberId);
    
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const contributionData = await emailService.contributionReminderService.getMemberContributionData(memberId);
    await emailService.contributionReminderService.sendContributionReminderEmail(member, contributionData);
    
    res.json({ success: true, message: 'Contribution reminder sent' });
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
    const result = await emailService.dashboardEmailService.requestLoanApproval(memberId, { amount, purpose });
    res.json(result);
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
    const result = await emailService.dashboardEmailService.processLoanApproval(loanId, adminId, approved, rejectionReason);
    res.json(result);
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
    const result = await emailService.dashboardEmailService.processMemberApproval(memberId, adminId, approved, denialReason);
    res.json(result);
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
    const result = await emailService.smsFallbackService.sendSMS(phoneNumber, message, priority);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Analytics Endpoints
app.get('/api/analytics', async (req, res) => {
  try {
    const { timeRange } = req.query;
    const report = emailService.analyticsService.generateReport(timeRange || '24h');
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analytics/metrics', async (req, res) => {
  try {
    const metrics = emailService.analyticsService.getAllMetrics();
    res.json(metrics);
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
    const result = await emailService.redisCacheService.set(key, value, ttl);
    res.json({ success: result });
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
    const value = await emailService.redisCacheService.get(key);
    res.json({ key, value });
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
    const webhook = emailService.webhookService.registerWebhook(event, url, secret);
    res.json({ success: true, webhook });
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
    const result = await emailService.webhookService.triggerWebhook(event, payload);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Multi-Language Endpoints
app.get('/api/language/available', (req, res) => {
  try {
    const languages = emailService.multiLanguageService.getAvailableLanguages();
    res.json({ languages });
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
    const translation = emailService.multiLanguageService.getTranslation(lang, key);
    res.json({ key, translation, language: lang });
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
    const loanData = await emailService.databaseManager.getLoanById(loanId);
    const memberData = await emailService.databaseManager.getMemberById(memberId);
    
    const pdfBuffer = await emailService.pdfAttachmentService.generateLoanStatementPDF(loanData, memberData);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=loan-statement.pdf');
    res.send(pdfBuffer);
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
    
    emailService.emailTrackingService.trackEmailOpen(trackingId, userAgent, ipAddress);
    
    // Return a 1x1 transparent pixel
    const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.setHeader('Content-Type', 'image/gif');
    res.send(pixel);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Member Management Endpoints
app.get('/api/members/approved', async (req, res) => {
  try {
    // Mock approved members data - replace with actual database query
    const approvedMembers = [
      { id: 1, first_name: 'John', last_name: 'Doe', email: 'john@example.com' },
      { id: 2, first_name: 'Jane', last_name: 'Smith', email: 'jane@example.com' },
      { id: 3, first_name: 'Michael', last_name: 'Johnson', email: 'michael@example.com' }
    ];
    
    res.json({ success: true, members: approvedMembers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Meeting Link Sending Endpoint
app.post('/api/meeting/send-link', [
  body('members').isArray(),
  body('meetingLink').isURL()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { members, meetingLink } = req.body;
    
    // Mock email sending - replace with actual email service
    const results = members.map(memberId => ({
      memberId,
      status: 'sent',
      timestamp: new Date().toISOString()
    }));
    
    res.json({
      success: true,
      message: `Meeting link sent to ${members.length} members`,
      results
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Meeting Data Storage Endpoint
app.post('/api/meeting/save', async (req, res) => {
  try {
    const meetingData = req.body;
    
    // Mock saving meeting data - replace with actual database storage
    const savedMeeting = {
      id: Date.now(),
      ...meetingData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    res.json({
      success: true,
      meeting: savedMeeting,
      message: 'Meeting data saved successfully'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Meeting Data Retrieval Endpoint
app.get('/api/meeting/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Mock retrieving meeting data - replace with actual database query
    const meetingData = {
      id: parseInt(id),
      title: 'Sample Meeting',
      createdAt: new Date().toISOString(),
      // ... other meeting fields
    };
    
    res.json({
      success: true,
      meeting: meetingData
    });
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
app.listen(PORT, () => {
  console.log(`ðŸš€ Email Service API Server running on http://localhost:${PORT}`);
  console.log(`ðŸ“Š Health check: http://localhost:${PORT}/health`);
  console.log(`ðŸ”§ API endpoints: http://localhost:${PORT}/api/`);
  console.log(`ðŸ“š API documentation: http://localhost:${PORT}/api/docs`);
});

module.exports = app;
