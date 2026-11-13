import { decodeAction } from './action-message.mjs';
import { saveDocument } from './save.mjs';
import { parsePR } from './pr-format.mjs';

// Fish single quotes interpret only escaped backslashes and single quotes.
export const fishQuote = value => `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
export async function handleAction(prompt, target, { run, resolve, state = {}, checkpoint = async () => {}, recovering = false } = {}) {
  let saved, space, script;
  try {
    const action = decodeAction(prompt.prompt);
    if (!target.pr?.repo || !target.pr?.rev || !target.sourceFile) throw new Error('this page has no recorded PR repository, revision, or source file');
    parsePR(action.save.text);
    saved = state.saved || await saveDocument(action.save, target, { recovering });
    if (saved.reply !== 'Saved') return { ...saved, reply: `${saved.reply} Create PR was not launched.` };
    if (state.launchAttempted) return { ...saved, reply: 'Saved. Create PR launch was interrupted or its acknowledgement was not persisted. It will not be launched again automatically. Check herdr for the Create PR terminal before submitting a new action.' };
    const terminal = await resolve();
    space = terminal?.labels?.['herdr.space'];
    if (!space) throw new Error('the target session or terminal is gone, ambiguous, or has no herdr.space; retarget the page before trying again');
    script = `jprc -r ${fishQuote(target.pr.rev)} --body-file ${fishQuote(target.sourceFile)}`;
  } catch (error) {
    return { ...(saved || {}), reply: `${saved ? 'Saved. ' : ''}Create PR failed: ${error.stderr?.trim() || error.message}. No successful launch was confirmed; check herdr before retrying.` };
  }
  // Persist before the external command. A crash may prevent the launch, but
  // restart must not open a second terminal after an unrecorded acknowledgement.
  // Persistence failures propagate to the batch retry, not a handler reply.
  await checkpoint({ saved, launchAttempted: true });
  try {
    const { stdout } = await run('herdr-app', ['do', 'tab.new', JSON.stringify({ space, folder: target.pr.repo, name: 'Create PR', argv: ['fish', '-c', script] })]);
    const result = JSON.parse(stdout);
    if (result.error) throw new Error(result.error);
    if (result.space !== space || !result.tab || !result.terminal) throw new Error('herdr did not acknowledge opening a terminal in the target space');
    return { ...saved, reply: `Saved. Launched ${script} in ${target.pr.repo}, herdr space ${space}, tab ${result.tab}. Continue in that terminal; launching is not confirmation that a PR was created.` };
  } catch (error) {
    return { ...saved, reply: `Saved. Create PR failed: ${error.stderr?.trim() || error.message}. No successful launch was confirmed; check herdr before retrying.` };
  }
}
