/**
 * emailReplyService.js
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Automatic email reply and processing service.
 * Monitors inbox for replies and processes them automatically.
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Gracefully handle missing dependencies
let Imap, simpleParser;
try {
  Imap = require('imap');
  simpleParser = require('mailparser').simpleParser;
} catch (err) {
  console.warn('[emailReplyService] IMAP dependencies not installed. Auto-reply disabled. Run: npm install imap mailparser');
  Imap = null;
  simpleParser = null;
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

// Service state management
let imap = null;
let isServiceRunning = false;
let reconnectAttempts = 0;
let maxReconnectAttempts = parseInt(process.env.MAX_RECONNECT_ATTEMPTS) || 5;
let reconnectDelay = parseInt(process.env.RECONNECT_DELAY) || 5000;
let processedEmails = new Set(); // Track processed email IDs to prevent duplicates
let rateLimitMap = new Map(); // Track reply rates per email address
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW) || 3600000; // 1 hour default
const MAX_REPLIES_PER_WINDOW = parseInt(process.env.MAX_REPLIES_PER_WINDOW) || 3;

/**
 * Initialize IMAP connection for receiving emails
 */
function initImap() {
  if (!Imap) {
    console.error('[emailReplyService] Cannot initialize IMAP - dependencies not available');
    return false;
  }

  if (!imapConfig.user || !imapConfig.password) {
    console.error('[emailReplyService] Cannot initialize IMAP - missing credentials');
    return false;
  }

  try {
    imap = new Imap(imapConfig);

    imap.once('ready', () => {
      console.log('[emailReplyService] IMAP connection ready - monitoring inbox for replies');
      reconnectAttempts = 0; // Reset reconnect attempts on successful connection
      openInbox();
    });

    imap.once('error', (err) => {
      console.error('[emailReplyService] IMAP error:', err);
      handleImapError(err);
    });

    imap.once('end', () => {
      console.log('[emailReplyService] IMAP connection ended');
      if (isServiceRunning) {
        console.log('[emailReplyService] Attempting to reconnect...');
        scheduleReconnect();
      }
    });

    imap.connect();
    return true;
  } catch (err) {
    console.error('[emailReplyService] Error initializing IMAP:', err);
    return false;
  }
}

/**
 * Handle IMAP errors with reconnection logic
 */
function handleImapError(err) {
  console.error('[emailReplyService] Handling IMAP error:', err);
  
  if (isServiceRunning && reconnectAttempts < maxReconnectAttempts) {
    reconnectAttempts++;
    console.log(`[emailReplyService] Reconnection attempt ${reconnectAttempts}/${maxReconnectAttempts}`);
    scheduleReconnect();
  } else {
    console.error('[emailReplyService] Max reconnection attempts reached or service stopped');
    stopEmailReplyService();
  }
}

/**
 * Schedule reconnection attempt with exponential backoff
 */
function scheduleReconnect() {
  const delay = reconnectDelay * Math.pow(2, reconnectAttempts - 1);
  console.log(`[emailReplyService] Scheduling reconnection in ${delay}ms`);
  
  setTimeout(() => {
    if (isServiceRunning) {
      initImap();
    }
  }, delay);
}

/**
 * Open inbox and start monitoring for new emails
 */
function openInbox() {
  if (!imap) {
    console.error('[emailReplyService] Cannot open inbox - IMAP not initialized');
    return;
  }

  imap.openBox('INBOX', false, (err, box) => {
    if (err) {
      console.error('[emailReplyService] Error opening inbox:', err);
      return;
    }
    console.log('[emailReplyService] Inbox opened, total messages:', box.messages.total);
    
    // Watch for new emails
    imap.on('mail', (numNewMsgs) => {
      console.log(`[emailReplyService] ${numNewMsgs} new email(s) received`);
      fetchNewEmails();
    });
  });
}

/**
 * Fetch and process new emails
 */
function fetchNewEmails() {
  if (!imap || !simpleParser) {
    console.error('[emailReplyService] Cannot fetch emails - IMAP or parser not available');
    return;
  }

  imap.search(['UNSEEN'], (err, results) => {
    if (err) {
      console.error('[emailReplyService] Error searching for unseen emails:', err);
      return;
    }
    
    if (!results || results.length === 0) {
      console.log('[emailReplyService] No unseen emails found');
      return;
    }

    console.log(`[emailReplyService] Found ${results.length} unseen email(s)`);
    
    const fetch = imap.fetch(results, { 
      bodies: '', 
      markSeen: false 
    });

    fetch.on('message', (msg, seqno) => {
      msg.on('body', (stream) => {
        simpleParser(stream, (err, parsed) => {
          if (err) {
            console.error('[emailReplyService] Error parsing email:', err);
            return;
          }
          processIncomingEmail(parsed);
        });
      });
    });

    fetch.once('error', (err) => {
      console.error('[emailReplyService] Fetch error:', err);
    });
    
    fetch.once('end', () => {
      console.log('[emailReplyService] Email fetch completed');
    });
  });
}

/**
 * Validate email object structure
 */
function validateEmailObject(email) {
  if (!email) {
    console.error('[emailReplyService] Invalid email object: null or undefined');
    return false;
  }
  
  if (!email.from || !email.from.text) {
    console.error('[emailReplyService] Invalid email: missing sender information');
    return false;
  }
  
  if (!email.subject) {
    console.error('[emailReplyService] Invalid email: missing subject');
    return false;
  }
  
  // Generate unique email ID for duplicate prevention
  const emailId = `${email.from.text}_${email.subject}_${email.date || Date.now()}`;
  if (processedEmails.has(emailId)) {
    console.log('[emailReplyService] Email already processed, skipping:', emailId);
    return false;
  }
  
  return true;
}

/**
 * Sanitize user input to prevent XSS attacks
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Check if rate limit would be exceeded for sender
 */
function checkRateLimit(senderEmail) {
  const now = Date.now();
  const senderData = rateLimitMap.get(senderEmail);
  
  if (!senderData) {
    rateLimitMap.set(senderEmail, { count: 1, windowStart: now });
    return true;
  }
  
  // Reset if window expired
  if (now - senderData.windowStart > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(senderEmail, { count: 1, windowStart: now });
    return true;
  }
  
  // Check if limit exceeded
  if (senderData.count >= MAX_REPLIES_PER_WINDOW) {
    console.warn(`[emailReplyService] Rate limit exceeded for ${senderEmail}`);
    return false;
  }
  
  senderData.count++;
  return true;
}

/**
 * Extract email address from various formats
 */
function extractEmailAddress(fromField) {
  if (!fromField) return null;
  
  // Handle simple email format
  if (typeof fromField === 'string' && fromField.includes('@')) {
    const match = fromField.match(/<([^>]+)>/) || fromField.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    return match ? match[1] : fromField.trim();
  }
  
  // Handle object format { text: '...', value: [...] }
  if (fromField.text) {
    return extractEmailAddress(fromField.text);
  }
  
  return null;
}

/**
 * Process incoming email and determine if auto-reply is needed
 */
function processIncomingEmail(email) {
  if (!validateEmailObject(email)) {
    return;
  }
  
  const senderEmail = extractEmailAddress(email.from);
  if (!senderEmail) {
    console.error('[emailReplyService] Could not extract valid email address from sender');
    return;
  }
  
  console.log('[emailReplyService] Processing email from:', senderEmail);
  console.log('[emailReplyService] Subject:', email.subject);
  
  // Check rate limit
  if (!checkRateLimit(senderEmail)) {
    console.log('[emailReplyService] Rate limit check failed, skipping auto-reply');
    return;
  }
  
  // Mark email as processed
  const emailId = `${senderEmail}_${email.subject}_${email.date || Date.now()}`;
  processedEmails.add(emailId);
  
  // Clean up old entries from processed emails (keep last 1000)
  if (processedEmails.size > 1000) {
    const oldestEntries = Array.from(processedEmails).slice(0, 100);
    oldestEntries.forEach(entry => processedEmails.delete(entry));
  }
  
  // Check if this is a reply to a system email
  const subject = (email.subject || '').toLowerCase();
  const isReply = subject.includes('re:') || subject.includes('reply') || subject.includes('fw:');
  
  if (isReply) {
    console.log('[emailReplyService] Detected reply to system email');
    handleAutoReply(email, senderEmail);
  }
}

/**
 * Send automatic reply based on email content
 */
async function handleAutoReply(email, senderEmail) {
  try {
    const { sendEmail } = require('./emailService');
    
    if (!sendEmail) {
      console.error('[emailReplyService] Email service not available');
      return;
    }
    
    const sanitizedSubject = sanitizeInput(email.subject || '');
    const replySubject = `Re: ${sanitizedSubject.replace(/^(Re:|RE:|Fw:|FW:)\s*/i, '')}`;
    
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
    
    await sendEmail(senderEmail, replySubject, replyBody);
    console.log('[emailReplyService] Auto-reply sent to:', senderEmail);
  } catch (err) {
    console.error('[emailReplyService] Error sending auto-reply:', err);
    // Don't throw - we want to continue processing other emails
  }
}

/**
 * Generate loan-related auto-reply
 */
function generateLoanReply(email) {
  const sanitizedSubject = sanitizeInput(email.subject || 'No Subject');
  const receivedDate = new Date().toLocaleString();
  const currentYear = new Date().getFullYear();
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Auto Reply</title>
  <style>
    body { margin: 0; padding: 0; background: #f0f4f8; font-family: 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1a3a5c 0%, #2563eb 100%); padding: 32px 40px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; }
    .body { padding: 36px 40px; color: #1e293b; line-height: 1.7; font-size: 15px; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; text-align: center; font-size: 12px; color: #94a3b8; }
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
        <strong>Received:</strong> ${receivedDate}
      </div>
    </div>
    <div class="footer">
      <p>This is an automated message. Please do not reply to this email.</p>
      <p>Â© ${currentYear} Loan Management System. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generate contribution-related auto-reply
 */
function generateContributionReply(email) {
  const currentYear = new Date().getFullYear();
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Auto Reply</title>
  <style>
    body { margin: 0; padding: 0; background: #f0f4f8; font-family: 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1a3a5c 0%, #2563eb 100%); padding: 32px 40px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; }
    .body { padding: 36px 40px; color: #1e293b; line-height: 1.7; font-size: 15px; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; text-align: center; font-size: 12px; color: #94a3b8; }
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
    </div>
    <div class="footer">
      <p>This is an automated message. Please do not reply to this email.</p>
      <p>Â© ${currentYear} Loan Management System. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generate approval-related auto-reply
 */
function generateApprovalReply(email) {
  const currentYear = new Date().getFullYear();
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Auto Reply</title>
  <style>
    body { margin: 0; padding: 0; background: #f0f4f8; font-family: 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1a3a5c 0%, #2563eb 100%); padding: 32px 40px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; }
    .body { padding: 36px 40px; color: #1e293b; line-height: 1.7; font-size: 15px; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; text-align: center; font-size: 12px; color: #94a3b8; }
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
    </div>
    <div class="footer">
      <p>This is an automated message. Please do not reply to this email.</p>
      <p>Â© ${currentYear} Loan Management System. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generate generic auto-reply
 */
function generateGenericReply(email) {
  const currentYear = new Date().getFullYear();
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Auto Reply</title>
  <style>
    body { margin: 0; padding: 0; background: #f0f4f8; font-family: 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1a3a5c 0%, #2563eb 100%); padding: 32px 40px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; }
    .body { padding: 36px 40px; color: #1e293b; line-height: 1.7; font-size: 15px; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; text-align: center; font-size: 12px; color: #94a3b8; }
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
    </div>
    <div class="footer">
      <p>This is an automated message. Please do not reply to this email.</p>
      <p>Â© ${currentYear} Loan Management System. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Start the email reply service
 */
function startEmailReplyService() {
  if (isServiceRunning) {
    console.warn('[emailReplyService] Service is already running');
    return false;
  }

  if (!Imap || !simpleParser) {
    console.warn('[emailReplyService] IMAP dependencies not available - auto-reply disabled');
    return false;
  }

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('[emailReplyService] Email credentials not configured - auto-reply disabled');
    return false;
  }
  
  console.log('[emailReplyService] Starting automatic email reply service...');
  isServiceRunning = true;
  
  const success = initImap();
  if (!success) {
    isServiceRunning = false;
    return false;
  }
  
  return true;
}

/**
 * Stop the email reply service gracefully
 */
function stopEmailReplyService() {
  console.log('[emailReplyService] Stopping automatic email reply service...');
  isServiceRunning = false;
  
  if (imap) {
    try {
      imap.end();
      console.log('[emailReplyService] IMAP connection closed');
    } catch (err) {
      console.error('[emailReplyService] Error closing IMAP connection:', err);
    }
    imap = null;
  }
  
  // Clear tracking data
  processedEmails.clear();
  rateLimitMap.clear();
  reconnectAttempts = 0;
  
  console.log('[emailReplyService] Service stopped');
}

/**
 * Get service status
 */
function getServiceStatus() {
  return {
    isRunning: isServiceRunning,
    hasDependencies: !!(Imap && simpleParser),
    hasCredentials: !!(process.env.EMAIL_USER && process.env.EMAIL_PASS),
    processedEmailsCount: processedEmails.size,
    reconnectAttempts: reconnectAttempts
  };
}

/**
 * Clean up old rate limit entries periodically
 */
function cleanupRateLimitMap() {
  const now = Date.now();
  for (const [email, data] of rateLimitMap.entries()) {
    if (now - data.windowStart > RATE_LIMIT_WINDOW) {
      rateLimitMap.delete(email);
    }
  }
}

// Schedule periodic cleanup
setInterval(cleanupRateLimitMap, RATE_LIMIT_WINDOW);

module.exports = {
  startEmailReplyService,
  stopEmailReplyService,
  getServiceStatus,
  processIncomingEmail,
  handleAutoReply
};
