#!/usr/bin/env node
// health-report.js — 汇总评分
const { execSync } = require('child_process');
const path = require('path');

const scriptsDir = __dirname;
const base = process.env.MEMORY_DIR || path.join(require('os').homedir(), '.claude/projects');

function run(script) {
  try {
    const out = execSync(`node "${path.join(scriptsDir, script)}"`, {
      env: { ...process.env, MEMORY_DIR: base },
      encoding: 'utf8'
    });
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, output: e.stdout || '', error: e.stderr || '' };
  }
}

function parseCount(output) {
  const m = output.match(/(\d+)\s+files?/);
  return m ? parseInt(m[1]) : 0;
}

function parseTotal(output) {
  const m = output.match(/(\d+)\s+files?/);
  return m ? parseInt(m[1]) : 0;
}

console.log('');
console.log('  ┌─────────────────────────────┐');
console.log('  │    Memory Health Report      │');
console.log('  └─────────────────────────────┘');
console.log('');

const val = run('validate.js');
const valTotal = parseTotal(val.output);
const valIssues = val.ok ? 0 : (() => { const m = val.output.match(/(\d+) issues?/); return m ? parseInt(m[1]) : 1; })();
const valScore = valTotal > 0 ? Math.round((1 - valIssues / valTotal) * 100) : 100;
console.log(`  Validate    ${val.ok ? '✓' : '✗'}  ${valScore}%  (${valTotal - valIssues}/${valTotal} OK)`);
if (!val.ok) val.output.split('\n').filter(l => l.includes('✗')).forEach(l => console.log(`               ${l.trim()}`));

const chk = run('check-links.js');
const broken = chk.ok ? 0 : (() => { const m = chk.output.match(/(\d+) broken/); return m ? parseInt(m[1]) : 0; })();
const linkScore = Math.max(0, 100 - broken * 20);
const linkFiles = parseTotal(chk.output);
console.log(`  Links       ${chk.ok ? '✓' : '✗'}  ${linkScore}%  (${broken} broken in ${linkFiles} files)`);

const orph = run('find-orphans.js');
const orphTotal = (() => { const m = orph.output.match(/(\d+) nodes total/); return m ? parseInt(m[1]) : 0; })();
const orphCount = (() => { const m = orph.output.match(/(\d+) orphans/); return m ? parseInt(m[1]) : 0; })();
const baseline = Math.max(2, Math.round(orphTotal * 0.1));
const effective = Math.max(0, orphCount - baseline);
const orphScore = orphTotal > 0 ? Math.round((1 - effective / orphTotal) * 100) : 100;
console.log(`  Orphans     ${orphCount === 0 ? '✓' : '⚠'}  ${orphScore}%  (${orphCount} orphans in ${orphTotal} nodes, baseline ${baseline})`);

const overall = Math.round((valScore + linkScore + orphScore) / 3);
console.log('');
console.log(`  ─────────────────────────────`);
console.log(`  Overall Health:  ${overall}%`);
console.log(`  Checked:         ${valTotal} memory files`);
console.log('');
const bar = '█'.repeat(Math.floor(overall / 10)) + '░'.repeat(10 - Math.floor(overall / 10));
console.log(`  [${bar}]`);
console.log('');
