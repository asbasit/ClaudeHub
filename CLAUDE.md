# ClaudeHub — shared rules for every machine

This file lives in the synced ClaudeHub folder. A SessionStart hook injects it
into every Claude Code session on every machine. Edit it once here; every
machine picks it up on its next session.

## Who I am working for
(Your name, what you work on, your time zone.)

## The machines
At session start a hook tells you which machine you are on (`You are on: X`).
Always know which one you are, and say so if the user seems to be asking about
work done elsewhere.

| Machine  | OS      | Role                                  |
|----------|---------|---------------------------------------|
| DESKTOP  | Windows | Main workstation                      |
| LAPTOP   | Windows | Travel machine                        |
| MAC      | macOS   | Light work, no production accounts    |
| VPS1     | Linux   | Always-on jobs, bots, monitoring      |

Edit the Role column as things change. Machine names here must match the name
used when installing (`node scripts/install.js VPS1`).

## Where the shared context lives
Everything below is inside the ClaudeHub folder:

- `sessions/<MACHINE>/` — automatic snapshots of every Claude Code session,
  written by a hook after each response. One file per session. Read these when
  the user asks "what was I doing on X", "where did I leave Y", or refers to
  work you have no record of in this session.
- `inbox/<MACHINE>.md` — jobs for a specific machine. The user (or another
  machine's Claude) adds a line; the target machine sees it at session start.
- `HANDOFF.md` — the cross-machine "in progress" board.

## Rules
1. When the user refers to earlier work you don't see in this session, check
   `sessions/` (all machines, newest first) before saying you don't know.
   Say which machine and folder the work was on.
2. If the work belongs on a different machine (it needs files, accounts or
   programs that only exist there), say so plainly and offer to drop a job in
   that machine's inbox instead of trying to do it here.
3. When you finish a meaningful piece of work, or stop mid-way, update
   `HANDOFF.md`: one short entry under your machine's heading — what, where
   (folder), status, next step. Replace your machine's old entries rather than
   piling up history. Only edit your own machine's section.
4. When you complete a job from your inbox, move its line from `## Pending`
   to `## Done` with the date.
5. To give another machine a job, append a line under `## Pending` in
   `inbox/<THAT-MACHINE>.md`: `- [YYYY-MM-DD from <YOUR-MACHINE>] task text`.
6. Paths differ between machines (the sync folder may be on another drive, the
   username may differ). Refer to synced files relative to the Dropbox root,
   e.g. `Dropbox/Projects/my-app`, not absolute paths.
7. Never write passwords, API keys, account numbers or logins into any
   ClaudeHub file. It syncs everywhere.
