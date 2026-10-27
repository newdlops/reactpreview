/** The authored page corridor must not disappear when a lower-ranked large file finishes first. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { collectPreviewInspectorFastPageCorridor } from '../../../../src/adapters/esbuild/inspector/previewInspectorFastPageCorridor';

const WORKSPACE = '/virtual/preview-admission-fixture';
const TARGET = WORKSPACE + '/src/components/Target.tsx';
const PREFERRED = WORKSPACE + '/src/pages/target-page.tsx';
const UNRELATED = WORKSPACE + '/src/pages/unrelated-page.tsx';
const MEBIBYTE = 1024 * 1024;

/** Pads inert JSX with a comment so the real byte budget is exercised without evaluating code. */
function padSource(sourceText: string, byteLength: number): string {
  return sourceText + '/*' + 'x'.repeat(byteLength - Buffer.byteLength(sourceText) - 4) + '*/';
}

for (const finishUnrelatedFirst of [false, true]) {
  it(`retains the target-affine page when finishUnrelatedFirst=${String(finishUnrelatedFirst)}`, async () => {
    const sources = new Map([
      [TARGET, 'export default function Target(){return <button>target</button>}'],
      [
        PREFERRED,
        padSource(
          'import Target from "../components/Target";import "./target-page.css";export default function TargetPage(){return <main><Target/></main>}',
          3 * MEBIBYTE,
        ),
      ],
      [
        UNRELATED,
        padSource(
          'export default function UnrelatedPage(){return <aside>unrelated</aside>}',
          4 * MEBIBYTE,
        ),
      ],
    ]);
    const pending = new Map<string, (value: string) => void>();
    const calls: string[] = [];
    let reportStarted: (() => void) | undefined;
    const bothStarted = new Promise<void>((resolve) => {
      reportStarted = resolve;
    });
    const task = collectPreviewInspectorFastPageCorridor({
      additionalSourcePaths: [...sources.keys()],
      documentPath: TARGET,
      projectRoot: WORKSPACE,
      workspaceRoot: WORKSPACE,
      readSource: (sourcePath) => {
        calls.push(sourcePath);
        if (sourcePath !== PREFERRED && sourcePath !== UNRELATED) {
          return Promise.resolve(sources.get(sourcePath));
        }
        return new Promise((resolve) => {
          pending.set(sourcePath, resolve);
          if (pending.size === 2) {
            assert(reportStarted);
            reportStarted();
          }
        });
      },
      resolveModule: (specifier, consumerPath) => {
        const lexicalPath = path.resolve(path.dirname(consumerPath), specifier);
        return [lexicalPath, lexicalPath + '.tsx'].find((candidate) => sources.has(candidate));
      },
    });
    await bothStarted;
    expect(calls.indexOf(PREFERRED)).toBeLessThan(calls.indexOf(UNRELATED));
    const completionOrder = finishUnrelatedFirst ? [UNRELATED, PREFERRED] : [PREFERRED, UNRELATED];
    for (const sourcePath of completionOrder) {
      const complete = pending.get(sourcePath);
      const text = sources.get(sourcePath);
      assert(complete && text !== undefined);
      complete(text);
      await yieldTurn();
    }
    const corridor = await task;
    expect(corridor?.importPath).toEqual([PREFERRED, TARGET]);
    expect(corridor?.sourcePaths).toEqual([TARGET, PREFERRED].sort());
    expect(corridor?.truncated).toBe(false);
  });
}
