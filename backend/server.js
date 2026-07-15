const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { OpenAI } = require('openai');

const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;


app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 5000, // Increased limit for local testing
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'fail', message: 'Too many requests from this IP, please try again later.' }
  })
);

// Serve static files from the project root (parent of backend/)
app.use(express.static(path.join(__dirname, '..')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const { sequelize } = require('./models');


app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// AI assistant proxy route.
// POST /api/ai/assistant { message, session }
app.post('/api/ai/assistant', async (req, res) => {
  try {
    const { message, session } = req.body || {};
    const prompt = `You are a helpful assistant for a loan management portal. The user said: "${String(message).slice(0, 1000)}". Respond clearly and politely with guidance about loans, repayments, account status, or member actions.`;

    if (openai) {
      const completion = await openai.createChatCompletion({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a member support assistant for a loan management application.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 250,
        temperature: 0.7
      });

      const aiReply = completion.data.choices?.[0]?.message?.content?.trim();
      if (aiReply) {
        return res.json({ reply: aiReply });
      }
    }

    // Fallback mock reply when OpenAI is not configured or returns no reply.
    const reply = `Mock assistant reply: I received your message "${String(message).slice(0,200)}". Ask me about your loans, repayments, or account status and I'll assist.`;
    return res.json({ reply });
  } catch (err) {
    console.error('AI assistant proxy error:', err);
    return res.status(500).json({ message: 'AI proxy error' });
  }
});

// Redirect root to member.html
app.get('/', (req, res) => {
  res.redirect('/member.html');
});

const os = require('os');

/**
 * Pick one preferred IPv4 address:
 * - Prefer the first non-loopback (non-127.x.x.x) address found.
 * - Fall back to 127.0.0.1 if none found.
 */
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

  app.use((req, res) => {
    res.status(404).json({ message: 'Not found' });
  });

  app.listen(PORT, HOST, () => {
    const localHost = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;
    console.log(`\nLM backend listening on port ${PORT}`);
    console.log(`Static files served from: ${path.join(__dirname, '..')}\n`);
    console.log('--- Available Localhost URLs ---');
    console.log(`  http://${localHost}:${PORT}/home.html          (Admin Panel)`);
    console.log(`  http://${localHost}:${PORT}/member.html        (Member Portal)`);
    console.log(`  http://${localHost}:${PORT}/login.html         (Admin Login)`);
    console.log(`  http://${localHost}:${PORT}/laddingpage.html   (Landing Page)`);
    console.log(`  http://${localHost}:${PORT}/createaccount.html (Create Account)`);
    console.log(`--------------------------------\n`);
  });
}

startServer();
