#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.GBRAIN_SOURCE_DIR || '/app';
const serveHttpFile = join(root, 'src/commands/serve-http.ts');
const oauthProviderFile = join(root, 'src/core/oauth-provider.ts');
let source = readFileSync(serveHttpFile, 'utf8');

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

if (!source.includes(corsBefore)) {
  throw new Error('CORS patch anchor not found');
}
source = source.replace(corsBefore, corsAfter);

const listenPattern = /  app\.listen\(port, \(\) => \{\n[\s\S]*?    console\.error\(`/;
const listenAfter = `  app.listen(port, () => {
    const adminTokenBlock = \`║  Admin Token: suppressed in Railway logs             ║
║  Use OAuth client credentials created via gbrain auth ║
║  or run locally with explicit private token output.   ║\`;
    console.error(\``;

if (!listenPattern.test(source)) {
  throw new Error('admin log patch anchor not found');
}
source = source.replace(listenPattern, () => listenAfter);

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

if (!source.includes(mcpRouteAfter)) {
  throw new Error('MCP auth error handler anchor not found');
}
if (!source.includes(mcpRouteStartBefore) && !source.includes('next: NextFunction) => {\n    try {')) {
  throw new Error('MCP route start anchor not found');
}
if (!source.includes('next: NextFunction) => {\n    try {')) {
  source = source.replace(mcpRouteStartBefore, () => mcpRouteStartAfter);
}
if (!source.includes('codexRemoteMcpAuthErrorHandler')) {
  source = source.replace(mcpRouteAfter, () => authErrorHandler);
}

if (!source.includes(tokenBefore)) {
  throw new Error('admin token block anchor not found');
}
source = source.replace(tokenBefore, () => '${adminTokenBlock}');

writeFileSync(serveHttpFile, source);

let oauthProvider = readFileSync(oauthProviderFile, 'utf8');
if (!oauthProvider.includes("InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js'")) {
  const authInfoImport = "import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';";
  if (!oauthProvider.includes(authInfoImport)) {
    throw new Error('OAuth provider InvalidTokenError import anchor not found');
  }
  oauthProvider = oauthProvider.replace(
    authInfoImport,
    `${authInfoImport}\nimport { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';`,
  );
}
oauthProvider = oauthProvider
  .replace("throw new Error('Token expired');", "throw new InvalidTokenError('Token expired');")
  .replace("throw new Error('Invalid token');", "throw new InvalidTokenError('Invalid token');");
if (
  !oauthProvider.includes("throw new InvalidTokenError('Token expired');")
  || !oauthProvider.includes("throw new InvalidTokenError('Invalid token');")
) {
  throw new Error('OAuth provider InvalidTokenError patch failed');
}
writeFileSync(oauthProviderFile, oauthProvider);

console.log('Applied GBrain remote HTTP safety patch.');
