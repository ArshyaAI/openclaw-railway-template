#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.GBRAIN_SOURCE_DIR || '/app';
const file = join(root, 'src/commands/serve-http.ts');
let source = readFileSync(file, 'utf8');

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

if (!source.includes(tokenBefore)) {
  throw new Error('admin token block anchor not found');
}
source = source.replace(tokenBefore, () => '${adminTokenBlock}');

writeFileSync(file, source);
console.log('Applied GBrain remote HTTP safety patch.');
