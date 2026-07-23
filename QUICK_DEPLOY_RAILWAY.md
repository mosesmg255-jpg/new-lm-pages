# Quick Railway Deployment Guide

## Step 1: Connect GitHub to Railway

1. Go to https://railway.com/dashboard
2. Click "New Project" → "Deploy from GitHub repo"
3. Authorize Railway to access your GitHub account
4. Select repository: `mosesmg255-jpg/new-lm-pages`
5. Click "Deploy Now"

## Step 2: Add MySQL Database

1. In your Railway project, click "New Service"
2. Select "Database" → "MySQL"
3. Railway will automatically create and configure the database

## Step 3: Configure Environment Variables

In your Railway project, go to the web service (not database) → "Variables" tab:

**Required Variables:**
```
PORT=4000
HOST=0.0.0.0
NODE_ENV=production
ADMIN_TOKEN_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
SESSION_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
```

**Database Variables (Railway provides these automatically - verify they exist):**
```
MYSQLHOST=${MYSQLHOST}
MYSQLPORT=${MYSQLPORT}
MYSQLDATABASE=${MYSQLDATABASE}
MYSQLUSER=${MYSQLUSER}
MYSQLPASSWORD=${MYSQLPASSWORD}
```

**Optional Variables:**
```
CORS_ORIGINS=https://mosesmg255-jpg.github.io,http://localhost:4000
OPENAI_API_KEY=<your_key_if_desired>
```

## Step 4: Redeploy

After adding environment variables:
1. Go to the "Deployments" tab
2. Click "Redeploy" to restart with new variables

## Step 5: Get Your Backend URL

1. Go to your Railway project
2. Click on the web service (the one running `node backend/server.js`)
3. Copy the "Public URL" (e.g., `https://your-app.up.railway.app`)

## Step 6: Update Frontend

Option A - Update code:
1. Edit `utils/security.js` line 197:
   ```javascript
   var defaultRailwayUrl = 'https://your-actual-railway-url.up.railway.app';
   ```
2. Commit and push to GitHub

Option B - Use URL parameter (no code change):
```
https://mosesmg255-jpg.github.io/new-lm-pages/member.html?backend=https://your-actual-railway-url.up.railway.app
```

## Step 7: Test

Visit your GitHub Pages site and test login functionality.

## Troubleshooting

**Deployment fails:**
- Check Railway deployment logs for errors
- Ensure `railway.json` is in the repository root

**Database connection errors:**
- Verify MySQL service is running
- Check that environment variables are set correctly
- Railway variables should be referenced as `${MYSQLHOST}` etc.

**Backend returns 404:**
- Ensure the web service is running (not just the database)
- Check the PORT is set to 4000
- Verify the start command is `node backend/server.js`

## Current Configuration

- ✅ `railway.json` configured with NIXPACKS builder
- ✅ Start command: `node backend/server.js`
- ✅ Restart policy: ON_FAILURE
- ✅ Database auto-creation in code
- ✅ CORS allows GitHub Pages origins
