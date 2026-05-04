#!/usr/bin/env node

const baseUrl = normalizeBaseUrl(process.env.GBRAIN_REMOTE_MCP_URL || '');
const canarySlug = process.env.GBRAIN_REMOTE_CANARY_SLUG || `system/canaries/gbrain-remote-mcp-canary-${new Date().toISOString().slice(0, 10)}`;

if (!baseUrl) {
  fail('GBRAIN_REMOTE_MCP_URL is required');
}

const mcpUrl = new URL('/mcp', baseUrl).toString();
const tokenUrl = new URL('/token', baseUrl).toString();

const evidence = [];

await expectUnauthorized('missing_token', {});
await expectUnauthorized('bad_token', { Authorization: 'Bearer gbrain_bad_token_for_canary' });
await expectCorsDefaultDeny();
await expectDcrDisabled();
await expectAdminRouteDenied();
await expectExpiredTokenDenied();
await expectRevokedClientDenied();
await expectLogRedactionEvidence();

const token = await getAccessToken();
const authHeaders = { Authorization: `Bearer ${token}` };
const readOnlyToken = await getAccessToken('read');
const readOnlyHeaders = { Authorization: `Bearer ${readOnlyToken}` };

await rpc('initialize', {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'gbrain-remote-mcp-canary', version: '1.0.0' },
}, authHeaders);
const tools = await rpc('tools/list', {}, authHeaders);
const toolNames = (tools.tools || []).map(tool => tool.name).sort();
const forbiddenRemoteTools = ['sync_brain', 'file_upload', 'file_list', 'file_url', 'purge_deleted_pages'];
const exposedForbidden = forbiddenRemoteTools.filter(name => toolNames.includes(name));
if (exposedForbidden.length) {
  fail(`local-only tools exposed remotely: ${exposedForbidden.join(', ')}`);
}
evidence.push({ step: 'tools_list', status: 'PASS', count: toolNames.length });

await expectReadOnlyWriteDenied(readOnlyHeaders);

const sentinel = `GBRAIN_REMOTE_MCP_CANARY_${Date.now()}`;
const body = [
  `# GBrain Remote MCP Canary`,
  ``,
  `Remote MCP/OAuth canary for OpenClaw/GBrain shared brain.`,
  ``,
  sentinel,
].join('\n');

await callTool('put_page', { slug: canarySlug, content: body, type: 'note', title: 'GBrain Remote MCP Canary' }, authHeaders);
const page = await callTool('get_page', { slug: canarySlug }, authHeaders);
assertText(JSON.stringify(page), sentinel, 'get_page sentinel');
await callTool('add_tag', { slug: canarySlug, tag: 'gbrain-remote-canary' }, authHeaders);
const tags = await callTool('get_tags', { slug: canarySlug }, authHeaders);
assertText(JSON.stringify(tags), 'gbrain-remote-canary', 'tag roundtrip');
const searchResult = await callTool('search', { query: sentinel, limit: 5 }, authHeaders);
const versions = await callTool('get_versions', { slug: canarySlug }, authHeaders);
await callTool('delete_page', { slug: canarySlug }, authHeaders);
const deleted = await callTool('get_page', { slug: canarySlug, include_deleted: true }, authHeaders);
assertText(JSON.stringify(deleted), canarySlug, 'include_deleted get_page');
await callTool('restore_page', { slug: canarySlug }, authHeaders);
const restored = await callTool('get_page', { slug: canarySlug }, authHeaders);
assertText(JSON.stringify(restored), sentinel, 'restore get_page');

evidence.push({
  step: 'read_write_search_versions_delete_restore',
  status: 'PASS',
  slug: canarySlug,
  search_result_count: Array.isArray(searchResult) ? searchResult.length : null,
  version_count: Array.isArray(versions) ? versions.length : null,
});

console.log(JSON.stringify({
  status: 'PASS',
  url: baseUrl,
  auth: process.env.GBRAIN_REMOTE_MCP_BEARER_TOKEN ? 'bearer' : 'oauth_client_credentials',
  exposed_tool_count: toolNames.length,
  canary_slug: canarySlug,
  evidence,
}, null, 2));

function normalizeBaseUrl(raw) {
  if (!raw) return '';
  const value = raw.trim().replace(/\/mcp\/?$/, '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(value)) return '';
  return value;
}

async function getAccessToken(scopeOverride) {
  const bearer = process.env.GBRAIN_REMOTE_MCP_BEARER_TOKEN;
  if (bearer) return bearer;

  const clientId = process.env.GBRAIN_REMOTE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GBRAIN_REMOTE_OAUTH_CLIENT_SECRET;
  const scope = scopeOverride || process.env.GBRAIN_REMOTE_OAUTH_SCOPE || 'read write';
  if (!clientId || !clientSecret) {
    fail('set GBRAIN_REMOTE_MCP_BEARER_TOKEN or GBRAIN_REMOTE_OAUTH_CLIENT_ID/GBRAIN_REMOTE_OAUTH_CLIENT_SECRET');
  }

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    fail(`token endpoint failed: ${res.status}`);
  }
  evidence.push({ step: 'token', status: 'PASS', scope });
  return json.access_token;
}

async function expectUnauthorized(name, headers, { requireCleanStatus = true } = {}) {
  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', params: {}, id: name }),
  });
  if (res.status < 400) {
    fail(`${name} expected non-2xx auth failure, got ${res.status}`);
  }
  if (requireCleanStatus && ![401, 403].includes(res.status)) {
    fail(`${name} expected clean 401/403 auth failure, got ${res.status}`);
  }
  evidence.push({ step: name, status: 'PASS', http_status: res.status, clean_auth_status: [401, 403].includes(res.status) });
}

async function expectCorsDefaultDeny() {
  const res = await fetch(mcpUrl, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://example.invalid',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  evidence.push({
    step: 'cors_default_deny',
    status: res.headers.has('access-control-allow-origin') ? 'FAIL' : 'PASS',
    http_status: res.status,
    access_control_allow_origin: res.headers.get('access-control-allow-origin'),
  });
  if (res.headers.has('access-control-allow-origin')) {
    fail('CORS default-deny failed: unexpected access-control-allow-origin header');
  }
}

async function expectDcrDisabled() {
  const registerUrl = new URL('/register', baseUrl).toString();
  const res = await fetch(registerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'gbrain-remote-mcp-canary-dcr-probe',
      redirect_uris: ['https://example.invalid/callback'],
      grant_types: ['client_credentials'],
      scope: 'read',
    }),
  });
  if (res.status < 400) {
    fail(`DCR expected non-2xx failure, got ${res.status}`);
  }
  evidence.push({ step: 'dcr_disabled', status: 'PASS', http_status: res.status });
}

async function expectAdminRouteDenied() {
  const adminUrl = new URL('/admin/api/clients', baseUrl).toString();
  const res = await fetch(adminUrl, {
    headers: { Authorization: 'Bearer gbrain_bad_token_for_canary' },
  });
  if (![401, 403].includes(res.status)) {
    fail(`admin route expected 401/403 without admin cookie, got ${res.status}`);
  }
  evidence.push({ step: 'admin_route_denial', status: 'PASS', http_status: res.status });
}

async function expectExpiredTokenDenied() {
  const expired = process.env.GBRAIN_REMOTE_EXPIRED_MCP_BEARER_TOKEN;
  if (!expired) {
    evidence.push({ step: 'expired_token_denial', status: 'SKIP', reason: 'set GBRAIN_REMOTE_EXPIRED_MCP_BEARER_TOKEN to verify a real expired token' });
    return;
  }
  await expectUnauthorized('expired_token_denial', { Authorization: `Bearer ${expired}` });
}

async function expectRevokedClientDenied() {
  const clientId = process.env.GBRAIN_REMOTE_REVOKED_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GBRAIN_REMOTE_REVOKED_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    evidence.push({ step: 'revoked_client_denial', status: 'SKIP', reason: 'set GBRAIN_REMOTE_REVOKED_OAUTH_CLIENT_ID/SECRET to verify a real revoked client' });
    return;
  }
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'read',
    }),
  });
  if (res.status < 400) {
    fail(`revoked client expected token mint denial, got ${res.status}`);
  }
  evidence.push({ step: 'revoked_client_denial', status: 'PASS', http_status: res.status });
}

async function expectLogRedactionEvidence() {
  const logFile = process.env.GBRAIN_REMOTE_LOG_SAMPLE_FILE;
  if (!logFile) {
    evidence.push({ step: 'log_redaction', status: 'SKIP', reason: 'set GBRAIN_REMOTE_LOG_SAMPLE_FILE to scan a redacted live log sample' });
    return;
  }
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(logFile, 'utf8');
  const forbidden = [
    /Admin Token \(paste into \/admin login\)/i,
    /gbrain_(?:at|rt|cs|cl|code)_[A-Za-z0-9_-]+/,
    /Bearer\s+[A-Za-z0-9._-]+/i,
    /postgres(?:ql)?:\/\/\S+/i,
    /sk-[A-Za-z0-9_-]{20,}/,
  ];
  const hit = forbidden.find(pattern => pattern.test(text));
  if (hit) {
    fail(`log redaction scan found forbidden pattern: ${hit}`);
  }
  evidence.push({ step: 'log_redaction', status: 'PASS' });
}

async function expectReadOnlyWriteDenied(headers) {
  if (process.env.GBRAIN_REMOTE_MCP_BEARER_TOKEN) {
    evidence.push({ step: 'read_only_write_denial', status: 'SKIP', reason: 'bearer canary cannot mint a scoped read-only token' });
    return;
  }
  const result = await rpc('tools/call', {
    name: 'put_page',
    arguments: {
      slug: `${canarySlug}-read-only-denial`,
      content: 'This write should be denied for a read-only token.',
      type: 'note',
      title: 'Read-only denial canary',
    },
  }, headers);
  const text = result.content?.map(part => part.text || '').join('\n') || '';
  if (!result.isError || !text.includes('insufficient_scope')) {
    fail(`read-only write denial expected insufficient_scope MCP error, got ${text.slice(0, 200)}`);
  }
  evidence.push({ step: 'read_only_write_denial', status: 'PASS' });
}

async function rpc(method, params, headers) {
  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: `${Date.now()}-${Math.random()}` }),
  });
  const text = await res.text();
  if (!res.ok) {
    fail(`${method} failed: ${res.status}`);
  }
  const payload = parseRpcPayload(text);
  if (payload.error) {
    fail(`${method} error: ${payload.error.message || JSON.stringify(payload.error)}`);
  }
  return payload.result || {};
}

async function callTool(name, args, headers) {
  const result = await rpc('tools/call', { name, arguments: args }, headers);
  const text = result.content?.map(part => part.text || '').join('\n') || '';
  if (result.isError) {
    fail(`${name} returned MCP error: ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseRpcPayload(text) {
  const dataLines = text.split(/\r?\n/).filter(line => line.startsWith('data:'));
  if (dataLines.length) {
    for (const line of dataLines.reverse()) {
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      return JSON.parse(payload);
    }
    fail('SSE response had no JSON data');
  }
  return JSON.parse(text);
}

function assertText(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    fail(`${label} missing expected marker`);
  }
}

function fail(message) {
  console.error(JSON.stringify({ status: 'FAIL', error: message }, null, 2));
  process.exit(1);
}
