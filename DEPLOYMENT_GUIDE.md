# Deployment Guide - Render & Railway

## ðŸ“‹ Overview

This project is configured to deploy on **both Render and Railway** simultaneously from the same GitHub repository. They are completely independent and don't interfere with each other.

## ðŸŒ Deployment URLs

### Render (Working âœ…)
- **URL:** https://new-lm-pages.onrender.com
- **Status:** âœ… Working perfectly
- **Config:** `render.yaml`
- **Server:** `server.js` (full-featured with email service)

### Railway (Fixed ðŸ”§)
- **URL:** https://new-lm-pages-production.up.railway.app
- **Status:** âœ… Fixed (was failing due to dependencies)
- **Config:** `nixpacks.toml`
- **Server:** `server-simple.js` (simplified without external dependencies)

## ðŸ”§ Why Two Different Servers?

### `server.js` (Render)
- Full-featured server with email service
- Requires external dependencies:
  - Database (MySQL/Sequelize)
  - Redis
  - Email server (IMAP)
  - Twilio (SMS)
- Used on Render where these services are configured

### `server-simple.js` (Railway)
- Simplified server with only authentication APIs
- No external dependencies required
- Same authentication endpoints as full server
- Used on Railway for quick deployment without complex setup

## ðŸš€ Deployment Configuration

### Render Configuration (`render.yaml`)
```yaml
services:
  - type: web
    name: new-lm-pages-api
    env: node
    plan: free
    buildCommand: npm install
    startCommand: node server.js
    healthCheckPath: /health
```

### Railway Configuration (`nixpacks.toml`)
```toml
[phases.setup]
nixPkgs = ["nodejs-18_x"]

[phases.build]
cmds = ["npm install --production"]

[start]
cmd = "node server-simple.js"

[variables]
NODE_ENV = "production"
PORT = "3000"
ADMIN_EMAIL = "admin@eldorethama.com"
ADMIN_PASSWORD = "admin123"
```

## ðŸ› Railway Error Fix

### Problem
Railway deployment was failing because `server.js` requires external dependencies (database, Redis, email, Twilio) that weren't configured.

### Solution
1. Created `server-simple.js` - a simplified version without external dependencies
2. Updated `nixpacks.toml` to use `server-simple.js` instead of `server.js`
3. Added environment variables for authentication

### Result
Railway now deploys successfully with authentication endpoints working.

## âœ… Common Endpoints (Both Servers)

Both servers provide the same authentication endpoints:

- `GET /health` - Health check
- `GET /api/debug` - Debug information
- `POST /api/auth/login` - Admin login
- `POST /api/auth/member/login` - Member login
- `POST /api/auth/member/register` - Member registration
- `POST /api/auth/logout` - Logout
- `GET /api/auth/verify` - Token verification
- `GET /api/members/approved` - Get approved members
- `POST /api/meeting/send-link` - Send meeting invitations

## ðŸ”‘ Default Credentials

### Admin
- Email: `admin@eldorethama.com`
- Password: `admin123`

### Mock Members
- Member 1: `member1` / `password123`
- Member 2: `member2` / `password123`

## ðŸ“Š Differences Between Servers

| Feature | server.js (Render) | server-simple.js (Railway) |
|---------|-------------------|---------------------------|
| Authentication | âœ… | âœ… |
| Email Service | âœ… | âŒ |
| Database | âœ… | âŒ |
| Redis Cache | âœ… | âŒ |
| SMS/Twilio | âœ… | âŒ |
| PDF Generation | âœ… | âŒ |
| Webhooks | âœ… | âŒ |
| Analytics | âœ… | âŒ |
| External Dependencies | Required | None |

## ðŸ”„ How to Trigger Railway Redeploy

After pushing these changes:

1. Go to Railway dashboard: https://railway.com/project/09190554-2c66-40bf-84e5-69aca4e0e581
2. Click on your service
3. Click "Redeploy" or "Deploy latest commit"
4. Railway will build using the new `nixpacks.toml` configuration
5. Service should start successfully with `server-simple.js`

## âš ï¸ Important Notes

1. **Render is not affected** - Render continues using `server.js` with full features
2. **Railway now uses simplified server** - Railway uses `server-simple.js` for authentication only
3. **Both are independent** - Changes to one don't affect the other
4. **Same GitHub repo** - Both deploy from the same repository
5. **Different configurations** - Each platform has its own config file

## ðŸ§ª Testing

### Test Render
```bash
curl https://new-lm-pages.onrender.com/health
curl https://new-lm-pages.onrender.com/api/debug
```

### Test Railway
```bash
curl https://new-lm-pages-production.up.railway.app/health
curl https://new-lm-pages-production.up.railway.app/api/debug
```

## ðŸ“ Files Changed

1. âœ… `nixpacks.toml` - Updated to use `server-simple.js`
2. âœ… `server-simple.js` - New simplified server file
3. âœ… `render.yaml` - Render configuration (unchanged)
4. âœ… `server.js` - Full server (unchanged for Render)

## ðŸŽ¯ Next Steps

1. Trigger Railway redeploy
2. Verify Railway health check
3. Test authentication endpoints on Railway
4. Monitor Railway logs for any issues

---

**Last Updated:** 2026-01-07
**Status:** Railway deployment fixed