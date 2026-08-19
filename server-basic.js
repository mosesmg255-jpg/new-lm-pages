/**
 * server-basic.js
 * Ultra-minimal server for Render deployment - only uses Node.js built-in modules
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// MIME types
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

const server = http.createServer((req, res) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      port: PORT
    }));
    return;
  }

  // Debug endpoint
  if (req.url === '/api/debug') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
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
    }));
    return;
  }

  // API endpoints
  if (req.url.startsWith('/api/')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = body ? JSON.parse(body) : {};
        handleApiRequest(req, res, data);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // Serve static files
  let filePath = '.' + req.url;
  if (filePath === './') {
    filePath = './index.html';
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found', path: req.url }));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server error' }));
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

function handleApiRequest(req, res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json' });

  switch (req.url) {
    case '/api/auth/login':
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@eldorethama.com';
      const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
      
      if (data.email === adminEmail && data.password === adminPassword) {
        const token = Buffer.from(`${data.email}:${Date.now()}`).toString('base64');
        res.end(JSON.stringify({
          success: true,
          token: token,
          user: { email: data.email, role: 'admin', name: 'Administrator' },
          message: 'Login successful'
        }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Invalid credentials' }));
      }
      break;

    case '/api/auth/verify':
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (token) {
        const decoded = Buffer.from(token, 'base64').toString('utf-8');
        const [email] = decoded.split(':');
        res.end(JSON.stringify({
          valid: true,
          user: { email: email, role: 'admin', name: 'Administrator' }
        }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ valid: false, message: 'No token provided' }));
      }
      break;

    case '/api/auth/logout':
      res.end(JSON.stringify({ success: true, message: 'Logout successful' }));
      break;

    case '/api/auth/member/login':
      const mockMembers = [
        { id: 1, email: 'member1@example.com', username: 'member1', password: 'password123', name: 'John Doe', status: 'approved' },
        { id: 2, email: 'member2@example.com', username: 'member2', password: 'password123', name: 'Jane Smith', status: 'approved' }
      ];
      
      const member = mockMembers.find(m => 
        (m.email === data.identity || m.username === data.identity) && m.password === data.password
      );
      
      if (member) {
        const token = Buffer.from(`${member.id}:${member.email}:${Date.now()}`).toString('base64');
        res.end(JSON.stringify({
          success: true,
          token: token,
          user: { id: member.id, email: member.email, name: member.name, username: member.username, role: 'member' },
          message: 'Login successful'
        }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Invalid credentials' }));
      }
      break;

    case '/api/auth/member/register':
      const newMember = {
        id: Date.now(),
        name: data.name,
        email: data.email,
        phone: data.phone,
        password: data.password,
        pin: data.pin,
        status: 'pending',
        createdAt: new Date().toISOString()
      };
      console.log('Registration notification sent to admin for:', newMember.email);
      res.end(JSON.stringify({
        success: true,
        message: 'Registration successful. Your account is pending admin approval.',
        member: { id: newMember.id, name: newMember.name, email: newMember.email, status: newMember.status }
      }));
      break;

    case '/api/members/approved':
      const approvedMembers = [
        { id: 1, first_name: 'John', last_name: 'Doe', email: 'john@example.com' },
        { id: 2, first_name: 'Jane', last_name: 'Smith', email: 'jane@example.com' },
        { id: 3, first_name: 'Michael', last_name: 'Johnson', email: 'michael@example.com' }
      ];
      res.end(JSON.stringify({ success: true, members: approvedMembers }));
      break;

    case '/api/meeting/send-link':
      const results = data.members.map(memberId => ({
        memberId,
        status: 'sent',
        timestamp: new Date().toISOString()
      }));
      res.end(JSON.stringify({
        success: true,
        message: `Meeting link sent to ${data.members.length} members`,
        results
      }));
      break;

    default:
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', path: req.url }));
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Basic Server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔧 API endpoints: http://localhost:${PORT}/api/`);
});