# Security Policy

## Overview

TrendFlow takes security seriously. This document describes the security architecture, supported versions, and how to report vulnerabilities.

---

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.2.x   | ✅ Active  |
| < 0.2   | ❌ EOL     |

---

## Authentication & Authorization

### OAuth 2.0 / SSO

TrendFlow uses OAuth 2.0 Authorization Code flow with PKCE for user authentication. Supported identity providers:

| Provider | Setup |
|----------|-------|
| GitHub   | Set `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` |
| Google   | Set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` |

The OAuth flow:
1. User clicks "Login" → redirected to `/api/auth/github` or `/api/auth/google`
2. Provider authenticates user, redirects to `/api/auth/:provider/callback`
3. Server exchanges code for access token, fetches user profile
4. Server issues a signed JWT (`JWT_SECRET`) and redirects frontend with the token
5. Frontend stores the token and sends it as `Authorization: Bearer <token>` on each request

**JWT configuration:**
- Secret: `JWT_SECRET` (minimum 32 characters, random)
- Expiry: `JWT_EXPIRES_IN` (default: `7d`)
- Payload: `{ sub, email, name, role }`

### Role-Based Access Control (RBAC)

Three roles with hierarchical permissions:

| Role     | Agent execution | Cost dashboard | Audit logs | User management |
|----------|----------------|----------------|------------|-----------------|
| `viewer` | ❌             | ❌             | ❌         | ❌              |
| `editor` | ✅             | ❌             | ❌         | ❌              |
| `admin`  | ✅             | ✅             | ✅         | ✅              |

The first user to authenticate via OAuth is automatically assigned the `admin` role.

### Disabling Auth (Development Only)

Set `AUTH_ENABLED=false` in `.env` to bypass all auth checks during local development. **Never use this in production.**

---

## API Security

### Rate Limiting

| Endpoint group     | Limit                |
|--------------------|----------------------|
| All API routes     | 100 req / 15 min / IP |
| Auth endpoints     | 10 req / 15 min / IP  |
| Agent execution    | 20 runs / hour / user |

### Security Headers

[Helmet.js](https://helmetjs.github.io/) is applied to all responses:
- `Strict-Transport-Security` (HTTPS enforcement)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Content-Security-Policy`
- `X-XSS-Protection`
- `Referrer-Policy`

### CORS

In production, configure `CORS_ORIGIN` to your specific frontend domain. The server defaults to allowing all origins in development.

### Input Validation

All request bodies are validated with Zod schemas before processing. Unknown fields are stripped.

---

## Data Security

### API Keys

API keys (Groq, OpenAI, Anthropic, etc.) are:
- Stored only in `.env` (never committed to git — `.env` is in `.gitignore`)
- Never logged or returned in API responses (redacted by pino logger)
- Never sent to the frontend

### Database (Convex)

Convex handles encryption at rest and in transit for all stored data. Access requires a valid `CONVEX_URL` and is mediated through the Express server.

### Audit Logging

All authenticated API actions are recorded in the `audit_logs` Convex table:
- Who (userId, email)
- What (action, resource, resourceId)
- When (timestamp)
- Result (success/failure)
- Request metadata (IP, user agent)

Audit logs are retained indefinitely. Access requires `admin` role.

---

## Docker & Kubernetes Security

### Container

- Runs as a non-root user (`uid=1001`)
- Read-only root filesystem
- No `NET_RAW` or other Linux capabilities
- Health check via `GET /api/health`

### Kubernetes

- Secrets stored in Kubernetes `Secret` objects (not ConfigMaps)
- `readOnlyRootFilesystem: true`
- `allowPrivilegeEscalation: false`
- Drop all capabilities
- TLS via cert-manager + Let's Encrypt

**Create the secrets before deploying:**

```bash
kubectl create secret generic trendflow-secrets \
  --from-literal=JWT_SECRET=$(openssl rand -base64 48) \
  --from-literal=CONVEX_URL=https://your-deployment.convex.cloud \
  --from-literal=GROQ_API_KEY=your_groq_key \
  --from-literal=GITHUB_CLIENT_ID=your_github_client_id \
  --from-literal=GITHUB_CLIENT_SECRET=your_github_client_secret
```

---

## Dependency Security

Dependencies are scanned automatically in CI. To run locally:

```bash
npm audit
```

To check for outdated packages:

```bash
npm outdated
```

We follow [Dependabot](https://docs.github.com/en/code-security/dependabot) for automated dependency updates.

---

## Vulnerability Disclosure

### Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report security issues by emailing: **security@trendflow.dev** (or the repository maintainer's email).

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Suggested fix (if you have one)

### Response Timeline

| Stage                    | Target SLA |
|--------------------------|------------|
| Acknowledgement          | 48 hours   |
| Initial assessment       | 5 days     |
| Fix + coordinated disclosure | 30 days |

### Scope

In scope:
- Authentication bypass
- Authorization escalation (RBAC bypass)
- SQL/NoSQL injection equivalents
- Sensitive data exposure (API keys, PII)
- Remote code execution
- XSS on the frontend

Out of scope:
- Denial of service via excessive API calls (rate limiting is already in place)
- Issues in third-party services (Convex, Groq, GitHub, Google)
- Non-security bugs

---

## Security Hardening Checklist

Before deploying to production:

- [ ] Set a strong `JWT_SECRET` (32+ random chars: `openssl rand -base64 48`)
- [ ] Set `AUTH_ENABLED=true`
- [ ] Configure `CORS_ORIGIN` to your frontend domain only
- [ ] Enable HTTPS (TLS termination at ingress or load balancer)
- [ ] Use Kubernetes Secrets (not ConfigMaps) for all sensitive values
- [ ] Enable Convex access rules in `convex/schema.ts`
- [ ] Run `npm audit` and resolve critical/high findings
- [ ] Enable branch protection on `main` in GitHub
- [ ] Configure rate limiting to appropriate values for your traffic
- [ ] Review and restrict OAuth app scopes to minimum required
