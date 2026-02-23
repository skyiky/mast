# Security Model

This document describes the security architecture for Mast — a mobile interface for
directing AI coding agents against real GitHub repos. Mast routes commands from a phone
through an orchestrator to a daemon on the developer's machine, which controls an AI
agent with access to the local filesystem and shell.

The stakes are high: a compromised connection means arbitrary code execution on the
developer's workstation.

Mast supports two deployment modes:

1. **Hosted (Mast Cloud)** — Mast runs the orchestrator on Azure. You trust Mast with
   relay metadata (conversation text, tool invocations) but never source code.
2. **Self-Hosted (Your VPS)** — You run the orchestrator on your own server. No third
   party sees any traffic. You manage TLS, updates, and infrastructure.

Both modes share the same authentication, authorization, and approval gate systems.
The sections below cover shared fundamentals first, then mode-specific details.

---

## How Mast Works

```
Phone (Expo)             Orchestrator               Dev Machine
┌──────────┐   TLS 1.3   ┌──────────────┐   TLS 1.3   ┌────────────┐
│  Mobile   ├────────────>│ Orchestrator ├<────────────┤  Daemon    │
│  Client   │  outbound   │              │   outbound   │            │
└──────────┘   only       └──────────────┘   only       │     │      │
                                                        │  OpenCode  │
                                                        │ (localhost) │
                                                        └────────────┘
```

The orchestrator is a message relay. It runs in the cloud (hosted) or on your VPS
(self-hosted). In both cases, these constraints hold:

1. **No inbound ports on phone or dev machine.** All connections are outbound to the
   orchestrator over port 443. This makes Mast compatible with corporate firewalls,
   NATs, and VPNs without any special configuration.

2. **Orchestrator is the only public surface.** It is the sole internet-facing component.
   It cannot execute code, read files, or access credentials on any machine.

3. **Credentials stay local.** The daemon uses whatever credentials already exist on the
   dev machine (SSH keys, cloud CLI tokens, env vars). No credentials are ever transmitted
   to the orchestrator or phone.

4. **Daemon to OpenCode is localhost only.** The daemon communicates with the AI agent
   process on `127.0.0.1`. No network exposure.

---

## Authentication

Authentication works identically in both deployment modes. The orchestrator verifies
identity on every connection and request.

### User to Orchestrator (Phone)

**Method:** JWT (JSON Web Token) issued after GitHub OAuth sign-in.

**Flow:**
1. User opens mobile app, redirected to GitHub OAuth
2. GitHub redirects back with authorization code
3. Orchestrator exchanges code for GitHub access token, verifies identity
4. Orchestrator issues a signed JWT with: user ID, expiry, issued-at
5. JWT stored on phone in platform secure storage (iOS Keychain / Android Keystore)
6. All subsequent requests include `Authorization: Bearer <JWT>`
7. WSS upgrade includes JWT as query parameter (validated before upgrade completes)

**Token lifecycle:**
- Short-lived access token (1 hour) + long-lived refresh token (30 days)
- Refresh token rotation: each use issues a new refresh token, invalidating the old one
- Refresh token stored in secure storage alongside the access token
- On token expiry: silent refresh in background, no user interruption
- On refresh token expiry: user must re-authenticate via GitHub OAuth

**Why GitHub OAuth:**
- Provides verified identity without building custom auth
- GitHub identity is useful for future features (repo access, PR creation)
- Enterprise SSO compatibility via GitHub Enterprise

### Daemon to Orchestrator (Dev Machine)

**Method:** Device key issued during one-time pairing.

**Flow:**
1. Daemon starts for the first time — no device key on disk
2. Daemon connects to orchestrator WSS with a temporary pairing token
3. Daemon generates a 6-digit pairing code, displays it in terminal
4. User enters the code in the mobile app (already authenticated via JWT)
5. Orchestrator verifies the code, links the daemon to the user's account
6. Orchestrator issues a unique device key (`dk_<uuid>`) to the daemon
7. Daemon stores the key locally at `~/.mast/device-key.json` (file permissions: 600)
8. All future connections use `wss://<orchestrator>/daemon?token=dk_<uuid>`

**Pairing security:**
- Codes expire after 5 minutes
- Codes are single-use (consumed on verification)
- New pairing codes invalidate any previous pending code
- The pairing code is 6 digits (1M combinations) — brute force within the 5-minute
  window requires ~200K attempts/second, which is trivially rate-limited

**Device key lifecycle:**
- Keys do not expire automatically (the daemon is a trusted device)
- User can revoke a device key from the phone (Settings > Devices > Revoke)
- Revocation is immediate: orchestrator rejects the key on next connection attempt
- Re-pairing generates a new key (old key is permanently invalidated)
- Device keys are per-machine, per-user — one key per daemon instance

### Daemon to OpenCode (Local)

**Method:** None. Localhost communication, no authentication.

OpenCode runs on `http://localhost:4096`. The daemon is the only process that communicates
with it. This is the same trust model as any local dev tool (IDE extensions, language
servers, etc.). If an attacker has localhost access to the dev machine, auth between
daemon and OpenCode would not meaningfully improve security.

---

## Authorization

Authorization works identically in both deployment modes. The orchestrator enforces
access control; the daemon enforces operation-level approval.

### Orchestrator Authorization

| Check | Enforcement |
|-------|-------------|
| Valid JWT on every HTTP request | Middleware rejects with 401 |
| Valid JWT on WSS upgrade | Connection refused before upgrade |
| Valid device key on daemon WSS | Connection refused before upgrade |
| User can only access their own sessions | Session ownership verified against JWT user ID |
| Daemon linked to the requesting user | Device key maps to user ID in database |

The orchestrator does **not** authorize individual agent operations (file writes, shell
commands). That is the daemon's responsibility — the orchestrator is a relay.

### Daemon Authorization (Approval Gates)

The daemon enforces operation-level approval policies. When OpenCode requests permission
for an operation, the daemon classifies it and either auto-approves, requires phone
approval, or blocks it entirely.

**Default policy:**

| Operation | Policy |
|-----------|--------|
| File read (within repo) | Auto-approve |
| File write (within repo) | Auto-approve |
| Git operations (branch, commit, push) | Auto-approve |
| Unit test execution | Auto-approve |
| Agent retries (up to 3) | Auto-approve |
| Start local backend / server | Requires phone approval |
| E2E / integration tests | Requires phone approval |
| Anything touching credentials or secrets | Requires phone approval |
| Create pull request | Requires phone approval |
| Any command outside repo directory | Blocked (never allowed) |

Policies are user-configurable from the mobile app (Settings > Approval Policies).

### Scoped Execution

The daemon restricts the AI agent to operate within a defined boundary:

- **Working directory:** Agent can only read/write within the repo directory it was
  started in. Path traversal outside this directory is blocked.
- **No arbitrary shell:** The daemon only forwards operations that OpenCode's tool
  system requests. There is no raw shell passthrough from the phone.
- **Process isolation:** OpenCode runs as a child process of the daemon. If the daemon
  stops, OpenCode stops.

---

## Data at Rest

| Data | Location | Protection |
|------|----------|------------|
| JWT (access + refresh) | Phone | iOS Keychain / Android Keystore (hardware-backed encryption) |
| Device key | Dev machine (`~/.mast/device-key.json`) | File permissions 600 (owner read/write only) |
| Session cache (messages, parts) | Supabase (Postgres) | Encrypted at rest (Supabase default), row-level security per user |
| Push notification tokens | Supabase | Encrypted at rest, scoped to user |
| Source code | Dev machine only | Never transmitted to orchestrator or stored in cloud |

**Critical:** Source code and file contents are never stored in the orchestrator or
Supabase. The orchestrator caches conversation messages (user prompts, agent text
responses, tool invocation metadata) but not the actual file contents that tools
operate on. Diff content is fetched on-demand from the daemon and streamed through
to the phone — it is not persisted in the cloud.

This applies to both deployment modes. In self-hosted mode, the Supabase instance
may also be self-hosted (see Self-Hosted Deployment below).

---

## Audit Trail

Every operation that flows through the daemon is logged:

```json
{
  "timestamp": "2026-02-23T10:15:30Z",
  "sessionId": "ses_abc123",
  "operation": "file_write",
  "target": "src/auth/login.ts",
  "authorization": "auto-approved (policy: file_write_in_repo)",
  "userId": "usr_xyz",
  "deviceKey": "dk_abc",
  "outcome": "success"
}
```

Logs are stored locally on the dev machine. Future: forward to a centralized logging
service for multi-machine visibility.

---

## Supabase Row-Level Security

All tables enforce row-level security (RLS) scoped to the authenticated user:

```sql
-- Sessions: users can only access their own sessions
CREATE POLICY "users_own_sessions" ON sessions
  FOR ALL USING (user_id = auth.uid());

-- Messages: users can only access messages in their own sessions
CREATE POLICY "users_own_messages" ON messages
  FOR ALL USING (
    session_id IN (SELECT id FROM sessions WHERE user_id = auth.uid())
  );

-- Push tokens: users can only manage their own tokens
CREATE POLICY "users_own_push_tokens" ON push_tokens
  FOR ALL USING (user_id = auth.uid());
```

---
---

## Hosted Deployment (Mast Cloud)

In hosted mode, Mast operates the orchestrator on Azure Container Apps. The user trusts
Mast with relay metadata (conversation text, tool invocation names and arguments, session
titles) but never source code or file contents.

### Overview

```
Phone (Expo)              Mast Cloud (Azure)          Dev Machine
┌──────────┐   TLS 1.3    ┌──────────────┐   TLS 1.3   ┌────────────┐
│  Mobile   ├─────────────>│ Orchestrator │<────────────┤  Daemon    │
│  Client   │   outbound   │  (managed)   │   outbound   │            │
└──────────┘    only       └──────┬───────┘    only      │  OpenCode  │
                                  │                      └────────────┘
                           ┌──────┴───────┐
                           │  Supabase    │
                           │  (managed)   │
                           └──────────────┘
```

**Responsibilities:**

| Concern | Who handles it |
|---------|---------------|
| TLS certificates | Mast (Azure-managed, auto-rotating) |
| Orchestrator uptime | Mast |
| Supabase hosting | Mast (Supabase Cloud) |
| Rate limiting | Mast |
| Security patches | Mast |
| Daemon + OpenCode | You (your dev machine) |
| Phone app updates | You (App Store / TestFlight) |

### Transport Security

| Connection | Protocol | Encryption |
|-----------|----------|------------|
| Phone to Orchestrator | HTTPS / WSS | TLS 1.3 (Azure-managed certificate) |
| Daemon to Orchestrator | WSS | TLS 1.3 (Azure-managed certificate) |
| Daemon to OpenCode | HTTP | None (localhost only, never leaves the machine) |

All external connections use TLS 1.3 with Azure-managed certificates. No self-signed
certificates, no certificate pinning required (Azure Container Apps handles rotation).

WSS connections use the `wss://` scheme, which upgrades HTTP to WebSocket over TLS.
The token is included in the query string during the upgrade handshake — this is
standard practice for WebSocket auth (the `Authorization` header is not supported
by the browser WebSocket API, and React Native's WebSocket implementation follows
the same constraint).

**Mitigation for token-in-query-string:** Access logs on Azure Container Apps do not
log query parameters by default. Server-side logging is configured to strip tokens
before writing to any log aggregation system.

### Threat Model

| Attack vector | Required access | Impact | Mitigation |
|--------------|----------------|--------|------------|
| Steal JWT from phone | Physical phone access or malware | Full account access until token expires | Secure storage (Keychain), short-lived tokens, refresh rotation |
| Steal device key from dev machine | Filesystem access to `~/.mast/` | Impersonate daemon, receive prompts | File permissions 600, revocable from phone |
| Compromise orchestrator (Mast infra) | Azure account access | Read cached messages, relay malicious prompts | Azure RBAC, no source code in cache, daemon approval gates still apply |
| Man-in-the-middle | Break TLS (impractical) | Intercept traffic | TLS 1.3 with Azure-managed certs |
| Brute force pairing code | Network access to orchestrator | Pair a rogue daemon | Rate limiting (5 attempts/minute), 5-minute expiry, single-use codes |
| Mast operator reads your data | Mast employee with DB access | Read conversation text, tool metadata | Source code is never stored; trust model requires trusting the operator |
| Enumerate orchestrator URL | Public internet | Learn if a daemon is connected | `/health` should require auth or return minimal info |

**Trust boundary:** In hosted mode, you trust the Mast operator not to read or
tamper with relay traffic. The operator can see conversation messages and tool
invocation metadata, but cannot see source code (never transmitted), cannot execute
commands (no code execution capability), and cannot bypass daemon approval gates
(approvals require the real phone with the real JWT).

**Defense in depth:** Even if the hosted orchestrator is fully compromised, the
attacker still faces:

1. **Daemon approval gates** — destructive operations require phone approval
2. **Scoped execution** — the agent cannot operate outside the repo directory
3. **Audit log** — all operations are logged locally on the dev machine
4. **Device key revocation** — user can revoke the key from the phone, immediately
   cutting off access

### Rate Limiting

| Endpoint | Limit | Scope |
|----------|-------|-------|
| `POST /pair/verify` | 5 attempts per minute | Per IP |
| `POST /sessions/:id/prompt` | 30 per minute | Per user |
| WSS connections | 5 concurrent per user | Per user |
| GitHub OAuth | 10 attempts per hour | Per IP |

Rate limits are enforced at the orchestrator level. Exceeded limits return HTTP 429.

---
---

## Self-Hosted Deployment (Your VPS)

In self-hosted mode, you run the orchestrator on your own server. No third party sees
any traffic. You are the operator — you manage infrastructure, TLS, and updates.

### Overview

```
Phone (Expo)              Your VPS                    Dev Machine
┌──────────┐   TLS 1.3    ┌──────────────┐   TLS 1.3   ┌────────────┐
│  Mobile   ├─────────────>│ Orchestrator │<────────────┤  Daemon    │
│  Client   │   outbound   │  (yours)     │   outbound   │            │
└──────────┘    only       └──────┬───────┘    only      │  OpenCode  │
                                  │                      └────────────┘
                           ┌──────┴───────┐
                           │  Supabase    │
                           │ (cloud or    │
                           │  self-hosted)│
                           └──────────────┘
```

**Key difference from hosted:** The phone and the dev machine do NOT need to be on the
same network. The VPS is the rendezvous point — both connect outbound to it. This means
you can use your phone on cellular data while the daemon runs on your home or office
machine, as long as both can reach the VPS.

**Responsibilities:**

| Concern | Who handles it |
|---------|---------------|
| TLS certificates | You (Let's Encrypt via Caddy or certbot) |
| Orchestrator uptime | You |
| Supabase hosting | You (Supabase Cloud or self-hosted) |
| Rate limiting | You (reverse proxy or orchestrator config) |
| Security patches | You (OS, Docker, orchestrator image) |
| Daemon + OpenCode | You (your dev machine) |
| Phone app updates | You (custom build or TestFlight) |
| Domain name + DNS | You |

### Transport Security

| Connection | Protocol | Encryption |
|-----------|----------|------------|
| Phone to Orchestrator | HTTPS / WSS | TLS 1.3 (your certificate, e.g. Let's Encrypt) |
| Daemon to Orchestrator | WSS | TLS 1.3 (your certificate) |
| Daemon to OpenCode | HTTP | None (localhost only, never leaves the machine) |

You must provide valid TLS certificates. The recommended approach is Caddy as a reverse
proxy — it handles Let's Encrypt certificate issuance, renewal, and HTTPS termination
automatically with zero configuration beyond the domain name.

**Why not self-signed certificates?** Mobile clients (iOS/Android) reject self-signed
certificates by default. Bypassing certificate validation would defeat the purpose of
TLS. Use a real domain with Let's Encrypt instead.

**Minimum viable TLS setup (Caddy):**

```
# Caddyfile
mast.yourdomain.com {
    reverse_proxy localhost:3000
}
```

This gives you automatic HTTPS with Let's Encrypt, HTTP/2, and certificate auto-renewal.

The same token-in-query-string considerations apply as in hosted mode. Since you control
the server, ensure your access logs do not capture query parameters containing tokens.

### Threat Model

Self-hosted mode eliminates the "trust the operator" concern but introduces
infrastructure management risks.

| Attack vector | Required access | Impact | Mitigation |
|--------------|----------------|--------|------------|
| Steal JWT from phone | Physical phone access or malware | Full account access until token expires | Same as hosted: secure storage, short-lived tokens |
| Steal device key from dev machine | Filesystem access to `~/.mast/` | Impersonate daemon | Same as hosted: file permissions 600, revocable |
| Compromise your VPS | SSH access, exploited service, cloud account breach | Full control of relay — read messages, inject prompts | SSH key auth (no passwords), firewall, unattended-upgrades, fail2ban |
| Unpatched VPS OS | Public internet + known CVE | Remote code execution on VPS | Automatic security updates, regular patching |
| Exposed ports | Port scan | Access to services that should be internal | Firewall: only 443 inbound (see checklist below) |
| Expired TLS certificate | Let's Encrypt renewal failure | Connections fail or fall back to HTTP | Caddy handles renewal automatically; monitor with uptime checks |
| DNS hijacking | Compromised DNS provider | Redirect traffic to attacker's server | Use a reputable DNS provider, enable DNSSEC if available |
| Forgotten VPS | Months without updates | Accumulating vulnerabilities | Set a calendar reminder; monitor uptime |

**Defense in depth:** The same layers apply as in hosted mode. Even if the VPS is
compromised:

1. **Daemon approval gates** still require the real phone with a valid JWT
2. **Scoped execution** still restricts the agent to the repo directory
3. **Audit log** on the dev machine still records all operations
4. **Device key revocation** from the phone still works (the orchestrator on the VPS
   checks the key on every connection)

The critical insight: compromising the VPS gives an attacker the same power as a
compromised Mast operator in hosted mode — they can read relay traffic and inject
prompts, but they cannot bypass daemon-side controls. The difference is that in
self-hosted mode, only you can compromise yourself (no third-party operator risk).

### Supabase Options

| Option | Pros | Cons |
|--------|------|------|
| **Supabase Cloud** (recommended) | Zero maintenance, automatic backups, managed Postgres | Third party has your session data (encrypted at rest) |
| **Self-hosted Supabase** on same VPS | Full data sovereignty, no third-party dependency | Significant operational overhead (Postgres, GoTrue, PostgREST, etc.) |
| **Self-hosted Supabase** on separate server | Data isolation from orchestrator | Even more infrastructure to manage |

For most self-hosted users, Supabase Cloud is the pragmatic choice. The data stored
there (session titles, conversation messages, tool metadata) does not include source
code. If full data sovereignty is required, self-hosting Supabase is possible but
adds substantial operational burden.

### Operational Checklist

Before running a self-hosted orchestrator in production, verify:

**Firewall:**
```bash
# UFW example — allow only SSH and HTTPS
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH (consider restricting to your IP)
ufw allow 443/tcp   # HTTPS (Caddy → orchestrator)
ufw enable
```

Only port 443 should be publicly accessible. The orchestrator listens on localhost:3000;
Caddy reverse-proxies to it. Do not expose port 3000 directly.

**TLS:**
- Use Caddy (automatic) or nginx + certbot (manual renewal)
- Verify certificate issuance: `curl -v https://mast.yourdomain.com/health`
- Caddy renews certificates ~30 days before expiry, automatically

**Domain:**
- You need a domain (or subdomain) pointing to the VPS IP for valid TLS
- IP-only HTTPS is not possible with Let's Encrypt
- A subdomain on an existing domain works fine (e.g. `mast.yourdomain.com`)

**Docker:**
```bash
# Pull the latest orchestrator image
docker pull mastacr.azurecr.io/mast-orchestrator:latest

# Run with environment variables
docker run -d \
  --name mast-orchestrator \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e SUPABASE_URL=https://your-supabase-url.supabase.co \
  -e SUPABASE_ANON_KEY=your-anon-key \
  mastacr.azurecr.io/mast-orchestrator:latest
```

Note: `-p 127.0.0.1:3000:3000` binds only to localhost. Caddy handles external traffic.

**Updates:**
- There is no auto-update. You must pull new images and restart the container.
- Check for releases periodically. Subscribe to the GitHub repo for notifications.
- After pulling a new image: `docker stop mast-orchestrator && docker rm mast-orchestrator`
  then re-run the `docker run` command.

**Monitoring:**
- Set up an uptime check against `https://mast.yourdomain.com/health`
- The health endpoint returns orchestrator status and daemon connection state
- Consider UptimeRobot (free tier) or similar for external monitoring

**SSH hardening:**
- Disable password authentication (`PasswordAuthentication no` in sshd_config)
- Use SSH key auth only
- Consider fail2ban for brute force protection

### Rate Limiting

You are responsible for rate limiting. The orchestrator does not enforce rate limits
by default in self-hosted mode. Options:

**Option 1: Caddy rate limiting (recommended)**

```
# Caddyfile with rate limiting
mast.yourdomain.com {
    rate_limit {
        zone static_zone {
            key    {remote_host}
            events 100
            window 1m
        }
    }
    reverse_proxy localhost:3000
}
```

Requires the `caddy-ratelimit` plugin.

**Option 2: iptables / nftables**

```bash
# Limit new connections to 30/minute per source IP
iptables -A INPUT -p tcp --dport 443 -m state --state NEW \
  -m recent --set --name MAST
iptables -A INPUT -p tcp --dport 443 -m state --state NEW \
  -m recent --update --seconds 60 --hitcount 30 --name MAST \
  -j DROP
```

**Minimum recommended limits (match hosted mode):**

| Endpoint | Limit |
|----------|-------|
| `POST /pair/verify` | 5 per minute per IP |
| `POST /sessions/:id/prompt` | 30 per minute per user |
| WSS connections | 5 concurrent per user |

---
---

## Known Gaps (Phase 1 to Production)

The current Phase 1 implementation uses hardcoded tokens for development convenience.
The following must be addressed before any release:

| Gap | Phase 1 (current) | Production | Affects |
|-----|-------------------|------------|---------|
| Phone auth | Hardcoded string `mast-api-token-phase1` | GitHub OAuth with JWT | Both |
| Daemon auth | Hardcoded fallback `mast-dev-key-phase1` | Device key only (no fallback) | Both |
| Token storage | AsyncStorage (plaintext) for some values | All secrets in SecureStore | Both |
| Rate limiting | None | Per-IP and per-user limits | Hosted: managed. Self-hosted: user-configured |
| `/health` endpoint | No auth, exposes connection state | Auth required or minimal public response | Both |
| Supabase RLS | Disabled (single-user MVP) | Enabled, per-user policies | Both |
| Audit logging | Console output only | Structured logs, persisted | Both |
| Device key revocation | Not implemented | Revoke from phone Settings | Both |
| Token refresh | No expiry | Short-lived access + rotating refresh | Both |
| Approval policies | Agent auto-approves everything | User-configurable policies enforced by daemon | Both |
| Self-hosted install docs | None | Docker image + Caddyfile + setup guide | Self-hosted only |
| Auto-update mechanism | None | At minimum: version check + notification | Self-hosted only |
