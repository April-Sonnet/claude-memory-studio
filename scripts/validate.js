#!/usr/bin/env node
// validate.js — frontmatter 完整性检查
const fs = require('fs');
const path = require('path');

const base = process.env.MEMORY_DIR || path.join(require('os').homedir(), '.claude/projects');
const validTypes = new Set(['user', 'project', 'feedback', 'reference']);

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return null;
  const fm = {};
  let key = '';
  m[1].split('\n').forEach(line => {
    const kv = line.match(/^(\w+):\s*(.*)/);
    if (kv) { key = kv[1]; fm[key] = kv[2].replace(/^["']|["']$/g, '').trim(); }
    else if (line.startsWith('  ') && key) {
      const sk = line.match(/\s+(\w+):\s*(.*)/);
      if (sk && !sk[1].startsWith('node_')) fm[key + '.' + sk[1]] = sk[2].replace(/^["']|["']$/g, '').trim();
    }
  });
  return fm;
}

const results = [];
let total = 0, passed = 0;

fs.readdirSync(base, { withFileTypes: true }).forEach(proj => {
  if (!proj.isDirectory()) return;
  const memDir = path.join(proj.path, proj.name, 'memory');
  if (!fs.existsSync(memDir)) return;
  fs.readdirSync(memDir).forEach(f => {
    if (!f.endsWith('.md') || f === 'MEMORY.md') return;
    total++;
    const fp = path.join(memDir, f);
    const text = fs.readFileSync(fp, 'utf8');
    const fm = parseFrontmatter(text);
    const issues = [];
    if (!fm) { issues.push('no frontmatter'); }
    else {
      if (!fm.name) issues.push('missing name');
      else if (fm.name + '.md' !== f) issues.push(`name "${fm.name}" ≠ filename "${f}"`);
      if (!fm.description) issues.push('missing or empty description');
      if (fm['metadata.type'] && !validTypes.has(fm['metadata.type'])) issues.push(`invalid type "${fm['metadata.type']}"`);
    }
    results.push({ file: path.relative(base, fp), issues, fm });
    if (!issues.length) passed++;
  });
});

console.log(`\n  Validate: ${total} files, ${passed} OK, ${total - passed} issues\n`);
results.filter(r => r.issues.length).forEach(r => {
  console.log(`  ✗ ${r.file}`);
  r.issues.forEach(i => console.log(`    ${i}`));
});
console.log('');
process.exit(total - passed > 0 ? 1 : 0);
