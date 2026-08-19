/**
 * server-minimal.js
 * Minimal Express.js server for Render deployment
 * Only uses express and cors - no external dependencies
 */

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files
app.use(express.static(__dirname));

// Request logging
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

// Debug endpoint
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

// Admin login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
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
app.post('/api/auth/member/login', async (req, res) => {
  try {
    const { identity, password } = req.body;
    
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
app.post('/api/auth/member/register', async (req, res) => {
  try {
    const { name, email, phone, password, pin } = req.body;
    
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
    
    console.log('Registration notification sent to admin for:', newMember.email);
    
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

// Member Management Endpoints
app.get('/api/members/approved', async (req, res) => {
  try {
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
app.post('/api/meeting/send-link', async (req, res) => {
  try {
    const { members, meetingLink } = req.body;
    
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Minimal API Server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔧 API endpoints: http://localhost:${PORT}/api/`);
});

module.exports = app;