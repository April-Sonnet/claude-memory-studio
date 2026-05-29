#!/usr/bin/env node
// check-links.js — 断链检测
const fs = require('fs');
const path = require('path');

const base = process.env.MEMORY_DIR || path.join(require('os').homedir(), '.claude/projects');

// Build name → file map
const nameMap = new Map();
const linkData = [];

fs.readdirSync(base, { withFileTypes: true }).forEach(proj => {
  if (!proj.isDirectory()) return;
  const memDir = path.join(proj.path, proj.name, 'memory');
  if (!fs.existsSync(memDir)) return;
  fs.readdirSync(memDir).forEach(f => {
    if (!f.endsWith('.md') || f === 'MEMORY.md') return;
    const fp = path.join(memDir, f);
    const text = fs.readFileSync(fp, 'utf8');
    const nameM = text.match(/^---\n[\s\S]*?name:\s*(\S+)/m);
    if (nameM) nameMap.set(nameM[1], fp);
    // Strip code spans before link extraction to avoid false positives
    const clean = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '');
    const links = Array.from(clean.matchAll(/\[\[([\w-]+)\]\]/g)).map(m => m[1]);
    if (links.length) linkData.push({ file: path.relative(base, fp), links });
  });
});

let broken = 0;
linkData.forEach(({ file, links }) => {
  links.forEach(l => {
    if (!nameMap.has(l)) {
      if (broken === 0) console.log(`\n  Broken links:\n`);
      console.log(`  ✗ ${file} → [[${l}]]`);
      broken++;
    }
  });
});

if (broken === 0) console.log(`\n  All ${nameMap.size} files, 0 broken links\n`);
else console.log(`\n  ${nameMap.size} files, ${broken} broken links\n`);
process.exit(broken > 0 ? 1 : 0);
