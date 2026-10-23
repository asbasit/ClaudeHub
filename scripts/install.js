#!/usr/bin/env node
// ClaudeHub installer. Run once per machine, from the ClaudeHub folder in Dropbox:
//   node scripts/install.js LAPTOP          install / re-install as LAPTOP
//   node scripts/install.js --uninstall     remove the hooks from this machine
// Safe to re-run. Backs up ~/.claude/settings.json before changing it.

const fs = require('fs');
const path = require('path');
const os = require('os');

const HUB = path.resolve(__dirname, '..').replace(/\\/g, '/');
const HOOK = `${HUB}/scripts/hub-hook.js`;
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const CFG = path.join(CLAUDE_DIR, 'claudehub.json');
const MARK = 'hub-hook.js';

function readJson(p) {
  if (!fs.existsSync(p)) return {};
  const raw = fs.readFileSync(p, 'utf8').replace(/^﻿/, '').trim();
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { console.error(`Could not parse ${p}. Fix or remove it, then re-run.`); process.exit(1); }
}

function stripOurHooks(settings) {
  if (!settings.hooks) return settings;
  for (const ev of Object.keys(settings.hooks)) {
    settings.hooks[ev] = (settings.hooks[ev] || [])
      .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !(h.command || '').includes(MARK)) }))
      .filter(g => g.hooks.length > 0);
    if (settings.hooks[ev].length === 0) delete settings.hooks[ev];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return settings;
}

function backup() {
  if (fs.existsSync(SETTINGS)) {
    const b = `${SETTINGS}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(SETTINGS, b);
    console.log(`Backed up settings.json -> ${b}`);
  }
}

const arg = (process.argv[2] || '').trim();

if (arg === '--uninstall') {
  backup();
  const s = stripOurHooks(readJson(SETTINGS));
  fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n');
  if (fs.existsSync(CFG)) fs.unlinkSync(CFG);
  console.log('ClaudeHub hooks removed from this machine. Hub files in Dropbox are untouched.');
  process.exit(0);
}

if (!arg || !/^[A-Za-z0-9_-]{2,20}$/.test(arg)) {
  console.log('Usage: node scripts/install.js <MACHINE-NAME>   e.g. DESKTOP, LAPTOP, MAC, VPS1');
  process.exit(1);
}
const MACHINE = arg.toUpperCase();

fs.mkdirSync(CLAUDE_DIR, { recursive: true });

// 1. machine config
fs.writeFileSync(CFG, JSON.stringify({ machine: MACHINE, hub: HUB }, null, 2) + '\n');
console.log(`Wrote ${CFG}  (machine=${MACHINE})`);

// 2. hooks in settings.json (merge, never clobber)
backup();
const settings = stripOurHooks(readJson(SETTINGS));
settings.hooks = settings.hooks || {};
const cmd = mode => `node "${HOOK}" ${mode}`;
(settings.hooks.SessionStart = settings.hooks.SessionStart || [])
  .push({ hooks: [{ type: 'command', command: cmd('start'), timeout: 15 }] });
(settings.hooks.Stop = settings.hooks.Stop || [])
  .push({ hooks: [{ type: 'command', command: cmd('stop'), timeout: 15 }] });
fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
console.log(`Added SessionStart + Stop hooks to ${SETTINGS}`);

// 3. this machine's folders in the hub
fs.mkdirSync(path.join(HUB, 'sessions', MACHINE), { recursive: true });
const inbox = path.join(HUB, 'inbox', `${MACHINE}.md`);
fs.mkdirSync(path.dirname(inbox), { recursive: true });
if (!fs.existsSync(inbox)) {
  fs.writeFileSync(inbox,
`# Inbox: ${MACHINE}

Jobs for ${MACHINE}. Add a line under Pending; ${MACHINE}'s Claude sees it at session start.
Format: - [YYYY-MM-DD from WHO] task

## Pending

## Done
`);
  console.log(`Created ${inbox}`);
}

// 4. self-test
const { execFileSync } = require('child_process');
try {
  const out = execFileSync(process.execPath, [HOOK.replace(/\//g, path.sep), 'start'], { input: '{}', encoding: 'utf8' });
  console.log('\nSelf-test OK. First line Claude will see at session start:');
  console.log('  ' + out.split('\n')[0]);
} catch (e) {
  console.log('\nSelf-test failed: ' + e.message);
}

console.log(`\nDone. Start a new Claude Code session on ${MACHINE} and ask: "which machine are you on?"`);
