# Troubleshooting & Diagnostics (`TROUBLESHOOTING.md`)

## 1. Quick Health Diagnostics

Run the built-in health check first:

```bash
supportdesk status
supportdesk health
supportdesk logs all
```

`supportdesk health` verifies:
1. Strict `.env` schema validation (`scripts/env-check.ts`) without printing secrets.
2. PostgreSQL readiness (`pg_isready`).
3. Next.js readiness endpoint (`GET /api/health/ready`), including DB latency, `pgvector` extension detection, storage accessibility, and RAG `workerQueue` counts.
4. RAG background worker heartbeat (`/tmp/supportdesk-worker-heartbeat` updated within the last 45 seconds).
5. External HTTPS reachability (`https://$DOMAIN_NAME/api/health`) when `DOMAIN_NAME != localhost`.

---

## 2. Common Failure Scenarios & Recovery

### A. Ports `80` or `443` Already in Use
**Symptom**: `proxy` container fails to bind port `80` or `443`.
**Fix**:
```bash
sudo ss -ltnp | grep -E ':80|:443'
# Stop conflicting nginx/apache2 if unused:
sudo systemctl disable --now nginx apache2
supportdesk repair
```

### B. Let's Encrypt HTTPS Certificate Not Issuing
**Symptom**: Browser reports TLS error on `https://your-domain`.
**Checklist**:
1. Confirm public DNS `A`/`AAAA` record for `DOMAIN_NAME` resolves to this server's public IP.
2. Confirm firewall (`ufw`, `iptables`, cloud security group) allows inbound TCP `80`, TCP `443`, and UDP `443`.
3. Inspect proxy logs: `supportdesk logs proxy`.
4. Confirm `APP_URL` and `DOMAIN_NAME` match (`supportdesk config`).

### C. Application Fails Readiness After Editing `.env`
**Symptom**: `app` exits immediately with `[env-check] Configuration validation FAILED`.
**Fix**: Run validation explicitly to see the exact missing or placeholder variable (values are never printed):
```bash
supportdesk repair
# Or run env-check inside one-off container:
cd /opt/supportdesk && docker compose --env-file .env run --rm --no-deps -T -e VALIDATE_ENV_ON_START=false --entrypoint "" app node ./node_modules/tsx/dist/cli.mjs ./scripts/env-check.ts
```

### D. Locked Out or Lost Super Admin Password
Reset the administrator password safely from the host terminal (revokes all compromised/old sessions):
```bash
supportdesk admin list
supportdesk admin reset-password --username superadmin --force-change
```
If the only Super Admin was accidentally disabled:
```bash
supportdesk admin enable --username superadmin
```

### E. RAG Documents Stuck in `queued` or `running`
**Symptom**: Uploaded KB documents remain queued or stuck after a host reboot.
**Diagnosis & Fix**:
1. Check worker logs: `supportdesk logs worker`.
2. Verify heartbeat & queue counts: `supportdesk health`.
3. Restart the worker cleanly (the worker automatically recovers stale `running` jobs older than 15 minutes):
   ```bash
   supportdesk restart worker
   ```
4. If external PostgreSQL is used, verify `vector` and `pg_trgm` extensions are installed (`CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;`).

### F. Non-Destructive Container / Permission Recovery
If host directories had wrong permissions or containers stopped cleanly:
```bash
supportdesk repair
```
If application/worker container layers appear corrupted:
```bash
supportdesk reinstall
```
(`reinstall` preserves **all** PostgreSQL records, uploaded files, KB indexes, and `.env`.)
