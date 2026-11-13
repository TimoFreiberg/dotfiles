import { decodeAction } from './action-message.mjs';
import { decodeSave } from './save-message.mjs';
import { handleSave } from './save.mjs';
import { parsePR } from './pr-format.mjs';

// Fish single quotes interpret only escaped backslashes and single quotes.
export const fishQuote = value => `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
export async function handleAction(prompt, target, { run, resolve } = {}) {
  let saved;
  try {
    const action = decodeAction(prompt.prompt);
    if (!target.pr?.repo || !target.pr?.rev || !target.sourceFile) throw new Error('this page has no recorded PR repository, revision, or source file');
    parsePR(decodeSave(action.save).text);
    saved = await handleSave({ prompt: action.save }, target);
    if (saved.reply !== 'Saved') return { ...saved, reply: `${saved.reply} Create PR was not launched.` };
    const terminal = await resolve();
    const space = terminal?.labels?.['herdr.space'];
    if (!space) throw new Error('the target session or terminal is gone, ambiguous, or has no herdr.space; retarget the page before trying again');
    const script = `jprc -r ${fishQuote(target.pr.rev)} --body-file ${fishQuote(target.sourceFile)}`;
    const { stdout } = await run('herdr-app', ['do', 'tab.new', JSON.stringify({ space, folder: target.pr.repo, name: 'Create PR', argv: ['fish', '-c', script] })]);
    const result = JSON.parse(stdout);
    if (result.error) throw new Error(result.error);
    if (result.space !== space || !result.tab || !result.terminal) throw new Error('herdr did not acknowledge opening a terminal in the target space');
    return { ...saved, reply: `Saved. Launched ${script} in ${target.pr.repo}, herdr space ${space}${result.tab ? `, tab ${result.tab}` : ''}. Continue in that terminal; launching is not confirmation that a PR was created.` };
  } catch (error) {
    return { ...(saved || {}), reply: `${saved ? 'Saved. ' : ''}Create PR failed: ${error.stderr?.trim() || error.message}. No successful launch was confirmed; check herdr before retrying.` };
  }
}
