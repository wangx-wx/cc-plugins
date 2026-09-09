#!/usr/bin/env node

// src/scope-init.js
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// src/args.js
function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`\u672A\u77E5\u53C2\u6570: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      values[key] = true;
    } else {
      values[key] = next;
      index += 1;
    }
  }
  return values;
}
function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}
`);
}
function printHelp(argv, help) {
  if (!argv.includes("--help") && !argv.includes("-h")) return false;
  process.stdout.write(`${help.trim()}
`);
  return true;
}

// src/scope-init.js
var HELP = `Usage: scope-init.js [--repo-root <path>] [--output <path>]

Create docs/kb/domain-scope.yaml as an empty, human-owned skeleton.
Run from the target repository root unless --repo-root is provided.`;
var TEMPLATE = `# \u672C\u6587\u4EF6\u7531 scope-init.js \u521B\u5EFA\u9AA8\u67B6\uFF0C\u9886\u57DF\u5185\u5BB9\u5FC5\u987B\u7531\u4EBA\u5DE5\u586B\u5199\u3002
# \u811A\u672C\u548C Agent \u4E0D\u5F97\u81EA\u52A8\u65B0\u589E\u3001\u62C6\u5206\u3001\u5408\u5E76\u6216\u4FEE\u6539\u6B63\u5F0F\u9886\u57DF\u3002

schema_version: 1

domains: []

shared_scopes: []

# domains \u6BCF\u9879\u7ED3\u6784\uFF1A
# - id: <\u9879\u76EE\u5185\u552F\u4E00\u9886\u57DF ID>
#   name: <\u9886\u57DF\u540D\u79F0>
#   owner: <\u8D1F\u8D23\u4EBA\u6216\u56E2\u961F>
#   status: active
#   include_packages: []
#   include_files: []
#   exclude_packages: []
#   exclude_files: []
#   keywords: []
#   project_docs: []
#   yuque_sources: []
#
# yuque_sources \u6BCF\u9879\u53EF\u586B\u5199\uFF1A
# - base_slug: <\u77E5\u8BC6\u5E93 slug>
# \u6216\uFF1A
# - document_url: <\u8BED\u96C0\u6587\u6863 URL>
#
# shared_scopes \u6BCF\u9879\u7ED3\u6784\uFF1A
# - id: <\u5171\u4EAB\u8303\u56F4 ID>
#   package: <\u5B8C\u6574\u5305\u540D>
#   module_ids: []
#   owners: []
`;
async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function main() {
  const argv = process.argv.slice(2);
  if (printHelp(argv, HELP)) return;
  const args = parseArgs(argv);
  const repoRoot = path.resolve(args.repoRoot || process.cwd());
  const output = path.resolve(repoRoot, args.output || "docs/kb/domain-scope.yaml");
  const relative = path.relative(repoRoot, output);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("domain-scope.yaml \u5FC5\u987B\u521B\u5EFA\u5728\u76EE\u6807\u4ED3\u5E93\u5185");
  }
  if (await exists(output)) {
    printJson({ action: "skipped", path: output, reason: "already_exists" });
    return;
  }
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, TEMPLATE, { encoding: "utf8", flag: "wx" });
  printJson({ action: "created", path: output, requires_human_input: true });
}
main().catch((error) => {
  process.stderr.write(`[scope-init] ${error.message}
`);
  process.exitCode = 1;
});
