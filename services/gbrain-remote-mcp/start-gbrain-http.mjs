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
  const file = '/app/src/commands/serve-http.ts';
  let source = readFileSync(file, 'utf8');
  if (source.includes('Admin Token: suppressed in Railway logs') && source.includes('origin: false')) {
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

  for (const [label, anchor] of [['cors', corsBefore], ['token', tokenBefore]]) {
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
    .replace(listenPattern, () => listenAfter)
    .replace(tokenBefore, () => '${adminTokenBlock}');

  writeFileSync(file, source);
  console.error('Applied GBrain remote HTTP safety patch at startup.');
}
