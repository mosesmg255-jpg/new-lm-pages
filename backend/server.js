const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const os = require('os');

const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();

// Optional OpenAI integration - only load if dependency is available and API key is provided
let openai = null;
try {
  if (process.env.OPENAI_API_KEY) {
    const { OpenAI } = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('[SERVER] OpenAI integration enabled');
  } else {
    console.log('[SERVER] OpenAI integration disabled (no API key)');
  }
} catch (err) {
  console.log('[SERVER] OpenAI integration disabled (dependency not available)');
}

// Optional security scanner and logger - load gracefully if available
let securityScanner = null;
let log = null;
try {
  securityScanner = require('./securityScanner');
} catch (err) {
  console.log('[SERVER] Security scanner not available');
}

try {
  const logger = require('./logger');
  log = logger.log;
} catch (err) {
  console.log('[SERVER] Logger not available, using console.log');
  log = (level, info) => console.log(`[${level}]`, info);
}

// --- Security Headers ---
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// --- CORS ---
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 
  'http://localhost:3000,http://127.0.0.1:3000,http://localhost:4000,http://127.0.0.1:4000,' +
  'https://project2026-64ro.onrender.com,https://new-lm-pages.onrender.com,https://mosesmg255-jpg.github.io'
).split(',').map(s => s.trim()).filter(s => s.length > 0);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, etc.)
    if (!origin) {
      return callback(null, true);
    }
    
    // Allow localhost for development
    if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
      return callback(null, true);
    }
    
    // Check against configured origins
    if (ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    
    // Block unapproved origins
    console.warn('[CORS] Blocked origin:', origin);
    callback(null, false);
  },
  credentials: true
}));

// Clean 403 response for blocked CORS (redundant with CORS middleware but kept for explicit rejection)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin) && !origin.startsWith('http://localhost') && !origin.startsWith('http://127.0.0.1')) {
    return res.status(403).json({ status: 'fail', message: 'CORS policy rejected request', error: 'Not allowed by CORS' });
  }
  next();
});

// --- Body Parsing ---
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' })); // support native HTML form POSTs
app.use(express.urlencoded({ extended: false, limit: '1mb' })); // support native HTML form POSTs

// --- WAF ---
if (securityScanner) {
  app.use(securityScanner);
}

// --- Request Logger ---
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    log('http_request', {
      route: req.originalUrl,
      admin_id: req.headers['x-admin-token'] ? 'token-present' : '',
      duration_ms: duration
    });
  });
  next();
});

// --- Global Rate Limit ---
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'fail', message: 'Too many requests from this IP, please try again later.' }
  })
);

// --- Stricter Rate Limits for Auth Endpoints ---
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'fail', message: 'Too many authentication attempts. Please try again in 15 minutes.' }
});

// --- Upload Rate Limit ---
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  message: { status: 'fail', message: 'Too many upload requests.' }
});

// Apply strict auth rate limiter
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/recover-password', authLimiter);
app.use('/api/members/login', authLimiter);
app.use('/api/settings/verify-admin-password', authLimiter);

// --- Static Files ---
app.use(express.static(path.join(__dirname, '..')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '0.0.0.0';

// Optional database models - load gracefully if database is configured
let sequelize = null;
try {
  const models = require('./models');
  sequelize = models.sequelize;
} catch (err) {
  console.log('[SERVER] Database models not available, running without database');
}

// --- Liveness Check (process alive) ---
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: require('../package.json').version,
    environment: process.env.NODE_ENV || 'development',
    port: PORT,
    host: HOST
  });
});

// --- Enhanced Health Check (dependencies) ---
app.get('/api/health', async (req, res) => {
  const health = {
    ok: true,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    db: sequelize ? 'disconnected' : 'not_configured',
    openai: openai ? 'enabled' : 'disabled',
    schedulers: process.env.ENABLE_SCHEDULERS === 'true' ? 'enabled' : 'disabled'
  };
  
  if (sequelize) {
    try {
      await sequelize.authenticate();
      health.db = 'connected';
    } catch (err) {
      health.db = 'error: ' + err.message;
      health.ok = false;
    }
  }
  
  const statusCode = health.ok ? 200 : 503;
  res.status(statusCode).json(health);
});

// --- AI Assistant Proxy ---
app.post('/api/ai/assistant', async (req, res) => {
  try {
    const { message } = req.body || {};
    const prompt = `You are a helpful assistant for a loan management portal. The user said: "${String(message).slice(0, 1000)}". Respond clearly and politely with guidance about loans, repayments, account status, or member actions.`;

    if (openai) {
      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a member support assistant for a loan management application.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 250,
        temperature: 0.7
      });

      const aiReply = completion.choices?.[0]?.message?.content?.trim();
      if (aiReply) {
        return res.json({ reply: aiReply });
      }
    }

    const reply = `Mock assistant reply: I received your message "${String(message).slice(0, 200)}". Ask me about your loans, repayments, or account status and I'll assist.`;
    return res.json({ reply });
  } catch (err) {
    console.error('AI assistant proxy error:', err.message);
    return res.status(500).json({ message: 'AI proxy error' });
  }
});

// --- IP Discovery ---
function getPreferredIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

let server;

// --- API Routes (always registered BEFORE DB connects to avoid cold-start HTML errors) ---
try {
  const apiRoutes = require('./routes/api');
  app.use('/api', apiRoutes);
  console.log('[SERVER] API routes mounted successfully');
} catch (err) {
  console.error('[SERVER] Failed to mount API routes:', err.message);
  // Mount a fallback that returns error info
  app.use('/api', (req, res) => {
    res.status(500).json({ status: 'fail', message: 'API routes failed to load', error: err.message });
  });
}

// Diagnostic endpoint to verify API router is mounted (must be before catch-all)
app.get('/api/diag', (req, res) => {
  res.json({
    status: 'ok',
    message: 'API router is responding',
    timestamp: new Date().toISOString(),
    routes_mounted: true,
    available_routes: ['/auth', '/members', '/loans', '/repayments', '/contributions', '/expenses', '/logs', '/verifications', '/treasurer', '/automation', '/corporate', '/safeguard', '/settings', '/minutes', '/messages', '/live-updates', '/checkins', '/badges', '/savings-goals'],
    configuration: {
      port: PORT,
      host: HOST,
      node_env: process.env.NODE_ENV || 'development',
      cors_origins: ALLOWED_ORIGINS,
      openai_enabled: !!openai,
      schedulers_enabled: process.env.ENABLE_SCHEDULERS === 'true'
    },
    git_info: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || 'unknown',
      branch: process.env.VERCEL_GIT_COMMIT_REF || process.env.RENDER_GIT_BRANCH || 'unknown'
    }
  });
});

// Serve landing page as index
app.get('/', (req, res) => {
  res.redirect('/landingpage.html');
});

// Catch-all 404 — always returns JSON, never HTML
app.use((req, res) => {
  res.status(404).json({ status: 'fail', message: 'Not found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[GLOBAL ERROR]', err);
  res.status(500).json({ status: 'fail', message: 'Internal Server Error', error: err.message });
});

async function startServer() {
  let dbConnected = false;
  
  if (sequelize) {
    const dbInfo = sequelize.connectionDetails || {};
    console.log(
      `MySQL target: ${dbInfo.user || 'root'}@${dbInfo.host || '127.0.0.1'}:${dbInfo.port || 3306}/${dbInfo.database || 'loanmanagement'}`
    );

    // Start the HTTP server immediately so Render's health check passes during DB connect
    server = app.listen(PORT, HOST, () => {
      const localHost = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;
      console.log(`\nLM backend listening on port ${PORT}`);
      console.log(`Static files served from: ${path.join(__dirname, '..')}\n`);
      console.log('--- Available Localhost URLs ---');
      console.log(`  http://${localHost}:${PORT}/home.html          (Admin Panel)`);
      console.log(`  http://${localHost}:${PORT}/member.html        (Member Portal)`);
      console.log(`  http://${localHost}:${PORT}/login.html         (Admin Login)`);
      console.log(`  http://${localHost}:${PORT}/landingpage.html   (Landing Page)`);
      console.log(`  http://${localHost}:${PORT}/createaccount.html (Create Account)`);
      console.log(`  http://${localHost}:${PORT}/api/health          (Health Check)`);
      console.log(`--------------------------------\n`);
    });

    for (let i = 1; i <= 5; i++) {
      try {
        await sequelize.authenticate();
        console.log('MySQL connected');
        dbConnected = true;
        break;
      } catch (err) {
        console.error(`MySQL connection attempt ${i}/5 failed:`, err.message);
        if (i < 5) await new Promise(res => setTimeout(res, 2000));
      }
    }

    if (!dbConnected) {
      console.error('MySQL is not connected. Start MySQL and confirm backend/.env points to 127.0.0.1:3306.');
      console.error('The web server will still start on localhost so static pages can load.');
    }

    if (dbConnected) {
      try {
        await sequelize.sync();
        console.log('MySQL tables synced');
      } catch (err) {
        console.error('MySQL sync error:', err.message);
      }
    }
  } else {
    // Start server without database
    server = app.listen(PORT, HOST, () => {
      const localHost = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;
      console.log(`\nLM backend listening on port ${PORT} (without database)`);
      console.log(`Static files served from: ${path.join(__dirname, '..')}\n`);
      console.log('--- Available Localhost URLs ---');
      console.log(`  http://${localHost}:${PORT}/home.html          (Admin Panel)`);
      console.log(`  http://${localHost}:${PORT}/member.html        (Member Portal)`);
      console.log(`  http://${localHost}:${PORT}/login.html         (Admin Login)`);
      console.log(`  http://${localHost}:${PORT}/landingpage.html   (Landing Page)`);
      console.log(`  http://${localHost}:${PORT}/createaccount.html (Create Account)`);
      console.log(`  http://${localHost}:${PORT}/api/health          (Health Check)`);
      console.log(`--------------------------------\n`);
      console.log('Note: Database not configured. API endpoints that require database will return errors.');
    });
  }

  // Start schedulers only if explicitly enabled (for multi-run safety)
  if (process.env.ENABLE_SCHEDULERS === 'true') {
    console.log('[SERVER] Schedulers enabled (ENABLE_SCHEDULERS=true)');
    
    // Start email scheduler (daily repayment reminders, overdue alerts)
    try {
      const { startEmailScheduler } = require('./emailScheduler');
      startEmailScheduler();
      console.log('[SERVER] Email scheduler started');
    } catch (schedulerErr) {
      console.warn('[server] Email scheduler failed to start:', schedulerErr.message);
    }

    // Start loan reminder scheduler
    try {
      const { startLoanSchedulers } = require('./schedulers/loanReminderScheduler');
      startLoanSchedulers();
      console.log('[SERVER] Loan reminder scheduler started');
    } catch (schedulerErr) {
      console.warn('[server] Loan reminder scheduler failed to start:', schedulerErr.message);
    }

    // Start automatic email reply service
    try {
      const { startEmailReplyService } = require('./emailReplyService');
      startEmailReplyService();
      console.log('[SERVER] Email reply service started');
    } catch (replyErr) {
      console.warn('[server] Email reply service failed to start:', replyErr.message);
    }
  } else {
    console.log('[SERVER] Schedulers disabled (ENABLE_SCHEDULERS not set to true)');
    console.log('[SERVER] This instance will run web API only without background jobs');
  }
}

// --- Graceful Shutdown ---
function gracefulShutdown(signal) {
  console.log(`\n[SHUTDOWN] Received ${signal}. Closing server gracefully...`);
  if (server) {
    server.close(() => {
      console.log('[SHUTDOWN] HTTP server closed.');
      if (sequelize) {
        sequelize.close().then(() => {
          console.log('[SHUTDOWN] Database connections closed.');
          process.exit(0);
        }).catch(() => {
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    });
  } else {
    process.exit(0);
  }
  setTimeout(() => {
    console.error('[SHUTDOWN] Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();
