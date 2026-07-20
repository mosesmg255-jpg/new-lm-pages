# Loan Management System (LM Project)

A full-stack loan management application for Kenyan Chama (table-banking cooperatives), built with Node.js/Express, MySQL/MariaDB, and vanilla HTML/CSS/JS.

## Features

- **Admin Dashboard** - Member management, loan tracking, repayment ledger, financial oversight
- **Member Portal** - Self-service loan requests, contribution tracking, savings view
- **Treasurer Console** - Subsidiary management, resolution voting, balance tracking
- **Corporate Portal** - Task routing, room booking, document vault, communications
- **Financial Safeguard** - Budgets, compliance, funding, forecasts, bank ledgers, assets
- **Meeting Minutes** - Create, manage, and export meeting records
- **Security** - WAF, helmet headers, rate limiting, bcrypt hashing, input validation

## Prerequisites

- [Node.js](https://nodejs.org/) v16+
- [MySQL](https://dev.mysql.com/downloads/mysql/) or [MariaDB](https://mariadb.org/) running on port 3306
- npm or yarn

## Quick Start

1. **Clone and install dependencies:**
   ```bash
   cd LM-PROJECT-LOCAL-VERSION
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example backend/.env
   # Edit backend/.env with your database credentials
   ```

3. **Import the database schema:**
   ```bash
   npm run import-schema
   ```

4. **Start the server:**
   ```bash
   npm start
   # or for development with auto-reload:
   npm run dev
   ```

5. **Open in browser:**
   - Admin Panel: http://localhost:4000/home.html
   - Member Portal: http://localhost:4000/member.html
   - Admin Login: http://localhost:4000/login.html
   - Landing Page: http://localhost:4000/landingpage.html
   - Health Check: http://localhost:4000/api/health

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start production server |
| `npm run dev` | Start with nodemon auto-reload |
| `npm test` | Run test suite |
| `npm run import-schema` | Import database schema |

## Project Structure

```
LM-PROJECT-LOCAL-VERSION/
├── backend/
│   ├── config/         # Database configuration
│   ├── models/         # Sequelize models (Member, Loan, Repayment, etc.)
│   ├── routes/         # Express API route handlers
│   ├── migrations/     # SQL migration files
│   ├── uploads/        # File upload storage
│   ├── server.js       # Express entry point
│   ├── migrate.js      # Migration runner
│   ├── adminContext.js  # Token auth (HMAC-SHA256)
│   ├── logger.js       # Activity logger
│   ├── securityScanner.js  # WAF middleware
│   ├── validation.js   # Input validation rules
│   └── uploadValidation.js # File upload validation
├── style/              # CSS stylesheets
├── utils/              # Client-side utilities
├── tools/              # Dev tools
├── __tests__/          # Test suite
├── home.html           # Admin dashboard
├── member.html         # Member portal
├── login.html          # Admin login
├── home.js             # Admin panel JS
├── member.js           # Member portal JS
├── loanmanagement.sql  # Database schema
└── package.json
```

## API Endpoints

| Module | Base Path | Description |
|--------|-----------|-------------|
| Auth | `/api/auth` | Admin registration, login, password reset |
| Members | `/api/members` | Member CRUD, approval workflow |
| Loans | `/api/loans` | Loan CRUD, statistics |
| Repayments | `/api/repayments` | Repayment processing |
| Contributions | `/api/contributions` | Contribution/dues management |
| Expenses | `/api/expenses` | Expense claim management |
| System Logs | `/api/logs` | Audit/activity logs |
| Verifications | `/api/verifications` | Transaction verification workflow |
| Treasurer | `/api/treasurer` | Subsidiaries, votes, balances |
| Automation | `/api/automation` | Admin automation, meetings |
| Corporate | `/api/corporate` | Tasks, rooms, documents, comms |
| Safeguard | `/api/safeguard` | Financial oversight (budgets, compliance, etc.) |
| Settings | `/api/settings` | App settings (blur gate) |
| Minutes | `/api/minutes` | Meeting minutes registry |
| Health | `/api/health` | Server health check |
| AI Assistant | `/api/ai/assistant` | AI chat proxy (OpenAI or mock) |

## Security Features

- **Helmet.js** - HTTP security headers
- **WAF Middleware** - SQL injection and XSS detection
- **Rate Limiting** - Global + stricter limits on auth endpoints
- **bcrypt** - Password and PIN hashing
- **HMAC-SHA256** - Token-based admin authentication
- **Input Validation** - express-validator on all write endpoints
- **File Upload Validation** - MIME type and size checks
- **CORS Restriction** - Origin whitelist
- **Graceful Shutdown** - SIGTERM/SIGINT handling

## Environment Variables

See `.env.example` for all available configuration options.

## License

ISC
