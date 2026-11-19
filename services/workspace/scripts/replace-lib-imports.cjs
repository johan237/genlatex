#!/usr/bin/env node
/**
 * Replace relative lib/ imports with @/lib/ for path alias support.
 * Run from genlatex root: node scripts/replace-lib-imports.cjs
 */

const fs = require('fs');
const path = require('path');

function walk(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue;
    if (e.isDirectory()) walk(full, files);
    else if (e.name.endsWith('.js') || e.name.endsWith('.jsx')) files.push(full);
  }
  return files;
}

const root = path.resolve(__dirname, '..');
const dirs = ['app', 'components', 'scripts'];
const allFiles = new Set();
for (const d of dirs) {
  const p = path.join(root, d);
  if (fs.existsSync(p)) walk(p, []).forEach(f => allFiles.add(f));
}

// Replace (any number of ../) + lib/ with @/lib/ in from '...' or from "..."
const importRegex = /(from\s+['"])((?:\.\.\/)+)(lib\/)/g;
const requireRegex = /(require\s*\(\s*['"])((?:\.\.\/)+)(lib\/)/g;

let total = 0;
for (const file of allFiles) {
  let content = fs.readFileSync(file, 'utf8');
  const before = content;
  content = content.replace(importRegex, '$1@/$3');
  content = content.replace(requireRegex, '$1@/$3');
  if (content !== before) {
    fs.writeFileSync(file, content);
    total++;
    console.log(path.relative(root, file));
  }
}
console.log('Updated', total, 'files');
