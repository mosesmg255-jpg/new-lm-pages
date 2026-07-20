const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

let serverProcess;
let PORT;

function waitForServer(url, timeout = 25000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      http.get(url, (res) => {
        resolve(res);
      }).on('error', () => {
        if (Date.now() - start > timeout) {
          reject(new Error('Server startup timeout'));
        } else {
          setTimeout(check, 500);
        }
      });
    };
    check();
  });
}

beforeAll(async () => {
  PORT = 4001 + Math.floor(Math.random() * 900);

  serverProcess = spawn('node', ['backend/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const output = [];
  serverProcess.stdout.on('data', d => output.push(d.toString()));
  serverProcess.stderr.on('data', d => output.push(d.toString()));

  try {
    await waitForServer(`http://localhost:${PORT}/api/health`, 25000);
  } catch (e) {
    console.error('Server output:', output.join('\n'));
    throw e;
  }
}, 35000);

afterAll(async () => {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
});

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}${path}`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject);
  });
}

function post(path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(`http://localhost:${PORT}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

describe('Health Check', () => {
  test('GET /api/health returns ok with db status', async () => {
    const res = await get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.uptime).toBeDefined();
    expect(res.body.db).toBe('connected');
    expect(res.body.memory).toBeDefined();
    expect(res.body.timestamp).toBeDefined();
  });
});

describe('Static Pages', () => {
  test('GET /member.html returns 200', async () => {
    const res = await get('/member.html');
    expect(res.status).toBe(200);
  });

  test('GET /home.html returns 200', async () => {
    const res = await get('/home.html');
    expect(res.status).toBe(200);
  });

  test('GET /login.html returns 200', async () => {
    const res = await get('/login.html');
    expect(res.status).toBe(200);
  });

  test('GET /nonexistent.html returns 404', async () => {
    const res = await get('/nonexistent.html');
    expect(res.status).toBe(404);
  });
});

describe('Auth API', () => {
  test('POST /api/auth/register rejects missing fields', async () => {
    const res = await post('/api/auth/register', {
      adminName: 'A',
      adminEmail: 'not-an-email',
      adminPassword: '123',
      adminConfirm: '456'
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/auth/register creates admin with valid data', async () => {
    const uniqueEmail = `testadmin_${Date.now()}@example.com`;
    const res = await post('/api/auth/register', {
      adminName: 'Test Admin',
      adminEmail: uniqueEmail,
      adminPhone: '+1234567890',
      adminPassword: 'TestPassword123!',
      adminConfirm: 'TestPassword123!'
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('POST /api/auth/login authenticates admin', async () => {
    const res = await post('/api/auth/login', {
      identifier: 'testadmin2@example.com',
      password: 'TestPassword123!'
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.token).toBeDefined();
  });

  test('POST /api/auth/login rejects wrong password', async () => {
    const res = await post('/api/auth/login', {
      identifier: 'testadmin2@example.com',
      password: 'wrongpassword'
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('fail');
  });
});

describe('Settings API (Auth Required)', () => {
  test('GET /api/settings/blur requires auth', async () => {
    const res = await get('/api/settings/blur');
    expect(res.status).toBe(401);
    expect(res.body.status).toBe('fail');
  });
});

describe('Protected Endpoints', () => {
  test('GET /api/members/all requires admin auth', async () => {
    const res = await get('/api/members/all');
    expect(res.status).toBe(401);
    expect(res.body.status).toBe('fail');
  });

  test('GET /api/loans/stats requires admin auth', async () => {
    const res = await get('/api/loans/stats');
    expect(res.status).toBe(401);
    expect(res.body.status).toBe('fail');
  });
});

describe('WAF Security', () => {
  test('XSS script tag in body is blocked', async () => {
    const res = await post('/api/ai/assistant', {
      message: '<script>alert("xss")</script>'
    });
    expect(res.status).toBe(403);
  });

  test('XSS event handler is blocked', async () => {
    const res = await post('/api/ai/assistant', {
      message: '<img src=x onerror=alert(1)>'
    });
    expect(res.status).toBe(403);
  });

  test('Normal business data passes WAF', async () => {
    const res = await post('/api/ai/assistant', {
      message: 'How do I check my loan status?'
    });
    expect(res.status).not.toBe(403);
  });

  test('Normal login data passes WAF', async () => {
    const res = await post('/api/auth/login', {
      identifier: 'testadmin@example.com',
      password: 'TestPassword123!'
    });
    expect(res.status).not.toBe(403);
  });
});

describe('404 Handling', () => {
  test('GET /api/nonexistent returns 404 JSON', async () => {
    const res = await get('/api/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.status).toBe('fail');
  });
});
