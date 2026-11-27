# 0008 Any Agent works: the prompts point at the instructions KapeCut ships

**KapeCut no longer needs Claude Code.** Codex, OpenCode or any Agent that reads and writes files can build and fix
Scenes. Setup passes when any known Agent is on PATH (Claude Code stays the suggested install), and the header shows
the Agent status, not the Claude status.

**The instructions travel by path, not by install.** The Connect prompt and the Fix prompt open with "Read the KapeCut
instructions at `<install folder>/skills/kapecut/SKILL.md` first". The app ships that folder unpacked (`asar: false`),
so every Agent can read it and it always matches the installed version. Installing the skill into `~/.claude/skills`
stays as an optional extra for Claude Code, no longer a Setup requirement.

**The handshake is `.kapecut/agent.json`.** KapeCut still reads `.kapecut/claude.json`, so Projects connected before
this change stay connected (ADR 0005 otherwise unchanged).

Considered: writing an `AGENTS.md` into every Project folder (most Agents read it on their own, but it puts KapeCut's
files in the user's Project, can clash with their own `AGENTS.md`, and goes stale when the app updates), and one skill
install per Agent (each has its own folder and format, and new Agents keep appearing).

Agent output still depends on the model behind it, so KapeCut says so next to the Connect button and on the website.
