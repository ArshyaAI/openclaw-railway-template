const fs = require("fs");
const path = require("path");

const commandsPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "@chrysb",
  "alphaclaw",
  "lib",
  "server",
  "commands.js",
);

let source = fs.readFileSync(commandsPath, "utf8");

if (source.includes("const { exec, execFile } = require(\"child_process\");")) {
  console.log("[patch-alphaclaw] process patch already applied");
  process.exit(0);
}

if (!source.includes("const { exec } = require(\"child_process\");")) {
  throw new Error("Could not find child_process import in AlphaClaw commands.js");
}

source = source.replace(
  "const { exec } = require(\"child_process\");",
  "const { exec, execFile } = require(\"child_process\");",
);

const helper = String.raw`
const splitCliArgs = (input) => {
  const args = [];
  let current = "";
  let quote = null;
  let escaped = false;

  for (const ch of String(input || "")) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (escaped) current += "\\";
  if (quote) throw new Error("Unterminated quote in command: " + input);
  if (current) args.push(current);
  return args;
};

`;

source = source.replace(
  "const createCommands = ({ gatewayEnv }) => {",
  `${helper}const createCommands = ({ gatewayEnv }) => {`,
);

const oldClawCmd = [
  "  const clawCmd = (",
  "    cmd,",
  "    { quiet = false, timeoutMs = 15000, killSignal = \"SIGTERM\" } = {},",
  "  ) =>",
  "    new Promise((resolve) => {",
  "      if (!quiet) console.log(`[alphaclaw] Running: openclaw ${cmd}`);",
  "      exec(",
  "        `openclaw ${cmd}`,",
  "        {",
  "          env: gatewayEnv(),",
  "          timeout: timeoutMs,",
  "          killSignal,",
  "        },",
  "        (err, stdout, stderr) => {",
  "          const result = {",
  "            ok: !err,",
  "            stdout: stdout.trim(),",
  "            stderr: stderr.trim(),",
  "            code: err?.code,",
  "          };",
  "          if (!quiet && !result.ok) {",
  "            console.log(`[alphaclaw] Error: ${result.stderr.slice(0, 200)}`);",
  "          }",
  "          resolve(result);",
  "        },",
  "      );",
  "    });",
].join("\n");

const newClawCmd = [
  "  const clawCmd = (",
  "    cmd,",
  "    { quiet = false, timeoutMs = 15000, killSignal = \"SIGTERM\" } = {},",
  "  ) =>",
  "    new Promise((resolve) => {",
  "      if (!quiet) console.log(`[alphaclaw] Running: openclaw ${cmd}`);",
  "      let args;",
  "      try {",
  "        args = splitCliArgs(cmd);",
  "      } catch (err) {",
  "        resolve({",
  "          ok: false,",
  "          stdout: \"\",",
  "          stderr: err?.message || \"Could not parse openclaw command\",",
  "          code: \"EINVAL\",",
  "        });",
  "        return;",
  "      }",
  "      execFile(",
  "        \"openclaw\",",
  "        args,",
  "        {",
  "          env: gatewayEnv(),",
  "          timeout: timeoutMs,",
  "          killSignal,",
  "          windowsHide: true,",
  "        },",
  "        (err, stdout = \"\", stderr = \"\") => {",
  "          const result = {",
  "            ok: !err,",
  "            stdout: stdout.trim(),",
  "            stderr: stderr.trim(),",
  "            code: err?.code,",
  "            signal: err?.signal,",
  "          };",
  "          if (!quiet && !result.ok) {",
  "            console.log(`[alphaclaw] Error: ${result.stderr.slice(0, 200)}`);",
  "          }",
  "          resolve(result);",
  "        },",
  "      );",
  "    });",
].join("\n");

if (!source.includes(oldClawCmd)) {
  throw new Error("Could not find AlphaClaw clawCmd block to patch");
}

source = source.replace(oldClawCmd, newClawCmd);
fs.writeFileSync(commandsPath, source);
console.log("[patch-alphaclaw] replaced shell clawCmd with execFile");
