# Email Reply Service - Test Server

Enterprise-grade email communication system with REST API wrapper for testing and integration.

## ðŸš€ Quick Start

### Prerequisites

- Node.js >= 16.0.0
- npm >= 8.0.0
- MySQL Database
- SMTP Email Service (Gmail, SendGrid, etc.)

### Installation

1. **Clone or copy the files to your project directory:**
   ```bash
   # You should have these files:
   - emailReplyService.js
   - server.js
   - package.json
   - .env.example
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   # Copy the example .env file
   cp .env.example .env
   
   # Edit .env with your actual configuration
   # Required fields:
   # - EMAIL_USER, EMAIL_PASS (SMTP credentials)
   # - DB_NAME, DB_USER, DB_PASS, DB_HOST (Database credentials)
   # - ENCRYPTION_KEY (32-character hex key)
   # - OTP_ENCRYPTION_KEY (32-character hex key)
   ```

4. **Generate encryption keys:**
   ```bash
   # Generate random 32-character hex keys
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   # Use the output for ENCRYPTION_KEY and OTP_ENCRYPTION_KEY
   ```

5. **Set up your database:**
   ```sql
   -- Create database
   CREATE DATABASE loan_management;
   
   -- Tables will be auto-created by Sequelize on first run
   ```

6. **Start the server:**
   ```bash
   npm start
   ```

7. **Access the API:**
   - Server runs on: `http://localhost:3000`
   - Health check: `http://localhost:3000/health`
   - API endpoints: `http://localhost:3000/api/`

## ðŸ“š API Endpoints

### Health & Status

- `GET /health` - Server health check
- `GET /api/email/status` - Complete service status
- `POST /api/email/start` - Start email service
- `POST /api/email/stop` - Stop email service

### Email Verification

- `POST /api/email/verify` - Send verification email
  ```json
  {
    "email": "user@example.com",
    "memberName": "John Doe"
  }
  ```
- `GET /api/email/verify/:token` - Verify email token

### OTP Password Reset

- `POST /api/otp/request` - Request password reset OTP
  ```json
  {
    "email": "user@example.com",
    "ipAddress": "192.168.1.1"
  }
  ```
- `POST /api/otp/verify` - Verify OTP and reset password
  ```json
  {
    "email": "user@example.com",
    "otp": "123456",
    "newPassword": "NewSecureP@ssw0rd!",
    "ipAddress": "192.168.1.1"
  }
  ```

### Contribution Reminders

- `POST /api/contribution/remind` - Send contribution reminder
  ```json
  {
    "memberId": 1
  }
  ```

### Dashboard Integration

- `POST /api/dashboard/loan/request` - Request loan approval
  ```json
  {
    "memberId": 1,
    "amount": 5000,
    "purpose": "Business expansion"
  }
  ```
- `POST /api/dashboard/loan/approve` - Approve/reject loan
  ```json
  {
    "loanId": 1,
    "adminId": 1,
    "approved": true,
    "rejectionReason": "Insufficient funds"
  }
  ```
- `POST /api/dashboard/member/approve` - Approve/reject member
  ```json
  {
    "memberId": 1,
    "adminId": 1,
    "approved": true,
    "denialReason": "Incomplete application"
  }
  ```

### SMS Fallback

- `POST /api/sms/send` - Send SMS message
  ```json
  {
    "phoneNumber": "+1234567890",
    "message": "Your message here",
    "priority": "urgent"
  }
  ```

### Analytics

- `GET /api/analytics` - Get analytics report
- `GET /api/analytics/metrics` - Get all metrics

### Cache (Redis)

- `POST /api/cache/set` - Set cache value
  ```json
  {
    "key": "user:1",
    "value": { "name": "John" },
    "ttl": 3600
  }
  ```
- `GET /api/cache/get/:key` - Get cache value

### Webhooks

- `POST /api/webhook/register` - Register webhook
  ```json
  {
    "event": "email.sent",
    "url": "https://your-webhook-url.com",
    "secret": "your-secret"
  }
  ```
- `POST /api/webhook/trigger` - Trigger webhook
  ```json
  {
    "event": "email.sent",
    "payload": { "email": "user@example.com" }
  }
  ```

### Multi-Language

- `GET /api/language/available` - Get available languages
- `GET /api/language/translate/:lang/:key` - Get translation

### PDF Generation

- `POST /api/pdf/loan-statement` - Generate loan statement PDF
  ```json
  {
    "loanId": 1,
    "memberId": 1
  }
  ```

### Email Tracking

- `POST /api/track/open/:trackingId` - Track email open (tracking pixel)

## ðŸ§ª Testing

### Using test-api.http

Open `test-api.http` in your IDE (VS Code, IntelliJ, etc.) and click "Send Request" on each endpoint.

### Using cURL

```bash
# Health check
curl http://localhost:3000/health

# Get service status
curl http://localhost:3000/api/email/status

# Send verification email
curl -X POST http://localhost:3000/api/email/verify \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","memberName":"Test User"}'

# Request OTP
curl -X POST http://localhost:3000/api/otp/request \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","ipAddress":"127.0.0.1"}'
```

### Using Postman

Import the endpoints into Postman and test each one with your configuration.

## ðŸ”§ Configuration

### Required Environment Variables

```env
# Email Service
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password

# Database
DB_NAME=loan_management
DB_USER=root
DB_PASS=your-password
DB_HOST=localhost

# Security
ENCRYPTION_KEY=32-character-hex-key
OTP_ENCRYPTION_KEY=32-character-hex-key
```

### Optional Environment Variables

See `.env.example` for all available configuration options.

## ðŸ“Š Monitoring

### Health Check Endpoint

```bash
curl http://localhost:3000/health
```

Returns:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 3600,
  "version": "1.0.0"
}
```

### Service Status Endpoint

```bash
curl http://localhost:3000/api/email/status
```

Returns comprehensive status including:
- Service running state
- Database connection status
- OTP service status
- Email tracking statistics
- Analytics data

## ðŸ”’ Security Features

- **Helmet.js** - HTTP security headers
- **CORS** - Cross-origin resource sharing
- **Rate Limiting** - 100 requests per 15 minutes per IP
- **Input Validation** - Express-validator for all inputs
- **Encryption** - AES-256 for sensitive data
- **OTP Security** - Rate limiting, attempt limits, expiration

## ðŸ“ Development

### Running in Development Mode

```bash
npm run dev
```

Uses nodemon for auto-restart on file changes.

### Running Tests

```bash
npm test
```

### Linting

```bash
npm run lint
```

## ðŸ› Troubleshooting

### Database Connection Failed

1. Check MySQL is running
2. Verify database credentials in `.env`
3. Ensure database exists
4. Check firewall settings

### Email Sending Failed

1. Verify SMTP credentials
2. Check if email provider requires app-specific password
3. Test SMTP connection with telnet
4. Check firewall for SMTP port access

### Redis Connection Failed

1. Ensure Redis is running
2. Check Redis credentials in `.env`
3. Verify Redis is accessible from your network

### SMS Not Sending

1. Verify Twilio credentials
2. Check phone number format (include country code)
3. Ensure Twilio account has credits
4. Check Twilio dashboard for errors

## ðŸ“ž Support

For issues or questions:
1. Check the logs in the console
2. Review the troubleshooting section
3. Ensure all environment variables are set correctly
4. Verify database tables are created

## ðŸ“„ License

MIT License - See LICENSE file for details

## ðŸŽ‰ Features Summary

âœ… Email verification system  
âœ… OTP password reset  
âœ… Contribution reminders  
âœ… Dashboard integration  
âœ… SMS fallback  
âœ… Multi-language support  
âœ… PDF generation  
âœ… Redis caching  
âœ… Webhook system  
âœ… Analytics & monitoring  
âœ… Rate limiting  
âœ… Input validation  
âœ… Security headers  
âœ… CORS support  
âœ… Health checks  
âœ… REST API wrapper  

---

**Ready for production use!** ðŸš€
