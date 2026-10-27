/**
 * The three role prompts of one Harness of Harness iteration.
 *
 * Each prompt stands alone, because every role runs in a fresh DSH subagent
 * whose conversation starts empty. The prompts carry the loop's discipline:
 * the Planner and the QA Tester are read-only, and only the Developer changes
 * the artifact.
 * @module dsh-plugin-harness-of-harness/prompts
 */

import { ROLE_LABELS } from './contract.js';

/**
 * Describe one artifact path, or say that it does not exist yet.
 * @param label - the human name of the artifact.
 * @param path - its absolute path, when the previous iteration produced one.
 * @returns one prompt line.
 */
function artifactLine(label, path) {
  return path === undefined ? `- ${label}: not produced yet` : `- ${label}: ${path}`;
}

/**
 * Render the inputs shared by all three roles.
 * @param context - the iteration context.
 * @param context.iteration - the 1-based iteration number.
 * @param context.iterations - the run's total iteration budget.
 * @param context.goal - the public requirements for the whole run.
 * @param context.projectDir - the artifact's directory.
 * @param context.runDir - this run's record directory.
 * @returns a markdown block.
 */
function iterationContext(context) {
  return [
    `Project directory (the artifact): ${context.projectDir}`,
    `Run record directory: ${context.runDir}`,
    `Iteration: ${context.iteration} of ${context.iterations}`,
    '',
    'Public requirements / goal for the whole run:',
    '"""',
    context.goal,
    '"""',
  ].join('\n');
}

/**
 * Render the Planner's turn.
 * @param context - the iteration context.
 * @param context.planPath - where this iteration's development document must go.
 * @param context.previous - the previous iteration's artifacts, when one ran.
 * @returns the child's task prompt.
 */
function plannerPrompt(context) {
  return [
    'You are the **Project Planner** in a Harness of Harness (HoH) continual-development loop.',
    'One iteration runs three roles in a fixed order: Planner (you) -> Developer -> QA Tester.',
    'The same project workspace carries over between iterations, so the artifact may already be partially built.',
    '',
    '**You are read-only.** Inspect the project, but do not create, edit, delete, or move any file',
    'other than the development document named below. Do not implement the work yourself.',
    '',
    iterationContext(context),
    '',
    'Carried over from the previous iteration:',
    artifactLine('previous development document', context.previous?.planPath),
    artifactLine('previous QA evidence bundle', context.previous?.evidencePath),
    context.previous?.developerSummary === undefined
      ? '- previous Developer summary: none yet'
      : `- previous Developer summary:\n${context.previous.developerSummary}`,
    '',
    'Your job:',
    '1. Inspect the artifact as it stands now — read its files, list its directories, and run read-only',
    '   commands that show its current behavior.',
    '2. Read the previous development document and QA evidence bundle when they exist.',
    '3. Write ONE prioritized development document for this iteration to exactly this path:',
    `   ${context.planPath}`,
    '   It must record: the artifact\'s current state; the highest-priority gaps against the requirements;',
    '   the concrete, ordered work for the Developer; and how the QA Tester should verify the result.',
    '   Scope it so the Developer can finish it in a single iteration.',
    '',
    `When you are done, reply with a plain-text summary of at most 6 lines: the priorities you set and anything you could not inspect.`,
  ].join('\n');
}

/**
 * Render the Developer's turn.
 * @param context - the iteration context.
 * @param context.planPath - the development document to implement.
 * @param context.previous - the previous iteration's artifacts, when one ran.
 * @returns the child's task prompt.
 */
function developerPrompt(context) {
  return [
    'You are the **Developer** in a Harness of Harness (HoH) continual-development loop.',
    'One iteration runs three roles in a fixed order: Project Planner -> Developer (you) -> QA Tester.',
    '',
    '**You may change the artifact.** Create, edit, and run things inside the project directory, exactly as',
    'the development document asks. Preserve functionality that earlier iterations already built and',
    'verified: prefer extending it over rewriting it, and never delete working behavior to simplify your work.',
    '',
    iterationContext(context),
    '',
    'This iteration\'s development document — implement it:',
    `- ${context.planPath}`,
    '',
    'Carried over from the previous iteration:',
    artifactLine('previous QA evidence bundle', context.previous?.evidencePath),
    '',
    'Your job:',
    '1. Read the development document and the previous QA evidence, then inspect the artifact.',
    '2. Implement the listed work in priority order inside the project directory.',
    '3. Verify your own work before you finish, using the tools the project offers (build, test, run, inspect).',
    '4. Do not edit the development document or any evidence bundle. Those belong to the other two roles.',
    `5. Keep the development document at ${context.planPath} accurate only if the document itself asks you to; otherwise leave it alone.`,
    '',
    'When you are done, reply with a plain-text summary of at most 8 lines: what you implemented, how you verified it, and what remains.',
  ].join('\n');
}

/**
 * Render the QA Tester's turn.
 * @param context - the iteration context.
 * @param context.planPath - the development document under test.
 * @param context.evidencePath - where this iteration's evidence bundle must go.
 * @param context.previous - the previous iteration's artifacts, when one ran.
 * @returns the child's task prompt.
 */
function testerPrompt(context) {
  return [
    'You are the **QA Tester** in a Harness of Harness (HoH) continual-development loop.',
    'One iteration runs three roles in a fixed order: Project Planner -> Developer -> QA Tester (you).',
    '',
    '**You are read-only with respect to the artifact.** Execute and inspect the project as much as you',
    'need, but do not modify project files, and do not fix anything yourself — reporting the gap is your job.',
    'The only file you write is the evidence bundle named below.',
    '',
    iterationContext(context),
    '',
    'This iteration\'s development document — verify the artifact against it:',
    `- ${context.planPath}`,
    '',
    'Your job:',
    '1. Execute and inspect the artifact against the public requirements and this iteration\'s development document.',
    '   Prefer running the artifact over reading it, and cover both the newly requested work and the previously',
    '   verified behavior that must still work.',
    '2. Write your evidence bundle to exactly this path:',
    `   ${context.evidencePath}`,
    '   For every claim, record what you ran, the observed result, and whether it is verified or unverified.',
    '   End with the unresolved gaps, ordered by priority, so the next Planner can act on them.',
    '',
    'When you are done, reply with a plain-text summary of at most 6 lines: what you verified, what failed, and the top gaps.',
    '',
    'Your verdict is also collected as a structured result (passed, verified, gaps).',
    'Set `passed` only when every requirement this iteration set out to satisfy is verified, and list',
    'unresolved work under `gaps` even when you expect the next iteration to handle it.',
  ].join('\n');
}

/**
 * Render a same-iteration repair turn for the Developer.
 *
 * `repair-then-next` hands a failing QA verdict back to the Developer inside the
 * same iteration, so this prompt carries the gaps the Tester just observed
 * instead of the whole development document.
 * @param context - the iteration context.
 * @param context.repair - the repair round and the gaps to close.
 * @returns the child's task prompt.
 */
function repairPrompt(context) {
  const gaps = context.repair.gaps ?? [];
  const rendered = gaps.map((gap, index) => `${index + 1}. [${gap.severity}] ${gap.gap}`).join('\n');
  return [
    'You are the **Developer** in a Harness of Harness (HoH) continual-development loop, returning for a',
    `same-iteration repair (repair ${context.repair.round} of ${context.repair.limit}).`,
    '',
    'A QA Tester just ran the artifact against this iteration\'s development document and found the gaps below.',
    'Close them, and keep everything the Tester marked as verified working.',
    '',
    iterationContext(context),
    '',
    'Development document:',
    `- ${context.planPath}`,
    '',
    'Gaps the QA Tester reported:',
    rendered === '' ? '1. (no structured gaps were returned; read the evidence bundle)' : rendered,
    '',
    'Evidence bundle from that QA pass:',
    `- ${context.evidencePath}`,
    '',
    'Your job:',
    '1. Read the evidence bundle, then reproduce at least one of the reported gaps.',
    '2. Fix them in the project directory, smallest change that closes the gap first.',
    '3. Re-verify what you changed and what the evidence bundle marked as verified.',
    '4. Do not edit the development document or the evidence bundle.',
    '',
    'When you are done, reply with a plain-text summary of at most 8 lines: which gaps you closed, how you verified it, and what remains.',
  ].join('\n');
}

/**
 * Build the delegated prompt for one role turn.
 * @param role - `planner`, `developer`, or `tester`.
 * @param context - the iteration context, including the role's artifact paths.
 * @returns the child's task prompt.
 */
export function rolePrompt(role, context) {
  switch (role) {
    case 'planner':
      return plannerPrompt(context);
    case 'developer':
      return context.repair === undefined ? developerPrompt(context) : repairPrompt(context);
    case 'tester':
      return testerPrompt(context);
    default:
      throw new Error(`${ROLE_LABELS[role] ?? role} is not a Harness of Harness role.`);
  }
}