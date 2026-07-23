# Railway Deployment Guide

This guide explains how to deploy the Loan Management System backend to Railway.

## Prerequisites

- Railway account (https://railway.com)
- GitHub repository connected to Railway
- MySQL database service on Railway

## Deployment Steps

### 1. Create Railway Project

1. Go to https://railway.com/dashboard
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your repository: `mosesmg255-jpg/new-lm-pages`

### 2. Configure Database

1. In your Railway project, add a MySQL database service
2. Once created, click on the database service
3. Go to the "Variables" tab
4. Copy the database connection details

### 3. Set Environment Variables

In your Railway project settings, add these environment variables:

```
PORT=4000
HOST=0.0.0.0

# Database (Railway provides these automatically)
MYSQL_HOST=${MYSQLHOST}
MYSQL_PORT=${MYSQLPORT}
MYSQL_DATABASE=${MYSQLDATABASE}
MYSQL_USER=${MYSQLUSER}
MYSQL_PASSWORD=${MYSQLPASSWORD}

# Security (generate secure random strings)
ADMIN_TOKEN_SECRET=your_secure_random_string_here
SESSION_SECRET=your_secure_random_string_here

# Optional: M-Pesa Integration
DARAJA_CONSUMER_KEY=your_consumer_key
DARAJA_CONSUMER_SECRET=your_consumer_secret
DARAJA_SHORTCODE=174379
DARAJA_PASSKEY=your_sandbox_passkey
DARAJA_CALLBACK_URL=https://your-railway-app-url.railway.app/api/mpesa/callback
DARAJA_ENV=sandbox
```

### 4. Configure Build Settings

The `railway.json` file is already configured with:
- Builder: NIXPACKS
- Start command: `node backend/server.js`
- Restart policy: ON_FAILURE

### 5. Deploy

1. Commit and push your changes to GitHub
2. Railway will automatically detect the push and start deployment
3. Monitor the deployment logs in Railway dashboard

### 6. Get Your Backend URL

After successful deployment:
1. Go to your Railway project
2. Click on the web service (not the database)
3. Copy the generated URL (e.g., `https://your-app.up.railway.app`)

### 7. Update Frontend Configuration

Option 1: Update `utils/security.js` (line 197):
```javascript
var defaultRailwayUrl = 'https://your-actual-railway-url.up.railway.app';
```

Option 2: Use URL parameter when accessing GitHub Pages:
```
https://mosesmg255-jpg.github.io/new-lm-pages/member.html?backend=https://your-actual-railway-url.up.railway.app
```

## Troubleshooting

### Backend returns 404
- Check if the web service is running in Railway dashboard
- Verify the PORT is set to 4000
- Check deployment logs for errors

### Database connection errors
- Verify MySQL service is running
- Check environment variables match Railway's provided values
- Ensure database tables are created (the app auto-creates them on first run)

### CORS errors
- The backend already allows GitHub Pages origins
- Check the CORS configuration in `backend/server.js`

## Current Status

- Railway URL: https://new-lm-pages-production.up.railway.env
- Status: Needs deployment or URL update
- Database: Check Railway dashboard for MySQL service status
