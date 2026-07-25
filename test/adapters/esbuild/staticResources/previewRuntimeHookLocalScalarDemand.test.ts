/**
 * Verifies bounded scalar-domain inference through direct, same-file helper calls.
 *
 * Fixtures intentionally use generic names so the analyzer is tested as a syntax policy rather than
 * against one application's hook, route, or workflow vocabulary.
 */
import { describe, expect, it } from 'vitest';
import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';

describe('preview runtime local scalar demand', () => {
  /** Coordinates a scalar switch case with the neutral branch of a sibling Boolean argument. */
  it('selects a case from the reachable helper branch', () => {
    const source = [
      `import { useWorkflowContext } from './workflow-context';`,
      'function getStageIndex(stage, alternateBranch) {',
      '  if (alternateBranch) {',
      '    switch (stage) { case "extended": return 1; case "shared": return 2; }',
      '  } else {',
      '    switch (stage) { case "basic": return 1; case "shared": return 2; }',
      '  }',
      '  throw new Error("unreachable");',
      '}',
      'export function Steps() {',
      '  const { workflow: { stage, alternateBranch } } = useWorkflowContext();',
      '  return <span>{getStageIndex(stage, alternateBranch)}</span>;',
      '}',
    ].join('\n');

    const transformed = applyReplacements(source);

    expect(transformed).toContain('"stage": "basic"');
    expect(transformed).toContain('"alternateBranch": false');
    expect(transformed).toContain('"fallbackLabel":"generated object fields"');
    expect(transformed).toContain('"requiredPaths":["workflow.stage","workflow.alternateBranch"]');
  });

  /** Uses a same-file literal alias after crossing more than one direct helper parameter. */
  it('follows a bounded helper chain and rejects an equality-exit union member', () => {
    const source = [
      `import { usePhase } from './workflow-hooks';`,
      'type Phase = "draft" | "ready";',
      'function validate(phase: Phase) {',
      '  if (phase === "draft") throw new Error("not ready");',
      '  return phase;',
      '}',
      'function forward(phase: Phase) { return validate(phase); }',
      'export function Status() {',
      '  const phase = usePhase();',
      '  return <span>{forward(phase)}</span>;',
      '}',
    ].join('\n');

    expect(applyReplacements(source)).toContain('() => ("ready")');
  });

  /** Makes a local inequality guard false by supplying its exact authored scalar. */
  it('uses the accepted side of a helper inequality guard', () => {
    const source = [
      `import { useMode } from './mode-hook';`,
      'function assertMode(mode) {',
      '  if (mode !== "ready") throw new Error("not ready");',
      '  return mode;',
      '}',
      'export function Panel() {',
      '  const mode = useMode();',
      '  return <span>{assertMode(mode)}</span>;',
      '}',
    ].join('\n');

    expect(applyReplacements(source)).toContain('() => ("ready")');
  });

  /** Coordinates a sibling Boolean with a helper guard that must be passed before its switch. */
  it('chooses a Boolean that avoids a local helper early exit', () => {
    const source = [
      `import { useAccessContext } from './access-context';`,
      'function readIndex(stage, hasAccess) {',
      '  if (hasAccess) {',
      '    switch (stage) { case "ready": return 1; case "done": return 2; }',
      '  } else { throw new Error("denied"); }',
      '  throw new Error("unreachable");',
      '}',
      'export function Content() {',
      '  const { stage, hasAccess } = useAccessContext();',
      '  return <span>{readIndex(stage, hasAccess)}</span>;',
      '}',
    ].join('\n');

    const transformed = applyReplacements(source);

    expect(transformed).toContain('"stage": "ready"');
    expect(transformed).toContain('"hasAccess": true');
  });

  /** Does not downgrade an object-semantic binding merely because a helper checks its truthiness. */
  it('preserves a semantic container across a helper truthiness test', () => {
    const source = [
      `import { useData } from './data-hook';`,
      'function inspect(value) { if (value) return "available"; return "missing"; }',
      'export function Summary() {',
      '  const data = useData();',
      '  return <span>{inspect(data)}</span>;',
      '}',
    ].join('\n');

    expect(applyReplacements(source)).toContain('() => (Object.freeze({}))');
  });
});

/** Applies source edits with the production transformer's right-to-left offset discipline. */
function applyReplacements(source: string): string {
  let transformed = source;
  const replacements = createPreviewRuntimeHookReplacements('/workspace/Fixture.tsx', source);
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    transformed = `${transformed.slice(0, replacement.start)}${replacement.replacement}${transformed.slice(replacement.end)}`;
  }
  return transformed;
}
