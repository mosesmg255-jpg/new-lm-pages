/**
 * emailReplyService.js
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Enterprise-grade Automatic email reply and processing service.
 * Monitors inbox for replies and processes them automatically.
 * Features: High throughput, security, resilience, observability.
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 */

const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const { EventEmitter } = require('events');

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
function startEmailReplyService() {
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
    version: '2.0.0-enterprise',
    features: ['circuit-breaker', 'message-queue', 'performance-monitoring', 'credential-encryption']
  });
  
  service.isServiceRunning = true;
  service.startTime = Date.now();
  
  const success = initImap();
  if (!success) {
    service.isServiceRunning = false;
    service.startTime = null;
    return false;
  }
  
  service.emit('started');
  logger.info('Email reply service started successfully');
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
  performanceMonitor: service.performanceMonitor
};
