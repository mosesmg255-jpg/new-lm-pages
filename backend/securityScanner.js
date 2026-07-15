/**
 * securityScanner.js
 * 
 * Global Web Application Firewall (WAF) Middleware.
 * Intercepts incoming requests and scans payloads for SQL Injection and XSS attempts.
 */

const SQL_INJECTION_PATTERN = /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|UNION|EXEC|TRUNCATE)\b)|(['"]\s*(OR|AND)\s*['"]?\d+['"]?\s*=\s*['"]?\d+)/i;
const XSS_PATTERN = /(<script\b[^>]*>[\s\S]*?<\/script>|<[^>]+(on[a-z]+)\s*=|javascript:|vbscript:)/i;

/**
 * Recursively scans an object for malicious strings.
 * Returns true if malicious content is found.
 */
function containsMaliciousPayload(data) {
  if (typeof data === 'string') {
    return SQL_INJECTION_PATTERN.test(data) || XSS_PATTERN.test(data);
  }
  if (Array.isArray(data)) {
    return data.some(item => containsMaliciousPayload(item));
  }
  if (data !== null && typeof data === 'object') {
    return Object.values(data).some(val => containsMaliciousPayload(val));
  }
  return false;
}

function securityScanner(req, res, next) {
  const isMalicious = 
    containsMaliciousPayload(req.body) ||
    containsMaliciousPayload(req.query) ||
    containsMaliciousPayload(req.params);

  if (isMalicious) {
    console.warn(`[SECURITY ALERT] Malicious payload detected from IP: ${req.ip} | Route: ${req.method} ${req.originalUrl}`);
    return res.status(403).json({
      status: 'fail',
      message: 'Security Alert: Malicious or harmful input detected. Request blocked by System Firewall.'
    });
  }

  next();
}

module.exports = securityScanner;
