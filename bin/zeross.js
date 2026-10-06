#!/usr/bin/env node
// bin/zeross.js
// @ts-check
// Version gate first, then a dynamic import: static imports would load (and
// possibly fail on) the CLI before the friendly message could be printed.
const [major] = process.versions.node.split(".").map(Number);
if (major < 22) {
  process.stderr.write(`zeross: Node.js >= 22 is required (found ${process.versions.node}).\n`);
  process.exit(1);
}

const { main } = await import("../lib/cli.js");
process.exitCode = await main();
