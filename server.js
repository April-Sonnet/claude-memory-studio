#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// ── Config ──
const DEFAULT_PORT = 3457;
const PUBLIC_DIR = path.join(__dirname, 'public');

let baseDir = path.join(os.homedir(), '.claude', 'projects');
let port = DEFAULT_PORT;

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--dir' && process.argv[i+1]) baseDir = path.resolve(process.argv[++i]);
  else if (process.argv[i] === '--port' && process.argv[i+1]) port = parseInt(process.argv[++i], 10);
}

// ── SSE clients ──
const sseClients = new Set();
let watchTimer = null;

function notifyClients(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(c => { try { c.write(msg); } catch(e) { sseClients.delete(c); } });
}

// ── File watching ──
function watchMemories() {
  if (!fs.existsSync(baseDir)) return;
  try {
    const projects = fs.readdirSync(baseDir);
    for (const project of projects) {
      const memDir = path.join(baseDir, project, 'memory');
      if (!fs.existsSync(memDir)) continue;
      fs.watch(memDir, (ev, fn) => {
        if (fn && fn.endsWith('.md')) {
          clearTimeout(watchTimer);
          watchTimer = setTimeout(() => {
            const nodes = scanMemories();
            notifyClients({ type: 'refresh', nodes });
          }, 300);
        }
      });
    }
  } catch(e) { /* ignore */ }
}

// ── Memory parsing ──
function parseFrontmatter(content) {
  const lines = content.split('\n');
  if (lines[0] !== '---') return null;
  let end = 1;
  while (end < lines.length && lines[end] !== '---') end++;
  if (end >= lines.length) return null;
  return { lines: lines.slice(1, end), endLine: end };
}

function fmValue(lines, key) {
  for (const l of lines) {
    if (l.startsWith(key + ':')) return l.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

function fmType(lines) {
  for (const l of lines) {
    const m = l.match(/^\s+type:\s*(.+)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

function extractLinks(body) {
  const links = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(body)) !== null) links.push(m[1]);
  return [...new Set(links)];
}

function scanMemories() {
  const nodes = [];
  const skipped = [];
  const nameToIdx = new Map();

  if (!fs.existsSync(baseDir)) return { nodes: [], skipped };

  let projects = fs.readdirSync(baseDir);
    // Auto-detect main project: pick the project with the most memory files
  const primaryProject = projects
    .filter(p => !p.includes('test') && !p.includes('draft'))
    .map(p => {
      const memDir = path.join(baseDir, p, 'memory');
      let count = 0;
      try { if (fs.existsSync(memDir)) count = fs.readdirSync(memDir).filter(f => f.endsWith('.md')).length; } catch(e) {}
      return { name: p, count };
    })
    .sort((a, b) => b.count - a.count)
    .shift()?.name;
// Sort: primary first, test/draft last, rest alphabetically
  projects = projects.sort((a, b) => {
    if (a === primaryProject) return -1;
    if (b === primaryProject) return 1;
    const prio = p => p.includes('test') || p.includes('draft') ? 1 : 0;
    return prio(a) - prio(b) || a.localeCompare(b);
  });
  for (const project of projects) {
    const memDir = path.join(baseDir, project, 'memory');
    if (!fs.existsSync(memDir)) continue;

    let files;
    try { files = fs.readdirSync(memDir); } catch(e) { continue; }

    for (const file of files.sort()) {
      if (!file.endsWith('.md')) continue;

      const filePath = path.join(memDir, file);
      let content;
      try { content = fs.readFileSync(filePath, 'utf-8'); }
      catch(e) { continue; }

      const parsed = parseFrontmatter(content);
      if (!parsed) {
        skipped.push({ file, reason: 'No frontmatter (index file?)' });
        continue;
      }

      const bodyStart = content.indexOf('---', content.indexOf('---') + 1) + 3;
      const body = content.slice(bodyStart).trim();

      let id = fmValue(parsed.lines, 'name') || file.replace(/\.md$/, '');
      const origName = id;
      if (nameToIdx.has(id)) id = id + '@' + project;
      const desc = fmValue(parsed.lines, 'description') || '';
      const type = fmType(parsed.lines) || 'project';
      const links = extractLinks(body);

      nodes.push({
        id, label: origName, desc, type, size: 'md',
        body, _file: filePath, _project: project,
        isUserProfile: type === 'user' && !nodes.some(n => n.isUserProfile),
        outgoing: links, incoming: [],
      });
      nameToIdx.set(id, nodes.length - 1);
    }
  }

  // Build edges
  nodes.forEach(n => {
    n.outgoing = n.outgoing.filter(tid => nameToIdx.has(tid));
    n.outgoing.forEach(tid => {
      const t = nodes[nameToIdx.get(tid)];
      if (t) t.incoming.push(n.id);
    });
  });

  return { nodes, skipped };
}

// ── File writing ──
function backupFile(filePath) {
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0,15);
  const bakPath = filePath + '.bak.' + ts;
  fs.copyFileSync(filePath, bakPath);
  // Keep only last 10 backups
  const dir = require('path').dirname(filePath);
  const base = require('path').basename(filePath);
  try {
    const baks = fs.readdirSync(dir)
      .filter(f => f.startsWith(base + '.bak.'))
      .sort()
      .slice(0, -10);
    baks.forEach(f => fs.unlinkSync(require('path').join(dir, f)));
  } catch(e) {}
}

function updateMemoryFile(filePath, updates) {
  backupFile(filePath);
  let content = fs.readFileSync(filePath, 'utf-8');

  if (updates.name !== undefined) content = content.replace(/^name:.*$/m, `name: ${updates.name}`);
  if (updates.description !== undefined) content = content.replace(/^description:.*$/m, `description: ${updates.description}`);
  if (updates.type !== undefined) content = content.replace(/^(\s+)type:.*$/m, `$1type: ${updates.type}`);

  if (updates.body !== undefined) {
    const m = content.match(/^---\n[\s\S]*?\n---\n*/);
    if (m) content = m[0] + updates.body;
  }

  if (updates.addLinks) {
    const toAdd = updates.addLinks.filter(id => !content.includes(`[[${id}]]`));
    if (toAdd.length) {
      content = content.replace(/\n*$/, '');
      content += '\n\n' + toAdd.map(id => `[[${id}]]`).join(', ') + '\n';
    }
  }

  if (updates.removeLinks) {
    updates.removeLinks.forEach(id => {
      content = content.replace(new RegExp(`\\[\\[${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`, 'g'), '');
    });
    content = content.replace(/,\s*,/g, ',');
    content = content.replace(/\n{3,}/g, '\n\n');
  }

  fs.writeFileSync(filePath, content);
}

// ── MIME ──
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.json': 'application/json',
};

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

function parseBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => { try { resolve(JSON.parse(b)); } catch(e) { resolve(null); } });
  });
}

function findNodeFile(id) {
  // Handle id@project format (from dedup)
  const atIdx = id.lastIndexOf('@');
  if (atIdx > 0) {
    const origName = id.slice(0, atIdx);
    const projectName = id.slice(atIdx + 1);
    const memDir = path.join(baseDir, projectName, 'memory');
    if (fs.existsSync(memDir)) {
      let files;
      try { files = fs.readdirSync(memDir); } catch(e) { files = []; }
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const fp = path.join(memDir, file);
        try {
          const c = fs.readFileSync(fp, 'utf-8');
          const p = parseFrontmatter(c);
          if (!p) continue;
          if (fmValue(p.lines, 'name') === origName) return fp;
        } catch(e) { continue; }
      }
    }
    return null; // suffixed ID → only search that one project
  }
  // Unsuffixed ID: search all projects, return first match
  if (!fs.existsSync(baseDir)) return null;
  const projects = fs.readdirSync(baseDir);
  for (const project of projects) {
    const memDir = path.join(baseDir, project, 'memory');
    if (!fs.existsSync(memDir)) continue;
    let files;
    try { files = fs.readdirSync(memDir); } catch(e) { continue; }
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const fp = path.join(memDir, file);
      try {
        const c = fs.readFileSync(fp, 'utf-8');
        const p = parseFrontmatter(c);
        if (!p) continue;
        if (fmValue(p.lines, 'name') === id) return fp;
      } catch(e) { continue; }
    }
  }
  return null;
}

// ── Server ──
const MIME_JSON = { 'Content-Type': 'application/json' };

async function handle(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = req.url.split('?')[0];
  const method = req.method;

  // SSE
  if (url === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // GET /api/memories
  if (url === '/api/memories' && method === 'GET') {
    const { nodes, skipped } = scanMemories();
    res.writeHead(200, MIME_JSON);
    res.end(JSON.stringify({ nodes, skipped }));
    return;
  }

  // GET /api/health
  if (url === '/api/health' && method === 'GET') {
    try {
      const scriptsDir = path.join(__dirname, 'scripts');
      const env = { ...process.env, MEMORY_DIR: baseDir };
      const run = (s) => { try { return execSync(`node "${path.join(scriptsDir, s)}"`, { env, encoding: 'utf8', timeout: 10000 }); } catch(e) { return e.stdout || ''; } };
      const valOut = run('validate.js');
      const chkOut = run('check-links.js');
      const orphOut = run('find-orphans.js');
      const valMatch = valOut.match(/(\d+) files?, (\d+) OK, (\d+) issues?/);
      const chkMatch = chkOut.match(/(\d+) files?, (\d+) broken/);
      const orphTotalM = orphOut.match(/(\d+) nodes total/);
      const orphCountM = orphOut.match(/(\d+) orphans/);
      const brokenLinks = Array.from(chkOut.matchAll(/✗\s+([^\n]+)/g)).map(m => m[1].trim());
      const orphans = Array.from(orphOut.matchAll(/○\s+(\S+)\s+\(([^)]+)\)/g)).map(m => ({ id: m[1], file: m[2] }));
      const valTotal = valMatch ? parseInt(valMatch[1]) : 0;
      const valOK = valMatch ? parseInt(valMatch[2]) : 0;
      const valIssues = valMatch ? parseInt(valMatch[3]) : 0;
      const valScore = valTotal > 0 ? Math.round(valOK / valTotal * 100) : 100;
      const brokenCount = chkMatch ? parseInt(chkMatch[2]) : 0;
      const linkScore = Math.max(0, 100 - brokenCount * 20);
      const orphTotal = orphTotalM ? parseInt(orphTotalM[1]) : 0;
      const orphCount = orphCountM ? parseInt(orphCountM[1]) : 0;
      const baseline = Math.max(2, Math.round(orphTotal * 0.1));
      const effective = Math.max(0, orphCount - baseline);
      const orphScore = orphTotal > 0 ? Math.round((1 - effective / orphTotal) * 100) : 100;
      const overall = Math.round((valScore + linkScore + orphScore) / 3);
      // Parse validate issues
      const valIssueLines = [];
      const lines = valOut.split('\n');
      let inIssues = false;
      for (const l of lines) {
        if (l.includes('✗')) { inIssues = true; valIssueLines.push(l.trim()); }
        else if (inIssues && l.trim() && l.includes('  ')) valIssueLines.push(l.trim());
        else if (inIssues && !l.trim()) inIssues = false;
      }
      res.writeHead(200, MIME_JSON);
      res.end(JSON.stringify({ overall, validate: valScore, links: linkScore, orphans: orphScore, brokenLinks, orphansList: orphans, validateIssues: valIssueLines, stats: { total: valTotal, broken: brokenCount, orphanCount: orphCount } }));
    } catch(e) {
      res.writeHead(500, MIME_JSON);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // PATCH /api/memory/:id
  const patchMatch = url.match(/^\/api\/memory\/([^/]+)$/);
  if (patchMatch && method === 'PATCH') {
    const id = patchMatch[1];
    const body = await parseBody(req);
    if (!body) { res.writeHead(400, MIME_JSON); res.end(JSON.stringify({ error: 'Bad JSON' })); return; }

    let filePath;
    // If client sent _file, use it directly
    if (body._file) {
      filePath = body._file;
    } else {
      filePath = findNodeFile(id);
    }

    if (!filePath || !fs.existsSync(filePath)) {
      res.writeHead(404, MIME_JSON);
      res.end(JSON.stringify({ error: 'Memory file not found: ' + id }));
      return;
    }

    try {
      const updates = {};
      if (body.label !== undefined) updates.name = body.label;
      if (body.desc !== undefined) updates.description = body.desc;
      if (body.type !== undefined) updates.type = body.type;
      if (body.body !== undefined) updates.body = body.body;
      if (body.addLinks) updates.addLinks = body.addLinks;
      if (body.removeLinks) updates.removeLinks = body.removeLinks;

      if (Object.keys(updates).length) updateMemoryFile(filePath, updates);

      res.writeHead(200, MIME_JSON);
      res.end(JSON.stringify({ ok: true }));
    } catch(e) {
      res.writeHead(500, MIME_JSON);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // POST /api/memory (create new)
  if (url === '/api/memory' && method === 'POST') {
    const body = await parseBody(req);
    if (!body || !body.id) { res.writeHead(400, MIME_JSON); res.end(JSON.stringify({ error: 'Need id' })); return; }

    // Find the first valid memory directory to write to
    const targetDir = findFirstMemoryDir();
    if (!targetDir) { res.writeHead(500, MIME_JSON); res.end(JSON.stringify({ error: 'No memory directory found' })); return; }

    const filePath = path.join(targetDir, body.id + '.md');
    if (fs.existsSync(filePath)) { res.writeHead(409, MIME_JSON); res.end(JSON.stringify({ error: 'Already exists' })); return; }

    const frontmatter = `---
name: ${body.id}
description: "${body.desc || ''}"
metadata:
  type: ${body.type || 'project'}
---

`;
    const content = frontmatter + (body.body || 'New node.');
    fs.writeFileSync(filePath, content);

    res.writeHead(201, MIME_JSON);
    res.end(JSON.stringify({ ok: true, file: filePath }));
    return;
  }

  // GET /api/backups/:id — list backups for a node
  const backupMatch = url.match(/^\/api\/backups\/([^/]+)$/);
  if (backupMatch && method === 'GET') {
    const id = backupMatch[1];
    const filePath = findNodeFile(id);
    if (!filePath) { res.writeHead(404, MIME_JSON); res.end(JSON.stringify({ error: 'Not found' })); return; }
    const dir = require('path').dirname(filePath);
    const base = require('path').basename(filePath);
    let backups = [];
    try {
      backups = fs.readdirSync(dir)
        .filter(f => f.startsWith(base + '.bak.'))
        .sort()
        .reverse()
        .map(f => ({ file: f, ts: f.replace(base + '.bak.', '') }));
    } catch(e) {}
    res.writeHead(200, MIME_JSON);
    res.end(JSON.stringify(backups));
    return;
  }

  // GET /api/backup/:id/:ts — view a specific backup
  const backupViewMatch = url.match(/^\/api\/backup\/([^/]+)\/([^/]+)$/);
  if (backupViewMatch && method === 'GET') {
    const id = backupViewMatch[1];
    const ts = backupViewMatch[2];
    const filePath = findNodeFile(id);
    if (!filePath) { res.writeHead(404, MIME_JSON); res.end(JSON.stringify({ error: 'Not found' })); return; }
    const bakPath = filePath + '.bak.' + ts;
    try {
      const content = fs.readFileSync(bakPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(content);
    } catch(e) {
      res.writeHead(404, MIME_JSON);
      res.end(JSON.stringify({ error: 'Backup not found' }));
    }
    return;
  }

  // POST /api/backup/restore/:id/:ts — restore a backup
  if (backupViewMatch && method === 'POST') {
    const id = backupViewMatch[1];
    const ts = backupViewMatch[2];
    const filePath = findNodeFile(id);
    if (!filePath) { res.writeHead(404, MIME_JSON); res.end(JSON.stringify({ error: 'Not found' })); return; }
    const bakPath = filePath + '.bak.' + ts;
    try {
      const content = fs.readFileSync(bakPath, 'utf-8');
      backupFile(filePath); // Backup current before restoring
      fs.writeFileSync(filePath, content);
      res.writeHead(200, MIME_JSON);
      res.end(JSON.stringify({ ok: true }));
    } catch(e) {
      res.writeHead(404, MIME_JSON);
      res.end(JSON.stringify({ error: 'Backup not found' }));
    }
    return;
  }

  // DELETE /api/memory/:id
  if (patchMatch && method === 'DELETE') {
    const id = patchMatch[1];
    const filePath = findNodeFile(id);
    if (!filePath) { res.writeHead(404, MIME_JSON); res.end(JSON.stringify({ error: 'Not found' })); return; }

    fs.unlinkSync(filePath);
    res.writeHead(200, MIME_JSON);
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Static files
  let reqPath = url;
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, reqPath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  serveFile(res, filePath);
}

function findFirstMemoryDir() {
  if (!fs.existsSync(baseDir)) return null;
  const projects = fs.readdirSync(baseDir);
  for (const project of projects) {
    const memDir = path.join(baseDir, project, 'memory');
    if (fs.existsSync(memDir)) return memDir;
  }
  return null;
}

// ── Start ──
function tryListen(port, cb) {
  const srv = http.createServer(handle);
  srv.listen(port, '0.0.0.0', () => cb(srv, port));
  srv.on('error', () => { if (!srv.listening) tryListen(port + 1, cb); });
}

tryListen(port, (srv, finalPort) => {
  const { nodes, skipped } = scanMemories();
  const conn = nodes.reduce((s, n) => s + (n.outgoing||[]).length, 0);

  console.log('');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║        claude-mem-viz  v0.1.2         ║');
  console.log('  ╚═══════════════════════════════════════╝');
  console.log('');
  console.log('  Directory:   ' + baseDir);
  console.log('  Memories:    ' + nodes.length + ' files');
  console.log('  Connections: ' + conn);
  if (skipped.length > 0) console.log('  Skipped:     ' + skipped.length + ' files (no frontmatter)');
  console.log('');
  console.log('  Open in browser:');
  console.log('  →  http://localhost:' + finalPort);
  console.log('');

  watchMemories();
  srv.keepAliveTimeout = 0;
});
