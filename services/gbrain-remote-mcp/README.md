# GBrain Remote MCP Service

Small Railway service wrapper for upstream GBrain HTTP MCP/OAuth.

It intentionally keeps the main OpenClaw service unchanged. OpenClaw continues to use stdio GBrain, while local or external agents can use the remote `/mcp` endpoint with OAuth or bearer credentials.

Current dogfood cut:

- Repo: `https://github.com/ArshyaAI/gbrain.git`
- SHA: `de11d4c858b1a880931c008fbee3ceef92a8329a`
- Version: `0.27.0`
- Reason: combines upstream `0.27.0` with pending upstream PRs #619, #620, and #626 for resolver, HTTP auth, and source-scoped stale embedding fixes.
- This is intentionally not an upstream-clean FULL PASS until those PRs are merged and consumed from `garrytan/gbrain`.

Security defaults:

- `GBRAIN_ENABLE_DCR` defaults off.
- `GBRAIN_HTTP_CORS_ORIGIN` defaults empty, which denies browser CORS by default.
- `GBRAIN_PRINT_ADMIN_TOKEN` defaults `0`, so the admin bootstrap token is not emitted into Railway logs.
- `GBRAIN_PUBLIC_URL` should be the Railway/custom domain origin.
- `GBRAIN_DATABASE_URL` must point at the shared Supabase/Supavisor GBrain database.

Rollback:

1. Remove or pause only the `gbrain-remote-mcp` Railway service.
2. Revoke remote OAuth clients or bearer tokens with `gbrain auth revoke-client <client_id>` or `gbrain auth revoke <name>`.
3. Leave the main `openclaw-railway-template` service untouched.
