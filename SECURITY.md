# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | Yes                |

## Reporting a Vulnerability

If you discover a security vulnerability in Bulwark AI, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, email: **info@afkzonagroup.lt**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide a timeline for a fix within 5 business days.

## Security Practices

- All database queries use parameterized statements (no SQL injection)
- PII values are never stored in match objects, error responses, or audit logs
- HMAC signature comparison uses constant-time `timingSafeEqual`
- Provider base URLs are validated against SSRF (IPv4/IPv6 private ranges, cloud metadata)
- Custom regex patterns are capped and validated against ReDoS
- Auth context always takes precedence over request body fields
- Audit export is paginated and capped

## Disclosure Policy

We follow coordinated disclosure. We will:
1. Confirm the vulnerability
2. Develop and test a fix
3. Release the fix
4. Credit the reporter (unless they prefer anonymity)
