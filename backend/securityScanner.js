/**
 * securityScanner.js
 * 
 * Global Web Application Firewall (WAF) Middleware.
 * Intercepts incoming requests and scans payloads for SQL Injection and XSS attempts.
 * 
 * Improved: Only matches actual attack patterns, not normal business data.
 */

// SQL Injection: match UNION-based attacks, stacked queries, and classic OR/AND injection
// Excludes normal business words like "SELECT status" in body fields
const SQL_INJECTION_PATTERN = /(\b(UNION\s+(ALL\s+)?SELECT|INSERT\s+INTO|DROP\s+TABLE|ALTER\s+TABLE|EXEC\s*\(|EXECUTE\s+PROCEDURE|INTO\s+OUTFILE|INTO\s+DUMPFILE|LOAD_FILE\s*\(|BENCHMARK\s*\(|SLEEP\s*\(\s*\d)|(\bSELECT\b.*\bFROM\b.*\bWHERE\b.*\bOR\b\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?\b)|([\s;]\s*;\s*DROP\b)|(--\s*$))|(\bWAITFOR\b\s+DELAY\b)|(\bCONVERT\b\s*\(\s*.*\bUSING\b)/i;

// XSS: actual script injection, event handler injection, javascript: URIs
const XSS_PATTERN = /(<script[\s>]|<\/script>|<iframe[\s>]|<object[\s>]|<embed[\s>]|<applet[\s>])|(\bon[a-z]+\s*=)|((?:java|vb)script\s*:)/i;

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
  try {
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
  } catch (err) {
    // If scanning itself fails, log but allow the request through
    console.error('[SECURITY] Scanner error:', err.message);
  }

  next();
}

module.exports = securityScanner;
