## Summary
- Briefly describe what changed and why.

## Pre-Handover Verification Checklist
- [ ] `npm run devops:check` passed locally (`bash -n`, secret scan, `next typegen`, `tsc --noEmit`, `eslint`, `vitest`)
- [ ] Database schema changes use versioned Drizzle migrations (`npm run db:generate`), never manual production edits
- [ ] `.env.example` updated if any environment variables were added or changed (no secrets committed)
- [ ] Rollback impact considered (forward migrations documented / backward-compatible deployment verified)
