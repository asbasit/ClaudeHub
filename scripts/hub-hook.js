#!/usr/bin/env node
// ClaudeHub hook — runs on SessionStart ("start") and Stop ("stop").
//   start: prints machine identity, this machine's inbox, HANDOFF.md and the
//          latest sessions from other machines. Claude Code adds stdout to context.
//   stop:  writes/refreshes a snapshot of the current session into
//          ClaudeHub/sessions/<MACHINE>/. No AI calls, no network, never blocks.
// Config comes from ~/.claude/claudehub.json written by install.js.

const fs = require('fs');
const path = require('path');
const os = require('os');

const MODE = process.argv[2] || 'stop';
const KEEP_DAYS = 30;          // prune own snapshots older than this
const OTHER_SESSIONS = 8;      // how many recent sessions to list at start
const HANDOFF_MAX = 4000;      // chars of HANDOFF.md to inject

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function loadConfig() {
  const p = path.join(os.homedir(), '.claude', 'claudehub.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b && b.type === 'text').map(b => b.text || '').join('\n');
}

function oneLine(s, n) {
  s = (s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function parseTranscript(file) {
  const out = { prompts: [], lastAssistant: '', files: new Set(), firstTs: null, lastTs: null };
  const raw = safe(() => fs.readFileSync(file, 'utf8'), '');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const e = safe(() => JSON.parse(line), null);
    if (!e || !e.message) continue;
    if (e.timestamp) { out.firstTs = out.firstTs || e.timestamp; out.lastTs = e.timestamp; }
    const c = e.message.content;
    if (e.type === 'user') {
      // skip tool results and command noise; keep real typed prompts
      const t = textOf(c);
      const isToolResult = Array.isArray(c) && c.some(b => b && b.type === 'tool_result');
      if (t && !isToolResult && !t.startsWith('<')) out.prompts.push(t);
    } else if (e.type === 'assistant') {
      const t = textOf(c);
      if (t) out.lastAssistant = t;
      if (Array.isArray(c)) for (const b of c) {
        if (b && b.type === 'tool_use' && b.input) {
          const fp = b.input.file_path || b.input.notebook_path;
          if (fp && /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(b.name || '')) out.files.add(fp);
        }
      }
    }
  }
  return out;
}

function dropboxRelative(p) {
  if (!p) return p;
  const i = p.toLowerCase().replace(/\\/g, '/').indexOf('/dropbox/');
  return i >= 0 ? 'Dropbox/' + p.replace(/\\/g, '/').slice(i + 9) : p;
}

function stop(cfg, input) {
  const sid = (input.session_id || 'unknown').slice(0, 8);
  const dir = path.join(cfg.hub, 'sessions', cfg.machine);
  fs.mkdirSync(dir, { recursive: true });

  const t = input.transcript_path ? parseTranscript(input.transcript_path) : null;
  if (!t || t.prompts.length === 0) return;

  const day = (t.firstTs || new Date().toISOString()).slice(0, 10);
  const file = path.join(dir, `${day}_${sid}.md`);
  const first = t.prompts[0];
  const recent = t.prompts.slice(-5);
  const files = [...t.files].map(dropboxRelative).slice(-25);

  const md = [
    '---',
    `machine: ${cfg.machine}`,
    `session: ${input.session_id || ''}`,
    `folder: ${dropboxRelative(input.cwd || '')}`,
    `started: ${t.firstTs || ''}`,
    `updated: ${t.lastTs || new Date().toISOString()}`,
    `prompts: ${t.prompts.length}`,
    `topic: ${JSON.stringify(oneLine(first, 120))}`,
    '---',
    '',
    `## First request`,
    oneLine(first, 600),
    '',
    `## Latest requests`,
    ...recent.map(p => `- ${oneLine(p, 300)}`),
    '',
    `## Files written or edited`,
    ...(files.length ? files.map(f => `- ${f}`) : ['- (none)']),
    '',
    `## Last reply from Claude`,
    oneLine(t.lastAssistant, 1200),
    '',
    `_To resume on ${cfg.machine}: cd to the folder above, run \`claude --resume ${input.session_id || ''}\`_`,
    ''
  ].join('\n');
  fs.writeFileSync(file, md);

  // prune old snapshots for this machine only
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  for (const f of safe(() => fs.readdirSync(dir), [])) {
    const fp = path.join(dir, f);
    const st = safe(() => fs.statSync(fp), null);
    if (st && st.mtimeMs < cutoff) safe(() => fs.unlinkSync(fp));
  }
}

function frontmatter(file) {
  const raw = safe(() => fs.readFileSync(file, 'utf8'), '').replace(/\r\n/g, '\n');
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  const o = {};
  if (m) for (const l of m[1].split('\n')) {
    const k = l.indexOf(':');
    if (k > 0) o[l.slice(0, k).trim()] = l.slice(k + 1).trim();
  }
  return o;
}

function start(cfg) {
  const lines = [];
  lines.push(`[ClaudeHub] You are on: ${cfg.machine}. Shared hub folder: ${cfg.hub}`);
  const rules = safe(() => fs.readFileSync(path.join(cfg.hub, 'CLAUDE.md'), 'utf8'), '');
  if (rules) lines.push('', rules.trim());

  const inbox = safe(() => fs.readFileSync(path.join(cfg.hub, 'inbox', `${cfg.machine}.md`), 'utf8'), '').replace(/\r\n/g, '\n');
  const pending = (inbox.split('## Done')[0].split('## Pending')[1] || '')
    .split('\n').filter(l => l.trim().startsWith('- '));
  if (pending.length) {
    lines.push('', `Pending jobs in this machine's inbox (tell the user about these):`);
    lines.push(...pending);
  }

  const handoff = safe(() => fs.readFileSync(path.join(cfg.hub, 'HANDOFF.md'), 'utf8'), '');
  if (handoff.replace(/^#.*$/gm, '').trim()) {
    lines.push('', 'HANDOFF.md:', handoff.slice(0, HANDOFF_MAX));
  }

  const sessRoot = path.join(cfg.hub, 'sessions');
  const all = [];
  for (const m of safe(() => fs.readdirSync(sessRoot), [])) {
    const d = path.join(sessRoot, m);
    for (const f of safe(() => fs.readdirSync(d), [])) {
      if (!f.endsWith('.md')) continue;
      const fp = path.join(d, f);
      const st = safe(() => fs.statSync(fp), null);
      if (st) all.push({ fp, m, t: st.mtimeMs });
    }
  }
  all.sort((a, b) => b.t - a.t);
  const recent = all.slice(0, OTHER_SESSIONS);
  if (recent.length) {
    lines.push('', 'Most recent Claude Code sessions across all machines (full files in ClaudeHub/sessions/):');
    for (const r of recent) {
      const fm = frontmatter(r.fp);
      let topic = fm.topic || '';
      try { topic = JSON.parse(topic); } catch {}
      lines.push(`- ${r.m} | ${(fm.updated || '').slice(0, 16).replace('T', ' ')} | ${fm.folder || ''} | ${oneLine(topic, 90)}`);
    }
  }
  process.stdout.write(lines.join('\n') + '\n');
}

(function main() {
  const cfg = loadConfig();
  if (!cfg || !cfg.hub || !cfg.machine) return; // not installed: stay silent
  const input = safe(() => JSON.parse(readStdin() || '{}'), {});
  try {
    if (MODE === 'start') start(cfg);
    else stop(cfg, input);
  } catch (e) {
    // never break Claude Code because of the hub
    process.stderr.write(`[ClaudeHub] ${e.message}\n`);
  }
  process.exit(0);
})();
