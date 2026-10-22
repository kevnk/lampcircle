#!/usr/bin/env node
// Sets one version in package.json, tauri.conf.json and Cargo.toml (from the TF Mac app template).
// It never pushes or notarizes.

import { readFileSync, writeFileSync } from "node:fs";

const FILES = {
  package: "package.json",
  tauri: "src-tauri/tauri.conf.json",
  cargo: "src-tauri/Cargo.toml",
};

const want = process.argv[2];
if (!want || !/^\d+\.\d+\.\d+$/.test(want)) {
  console.error("Usage: npm run release -- <x.y.z>");
  process.exit(2);
}

function edit(file, fn) {
  const before = readFileSync(file, "utf8");
  const after = fn(before);
  if (after === before) throw new Error(`Couldn't find version in ${file}`);
  writeFileSync(file, after);
  console.log(`  ${file} → ${want}`);
}

edit(FILES.package, (s) => s.replace(/"version": "[^"]+"/, `"version": "${want}"`));
edit(FILES.tauri, (s) => s.replace(/"version": "[^"]+"/, `"version": "${want}"`));
edit(FILES.cargo, (s) => s.replace(/^version = "[^"]+"/m, `version = "${want}"`));
console.log("Bumped locally. Commit it yourself. This does not tag, push or notarize.");
