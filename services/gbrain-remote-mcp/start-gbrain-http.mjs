#!/usr/bin/env bun

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

ensureRemoteHttpSafetyPatch();

process.env.GBRAIN_PRINT_ADMIN_TOKEN ??= '0';
process.env.GBRAIN_HTTP_CORS_ORIGIN ??= '';

const port = process.env.PORT || '3131';
const publicUrl = process.env.GBRAIN_PUBLIC_URL
  || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');

if (!publicUrl) {
  console.error('GBRAIN_PUBLIC_URL or RAILWAY_PUBLIC_DOMAIN is required for OAuth issuer metadata.');
  process.exit(64);
}

if (!process.env.GBRAIN_DATABASE_URL && !process.env.DATABASE_URL) {
  console.error('GBRAIN_DATABASE_URL or DATABASE_URL is required.');
  process.exit(64);
}

const args = [
  'run',
  'src/cli.ts',
  'serve',
  '--http',
  '--port',
  port,
  '--public-url',
  publicUrl,
  '--token-ttl',
  process.env.GBRAIN_TOKEN_TTL || '3600',
];

if (process.env.GBRAIN_ENABLE_DCR === '1') {
  args.push('--enable-dcr');
}

const child = spawn('bun', args, {
  cwd: '/app',
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`gbrain-http exited from signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

function ensureRemoteHttpSafetyPatch() {
  const serveHttpFile = '/app/src/commands/serve-http.ts';
  const oauthProviderFile = '/app/src/core/oauth-provider.ts';
  let source = readFileSync(serveHttpFile, 'utf8');
  const oauthProvider = readFileSync(oauthProviderFile, 'utf8');
  if (
    source.includes('Admin Token: suppressed in Railway logs')
    && source.includes('origin: false')
    && source.includes('codexRemoteMcpAuthErrorHandler')
    && oauthProvider.includes("InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js'")
  ) {
    return;
  }

  const corsBefore = `  app.use('/mcp', cors());
  app.use('/token', cors());
  app.use('/authorize', cors());
  app.use('/register', cors());
  app.use('/revoke', cors());`;

  const corsAfter = `  const corsOriginEnv = process.env.GBRAIN_HTTP_CORS_ORIGIN?.trim() || '';
  const corsOptions = corsOriginEnv
    ? { origin: corsOriginEnv.split(',').map(origin => origin.trim()).filter(Boolean) }
    : { origin: false };
  app.use('/mcp', cors(corsOptions));
  app.use('/token', cors(corsOptions));
  app.use('/authorize', cors(corsOptions));
  app.use('/register', cors(corsOptions));
  app.use('/revoke', cors(corsOptions));`;

  const listenPattern = /  app\.listen\(port, \(\) => \{\n[\s\S]*?    console\.error\(`/;
  const listenAfter = `  app.listen(port, () => {
    const adminTokenBlock = \`║  Admin Token: suppressed in Railway logs             ║
║  Use OAuth client credentials created via gbrain auth ║
║  or run locally with explicit private token output.   ║\`;
    console.error(\``;

  const tokenBefore = `║  Admin Token (paste into /admin login):              ║
║  \${bootstrapToken.substring(0, 50)}  ║
║  \${bootstrapToken.substring(50).padEnd(50)}  ║`;

  const mcpRouteStartBefore = `  app.post('/mcp', requireBearerAuth({ verifier: oauthProvider }), async (req: Request, res: Response) => {
    const startTime = Date.now();`;

  const mcpRouteStartAfter = `  app.post('/mcp', requireBearerAuth({ verifier: oauthProvider }), async (req: Request, res: Response, next: NextFunction) => {
    try {
    const startTime = Date.now();`;

  const mcpRouteAfter = `    await transport.handleRequest(req, res, req.body);
  });`;

  const authErrorHandler = `    await transport.handleRequest(req, res, req.body);
    } catch (err) {
      next(err);
    }
  });

  const codexRemoteMcpAuthErrorHandler = (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const statusCode = Number((err as any)?.status ?? (err as any)?.statusCode);
    const message = err instanceof Error ? err.message : String(err ?? '');
    const lower = message.toLowerCase();
    const isAuthFailure = statusCode === 401 || statusCode === 403
      || lower.includes('bearer')
      || lower.includes('token')
      || lower.includes('authorization')
      || lower.includes('auth');
    if (!isAuthFailure) return next(err);
    const status = statusCode === 403 || lower.includes('forbidden') || lower.includes('scope') ? 403 : 401;
    res.status(status).json({
      error: status === 403 ? 'forbidden' : 'unauthorized',
      error_description: 'MCP authentication failed',
    });
  };
  app.use('/mcp', codexRemoteMcpAuthErrorHandler);`;

  for (const [label, anchor] of [['cors', corsBefore], ['token', tokenBefore], ['mcp route start', mcpRouteStartBefore], ['mcp auth error handler', mcpRouteAfter]]) {
    if (!source.includes(anchor)) {
      console.error(`GBrain remote HTTP safety patch failed: missing ${label} anchor.`);
      process.exit(65);
    }
  }
  if (!listenPattern.test(source)) {
    console.error('GBrain remote HTTP safety patch failed: missing listen anchor.');
    process.exit(65);
  }

  source = source
    .replace(corsBefore, corsAfter)
    .replace(mcpRouteStartBefore, () => mcpRouteStartAfter)
    .replace(mcpRouteAfter, () => authErrorHandler)
    .replace(listenPattern, () => listenAfter)
    .replace(tokenBefore, () => '${adminTokenBlock}');

  writeFileSync(serveHttpFile, source);

  let providerSource = oauthProvider;
  if (!providerSource.includes("InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js'")) {
    const authInfoImport = "import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';";
    if (!providerSource.includes(authInfoImport)) {
      console.error('GBrain remote HTTP safety patch failed: missing OAuth provider import anchor.');
      process.exit(65);
    }
    providerSource = providerSource.replace(
      authInfoImport,
      `${authInfoImport}\nimport { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';`,
    );
  }
  providerSource = providerSource
    .replace("throw new Error('Token expired');", "throw new InvalidTokenError('Token expired');")
    .replace("throw new Error('Invalid token');", "throw new InvalidTokenError('Invalid token');");
  if (
    !providerSource.includes("throw new InvalidTokenError('Token expired');")
    || !providerSource.includes("throw new InvalidTokenError('Invalid token');")
  ) {
    console.error('GBrain remote HTTP safety patch failed: OAuth provider InvalidTokenError patch missing.');
    process.exit(65);
  }
  writeFileSync(oauthProviderFile, providerSource);
  console.error('Applied GBrain remote HTTP safety patch at startup.');
}
