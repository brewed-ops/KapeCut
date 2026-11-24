# 0005 Claude's presence comes from files: a session file, a handshake and the folder watch

**Claude Code has no live link to KapeCut.** They already talk only through files in the Project (ADR 0003, 0004), and
presence keeps it that way: no socket, no server, no MCP.

**The session file says which Project is open.** KapeCut writes `session.json` in its app data folder each time a
Project opens: `{ version: 1, project }`, `project` being the folder's absolute path. Both prompts KapeCut copies name
this file and the Project folder. Before any job Claude reads it, and when `project` is not the folder it is about to
work in, it stops and tells the user KapeCut has another Project open. The file sits outside every Project because
it is about the app, not one video, and a Project shared by someone else must not be able to claim it is open.

**The handshake says Claude is connected.** Right after the check Claude writes `.kapecut/claude.json` in the Project
(`{ version: 1, connected }`, an ISO time). The dot folder keeps it out of Files and out of the Project's own content.
KapeCut shows "Claude connected" once the file exists, also when the Project is opened again later.

**Activity is the folder watch.** Once connected, any change in the Project that the app did not write itself (the
same events that reload Scenes and Files), and any input in the app window, set the status to active. With neither for
the idle time (15 minutes by default, set in Settings) it turns idle; the next one turns it active again. So a user
copying files in by hand also counts, which is what "the user is working on it again" means. A Project just opened with
a handshake starts idle until the first activity.

Considered: a Claude Code hook that touches a heartbeat file on every tool call (precise, but it edits the user's
Claude settings), Claude running a heartbeat script at each step (easy to forget mid-task), and treating the first
file Claude writes as the connection (no state between "pasted the prompt" and "started building").
