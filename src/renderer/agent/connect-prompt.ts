// The two prompts KapeCut copies for the Agent: the Connect prompt and the fix prompt (GLOSSARY).
import { HANDSHAKE } from './status'

const NEXT = {
  'set-up': 'Ask me the format (9:16, 16:9, 1:1), safe zone on or off, and 30 or 60 fps, then ask what the video is about and build the Scenes.',
  ready: 'project.json is set. Ask me what to work on in the video.',
  error: 'project.json has an error, shown in KapeCut. Fix it first, then ask me what to work on in the video.',
}

// A folder name may hold a line break (macOS, Linux): it must not add a line of its own to what the user pastes.
const oneLine = (path: string) => path.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, '?')

/**
 * Where both prompts start: the SKILL.md KapeCut ships, by the absolute path main resolves, so any Agent reads it (ADR
 * 0008). In backticks, as the path may hold spaces; it wins over a copy the Agent installed, which may be older.
 */
const readFirst = (skill: string) =>
  `I'm using KapeCut. Read the KapeCut instructions at \`${oneLine(skill)}\` first, over any older copy you have installed`

/**
 * The Connect prompt (GLOSSARY): what "Connect your agent" copies. It points at the shipped instructions, names the
 * Project folder and the Session file the Agent checks first (ADR 0005), then what to do for the folder's state: set it
 * up, work on the video, or fix project.json.
 */
export const connectPrompt = ({ project, session, skill, state }: { project: string; session: string; skill: string; state: keyof typeof NEXT }) =>
  `${readFirst(skill)}.
${checkFirst(project, session)}
Then write ${HANDSHAKE} in the Project so KapeCut shows you as connected.
${NEXT[state]}`

const checkFirst = (project: string, session: string) => `Project folder (open in KapeCut now): ${oneLine(project)}
Before any work, read ${oneLine(session)} and confirm its "project" is this folder. If it is not, stop, tell me KapeCut has a different Project open and ask me which folder to work in.`

/**
 * The fix prompt (GLOSSARY): what Copy Prompt in the Notes window copies. Same instructions, Project folder and Session
 * file check as the Connect prompt, then fix-notes.md for the open Notes, by number only: Note text stays in notes.json.
 */
export const fixPrompt = ({ project, session, skill, open }: { project: string; session: string; skill: string; open: number[] }) =>
  `${readFirst(skill)}, then follow fix-notes.md next to it.
${checkFirst(project, session)}
Fix these open Notes in notes.json: ${open.join(', ')}. Check each with a still, then mark them done with mark-done.mjs.`
