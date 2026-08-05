/**
 * emailReplyService.js
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Enterprise-grade Automatic email reply and processing service.
 * Monitors inbox for replies and processes them automatically.
 * Features: High throughput, security, resilience, observability.
 * New: Scheduled emails, database integration, dynamic templates.
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 */

const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const { EventEmitter } = require('events');
const { Sequelize, DataTypes } = require('sequelize');
const cron = require('node-cron');

require('dotenv').config({ path: path.join(__dirname, '.env') });

// Enterprise-grade logging system
class Logger {
  constructor(serviceName) {
    this.serviceName = serviceName;
    this.logLevel = process.env.LOG_LEVEL || 'info';
    this.levels = { error: 0, warn: 1, info: 2, debug: 3 };
    this.metrics = {
      totalProcessed: 0,
      successfulReplies: 0,
      failedReplies: 0,
      rateLimitHits: 0,
      errors: []
    };
  }

  log(level, message, meta = {}) {
    if (this.levels[level] <= this.levels[this.logLevel]) {
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        service: this.serviceName,
        level,
        message,
        ...meta
      };
      
      // Sensitive data redaction
      const safeEntry = this.redactSensitiveData(logEntry);
      
      console.log(JSON.stringify(safeEntry));
      
      // Track metrics
      if (level === 'error') {
        this.metrics.errors.push({ timestamp, message, ...meta });
        if (this.metrics.errors.length > 1000) this.metrics.errors.shift();
      }
    }
  }

  error(message, meta) { this.log('error', message, meta); }
  warn(message, meta) { this.log('warn', message, meta); }
  info(message, meta) { this.log('info', message, meta); }
  debug(message, meta) { this.log('debug', message, meta); }

  redactSensitiveData(data) {
    const sensitiveKeys = ['password', 'token', 'secret', 'credential', 'auth'];
    const redacted = JSON.parse(JSON.stringify(data));
    
    const redact = (obj) => {
      if (typeof obj !== 'object' || obj === null) return obj;
      
      for (const key in obj) {
        if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object') {
          redact(obj[key]);
        }
      }
      return obj;
    };
    
    return redact(redacted);
  }

  getMetrics() {
    return {
      ...this.metrics,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
  }
}

const logger = new Logger('emailReplyService');

// Database integration for real member data
class DatabaseManager {
  constructor() {
    this.sequelize = null;
    this.Member = null;
    this.Admin = null;
    this.Loan = null;
    this.Meeting = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      this.sequelize = new Sequelize(
        process.env.DB_NAME || 'loan_management',
        process.env.DB_USER || 'root',
        process.env.DB_PASS || '',
        {
          host: process.env.DB_HOST || 'localhost',
          dialect: process.env.DB_DIALECT || 'mysql',
          port: parseInt(process.env.DB_PORT) || 3306,
          logging: (msg) => logger.debug('Database query', { message: msg }),
          pool: {
            max: parseInt(process.env.DB_POOL_MAX) || 10,
            min: parseInt(process.env.DB_POOL_MIN) || 0,
            acquire: parseInt(process.env.DB_POOL_ACQUIRE) || 30000,
            idle: parseInt(process.env.DB_POOL_IDLE) || 10000
          }
        }
      );

      // Define Member model
      this.Member = this.sequelize.define('Member', {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        first_name: {
          type: DataTypes.STRING(100),
          allowNull: false
        },
        last_name: {
          type: DataTypes.STRING(100),
          allowNull: false
        },
        email: {
          type: DataTypes.STRING(255),
          allowNull: false,
          unique: true,
          validate: {
            isEmail: true
          }
        },
        password: {
          type: DataTypes.STRING(255),
          allowNull: false
        },
        phone: {
          type: DataTypes.STRING(20)
        },
        status: {
          type: DataTypes.ENUM('active', 'inactive', 'pending', 'suspended'),
          defaultValue: 'pending'
        },
        membership_date: {
          type: DataTypes.DATE
        },
        timezone: {
          type: DataTypes.STRING(50),
          defaultValue: 'UTC'
        },
        email_preferences: {
          type: DataTypes.JSON,
          defaultValue: {
            loan_updates: true,
            meeting_notifications: true,
            approval_alerts: true,
            daily_summaries: true
          }
        },
        password_changed_at: {
          type: DataTypes.DATE
        }
      }, {
        tableName: 'members',
        timestamps: true
      });

      // Define Admin model
      this.Admin = this.sequelize.define('Admin', {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        first_name: {
          type: DataTypes.STRING(100),
          allowNull: false
        },
        last_name: {
          type: DataTypes.STRING(100),
          allowNull: false
        },
        email: {
          type: DataTypes.STRING(255),
          allowNull: false,
          unique: true
        },
        role: {
          type: DataTypes.ENUM('super_admin', 'admin', 'treasurer', 'secretary'),
          defaultValue: 'admin'
        },
        department: {
          type: DataTypes.STRING(100)
        },
        status: {
          type: DataTypes.ENUM('active', 'inactive'),
          defaultValue: 'active'
        }
      }, {
        tableName: 'admins',
        timestamps: true
      });

      // Define Loan model
      this.Loan = this.sequelize.define('Loan', {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        member_id: {
          type: DataTypes.INTEGER,
          allowNull: false
        },
        amount: {
          type: DataTypes.DECIMAL(15, 2),
          allowNull: false
        },
        purpose: {
          type: DataTypes.TEXT
        },
        status: {
          type: DataTypes.ENUM('pending', 'approved', 'rejected', 'disbursed', 'paid'),
          defaultValue: 'pending'
        },
        requested_date: {
          type: DataTypes.DATE
        },
        approved_date: {
          type: DataTypes.DATE
        },
        approved_by: {
          type: DataTypes.INTEGER
        },
        rejection_reason: {
          type: DataTypes.TEXT
        }
      }, {
        tableName: 'loans',
        timestamps: true
      });

      // Define Meeting model
      this.Meeting = this.sequelize.define('Meeting', {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        title: {
          type: DataTypes.STRING(255),
          allowNull: false
        },
        description: {
          type: DataTypes.TEXT
        },
        scheduled_date: {
          type: DataTypes.DATE,
          allowNull: false
        },
        scheduled_time: {
          type: DataTypes.TIME,
          allowNull: false
        },
        location: {
          type: DataTypes.STRING(255)
        },
        status: {
          type: DataTypes.ENUM('scheduled', 'completed', 'cancelled'),
          defaultValue: 'scheduled'
        },
        created_by: {
          type: DataTypes.INTEGER
        }
      }, {
        tableName: 'meetings',
        timestamps: true
      });

      // Set up model associations
      this.Loan.belongsTo(this.Member, { foreignKey: 'member_id', as: 'member' });
      this.Member.hasMany(this.Loan, { foreignKey: 'member_id', as: 'loans' });
      
      this.Meeting.belongsTo(this.Admin, { foreignKey: 'created_by', as: 'creator' });
      this.Admin.hasMany(this.Meeting, { foreignKey: 'created_by', as: 'meetings' });

      // Test connection
      await this.sequelize.authenticate();
      this.isConnected = true;
      logger.info('Database connected successfully');

      return true;
    } catch (err) {
      logger.error('Database connection failed', { error: err.message });
      this.isConnected = false;
      return false;
    }
  }

  async getAllActiveMembers() {
    try {
      const members = await this.Member.findAll({
        where: { status: 'active' },
        attributes: ['id', 'first_name', 'last_name', 'email', 'timezone', 'email_preferences']
      });
      return members.map(m => m.toJSON());
    } catch (err) {
      logger.error('Error fetching active members', { error: err.message });
      return [];
    }
  }

  async getMemberById(memberId) {
    try {
      const member = await this.Member.findByPk(memberId);
      return member ? member.toJSON() : null;
    } catch (err) {
      logger.error('Error fetching member by ID', { error: err.message, memberId });
      return null;
    }
  }

  async getAdminById(adminId) {
    try {
      const admin = await this.Admin.findByPk(adminId);
      return admin ? admin.toJSON() : null;
    } catch (err) {
      logger.error('Error fetching admin by ID', { error: err.message, adminId });
      return null;
    }
  }

  async getLoanById(loanId) {
    try {
      const loan = await this.Loan.findByPk(loanId, {
        include: [{
          model: this.Member,
          as: 'member'
        }]
      });
      return loan ? loan.toJSON() : null;
    } catch (err) {
      logger.error('Error fetching loan by ID', { error: err.message, loanId });
      return null;
    }
  }

  async getPendingLoans() {
    try {
      const loans = await this.Loan.findAll({
        where: { status: 'pending' },
        include: [{
          model: this.Member,
          as: 'member'
        }]
      });
      return loans.map(l => l.toJSON());
    } catch (err) {
      logger.error('Error fetching pending loans', { error: err.message });
      return [];
    }
  }

  async getUpcomingMeetings() {
    try {
      const meetings = await this.Meeting.findAll({
        where: { 
          status: 'scheduled',
          scheduled_date: { [Sequelize.Op.gte]: new Date() }
        },
        order: [['scheduled_date', 'ASC']]
      });
      return meetings.map(m => m.toJSON());
    } catch (err) {
      logger.error('Error fetching upcoming meetings', { error: err.message });
      return [];
    }
  }

  async updateLoanStatus(loanId, status, approvedBy = null, rejectionReason = null) {
    try {
      const updateData = { status };
      if (approvedBy) updateData.approved_by = approvedBy;
      if (status === 'approved') updateData.approved_date = new Date();
      if (rejectionReason) updateData.rejection_reason = rejectionReason;

      await this.Loan.update(updateData, {
        where: { id: loanId }
      });
      return true;
    } catch (err) {
      logger.error('Error updating loan status', { error: err.message, loanId, status });
      return false;
    }
  }

  async getConnection() {
    return this.sequelize;
  }

  isConnectedToDatabase() {
    return this.isConnected;
  }
}

const databaseManager = new DatabaseManager();

// Secure OTP Service for Password Reset
class SecureOTPService extends EventEmitter {
  constructor() {
    super();
    this.otpLength = parseInt(process.env.OTP_LENGTH) || 6;
    this.otpExpiry = parseInt(process.env.OTP_EXPIRY_MINUTES) || 10; // minutes
    this.maxAttempts = parseInt(process.env.OTP_MAX_ATTEMPTS) || 3;
    this.rateLimitWindow = parseInt(process.env.OTP_RATE_LIMIT_WINDOW) || 3600000; // 1 hour
    this.maxOTPsPerWindow = parseInt(process.env.OTP_MAX_PER_WINDOW) || 5;
    this.otpAttempts = new Map(); // Track OTP attempts by IP/email
    this.otpRateLimit = new Map(); // Track OTP generation rate
    this.encryptionKey = process.env.OTP_ENCRYPTION_KEY || this.generateEncryptionKey();
  }

  generateEncryptionKey() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Generate cryptographically secure OTP
   */
  generateOTP() {
    // Use crypto.randomBytes for cryptographically secure random numbers
    const randomBytes = crypto.randomBytes(this.otpLength);
    const otp = Array.from(randomBytes)
      .map(byte => byte % 10) // Convert to single digit
      .join('');
    
    return otp;
  }

  /**
   * Encrypt OTP for database storage
   */
  encryptOTP(otp) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(this.encryptionKey, 'hex'), iv);
    
    let encrypted = cipher.update(otp, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted: encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  }

  /**
   * Decrypt OTP from database
   */
  decryptOTP(encryptedData) {
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm', 
        Buffer.from(this.encryptionKey, 'hex'), 
        Buffer.from(encryptedData.iv, 'hex')
      );
      
      decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
      
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (err) {
      logger.error('OTP decryption failed', { error: err.message });
      return null;
    }
  }

  /**
   * Hash OTP for verification (prevents timing attacks)
   */
  hashOTP(otp) {
    return crypto.createHash('sha256').update(otp).digest('hex');
  }

  /**
   * Check rate limit for OTP generation
   */
  checkRateLimit(identifier) {
    const now = Date.now();
    const record = this.otpRateLimit.get(identifier);
    
    if (!record) {
      this.otpRateLimit.set(identifier, { count: 1, windowStart: now });
      return true;
    }
    
    // Reset if window expired
    if (now - record.windowStart > this.rateLimitWindow) {
      this.otpRateLimit.set(identifier, { count: 1, windowStart: now });
      return true;
    }
    
    // Check if limit exceeded
    if (record.count >= this.maxOTPsPerWindow) {
      logger.warn('OTP rate limit exceeded', { identifier, count: record.count });
      return false;
    }
    
    record.count++;
    return true;
  }

  /**
   * Check OTP attempt limits
   */
  checkAttemptLimits(identifier) {
    const now = Date.now();
    const attempts = this.otpAttempts.get(identifier);
    
    if (!attempts) {
      this.otpAttempts.set(identifier, { count: 1, lastAttempt: now });
      return true;
    }
    
    // Reset if time window passed (30 minutes)
    if (now - attempts.lastAttempt > 1800000) {
      this.otpAttempts.set(identifier, { count: 1, lastAttempt: now });
      return true;
    }
    
    // Check if max attempts exceeded
    if (attempts.count >= this.maxAttempts) {
      logger.warn('OTP attempt limit exceeded', { identifier, count: attempts.count });
      return false;
    }
    
    attempts.count++;
    attempts.lastAttempt = now;
    return true;
  }

  /**
   * Request password reset OTP
   */
  async requestPasswordResetOTP(email, ipAddress = 'unknown') {
    try {
      // Validate email format
      if (!this.isValidEmail(email)) {
        logger.warn('Invalid email format for OTP request', { email, ipAddress });
        return { success: false, error: 'Invalid email format' };
      }

      // Check rate limits
      if (!this.checkRateLimit(email)) {
        return { success: false, error: 'Too many OTP requests. Please try again later.' };
      }

      // Check if member exists
      const member = await databaseManager.getMemberByEmail(email);
      if (!member) {
        // Still return success for security (don't reveal if email exists)
        logger.info('OTP requested for non-existent email', { email, ipAddress });
        return { success: true, message: 'If an account exists, you will receive an OTP.' };
      }

      // Generate OTP
      const otp = this.generateOTP();
      const expiresAt = new Date(Date.now() + (this.otpExpiry * 60 * 1000));
      
      // Encrypt OTP for storage
      const encryptedOTP = this.encryptOTP(otp);
      
      // Store in database
      const otpRecord = await databaseManager.createOTPRecord({
        email: email,
        encryptedOTP: encryptedOTP,
        expiresAt: expiresAt,
        ipAddress: ipAddress,
        attempts: 0,
        used: false
      });

      // Send OTP email
      const emailSent = await this.sendOTPEmail(member, otp, expiresAt);
      
      if (emailSent) {
        logger.info('Password reset OTP sent successfully', { 
          email, 
          ipAddress, 
          expiresAt: expiresAt.toISOString(),
          otpId: otpRecord.id 
        });
        
        this.emit('otp_sent', { email, ipAddress, expiresAt });
        
        return { 
          success: true, 
          message: 'OTP sent successfully. Valid for 10 minutes.',
          expiresAt: expiresAt.toISOString()
        };
      } else {
        // Rollback OTP creation if email failed
        await databaseManager.deleteOTPRecord(otpRecord.id);
        return { success: false, error: 'Failed to send OTP email' };
      }
      
    } catch (err) {
      logger.error('Failed to request password reset OTP', { error: err.message, email, ipAddress });
      return { success: false, error: 'Failed to process OTP request' };
    }
  }

  /**
   * Verify OTP and reset password
   */
  async verifyOTPAndResetPassword(email, otp, newPassword, ipAddress = 'unknown') {
    try {
      // Validate inputs
      if (!this.isValidEmail(email)) {
        return { success: false, error: 'Invalid email format' };
      }

      if (!otp || otp.length !== this.otpLength) {
        return { success: false, error: 'Invalid OTP format' };
      }

      if (!this.isValidPassword(newPassword)) {
        return { success: false, error: 'Password does not meet security requirements' };
      }

      // Check attempt limits
      if (!this.checkAttemptLimits(email)) {
        return { success: false, error: 'Too many failed attempts. Please request a new OTP.' };
      }

      // Get valid OTP record
      const otpRecord = await databaseManager.getValidOTPRecord(email);
      if (!otpRecord) {
        logger.warn('No valid OTP record found', { email, ipAddress });
        return { success: false, error: 'Invalid or expired OTP' };
      }

      // Decrypt stored OTP
      const storedOTP = this.decryptOTP(otpRecord.encryptedOTP);
      if (!storedOTP) {
        logger.error('Failed to decrypt OTP', { otpId: otpRecord.id });
        return { success: false, error: 'OTP verification failed' };
      }

      // Verify OTP using constant-time comparison to prevent timing attacks
      const isValid = this.constantTimeCompare(otp, storedOTP);
      
      if (!isValid) {
        // Increment attempt counter
        await databaseManager.incrementOTPAttempts(otpRecord.id);
        logger.warn('OTP verification failed', { email, ipAddress, otpId: otpRecord.id });
        return { success: false, error: 'Invalid OTP' };
      }

      // Mark OTP as used
      await databaseManager.markOTPAsUsed(otpRecord.id);

      // Update member password
      const passwordReset = await databaseManager.updateMemberPassword(email, newPassword);
      
      if (passwordReset) {
        // Clear all existing sessions for this user
        await databaseManager.clearUserSessions(email);
        
        logger.info('Password reset successful', { 
          email, 
          ipAddress, 
          otpId: otpRecord.id 
        });
        
        this.emit('password_reset', { email, ipAddress });
        
        return { 
          success: true, 
          message: 'Password reset successfully. Please login with your new password.' 
        };
      } else {
        return { success: false, error: 'Failed to update password' };
      }
      
    } catch (err) {
      logger.error('Failed to verify OTP and reset password', { error: err.message, email, ipAddress });
      return { success: false, error: 'Password reset failed' };
    }
  }

  /**
   * Constant-time comparison to prevent timing attacks
   */
  constantTimeCompare(a, b) {
    if (a.length !== b.length) {
      return false;
    }
    
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    
    return result === 0;
  }

  /**
   * Validate email format
   */
  isValidEmail(email) {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
  }

  /**
   * Validate password strength
   */
  isValidPassword(password) {
    // Minimum 8 characters
    if (password.length < 8) {
      return false;
    }
    
    // At least one uppercase letter
    if (!/[A-Z]/.test(password)) {
      return false;
    }
    
    // At least one lowercase letter
    if (!/[a-z]/.test(password)) {
      return false;
    }
    
    // At least one number
    if (!/[0-9]/.test(password)) {
      return false;
    }
    
    // At least one special character
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      return false;
    }
    
    // Check against common passwords (basic check)
    const commonPasswords = ['password', '12345678', 'qwerty', 'abc123', 'password123'];
    if (commonPasswords.includes(password.toLowerCase())) {
      return false;
    }
    
    return true;
  }

  /**
   * Send OTP email with security features
   */
  async sendOTPEmail(member, otp, expiresAt) {
    try {
      const { sendEmail } = require('./emailService');
      
      const otpEmail = this.generateOTPEmail(member, otp, expiresAt);
      
      await sendEmail(member.email, otpEmail.subject, otpEmail.html);
      
      return true;
    } catch (err) {
      logger.error('Failed to send OTP email', { error: err.message, email: member.email });
      return false;
    }
  }

  /**
   * Generate OTP email template
   */
  generateOTPEmail(member, otp, expiresAt) {
    const trackingId = crypto.randomBytes(16).toString('hex').substring(0, 8);
    const currentYear = new Date().getFullYear();
    const memberName = `${member.first_name} ${member.last_name}`;
    const expiresAtFormatted = new Date(expiresAt).toLocaleString();
    
    // Format OTP for better readability
    const formattedOTP = otp.slice(0, 3) + '-' + otp.slice(3);

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset OTP</title>
  <style>
    body { margin: 0; padding: 0; background: #f0f4f8; font-family: 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #7c3aed 0%, #8b5cf6 100%); padding: 32px 40px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; }
    .body { padding: 36px 40px; color: #1e293b; line-height: 1.7; font-size: 15px; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; text-align: center; font-size: 12px; color: #94a3b8; }
    .otp-display { 
      background: linear-gradient(135deg, #ede9fe 0%, #c4b5fd 100%); 
      border: 2px solid #8b5cf6; 
      border-radius: 12px; 
      padding: 24px; 
      text-align: center; 
      margin: 24px 0; 
    }
    .otp-code { 
      font-size: 36px; 
      font-weight: 700; 
      letter-spacing: 8px; 
      color: #7c3aed; 
      font-family: 'Courier New', monospace; 
    }
    .warning { 
      background: #fef3c7; 
      border: 1px solid #fcd34d; 
      border-radius: 8px; 
      padding: 16px; 
      margin: 20px 0; 
    }
    .tracking { font-family: monospace; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>ðŸ” Password Reset Request</h1>
      <p>One-Time Password (OTP)</p>
    </div>
    <div class="body">
      <h2>Dear ${memberName},</h2>
      <p>We received a request to reset your password for the Loan Management System. Please use the following One-Time Password (OTP) to complete the password reset process:</p>
      
      <div class="otp-display">
        <div class="otp-code">${formattedOTP}</div>
        <div style="margin-top: 12px; color: #6b7280; font-size: 14px;">
          Valid for 10 minutes
        </div>
      </div>
      
      <div class="warning">
        <strong>âš ï¸ Security Notice:</strong>
        <ul style="margin: 12px 0; padding-left: 20px;">
          <li>This OTP is valid for 10 minutes only</li>
          <li>Never share your OTP with anyone</li>
          <li>Our team will never ask for your OTP</li>
          <li>If you didn't request this, ignore this email</li>
        </ul>
      </div>
      
      <p><strong>How to use this OTP:</strong></p>
      <ol style="margin: 16px 0; padding-left: 20px;">
        <li>Enter this OTP in the password reset form</li>
        <li>Create your new password (must be at least 8 characters with uppercase, lowercase, numbers, and special characters)</li>
        <li>Confirm your new password</li>
        <li>Submit the form to complete the reset</li>
      </ol>
      
      <div style="background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <strong>Expires:</strong> ${expiresAtFormatted}<br>
        <strong>Tracking ID:</strong> <span class="tracking">${trackingId}</span>
      </div>
    </div>
    <div class="footer">
      <p>This is an automated message. If you didn't request this password reset, please contact support immediately.</p>
      <p>Â© ${currentYear} Loan Management System. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

    logger.debug('Generated OTP email', { trackingId, email: member.email });
    return { html, subject: 'ðŸ” Password Reset OTP - Your Security Code', trackingId };
  }

  /**
   * Get OTP service status
   */
  getServiceStatus() {
    return {
      isRunning: true,
      otpLength: this.otpLength,
      otpExpiryMinutes: this.otpExpiry,
      maxAttempts: this.maxAttempts,
      rateLimitWindow: this.rateLimitWindow,
      maxOTPsPerWindow: this.maxOTPsPerWindow,
      activeRequests: this.otpAttempts.size,
      rateLimitEntries: this.otpRateLimit.size
    };
  }

  /**
   * Clean up expired OTP records
   */
  async cleanupExpiredOTPs() {
    try {
      const deleted = await databaseManager.deleteExpiredOTPRecords();
      if (deleted > 0) {
        logger.info('Cleaned up expired OTP records', { count: deleted });
      }
    } catch (err) {
      logger.error('Failed to cleanup expired OTPs', { error: err.message });
    }
  }
}

const secureOTPService = new SecureOTPService();

// Scheduled email system with timezone awareness
class ScheduledEmailService extends EventEmitter {
  constructor() {
    super();
    this.scheduledJobs = new Map();
    this.timezone = process.env.DEFAULT_TIMEZONE || 'UTC';
    this.scheduleTimes = [
      { hour: 9, minute: 0, name: 'morning_summary' },
      { hour: 13, minute: 0, name: 'afternoon_summary' },
      { hour: 20, minute: 0, name: 'evening_summary' }
    ];
  }

  async initialize() {
    logger.info('Initializing scheduled email service', { timezone: this.timezone });
    
    // Clear existing jobs
    this.stopAllJobs();
    
    // Schedule daily emails at specified times
    for (const schedule of this.scheduleTimes) {
      await this.scheduleDailyEmail(schedule);
    }
    
    logger.info('Scheduled email service initialized', { 
      schedules: this.scheduleTimes.map(s => s.name) 
    });
  }

  async scheduleDailyEmail(schedule) {
    const cronExpression = `${schedule.minute} ${schedule.hour} * * *`;
    
    try {
      const job = cron.schedule(cronExpression, async () => {
        await this.sendDailyMemberEmails(schedule.name);
      }, {
        scheduled: true,
        timezone: this.timezone
      });
      
      this.scheduledJobs.set(schedule.name, job);
      logger.info(`Scheduled ${schedule.name} at ${schedule.hour}:00`, { timezone: this.timezone });
    } catch (err) {
      logger.error(`Failed to schedule ${schedule.name}`, { error: err.message, schedule });
    }
  }

  async sendDailyMemberEmails(scheduleName) {
    const startTime = Date.now();
    logger.info(`Starting ${scheduleName} email distribution`);
    
    try {
      if (!databaseManager.isConnectedToDatabase()) {
        logger.error('Database not connected, skipping scheduled email');
        return;
      }

      const members = await databaseManager.getAllActiveMembers();
      let sentCount = 0;
      let failedCount = 0;

      for (const member of members) {
        try {
          // Check member's email preferences
          if (!member.email_preferences?.daily_summaries) {
            logger.debug('Member opted out of daily summaries', { memberId: member.id });
            continue;
          }

          // Calculate member's local time
          const memberLocalTime = this.getMemberLocalTime(member.timezone);
          const memberHour = memberLocalTime.getHours();

          // Only send if it's appropriate time for member's timezone
          if (this.shouldSendToMember(memberHour, scheduleName)) {
            await this.sendPersonalizedDailyEmail(member, scheduleName);
            sentCount++;
          }
        } catch (err) {
          logger.error('Error sending daily email to member', { 
            error: err.message, 
            memberId: member.id 
          });
          failedCount++;
        }
      }

      const duration = Date.now() - startTime;
      logger.info(`Completed ${scheduleName} email distribution`, { 
        sentCount, 
        failedCount, 
        totalMembers: members.length,
        duration 
      });

      this.emit('daily_email_completed', { scheduleName, sentCount, failedCount, duration });
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`Failed to complete ${scheduleName} email distribution`, { 
        error: err.message, 
        duration 
      });
    }
  }

  getMemberLocalTime(memberTimezone) {
    try {
      return new Date().toLocaleString('en-US', { timeZone: memberTimezone });
    } catch (err) {
      return new Date(); // Fallback to system time
    }
  }

  shouldSendToMember(memberHour, scheduleName) {
    // Define appropriate time windows for each schedule
    const timeWindows = {
      morning_summary: { min: 8, max: 10 },
      afternoon_summary: { min: 12, max: 14 },
      evening_summary: { min: 19, max: 21 }
    };

    const window = timeWindows[scheduleName];
    return memberHour >= window.min && memberHour <= window.max;
  }

  async sendPersonalizedDailyEmail(member, scheduleName) {
    const { sendEmail } = require('./emailService');
    
    // Get member's loan status
    const pendingLoans = await databaseManager.getPendingLoansByMember(member.id);
    const upcomingMeetings = await databaseManager.getUpcomingMeetingsForMember(member.id);
    
    const subject = this.getDailySubject(scheduleName);
    const body = generateDailySummaryEmail(member, pendingLoans, upcomingMeetings, scheduleName);
    
    await sendEmail(member.email, subject, body);
    logger.info('Daily email sent to member', { 
      memberId: member.id, 
      email: member.email,
      scheduleName 
    });
  }

  getDailySubject(scheduleName) {
    const subjects = {
      morning_summary: 'ðŸŒ… Morning Loan Management Summary',
      afternoon_summary: 'â˜€ï¸ Afternoon Loan Management Update',
      evening_summary: 'ðŸŒ™ Evening Loan Management Summary'
    };
    return subjects[scheduleName] || 'Daily Loan Management Summary';
  }

  stopAllJobs() {
    for (const [name, job] of this.scheduledJobs) {
      job.stop();
      logger.info(`Stopped scheduled job: ${name}`);
    }
    this.scheduledJobs.clear();
  }

  getScheduledJobs() {
    return Array.from(this.scheduledJobs.keys());
  }
}

// Extend DatabaseManager with OTP-related methods
DatabaseManager.prototype.getMemberByEmail = async function(email) {
  try {
    const member = await this.Member.findOne({
      where: { email: email.toLowerCase() }
    });
    return member ? member.toJSON() : null;
  } catch (err) {
    logger.error('Error fetching member by email', { error: err.message, email });
    return null;
  }
};

DatabaseManager.prototype.createOTPRecord = async function(otpData) {
  try {
    const OTPRecord = this.sequelize.define('OTPRecord', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false
      },
      encryptedOTP: {
        type: DataTypes.TEXT,
        allowNull: false
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      ipAddress: {
        type: DataTypes.STRING(45)
      },
      attempts: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      used: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
      }
    }, {
      tableName: 'otp_records',
      timestamps: true
    });

    await OTPRecord.sync();
    
    const record = await OTPRecord.create(otpData);
    return record.toJSON();
  } catch (err) {
    logger.error('Error creating OTP record', { error: err.message });
    throw err;
  }
};

DatabaseManager.prototype.getValidOTPRecord = async function(email) {
  try {
    const OTPRecord = this.sequelize.model('OTPRecord');
    
    const record = await OTPRecord.findOne({
      where: {
        email: email.toLowerCase(),
        used: false,
        expiresAt: {
          [Sequelize.Op.gt]: new Date()
        }
      },
      order: [['createdAt', 'DESC']]
    });
    
    return record ? record.toJSON() : null;
  } catch (err) {
    logger.error('Error fetching valid OTP record', { error: err.message, email });
    return null;
  }
};

DatabaseManager.prototype.incrementOTPAttempts = async function(otpId) {
  try {
    const OTPRecord = this.sequelize.model('OTPRecord');
    
    await OTPRecord.increment('attempts', {
      where: { id: otpId }
    });
    
    return true;
  } catch (err) {
    logger.error('Error incrementing OTP attempts', { error: err.message, otpId });
    return false;
  }
};

DatabaseManager.prototype.markOTPAsUsed = async function(otpId) {
  try {
    const OTPRecord = this.sequelize.model('OTPRecord');
    
    await OTPRecord.update(
      { used: true, usedAt: new Date() },
      { where: { id: otpId } }
    );
    
    return true;
  } catch (err) {
    logger.error('Error marking OTP as used', { error: err.message, otpId });
    return false;
  }
};

DatabaseManager.prototype.deleteOTPRecord = async function(otpId) {
  try {
    const OTPRecord = this.sequelize.model('OTPRecord');
    
    await OTPRecord.destroy({
      where: { id: otpId }
    });
    
    return true;
  } catch (err) {
    logger.error('Error deleting OTP record', { error: err.message, otpId });
    return false;
  }
};

DatabaseManager.prototype.deleteExpiredOTPRecords = async function() {
  try {
    const OTPRecord = this.sequelize.model('OTPRecord');
    
    const deleted = await OTPRecord.destroy({
      where: {
        used: true,
        expiresAt: {
          [Sequelize.Op.lt]: new Date(Date.now() - 86400000) // Delete used OTPs older than 24 hours
        }
      }
    });
    
    return deleted;
  } catch (err) {
    logger.error('Error deleting expired OTP records', { error: err.message });
    return 0;
  }
};

DatabaseManager.prototype.updateMemberPassword = async function(email, newPassword) {
  try {
    // Hash the new password
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    
    await this.Member.update(
      { password: hashedPassword, passwordChangedAt: new Date() },
      { where: { email: email.toLowerCase() } }
    );
    
    return true;
  } catch (err) {
    logger.error('Error updating member password', { error: err.message, email });
    return false;
  }
};

DatabaseManager.prototype.clearUserSessions = async function(email) {
  try {
    // If you have a sessions table, clear all sessions for this user
    // This would depend on your session management system
    logger.info('Clearing user sessions', { email });
    return true;
  } catch (err) {
    logger.error('Error clearing user sessions', { error: err.message, email });
    return false;
  }
};

DatabaseManager.prototype.getAllAdmins = async function() {
  try {
    const admins = await this.Admin.findAll({
      where: { status: 'active' }
    });
    return admins.map(a => a.toJSON());
  } catch (err) {
    logger.error('Error fetching all admins', { error: err.message });
    return [];
  }
};



// Add back the member-specific methods
DatabaseManager.prototype.getPendingLoansByMember = async function(memberId) {
  try {
    const loans = await this.Loan.findAll({
      where: { 
        member_id: memberId,
        status: 'pending'
      }
    });
    return loans.map(l => l.toJSON());
  } catch (err) {
    logger.error('Error fetching pending loans for member', { error: err.message, memberId });
    return [];
  }
};

DatabaseManager.prototype.getUpcomingMeetingsForMember = async function(memberId) {
  try {
    const meetings = await this.Meeting.findAll({
      where: { 
        status: 'scheduled',
        scheduled_date: { [Sequelize.Op.gte]: new Date() }
      },
      order: [['scheduled_date', 'ASC']],
      limit: 5
    });
    return meetings.map(m => m.toJSON());
  } catch (err) {
    logger.error('Error fetching upcoming meetings for member', { error: err.message, memberId });
    return [];
  }
};

const scheduledEmailService = new ScheduledEmailService();

// Secure credential management
class CredentialManager {
  constructor() {
    this.credentials = new Map();
    this.encryptionKey = process.env.ENCRYPTION_KEY || this.generateKey();
  }

  generateKey() {
    return crypto.randomBytes(32).toString('hex');
  }

  encrypt(text) {
    if (!text) return null;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(this.encryptionKey, 'hex'), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  decrypt(encryptedText) {
    if (!encryptedText) return null;
    try {
      const parts = encryptedText.split(':');
      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];
      const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(this.encryptionKey, 'hex'), iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      logger.error('Credential decryption failed', { error: err.message });
      return null;
    }
  }

  setCredential(key, value) {
    const encrypted = this.encrypt(value);
    this.credentials.set(key, encrypted);
  }

  getCredential(key) {
    const encrypted = this.credentials.get(key);
    return this.decrypt(encrypted);
  }

  validateCredential(key, value) {
    const stored = this.getCredential(key);
    return stored && stored === value;
  }
}

const credentialManager = new CredentialManager();

// Gracefully handle missing dependencies
let Imap, simpleParser;
try {
  Imap = require('imap');
  simpleParser = require('mailparser').simpleParser;
  logger.info('IMAP dependencies loaded successfully');
} catch (err) {
  logger.warn('IMAP dependencies not installed. Auto-reply disabled. Run: npm install imap mailparser');
  Imap = null;
  simpleParser = null;
}

// Circuit breaker pattern for resilience
class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.threshold = threshold;
    this.timeout = timeout;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = 'closed'; // closed, open, half-open
  }

  async execute(fn) {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'half-open';
        logger.info('Circuit breaker entering half-open state');
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    if (this.state === 'half-open') {
      this.state = 'closed';
      logger.info('Circuit breaker closed after successful execution');
    }
  }

  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.threshold) {
      this.state = 'open';
      logger.error('Circuit breaker opened due to repeated failures', { 
        failureCount: this.failureCount,
        threshold: this.threshold 
      });
    }
  }

  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime
    };
  }
}

// Message queue for high throughput processing
class MessageQueue {
  constructor(concurrency = 10) {
    this.queue = [];
    this.processing = new Set();
    this.concurrency = concurrency;
    this.stats = {
      enqueued: 0,
      processed: 0,
      failed: 0,
      dropped: 0
    };
  }

  enqueue(task, priority = 0) {
    if (this.queue.length >= 10000) {
      this.stats.dropped++;
      logger.warn('Message queue full, dropping task', { queueSize: this.queue.length });
      return false;
    }

    this.queue.push({ task, priority, timestamp: Date.now() });
    this.queue.sort((a, b) => b.priority - a.priority);
    this.stats.enqueued++;
    this.processQueue();
    return true;
  }

  async processQueue() {
    while (this.queue.length > 0 && this.processing.size < this.concurrency) {
      const { task, timestamp } = this.queue.shift();
      const taskId = Date.now() + Math.random();
      
      this.processing.add(taskId);
      
      // Process task with timeout
      const timeout = setTimeout(() => {
        this.processing.delete(taskId);
        this.stats.failed++;
        logger.error('Task processing timeout', { taskId, age: Date.now() - timestamp });
      }, 30000);

      try {
        await task();
        clearTimeout(timeout);
        this.stats.processed++;
        logger.metrics.successfulReplies++;
      } catch (err) {
        clearTimeout(timeout);
        this.stats.failed++;
        logger.metrics.failedReplies++;
        logger.error('Task processing failed', { error: err.message, taskId });
      } finally {
        this.processing.delete(taskId);
      }
    }
  }

  getStats() {
    return {
      ...this.stats,
      queueLength: this.queue.length,
      processingCount: this.processing.size
    };
  }
}

// Performance monitoring
class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.alerts = [];
  }

  recordOperation(operation, duration, success = true) {
    if (!this.metrics.has(operation)) {
      this.metrics.set(operation, {
        count: 0,
        totalDuration: 0,
        failures: 0,
        maxDuration: 0,
        minDuration: Infinity,
        avgDuration: 0
      });
    }

    const metric = this.metrics.get(operation);
    metric.count++;
    metric.totalDuration += duration;
    metric.maxDuration = Math.max(metric.maxDuration, duration);
    metric.minDuration = Math.min(metric.minDuration, duration);
    metric.avgDuration = metric.totalDuration / metric.count;
    
    if (!success) metric.failures++;

    // Performance alerts
    if (duration > 5000) {
      this.alerts.push({
        type: 'slow_operation',
        operation,
        duration,
        timestamp: new Date().toISOString()
      });
      logger.warn('Slow operation detected', { operation, duration });
    }
  }

  getMetrics() {
    return {
      operations: Object.fromEntries(this.metrics),
      alerts: this.alerts.slice(-100), // Last 100 alerts
      timestamp: new Date().toISOString()
    };
  }

  clearAlerts() {
    this.alerts = [];
  }
}

// IMAP Configuration for receiving emails with enhanced options
const imapConfig = {
  user: process.env.EMAIL_USER,
  password: process.env.EMAIL_PASS,
  host: process.env.IMAP_HOST || 'imap.gmail.com',
  port: parseInt(process.env.IMAP_PORT) || 993,
  tls: true,
  connTimeout: parseInt(process.env.IMAP_CONN_TIMEOUT) || 30000,
  authTimeout: parseInt(process.env.IMAP_AUTH_TIMEOUT) || 15000,
  keepalive: {
    interval: parseInt(process.env.IMAP_KEEPALIVE_INTERVAL) || 10000,
    idleInterval: parseInt(process.env.IMAP_IDLE_INTERVAL) || 300000
  }
};

// Service state management with enhanced features
class EmailReplyService extends EventEmitter {
  constructor() {
    super();
    this.imap = null;
    this.isServiceRunning = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = parseInt(process.env.MAX_RECONNECT_ATTEMPTS) || 5;
    this.reconnectDelay = parseInt(process.env.RECONNECT_DELAY) || 5000;
    this.processedEmails = new Set(); // Track processed email IDs to prevent duplicates
    this.rateLimitMap = new Map(); // Track reply rates per email address
    this.RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW) || 3600000; // 1 hour default
    this.MAX_REPLIES_PER_WINDOW = parseInt(process.env.MAX_REPLIES_PER_WINDOW) || 3;
    
    // Enterprise features
    this.circuitBreaker = new CircuitBreaker();
    this.messageQueue = new MessageQueue(parseInt(process.env.QUEUE_CONCURRENCY) || 50);
    this.performanceMonitor = new PerformanceMonitor();
    this.startTime = null;
    
    // Security
    this.ipWhitelist = this.parseWhitelist(process.env.IP_WHITELIST);
    this.domainWhitelist = this.parseWhitelist(process.env.DOMAIN_WHITELIST);
  }

  parseWhitelist(value) {
    if (!value) return null;
    return value.split(',').map(item => item.trim().toLowerCase());
  }

  validateSecurity(senderEmail) {
    // Domain whitelist check
    if (this.domainWhitelist) {
      const domain = senderEmail.split('@')[1]?.toLowerCase();
      if (!this.domainWhitelist.includes(domain)) {
        logger.warn('Domain not in whitelist', { senderEmail, domain });
        return false;
      }
    }

    // Additional security checks can be added here
    return true;
  }
}

const service = new EmailReplyService();

/**
 * Initialize IMAP connection for receiving emails with enterprise-grade features
 */
async function initImap() {
  if (!Imap) {
    logger.error('Cannot initialize IMAP - dependencies not available');
    return false;
  }

  if (!imapConfig.user || !imapConfig.password) {
    logger.error('Cannot initialize IMAP - missing credentials');
    return false;
  }

  // Store credentials securely
  credentialManager.setCredential('imap_user', imapConfig.user);
  credentialManager.setCredential('imap_password', imapConfig.password);

  try {
    const startTime = Date.now();
    
    await service.circuitBreaker.execute(async () => {
      return new Promise((resolve, reject) => {
        service.imap = new Imap(imapConfig);

        service.imap.once('ready', () => {
          const duration = Date.now() - startTime;
          service.performanceMonitor.recordOperation('imap_connection', duration, true);
          logger.info('IMAP connection ready - monitoring inbox for replies', { duration });
          service.reconnectAttempts = 0;
          service.emit('connected');
          openInbox();
          resolve(true);
        });

        service.imap.once('error', (err) => {
          const duration = Date.now() - startTime;
          service.performanceMonitor.recordOperation('imap_connection', duration, false);
          logger.error('IMAP error', { error: err.message, duration });
          handleImapError(err);
          reject(err);
        });

        service.imap.once('end', () => {
          logger.info('IMAP connection ended');
          service.emit('disconnected');
          if (service.isServiceRunning) {
            logger.info('Attempting to reconnect...');
            scheduleReconnect();
          }
        });

        service.imap.connect();
      });
    });

    return true;
  } catch (err) {
    const duration = Date.now() - startTime;
    service.performanceMonitor.recordOperation('imap_connection', duration, false);
    logger.error('Error initializing IMAP', { error: err.message, duration });
    return false;
  }
}

/**
 * Handle IMAP errors with enhanced reconnection logic with jitter
 */
function handleImapError(err) {
  logger.error('Handling IMAP error', { 
    error: err.message, 
    code: err.code,
    attempt: service.reconnectAttempts,
    maxAttempts: service.maxReconnectAttempts
  });
  
  if (service.isServiceRunning && service.reconnectAttempts < service.maxReconnectAttempts) {
    service.reconnectAttempts++;
    logger.info(`Reconnection attempt ${service.reconnectAttempts}/${service.maxReconnectAttempts}`);
    scheduleReconnect();
  } else {
    logger.error('Max reconnection attempts reached or service stopped');
    service.emit('max_reconnect_attempts_reached');
    stopEmailReplyService();
  }
}

/**
 * Schedule reconnection attempt with exponential backoff and jitter
 */
function scheduleReconnect() {
  // Exponential backoff with jitter to prevent thundering herd
  const baseDelay = service.reconnectDelay * Math.pow(2, service.reconnectAttempts - 1);
  const jitter = Math.random() * 1000; // Add up to 1 second of jitter
  const delay = baseDelay + jitter;
  
  logger.info(`Scheduling reconnection in ${Math.round(delay)}ms`, { 
    baseDelay: Math.round(baseDelay),
    jitter: Math.round(jitter)
  });
  
  const reconnectTimeout = setTimeout(() => {
    if (service.isServiceRunning) {
      initImap();
    }
  }, delay);
  
  // Store timeout for cancellation if needed
  service.reconnectTimeout = reconnectTimeout;
}

/**
 * Open inbox and start monitoring for new emails with enhanced monitoring
 */
function openInbox() {
  if (!service.imap) {
    logger.error('Cannot open inbox - IMAP not initialized');
    return;
  }

  const startTime = Date.now();
  
  service.imap.openBox('INBOX', false, (err, box) => {
    const duration = Date.now() - startTime;
    
    if (err) {
      service.performanceMonitor.recordOperation('inbox_open', duration, false);
      logger.error('Error opening inbox', { error: err.message, duration });
      return;
    }
    
    service.performanceMonitor.recordOperation('inbox_open', duration, true);
    logger.info('Inbox opened successfully', { 
      totalMessages: box.messages.total,
      unseen: box.messages.unseen,
      duration 
    });
    
    service.emit('inbox_opened', { total: box.messages.total, unseen: box.messages.unseen });
    
    // Watch for new emails with debouncing
    let emailTimeout;
    service.imap.on('mail', (numNewMsgs) => {
      logger.info(`${numNewMsgs} new email(s) received`);
      
      // Debounce rapid email arrivals
      clearTimeout(emailTimeout);
      emailTimeout = setTimeout(() => {
        fetchNewEmails();
      }, 1000); // Wait 1 second for batch processing
    });
  });
}

/**
 * Fetch and process new emails with batch processing and queuing
 */
function fetchNewEmails() {
  if (!service.imap || !simpleParser) {
    logger.error('Cannot fetch emails - IMAP or parser not available');
    return;
  }

  const startTime = Date.now();
  
  service.imap.search(['UNSEEN'], (err, results) => {
    const duration = Date.now() - startTime;
    
    if (err) {
      service.performanceMonitor.recordOperation('email_search', duration, false);
      logger.error('Error searching for unseen emails', { error: err.message, duration });
      return;
    }
    
    if (!results || results.length === 0) {
      service.performanceMonitor.recordOperation('email_search', duration, true);
      logger.debug('No unseen emails found', { duration });
      return;
    }

    service.performanceMonitor.recordOperation('email_search', duration, true);
    logger.info(`Found ${results.length} unseen email(s)`, { duration });
    
    // Process emails in batches for high throughput
    const batchSize = parseInt(process.env.EMAIL_BATCH_SIZE) || 50;
    const batches = [];
    
    for (let i = 0; i < results.length; i += batchSize) {
      batches.push(results.slice(i, i + batchSize));
    }
    
    // Process each batch
    batches.forEach((batch, batchIndex) => {
      const fetch = service.imap.fetch(batch, { 
        bodies: '', 
        markSeen: false,
        struct: true
      });

      let processedCount = 0;
      
      fetch.on('message', (msg, seqno) => {
        msg.on('body', (stream) => {
          const parseStartTime = Date.now();
          
          simpleParser(stream, (err, parsed) => {
            const parseDuration = Date.now() - parseStartTime;
            
            if (err) {
              service.performanceMonitor.recordOperation('email_parse', parseDuration, false);
              logger.error('Error parsing email', { error: err.message, duration: parseDuration });
              return;
            }
            
            service.performanceMonitor.recordOperation('email_parse', parseDuration, true);
            
            // Queue email processing for high throughput
            service.messageQueue.enqueue(() => processIncomingEmail(parsed), 1);
            processedCount++;
          });
        });
      });

      fetch.once('error', (err) => {
        logger.error('Batch fetch error', { 
          batchIndex, 
          batchSize: batch.length,
          error: err.message 
        });
      });
      
      fetch.once('end', () => {
        logger.info(`Batch ${batchIndex + 1}/${batches.length} completed`, { 
          processedCount,
          batchSize: batch.length 
        });
      });
    });
  });
}

/**
 * Validate email object structure with enhanced security checks
 */
function validateEmailObject(email) {
  if (!email) {
    logger.error('Invalid email object: null or undefined');
    return false;
  }
  
  if (!email.from || !email.from.text) {
    logger.error('Invalid email: missing sender information');
    return false;
  }
  
  if (!email.subject) {
    logger.error('Invalid email: missing subject');
    return false;
  }
  
  // Additional security checks
  if (email.subject.length > 1000) {
    logger.warn('Email subject too long, potential attack', { length: email.subject.length });
    return false;
  }
  
  // Generate unique email ID for duplicate prevention
  const emailId = `${email.from.text}_${email.subject}_${email.date || Date.now()}`;
  if (service.processedEmails.has(emailId)) {
    logger.debug('Email already processed, skipping', { emailId });
    return false;
  }
  
  return true;
}

/**
 * Enhanced input sanitization with comprehensive security
 */
function sanitizeInput(input, maxLength = 500) {
  if (typeof input !== 'string') return '';
  
  // Truncate to prevent DoS
  if (input.length > maxLength) {
    input = input.substring(0, maxLength);
    logger.warn('Input truncated due to length limit', { originalLength: input.length, maxLength });
  }
  
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .replace(/=/g, '&#x3D;')
    .replace(/`/g, '&#x60;')
    .replace(/\n/g, '<br>')
    .replace(/\r/g, '');
}

/**
 * Check if rate limit would be exceeded for sender with enhanced tracking
 */
function checkRateLimit(senderEmail) {
  const now = Date.now();
  const senderData = service.rateLimitMap.get(senderEmail);
  
  if (!senderData) {
    service.rateLimitMap.set(senderEmail, { count: 1, windowStart: now });
    return true;
  }
  
  // Reset if window expired
  if (now - senderData.windowStart > service.RATE_LIMIT_WINDOW) {
    service.rateLimitMap.set(senderEmail, { count: 1, windowStart: now });
    return true;
  }
  
  // Check if limit exceeded
  if (senderData.count >= service.MAX_REPLIES_PER_WINDOW) {
    logger.metrics.rateLimitHits++;
    logger.warn('Rate limit exceeded for sender', { 
      senderEmail, 
      count: senderData.count,
      limit: service.MAX_REPLIES_PER_WINDOW 
    });
    return false;
  }
  
  senderData.count++;
  return true;
}

/**
 * Extract email address from various formats with validation
 */
function extractEmailAddress(fromField) {
  if (!fromField) return null;
  
  try {
    // Handle simple email format
    if (typeof fromField === 'string' && fromField.includes('@')) {
      const match = fromField.match(/<([^>]+)>/) || fromField.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (match) {
        const email = match[1].trim().toLowerCase();
        // Basic email validation
        if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
          return email;
        }
      }
      return fromField.trim().toLowerCase();
    }
    
    // Handle object format { text: '...', value: [...] }
    if (fromField.text) {
      return extractEmailAddress(fromField.text);
    }
    
    return null;
  } catch (err) {
    logger.error('Error extracting email address', { error: err.message, fromField });
    return null;
  }
}

/**
 * Process incoming email and determine if auto-reply is needed with enhanced features
 */
async function processIncomingEmail(email) {
  const startTime = Date.now();
  
  try {
    if (!validateEmailObject(email)) {
      return;
    }
    
    const senderEmail = extractEmailAddress(email.from);
    if (!senderEmail) {
      logger.error('Could not extract valid email address from sender');
      return;
    }
    
    // Security validation
    if (!service.validateSecurity(senderEmail)) {
      logger.warn('Security validation failed for sender', { senderEmail });
      return;
    }
    
    logger.info('Processing email', { 
      from: senderEmail, 
      subject: email.subject?.substring(0, 50) 
    });
    
    // Check rate limit
    if (!checkRateLimit(senderEmail)) {
      logger.info('Rate limit check failed, skipping auto-reply', { senderEmail });
      return;
    }
    
    // Mark email as processed
    const emailId = `${senderEmail}_${email.subject}_${email.date || Date.now()}`;
    service.processedEmails.add(emailId);
    
    // Clean up old entries from processed emails (keep last 10000 for high volume)
    if (service.processedEmails.size > 10000) {
      const oldestEntries = Array.from(service.processedEmails).slice(0, 1000);
      oldestEntries.forEach(entry => service.processedEmails.delete(entry));
    }
    
    // Check if this is a reply to a system email
    const subject = (email.subject || '').toLowerCase();
    const isReply = subject.includes('re:') || subject.includes('reply') || 
                     subject.includes('fw:') || subject.includes('fwd:');
    
    if (isReply) {
      logger.info('Detected reply to system email', { senderEmail });
      await handleAutoReply(email, senderEmail);
    }
    
    const duration = Date.now() - startTime;
    service.performanceMonitor.recordOperation('email_process', duration, true);
    logger.metrics.totalProcessed++;
    
  } catch (err) {
    const duration = Date.now() - startTime;
    service.performanceMonitor.recordOperation('email_process', duration, false);
    logger.error('Error processing email', { error: err.message, duration });
  }
}

/**
 * Send automatic reply based on email content with enhanced reliability
 */
async function handleAutoReply(email, senderEmail) {
  const startTime = Date.now();
  
  try {
    const { sendEmail } = require('./emailService');
    
    if (!sendEmail) {
      logger.error('Email service not available');
      return;
    }
    
    const sanitizedSubject = sanitizeInput(email.subject || '');
    const replySubject = `Re: ${sanitizedSubject.replace(/^(Re:|RE:|Fw:|FW:|Fwd:)\s*/i, '')}`;
    
    // Generate auto-reply content based on context
    let replyBody = '';
    const subjectLower = sanitizedSubject.toLowerCase();
    
    if (subjectLower.includes('loan')) {
      replyBody = generateLoanReply(email);
    } else if (subjectLower.includes('contribution')) {
      replyBody = generateContributionReply(email);
    } else if (subjectLower.includes('approval')) {
      replyBody = generateApprovalReply(email);
    } else {
      replyBody = generateGenericReply(email);
    }
    
    // Use circuit breaker for email sending
    await service.circuitBreaker.execute(async () => {
      await sendEmail(senderEmail, replySubject, replyBody);
    });
    
    const duration = Date.now() - startTime;
    service.performanceMonitor.recordOperation('email_send', duration, true);
    logger.info('Auto-reply sent successfully', { 
      to: senderEmail, 
      subject: replySubject?.substring(0, 50),
      duration 
    });
    
    service.emit('reply_sent', { to: senderEmail, subject: replySubject });
    
  } catch (err) {
    const duration = Date.now() - startTime;
    service.performanceMonitor.recordOperation('email_send', duration, false);
    logger.error('Error sending auto-reply', { 
      error: err.message, 
      to: senderEmail,
      duration 
    });
    
    service.emit('reply_failed', { to: senderEmail, error: err.message });
    
    // Don't throw - we want to continue processing other emails
  }
}

/**
 * Generate loan-related auto-reply with enhanced security and tracking
 */
function generateLoanReply(email) {
  const sanitizedSubject = sanitizeInput(email.subject || 'No Subject');
  const receivedDate = new Date().toLocaleString();
  const currentYear = new Date().getFullYear();
  const trackingId = crypto.randomBytes(16).toString('hex').substring(0, 8);
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Auto Reply</title>
  <style>
    body { margin: 0; padding: 0; background: #f0f4f8; font-family: 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1a3a5c 0%, #2563eb 100%); padding: 32px 40px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; }
    .body { padding: 36px 40px; color: #1e293b; line-height: 1.7; font-size: 15px; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; text-align: center; font-size: 12px; color: #94a3b8; }
    .tracking { font-family: monospace; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>ðŸ¦ Loan Management System</h1>
      <p>Automatic Reply</p>
    </div>
    <div class="body">
      <h2>Thank you for your response</h2>
      <p>We have received your email regarding loan matters. Our team will review your message and get back to you within 24-48 hours.</p>
      <p>If this is urgent, please contact your administrator directly or call our support line.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <strong>Reference:</strong> ${sanitizedSubject}<br>
        <strong>Received:</strong> ${receivedDate}<br>
        <strong>Tracking ID:</strong> <span class="tracking">${trackingId}</span>
      </div>
    </div>
    <div class="footer">
      <p>This is an automated message. Please do not reply to this email.</p>
      <p>Â© ${currentYear} Loan Management System. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
  
  logger.debug('Generated loan reply', { trackingId, subject: sanitizedSubject.substring(0, 30) });
  return html;
}

/**
 * NEW: Generate loan approval email with database information
 */
async function generateLoanApprovalEmail(loanId, adminId) {
  try {
    const loan = await databaseManager.getLoanById(loanId);
    const admin = await databaseManager.getAdminById(adminId);
    
    if (!loan || !admin) {
      logger.error('Failed to generate loan approval email - missing data', { loanId, adminId });
      return null;
    }

    const trackingId = crypto.randomBytes(16).toString('hex').substring(0, 8);
    const currentYear = new Date().getFullYear();
    const approvedDate = new Date().toLocaleString();
    
    const adminName = `${admin.first_name} ${admin.last_name}`;
    const memberName = `${loan.member.first_name} ${loan.member.last_name}`;
    const loanAmount = parseFloat(loan.amount).toLocaleString();

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Loan Approval Confirmation</title>
  <style>
    body { margin: 0; padding: 0; background: #f0f4f8; font-family: 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 32px 40px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; }
    .body { padding: 36px 40px; color: #1e293b; line-height: 1.7; font-size: 15px; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; text-align: center; font-size: 12px; color: #94a3b8; }
    .status { display: inline-block; background: #dcfce7; color: #166534; padding: 8px 16px; border-radius: 20px; font-weight: 600; font-size: 14px; }
    .amount { font-size: 28px; font-weight: 700; color: #059669; }
    .tracking { font-family: monospace; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; }
    .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>âœ… Loan Approval Confirmed</h1>
      <p>Congratulations, ${memberName}!</p>
    </div>
    <div class="body">
      <h2>Your Loan Has Been Approved</h2>
      <p>We are pleased to inform you that your loan application has been approved by our administration team.</p>
      
      <div class="info-box">
        <div style="margin-bottom: 16px;">
          <strong>Loan Amount:</strong>
          <div class="amount">$${loanAmount}</div>
        </div>
        
        <div style="margin-bottom: 16px;">
          <strong>Application Date:</strong><br>
          ${new Date(loan.requested_date).toLocaleDateString()}
        </div>
        
        <div style="margin-bottom: 16px;">
          <strong>Approved By:</strong><br>
          ${adminName}
        </div>
        
        <div style="margin-bottom: 16px;">
          <strong>Approval Date:</strong><br>
          ${approvedDate}
        </div>
        
        <div>
          <strong>Status:</strong><br>
          <span class="status">APPROVED</span>
        </div>
      </div>
      
      <p>Your loan will be disbursed within 2-3 business days. Please ensure your bank details are up to date in your dashboard.</p>
      
      <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <strong>âš ï¸ Important:</strong> Please review the loan terms and conditions in your dashboard before accepting the disbursement.
      </div>
      
      <div style="background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <strong>Tracking ID:</strong> <span class="tracking">${trackingId}</span><br>
        <strong>Reference:</strong> #LN-${loanId}
      </div>
    </div>
    <div class="footer">
      <p>This is an automated message. For inquiries, please contact your administrator.</p>
      <p>Â© ${currentYear} Loan Management System. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

    logger.info('Generated loan approval email', { trackingId, loanId, adminId });
    return { html, subject: `âœ… Loan Approved - $${loanAmount}`, trackingId };
  } catch (err) {
    logger.error('Error generating loan approval email', { error: err.message, loanId, adminId });
    return null;
  }
}

/**
 * NEW: Generate loan denial email with database information
 */
async function generateLoanDenialEmail(loanId, adminId, rejectionReason) {
  try {
    const loan = await databaseManager.getLoanById(loanId);
    const admin = await databaseManager.getAdminById(adminId);
    
    if (!loan || !admin) {
      logger.error('Failed to generate loan denial email - missing data', { loanId, adminId });
      return null;
    }

    const trackingId = crypto.randomBytes(16).toString('hex').substring(0, 8);
    const currentYear = new Date().getFullYear();
    const deniedDate = new Date().toLocaleString();
    
    const adminName = `${admin.first_name} ${admin.last_name}`;
    const memberName = `${loan.member.first_name} ${loan.member.last_name}`;
    const loanAmount = parseFloat(loan.amount).toLocaleString();
    const reason = sanitizeInput(rejectionReason || 'No specific reason provided');

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Loan Application Update</title>
  <style>
    body { margin: 0; padding: 0; background: #f0f4f8; font-family: 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%); padding: 32px 40px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; }
    .body { padding: 36px 40px; color: #1e293b; line-height: 1.7; font-size: 15px; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; text-align: center; font-size: 12px; color: #94a3b8; }
    .status { display: inline-block; background: #fee2e2; color: #991b1b; padding: 8px 16px; border-radius: 20px; font-weight: 600; font-size: 14px; }
    .amount { font-size: 28px; font-weight: 700; color: #dc2626; }
    .tracking { font-family: monospace; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; }
    .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .reason-box { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 20px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>âŒ Loan Application Update</h1>
      <p>Dear ${memberName}</p>
    </div>
    <div class="body">
      <h2>Your Loan Application Was Not Approved</h2>
      <p>We regret to inform you that your loan application has been reviewed and could not be approved at this time.</p>
      
      <div class="info-box">
        <div style="margin-bottom: 16px;">
          <strong>Requested Amount:</strong>
          <div class="amount">$${loanAmount}</div>
        </div>
        
        <div style="margin-bottom: 16px;">
          <strong>Application Date:</strong><br>
          ${new Date(loan.requested_date).toLocaleDateString()}
        </div>
        
        <div style="margin-bottom: 16px;">
          <strong>Reviewed By:</strong><br>
          ${adminName}
        </div>
        
        <div style="margin-bottom: 16px;">
          <strong>Review Date:</strong><br>
          ${deniedDate}
        </div>
        
        <div>
          <strong>Status:</strong><br>
          <span class="status">NOT APPROVED</span>
        </div>
      </div>
      
      <div class="reason-box">
        <strong>Reason for Decision:</strong><br>
        ${reason}
      </div>
      
      <p>You may reapply after 30 days from the original application date. We encourage you to review our loan guidelines and ensure all requirements are met before reapplying.</p>
      
      <p>If you believe this decision was made in error, please contact your administrator directly to discuss your application.</p>
      
      <div style="background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <strong>Tracking ID:</strong> <span class="tracking">${trackingId}</span><br>
        <strong>Reference:</strong> #LN-${loanId}
      </div>
    </div>
    <div class="footer">
      <p>This is an automated message. For appeals or inquiries, please contact your administrator.</p>
      <p>Â© ${currentYear} Loan Management System. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

    logger.info('Generated loan denial email', { trackingId, loanId, adminId });
    return { html, subject: `âŒ Loan Application Update - $${loanAmount}`, trackingId };
  } catch (err) {
    logger.error('Error generating loan denial email', { error: err.message, loanId, adminId });
    return null;
  }
}

/**
 * NEW: Generate meeting scheduled email with database information
 */
async function generateMeetingScheduledEmail(meetingId, adminId) {
  try {
    const meeting = await databaseManager.getMeetingById(meetingId);
    const admin = await databaseManager.getAdminById(adminId);
    
    if (!meeting || !admin) {
      logger.error('Failed to generate meeting email - missing data', { meetingId, adminId });
      return null;
    }

    const trackingId = crypto.randomBytes(16).toString('hex').substring(0, 8);
    const currentYear = new Date().getFullYear();
    
    const adminName = `${admin.first_name} ${admin.last_name}`;
    const meetingDate = new Date(meeting.scheduled_date).toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    const meetingTime = meeting.scheduled_time;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Meeting Scheduled</title>
  <style>
    body { margin: 0; padding: 0; background: #f0f4f8; font-family: 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #7c3aed 0%, #8b5cf6 100%); padding: 32px 40px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; }
    .body { padding: 36px 40px; color: #1e293b; line-height: 1.7; font-size: 15px; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; text-align: center; font-size: 12px; color: #94a3b8; }
    .tracking { font-family: monospace; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; }
    .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .calendar { background: #ede9fe; border: 1px solid #c4b5fd; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center; }
    .date-display { font-size: 24px; font-weight: 700; color: #7c3aed; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>ðŸ“… Meeting Scheduled</h1>
      <p>You're invited to attend</p>
    </div>
    <div class="body">
      <h2>${sanitizeInput(meeting.title)}</h2>
      <p>${sanitizeInput(meeting.description || 'Important meeting regarding loan management matters.')}</p>
      
      <div class="calendar">
        <div class="date-display">${meetingDate}</div>
        <div style="font-size: 18px; margin-top: 8px;">${meetingTime}</div>
      </div>
      
      <div class="info-box">
        <div style="margin-bottom: 16px;">
          <strong>Location:</strong><br>
          ${sanitizeInput(meeting.location || 'TBD - Will be announced')}
        </div>
        
        <div style="margin-bottom: 16px;">
          <strong>Organized By:</strong><br>
          ${adminName}
        </div>
        
        <div>
          <strong>Meeting ID:</strong><br>
          #MT-${meetingId}
        </div>
      </div>
      
      <p>Please mark your calendar and ensure you attend this important meeting. Your participation is valued and important for our collective decision-making process.</p>
      
      <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <strong>ðŸ“ Action Required:</strong> Please confirm your attendance by responding to this email or through your dashboard.
      </div>
      
      <div style="background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <strong>Tracking ID:</strong> <span class="tracking">${trackingId}</span>
      </div>
    </div>
    <div class="footer">
      <p>This is an automated message. For meeting-related inquiries, please contact the organizer.</p>
      <p>Â© ${currentYear} Loan Management System. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

    logger.info('Generated meeting scheduled email', { trackingId, meetingId, adminId });
    return { html, subject: `ðŸ“… Meeting Scheduled: ${sanitizeInput(meeting.title)}`, trackingId };
  } catch (err) {
    logger.error('Error generating meeting scheduled email', { error: err.message, meetingId, adminId });
    return null;
  }
}

/**
 * NEW: Generate emergency email notification
 */
async function generateEmergencyEmail(emergencyType, message, recipientName) {
  try {
    const trackingId = crypto.randomBytes(16).toString('hex').substring(0, 8);
    const currentYear = new Date().getFullYear();
    const emergencyDate = new Date().toLocaleString();
    
    const emergencyTypes = {
      urgent: { icon: 'ðŸš¨', color: '#dc2626', title: 'URGENT NOTIFICATION' },
      critical: { icon: 'âš ï¸', color: '#f59e0b', title: 'CRITICAL ALERT' },
      emergency: { icon: 'ðŸ†˜', color: '#ef4444', title: 'EMERGENCY NOTIFICATION' }
    };
    
    const type = emergencyTypes[emergencyType] || emergencyTypes.urgent;
    const sanitizedMessage = sanitizeInput(message);

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${type.title}</title>
  <style>
    body { margin: 0; padding: 0; background: #f0f4f8; font-family: 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, ${type.color} 0%, #991b1b 100%); padding: 32px 40px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; }
    .body { padding: 36px 40px; color: #1e293b; line-height: 1.7; font-size: 15px; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; text-align: center; font-size: 12px; color: #94a3b8; }
    .tracking { font-family: monospace; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; }
    .emergency-box { background: #fef2f2; border: 2px solid #fecaca; border-radius: 8px; padding: 24px; margin: 20px 0; }
    .alert { display: inline-block; background: #fee2e2; color: #991b1b; padding: 8px 16px; border-radius: 20px; font-weight: 700; font-size: 14px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>${type.icon} ${type.title}</h1>
      <p>Immediate Attention Required</p>
    </div>
    <div class="body">
      <h2>Dear ${sanitizeInput(recipientName)}</h2>
      
      <div class="emergency-box">
        <div style="margin-bottom: 16px;">
          <span class="alert">âš ï¸ URGENT</span>
        </div>
        <p style="font-size: 16px; font-weight: 500;">${sanitizedMessage}</p>
      </div>
      
      <p>This message requires your immediate attention. Please take appropriate action as soon as possible.</p>
      
      <div style="background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <strong>Issued:</strong> ${emergencyDate}<br>
        <strong>Tracking ID:</strong> <span class="tracking">${trackingId}</span>
      </div>
      
      <p><strong>ðŸ“ž Emergency Contact:</strong> Please reach out to your administrator immediately if you have questions or require assistance.</p>
    </div>
    <div class="footer">
      <p>This is an automated emergency notification. Please act accordingly.</p>
      <p>Â© ${currentYear} Loan Management System. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

    logger.info('Generated emergency email', { trackingId, emergencyType });
    return { html, subject: `${type.icon} ${type.title} - Immediate Action Required`, trackingId };
  } catch (err) {
    logger.error('Error generating emergency email', { error: err.message, emergencyType });
    return null;
  }
}

/**
 * NEW: Generate daily summary email with personalized database content
 */
function generateDailySummaryEmail(member, pendingLoans, upcomingMeetings, scheduleName) {
  const trackingId = crypto.randomBytes(16).toString('hex').substring(0, 8);
  const currentYear = new Date().getFullYear();
  const memberName = `${member.first_name} ${member.last_name}`;
  const greeting = getGreeting(scheduleName);
  
  // Ensure pendingLoans is an array
  const loans = Array.isArray(pendingLoans) ? pendingLoans : [];
  // Ensure upcomingMeetings is an array
  const meetings = Array.isArray(upcomingMeetings) ? upcomingMeetings : [];
  
  const pendingLoansHtml = loans.length > 0 ? `
    <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin: 20px 0;">
      <h3 style="margin-top: 0;">ðŸ“‹ Pending Loan Applications</h3>
      ${loans.map(loan => `
        <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #fcd34d;">
          <strong>Amount:</strong> $${parseFloat(loan.amount).toLocaleString()}<br>
          <strong>Applied:</strong> ${new Date(loan.requested_date).toLocaleDateString()}<br>
          <strong>Status:</strong> <span style="color: #f59e0b; font-weight: 600;">Pending Review</span>
        </div>
      `).join('')}
    </div>
  ` : `
    <div style="background: #dcfce7; border: 1px solid #86efac; border-radius: 8px; padding: 16px; margin: 20px 0;">
      <h3 style="margin-top: 0;">âœ… No Pending Loan Applications</h3>
      <p>You have no pending loan applications at this time.</p>
    </div>
  `;

  const meetingsHtml = meetings.length > 0 ? `
    <div style="background: #ede9fe; border: 1px solid #c4b5fd; border-radius: 8px; padding: 16px; margin: 20px 0;">
      <h3 style="margin-top: 0;">ðŸ“… Upcoming Meetings</h3>
      ${meetings.map(meeting => `
        <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #c4b5fd;">
          <strong>${sanitizeInput(meeting.title)}</strong><br>
          <strong>Date:</strong> ${new Date(meeting.scheduled_date).toLocaleDateString()} at ${meeting.scheduled_time}<br>
          <strong>Location:</strong> ${sanitizeInput(meeting.location || 'TBD')}
        </div>
      `).join('')}
    </div>
  ` : `
    <div style="background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
      <h3 style="margin-top: 0;">ðŸ“… No Upcoming Meetings</h3>
      <p>No meetings are currently scheduled.</p>
    </div>
  `;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Loan Management Summary</title>
  <style>
    body { margin: 0; padding: 0; background: #f0f4f8; font-family: 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1a3a5c 0%, #2563eb 100%); padding: 32px 40px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; }
    .body { padding: 36px 40px; color: #1e293b; line-height: 1.7; font-size: 15px; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; text-align: center; font-size: 12px; color: #94a3b8; }
    .tracking { font-family: monospace; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; }
    .quick-actions { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>ðŸ¦ Loan Management System</h1>
      <p>${greeting}, ${memberName}!</p>
    </div>
    <div class="body">
      <h2>Your Daily Summary</h2>
      <p>Here's your personalized loan management update for today.</p>
      
      ${pendingLoansHtml}
      ${meetingsHtml}
      
      <div class="quick-actions">
        <h3 style="margin-top: 0;">âš¡ Quick Actions</h3>
        <ul style="padding-left: 20px; margin: 0;">
          <li><a href="#" style="color: #2563eb; text-decoration: none;">View Your Dashboard</a></li>
          <li><a href="#" style="color: #2563eb; text-decoration: none;">Apply for New Loan</a></li>
          <li><a href="#" style="color: #2563eb; text-decoration: none;">Check Contribution Status</a></li>
          <li><a href="#" style="color: #2563eb; text-decoration: none;">View Meeting Schedule</a></li>
        </ul>
      </div>
      
      <div style="background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <strong>Tracking ID:</strong> <span class="tracking">${trackingId}</span><br>
        <strong>Generated:</strong> ${new Date().toLocaleString()}
      </div>
    </div>
    <div class="footer">
      <p>This is an automated daily summary. Email preferences can be updated in your dashboard.</p>
      <p>Â© ${currentYear} Loan Management System. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

  logger.debug('Generated daily summary email', { trackingId, memberId: member.id, scheduleName });
  return html;
}

function getGreeting(scheduleName) {
  const greetings = {
    morning_summary: 'Good Morning',
    afternoon_summary: 'Good Afternoon',
    evening_summary: 'Good Evening'
  };
  return greetings[scheduleName] || 'Hello';
}

/**
 * NEW: Dashboard integration endpoints for email requests
 */
class DashboardEmailService {
  constructor() {
    this.pendingRequests = new Map();
    this.requestQueue = new Map();
  }

  /**
   * Request loan approval from dashboard
   */
  async requestLoanApproval(memberId, loanData) {
    const requestId = crypto.randomBytes(16).toString('hex');
    
    try {
      // Store request in database
      const loan = await databaseManager.Loan.create({
        member_id: memberId,
        amount: loanData.amount,
        purpose: loanData.purpose,
        status: 'pending',
        requested_date: new Date()
      });

      this.pendingRequests.set(requestId, {
        type: 'loan_approval',
        loanId: loan.id,
        memberId: memberId,
        timestamp: Date.now()
      });

      // Notify admins about new loan request
      await this.notifyAdminsOfNewLoan(loan.id, memberId);

      logger.info('Loan approval requested from dashboard', { requestId, loanId: loan.id, memberId });
      return { success: true, requestId, loanId: loan.id };
    } catch (err) {
      logger.error('Failed to request loan approval', { error: err.message, memberId });
      return { success: false, error: err.message };
    }
  }

  /**
   * Notify admins about new loan requests
   */
  async notifyAdminsOfNewLoan(loanId, memberId) {
    try {
      const loan = await databaseManager.getLoanById(loanId);
      const member = await databaseManager.getMemberById(memberId);
      const admins = await databaseManager.getAllAdmins();

      for (const admin of admins) {
        const notificationEmail = generateAdminLoanNotificationEmail(loan, member, admin);
        await this.sendEmailToAdmin(admin.email, notificationEmail.subject, notificationEmail.html);
      }

      logger.info('Admins notified of new loan request', { loanId, adminCount: admins.length });
    } catch (err) {
      logger.error('Failed to notify admins of new loan', { error: err.message, loanId });
    }
  }

  /**
   * Send email to admin
   */
  async sendEmailToAdmin(adminEmail, subject, html) {
    const { sendEmail } = require('./emailService');
    await sendEmail(adminEmail, subject, html);
  }

  /**
   * Process loan approval (admin action)
   */
  async processLoanApproval(loanId, adminId, approved, rejectionReason = null) {
    try {
      const loan = await databaseManager.getLoanById(loanId);
      const admin = await databaseManager.getAdminById(adminId);

      if (!loan || !admin) {
        throw new Error('Loan or admin not found');
      }

      const status = approved ? 'approved' : 'rejected';
      const success = await databaseManager.updateLoanStatus(loanId, status, adminId, rejectionReason);

      if (success) {
        // Send notification email to member
        if (approved) {
          const approvalEmail = await generateLoanApprovalEmail(loanId, adminId);
          if (approvalEmail) {
            await this.sendEmailToMember(loan.member.email, approvalEmail.subject, approvalEmail.html);
          }
        } else {
          const denialEmail = await generateLoanDenialEmail(loanId, adminId, rejectionReason);
          if (denialEmail) {
            await this.sendEmailToMember(loan.member.email, denialEmail.subject, denialEmail.html);
          }
        }

        logger.info('Loan approval processed', { loanId, adminId, status });
        return { success: true, status };
      } else {
        throw new Error('Failed to update loan status');
      }
    } catch (err) {
      logger.error('Failed to process loan approval', { error: err.message, loanId, adminId });
      return { success: false, error: err.message };
    }
  }

  /**
   * Send email to member
   */
  async sendEmailToMember(memberEmail, subject, html) {
    const { sendEmail } = require('./emailService');
    await sendEmail(memberEmail, subject, html);
  }

  /**
   * Create and schedule meeting
   */
  async createMeeting(meetingData, adminId) {
    try {
      const meeting = await databaseManager.Meeting.create({
        title: meetingData.title,
        description: meetingData.description,
        scheduled_date: meetingData.scheduled_date,
        scheduled_time: meetingData.scheduled_time,
        location: meetingData.location,
        status: 'scheduled',
        created_by: adminId
      });

      // Notify all members about new meeting
      await this.notifyMembersOfMeeting(meeting.id, adminId);

      logger.info('Meeting created and notifications sent', { meetingId: meeting.id, adminId });
      return { success: true, meetingId: meeting.id };
    } catch (err) {
      logger.error('Failed to create meeting', { error: err.message, adminId });
      return { success: false, error: err.message };
    }
  }

  /**
   * Notify members about new meeting
   */
  async notifyMembersOfMeeting(meetingId, adminId) {
    try {
      const meeting = await databaseManager.getMeetingById(meetingId);
      const admin = await databaseManager.getAdminById(adminId);
      const members = await databaseManager.getAllActiveMembers();

      for (const member of members) {
        if (member.email_preferences?.meeting_notifications) {
          const meetingEmail = await generateMeetingScheduledEmail(meetingId, adminId);
          if (meetingEmail) {
            await this.sendEmailToMember(member.email, meetingEmail.subject, meetingEmail.html);
          }
        }
      }

      logger.info('Members notified of new meeting', { meetingId, memberCount: members.length });
    } catch (err) {
      logger.error('Failed to notify members of meeting', { error: err.message, meetingId });
    }
  }

  /**
   * Send emergency notification
   */
  async sendEmergencyNotification(emergencyType, message, targetRecipients = 'all') {
    try {
      let recipients = [];

      if (targetRecipients === 'all') {
        recipients = await databaseManager.getAllActiveMembers();
      } else if (targetRecipients === 'admins') {
        recipients = await databaseManager.getAllAdmins();
      } else if (Array.isArray(targetRecipients)) {
        recipients = targetRecipients;
      }

      for (const recipient of recipients) {
        const recipientName = recipient.first_name ? `${recipient.first_name} ${recipient.last_name}` : recipient.email;
        const emergencyEmail = await generateEmergencyEmail(emergencyType, message, recipientName);
        
        if (emergencyEmail) {
          await this.sendEmailToMember(recipient.email, emergencyEmail.subject, emergencyEmail.html);
        }
      }

      logger.info('Emergency notification sent', { emergencyType, recipientCount: recipients.length });
      return { success: true, recipientCount: recipients.length };
    } catch (err) {
      logger.error('Failed to send emergency notification', { error: err.message, emergencyType });
      return { success: false, error: err.message };
    }
  }

  /**
   * Get pending email requests
   */
  getPendingRequests() {
    return Array.from(this.pendingRequests.values());
  }

  /**
   * Clear processed requests
   */
  clearProcessedRequest(requestId) {
    this.pendingRequests.delete(requestId);
  }
}

// Extend DatabaseManager with admin methods
DatabaseManager.prototype.getAllAdmins = async function() {
  try {
    const admins = await this.Admin.findAll({
      where: { status: 'active' }
    });
    return admins.map(a => a.toJSON());
  } catch (err) {
    logger.error('Error fetching all admins', { error: err.message });
    return [];
  }
};



/**
 * Generate admin notification email for new loan request
 */
function generateAdminLoanNotificationEmail(loan, member, admin) {
  const trackingId = crypto.randomBytes(16).toString('hex').substring(0, 8);
  const currentYear = new Date().getFullYear();
  const adminName = `${admin.first_name} ${admin.last_name}`;
  const memberName = `${member.first_name} ${member.last_name}`;
  const loanAmount = parseFloat(loan.amount).toLocaleString();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Loan Request</title>
  <style>
    body { margin: 0; padding: 0; background: #f0f4f8; font-family: 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 32px 40px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; }
    .body { padding: 36px 40px; color: #1e293b; line-height: 1.7; font-size: 15px; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; text-align: center; font-size: 12px; color: #94a3b8; }
    .amount { font-size: 28px; font-weight: 700; color: #d97706; }
    .action-buttons { margin: 20px 0; }
    .btn { display: inline-block; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-right: 10px; }
    .btn-approve { background: #059669; color: white; }
    .btn-reject { background: #dc2626; color: white; }
    .tracking { font-family: monospace; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>ðŸ“‹ New Loan Request</h1>
      <p>Review Required</p>
    </div>
    <div class="body">
      <h2>Dear ${adminName}</h2>
      <p>A new loan application requires your review and approval.</p>
      
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <div style="margin-bottom: 16px;">
          <strong>Applicant:</strong><br>
          ${memberName}
        </div>
        
        <div style="margin-bottom: 16px;">
          <strong>Loan Amount:</strong>
          <div class="amount">$${loanAmount}</div>
        </div>
        
        <div style="margin-bottom: 16px;">
          <strong>Purpose:</strong><br>
          ${sanitizeInput(loan.purpose || 'Not specified')}
        </div>
        
        <div style="margin-bottom: 16px;">
          <strong>Application Date:</strong><br>
          ${new Date(loan.requested_date).toLocaleString()}
        </div>
        
        <div>
          <strong>Loan ID:</strong><br>
          #LN-${loan.id}
        </div>
      </div>
      
      <div class="action-buttons">
        <a href="#" class="btn btn-approve">âœ… Approve Loan</a>
        <a href="#" class="btn btn-reject">âŒ Reject Loan</a>
      </div>
      
      <p>Please review this application in your dashboard and take appropriate action.</p>
      
      <div style="background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <strong>Tracking ID:</strong> <span class="tracking">${trackingId}</span>
      </div>
    </div>
    <div class="footer">
      <p>This is an automated notification. Please review the application in your dashboard.</p>
      <p>Â© ${currentYear} Loan Management System. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

  logger.debug('Generated admin loan notification email', { trackingId, loanId: loan.id });
  return { html, subject: `ðŸ“‹ New Loan Request: $${loanAmount} - ${memberName}`, trackingId };
}

const dashboardEmailService = new DashboardEmailService();

/**
 * Generate contribution-related auto-reply with enhanced security
 */
function generateContributionReply(email) {
  const currentYear = new Date().getFullYear();
  const trackingId = crypto.randomBytes(16).toString('hex').substring(0, 8);
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Auto Reply</title>
  <style>
    body { margin: 0; padding: 0; background: #f0f4f8; font-family: 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1a3a5c 0%, #2563eb 100%); padding: 32px 40px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; }
    .body { padding: 36px 40px; color: #1e293b; line-height: 1.7; font-size: 15px; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; text-align: center; font-size: 12px; color: #94a3b8; }
    .tracking { font-family: monospace; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>ðŸ¦ Loan Management System</h1>
      <p>Automatic Reply</p>
    </div>
    <div class="body">
      <h2>Contribution Query Received</h2>
      <p>Thank you for your email regarding contributions. Your message has been logged and will be reviewed by our treasurer team.</p>
      <p>For immediate assistance with contribution matters, please contact the treasurer directly.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <strong>Tracking ID:</strong> <span class="tracking">${trackingId}</span><br>
        <strong>Received:</strong> ${new Date().toLocaleString()}
      </div>
    </div>
    <div class="footer">
      <p>This is an automated message. Please do not reply to this email.</p>
      <p>Â© ${currentYear} Loan Management System. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
  
  logger.debug('Generated contribution reply', { trackingId });
  return html;
}

/**
 * Generate approval-related auto-reply with enhanced security
 */
function generateApprovalReply(email) {
  const currentYear = new Date().getFullYear();
  const trackingId = crypto.randomBytes(16).toString('hex').substring(0, 8);
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Auto Reply</title>
  <style>
    body { margin: 0; padding: 0; background: #f0f4f8; font-family: 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1a3a5c 0%, #2563eb 100%); padding: 32px 40px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; }
    .body { padding: 36px 40px; color: #1e293b; line-height: 1.7; font-size: 15px; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; text-align: center; font-size: 12px; color: #94a3b8; }
    .tracking { font-family: monospace; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>ðŸ¦ Loan Management System</h1>
      <p>Automatic Reply</p>
    </div>
    <div class="body">
      <h2>Membership Application Response</h2>
      <p>We have received your response regarding your membership application. Our admin team will review and update your status accordingly.</p>
      <p>You will receive a formal notification once your application status changes.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <strong>Tracking ID:</strong> <span class="tracking">${trackingId}</span><br>
        <strong>Received:</strong> ${new Date().toLocaleString()}
      </div>
    </div>
    <div class="footer">
      <p>This is an automated message. Please do not reply to this email.</p>
      <p>Â© ${currentYear} Loan Management System. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
  
  logger.debug('Generated approval reply', { trackingId });
  return html;
}

/**
 * Generate generic auto-reply with enhanced security
 */
function generateGenericReply(email) {
  const currentYear = new Date().getFullYear();
  const trackingId = crypto.randomBytes(16).toString('hex').substring(0, 8);
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Auto Reply</title>
  <style>
    body { margin: 0; padding: 0; background: #f0f4f8; font-family: 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1a3a5c 0%, #2563eb 100%); padding: 32px 40px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; }
    .body { padding: 36px 40px; color: #1e293b; line-height: 1.7; font-size: 15px; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; text-align: center; font-size: 12px; color: #94a3b8; }
    .tracking { font-family: monospace; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>ðŸ¦ Loan Management System</h1>
      <p>Automatic Reply</p>
    </div>
    <div class="body">
      <h2>Thank you for your email</h2>
      <p>We have received your message. Our team will review it and respond within 24-48 hours.</p>
      <p>If you require immediate assistance, please contact your administrator directly.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <strong>Tracking ID:</strong> <span class="tracking">${trackingId}</span><br>
        <strong>Received:</strong> ${new Date().toLocaleString()}
      </div>
    </div>
    <div class="footer">
      <p>This is an automated message. Please do not reply to this email.</p>
      <p>Â© ${currentYear} Loan Management System. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
  
  logger.debug('Generated generic reply', { trackingId });
  return html;
}

/**
 * Start the email reply service with enterprise-grade features
 */
async function startEmailReplyService() {
  if (service.isServiceRunning) {
    logger.warn('Service is already running');
    return false;
  }

  if (!Imap || !simpleParser) {
    logger.warn('IMAP dependencies not available - auto-reply disabled');
    return false;
  }

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    logger.warn('Email credentials not configured - auto-reply disabled');
    return false;
  }
  
  logger.info('Starting automatic email reply service...', {
    version: '3.0.0-enterprise',
    features: [
      'circuit-breaker', 
      'message-queue', 
      'performance-monitoring', 
      'credential-encryption',
      'database-integration',
      'scheduled-emails',
      'dynamic-templates',
      'dashboard-integration'
    ]
  });
  
  service.isServiceRunning = true;
  service.startTime = Date.now();
  
  // Initialize database connection
  const dbConnected = await databaseManager.connect();
  if (!dbConnected) {
    logger.warn('Database connection failed, some features will be limited');
  }
  
  // Initialize scheduled email service
  if (dbConnected) {
    await scheduledEmailService.initialize();
    
    // Schedule OTP cleanup (every hour)
    setInterval(() => {
      secureOTPService.cleanupExpiredOTPs();
    }, 3600000);
  }
  
  const success = initImap();
  if (!success) {
    service.isServiceRunning = false;
    service.startTime = null;
    return false;
  }
  
  service.emit('started');
  logger.info('Email reply service started successfully', { 
    databaseConnected: dbConnected,
    scheduledEmails: dbConnected ? scheduledEmailService.getScheduledJobs() : []
  });
  return true;
}

/**
 * Stop the email reply service gracefully with enhanced cleanup
 */
function stopEmailReplyService() {
  logger.info('Stopping automatic email reply service...');
  service.isServiceRunning = false;
  
  // Clear reconnect timeout if exists
  if (service.reconnectTimeout) {
    clearTimeout(service.reconnectTimeout);
  }
  
  if (service.imap) {
    try {
      service.imap.end();
      logger.info('IMAP connection closed');
    } catch (err) {
      logger.error('Error closing IMAP connection', { error: err.message });
    }
    service.imap = null;
  }
  
  // Clear tracking data
  service.processedEmails.clear();
  service.rateLimitMap.clear();
  service.reconnectAttempts = 0;
  service.startTime = null;
  
  service.emit('stopped');
  logger.info('Email reply service stopped');
}

/**
 * Get comprehensive service status with health indicators
 */
function getServiceStatus() {
  const uptime = service.startTime ? Date.now() - service.startTime : 0;
  const queueStats = service.messageQueue.getStats();
  const circuitBreakerState = service.circuitBreaker.getState();
  const performanceMetrics = service.performanceMonitor.getMetrics();
  
  return {
    service: {
      isRunning: service.isServiceRunning,
      uptime: uptime,
      startTime: service.startTime ? new Date(service.startTime).toISOString() : null,
      version: '2.0.0-enterprise'
    },
    dependencies: {
      hasImap: !!Imap,
      hasParser: !!simpleParser,
      hasCredentials: !!(process.env.EMAIL_USER && process.env.EMAIL_PASS)
    },
    performance: {
      processedEmails: service.processedEmails.size,
      reconnectAttempts: service.reconnectAttempts,
      queue: queueStats,
      circuitBreaker: circuitBreakerState,
      operations: performanceMetrics.operations
    },
    metrics: logger.getMetrics(),
    health: {
      status: service.isServiceRunning ? 'healthy' : 'stopped',
      circuitBreaker: circuitBreakerState.state,
      queueUtilization: queueStats.queueLength / 10000 // Queue capacity is 10000
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * Get detailed health check for monitoring systems
 */
function getHealthCheck() {
  const status = getServiceStatus();
  const isHealthy = status.service.isRunning && 
                   status.health.circuitBreaker === 'closed' &&
                   status.health.queueUtilization < 0.8;
  
  return {
    healthy: isHealthy,
    status: isHealthy ? 'healthy' : 'unhealthy',
    checks: {
      service: status.service.isRunning ? 'pass' : 'fail',
      dependencies: status.dependencies.hasImap && status.dependencies.hasParser ? 'pass' : 'fail',
      circuitBreaker: status.health.circuitBreaker === 'closed' ? 'pass' : 'fail',
      queue: status.health.queueUtilization < 0.8 ? 'pass' : 'fail'
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * Clean up old rate limit entries periodically with enhanced tracking
 */
function cleanupRateLimitMap() {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [email, data] of service.rateLimitMap.entries()) {
    if (now - data.windowStart > service.RATE_LIMIT_WINDOW) {
      service.rateLimitMap.delete(email);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    logger.debug('Cleaned up expired rate limit entries', { count: cleanedCount });
  }
}

// Schedule periodic cleanup with configurable interval
const cleanupInterval = setInterval(cleanupRateLimitMap, service.RATE_LIMIT_WINDOW);

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  stopEmailReplyService();
  clearInterval(cleanupInterval);
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  stopEmailReplyService();
  clearInterval(cleanupInterval);
  process.exit(0);
});

// Export enterprise-grade API
module.exports = {
  // Core service functions
  startEmailReplyService,
  stopEmailReplyService,
  getServiceStatus,
  getHealthCheck,
  processIncomingEmail,
  handleAutoReply,
  
  // Enterprise features
  service,
  logger,
  credentialManager,
  circuitBreaker: service.circuitBreaker,
  messageQueue: service.messageQueue,
  performanceMonitor: service.performanceMonitor,
  
  // Database integration
  databaseManager,
  
  // Scheduled email service
  scheduledEmailService,
  
  // Dashboard integration
  dashboardEmailService,
  
  // NEW: Secure OTP Service
  secureOTPService,
  
  // New email generation functions
  generateLoanApprovalEmail,
  generateLoanDenialEmail,
  generateMeetingScheduledEmail,
  generateEmergencyEmail,
  generateDailySummaryEmail,
  
  // Helper functions
  sanitizeInput,
  extractEmailAddress,
  validateEmailObject
};
