# LM Project - Process Workflow & Checklist

## 1. Checking Code & Process Management
- [ ] Check active Node processes: `Get-Process node -ErrorAction SilentlyContinue`
- [ ] Check what is running on Port 3000: `netstat -ano | findstr :3000`

## 2. Calling the Backend & Starting the Server
- [ ] Navigate to the backend directory: `cd backend`
- [ ] Install dependencies if needed: `npm install`
- [ ] Start the backend server: `npm start`
  *Note: If Windows blocks PowerShell script execution (`npm.ps1 cannot be loaded`), use one of these workarounds:*
  *   Use the command-line wrapper: `npm.cmd start`
  *   Bypass execution policy temporarily for this window: `Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process`
  *   Run Node directly (if inside `backend` folder): `node server.js`
  *   Run Node directly (from root directory): `node backend/server.js`
*(The server has been updated to automatically list all available localhost and IP addresses in the terminal upon startup.)*

## 3. Application Flow & Testing
- [ ] Open the printed Localhost URLs in your web browser.
- [ ] Test the **Admin Panel** (`home.html`).
- [ ] Test the **Member Portal** (`member.html`) and login  API requests, database syncs, and errors.

## 4. Killing All Processes
- [ ] If running the server directly in the terminal, press `Ctrl + C` to terminate.
- [ ] To forcefully kill any lingering Node.js process: `Stop-Process -Name node -Force -ErrorAction SilentlyContinue`
- [ ] To kill a specific process ID found holding port 3000: `Stop-Process -Id <PID> -Force`
flows.
- [ ] Monitor the terminal for live console logs indicating