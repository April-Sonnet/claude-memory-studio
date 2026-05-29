#!/usr/bin/env node
// find-orphans.js — 孤立节点查找（0 连接）
const fs = require('fs');
const path = require('path');

const base = process.env.MEMORY_DIR || path.join(require('os').homedir(), '.claude/projects');

const nodes = [];

fs.readdirSync(base, { withFileTypes: true }).forEach(proj => {
  if (!proj.isDirectory()) return;
  const memDir = path.join(proj.path, proj.name, 'memory');
  if (!fs.existsSync(memDir)) return;
  fs.readdirSync(memDir).forEach(f => {
    if (!f.endsWith('.md') || f === 'MEMORY.md') return;
    const fp = path.join(memDir, f);
    const text = fs.readFileSync(fp, 'utf8');
    const nameM = text.match(/^---\n[\s\S]*?name:\s*(\S+)/m);
    if (!nameM) return;
    // Skip files explicitly marked as standalone
    const fm = text.match(/^---\n[\s\S]*?\n---/);
    if (fm && /\bstandalone:\s*true\b/.test(fm[0])) return;
    const links = Array.from(text.matchAll(/\[\[([\w-]+)\]\]/g)).map(m => m[1]);
    nodes.push({ id: nameM[1], file: path.relative(base, fp), links });
  });
});

const idSet = new Set(nodes.map(n => n.id));
const connected = new Set();

nodes.forEach(n => {
  n.links.forEach(l => {
    if (idSet.has(l)) {
      connected.add(n.id);
      connected.add(l);
    }
  });
});

const orphans = nodes.filter(n => !connected.has(n.id));
const total = nodes.length;
const connectedCount = connected.size;

console.log(`\n  ${total} nodes total, ${connectedCount} connected, ${orphans.length} orphans\n`);
orphans.forEach(n => console.log(`  ○ ${n.id}  (${n.file})`));
console.log('');
process.exit(0);
