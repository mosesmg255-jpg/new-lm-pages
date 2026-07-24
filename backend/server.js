const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { OpenAI } = require('openai');
const os = require('os');

const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const securityScanner = require('./securityScanner');
const { log } = require('./logger');

// --- Security Headers ---
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// --- CORS ---
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:4000,http://127.0.0.1:4000,http://localhost:3000,http://127.0.0.1:3000')
  .split(',').map(s => s.trim());
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes(origin) || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1') || origin.endsWith('github.io')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// --- Body Parsing ---
app.use(express.json({ limit: '1mb' }));

// --- WAF ---
app.use(securityScanner);

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

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';

const { sequelize } = require('./models');

// --- Enhanced Health Check ---
app.get('/api/health', async (req, res) => {
  const health = {
    ok: true,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    db: 'disconnected'
  };
  try {
    await sequelize.authenticate();
    health.db = 'connected';
  } catch (err) {
    health.db = 'error: ' + err.message;
    health.ok = false;
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

async function startServer() {
  const dbInfo = sequelize.connectionDetails || {};
  let dbConnected = false;
  console.log(
    `MySQL target: ${dbInfo.user || 'root'}@${dbInfo.host || '127.0.0.1'}:${dbInfo.port || 3306}/${dbInfo.database || 'loanmanagement'}`
  );

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

  // Routes
  app.use('/api', require('./routes/api'));

  // Serve landing page as index
  app.get('/', (req, res) => {
    res.redirect('/member.html');
  });

    app.use((req, res) => {
    res.status(404).json({ status: 'fail', message: 'Not found' });
  });

  // --- JSON Error Handler (must be last) ---
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(err.status || 500).json({ status: 'fail', message: err.message || 'Server error' });
  });


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
}

// --- Graceful Shutdown ---
function gracefulShutdown(signal) {
  console.log(`\n[SHUTDOWN] Received ${signal}. Closing server gracefully...`);
  if (server) {
    server.close(() => {
      console.log('[SHUTDOWN] HTTP server closed.');
      sequelize.close().then(() => {
        console.log('[SHUTDOWN] Database connections closed.');
        process.exit(0);
      }).catch(() => {
        process.exit(0);
      });
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
