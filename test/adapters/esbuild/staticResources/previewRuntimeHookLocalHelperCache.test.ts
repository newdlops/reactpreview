/** Proves syntax indexes are shared by AST identity without changing bounded helper inference. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  collectPreviewRuntimeLocalHelperArgumentDemands,
  collectPreviewRuntimeLocalHelperParameterDemands,
} from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookLocalHelperItem';

/** Parses one immutable tree and obtains its top-level callback declaration. */
function parseHelperSource(source: string): {
  readonly callback: ts.FunctionDeclaration;
  readonly file: ts.SourceFile;
} {
  const file = ts.createSourceFile('/workspace/Helpers.ts', source, ts.ScriptTarget.Latest, true);
  const callback = file.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === 'callback',
  );
  if (callback === undefined) throw new Error('Fixture callback is missing.');
  return { callback, file };
}

describe('local helper syntax index reuse', () => {
  it('walks a source tree once across parameter and argument demand requests', () => {
    const { file, callback } = parseHelperSource(`
      function helper(value) { return value.profile.name; }
      function callback(item) { return helper(item); }
    `);
    let sourceWalks = 0;
    const observed = new Proxy(file, {
      get(target, property, receiver): unknown {
        if (property === 'statements') sourceWalks += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const first = collectPreviewRuntimeLocalHelperParameterDemands(callback, 'item', observed);
    expect(first).toHaveLength(1);
    const initialWalks = sourceWalks;
    expect(initialWalks).toBeGreaterThan(0);
    for (let index = 0; index < 40; index += 1) {
      expect(collectPreviewRuntimeLocalHelperParameterDemands(callback, 'item', observed)).toEqual(
        first,
      );
      expect(collectPreviewRuntimeLocalHelperArgumentDemands(callback, observed)).toHaveLength(1);
    }
    expect(sourceWalks).toBe(initialWalks);
  });

  it('never reuses a prior editor revision or another tree with the same path', () => {
    const before = parseHelperSource(
      'function helper(value) {} function callback(item) { helper(item); }',
    );
    const after = parseHelperSource(
      'function changed(value) {} function callback(item) { changed(item); }',
    );
    const oldDemand = collectPreviewRuntimeLocalHelperParameterDemands(
      before.callback,
      'item',
      before.file,
    );
    const newDemand = collectPreviewRuntimeLocalHelperParameterDemands(
      after.callback,
      'item',
      after.file,
    );
    expect(oldDemand[0]?.owner).not.toBe(newDemand[0]?.owner);
    expect(newDemand[0]?.owner.getText(after.file)).toContain('changed');
  });

  it('preserves ambiguity rejection, cycles, and deferred callback boundaries on cache hits', () => {
    const ambiguous = parseHelperSource(`
      function helper(value) {} function outer() { function helper(value) {} }
      function callback(item) { helper(item); }
    `);
    const cyclic = parseHelperSource(`
      function left(value) { right(value); }
      function right(value) { left(value); }
      function callback(item) { left(item); setTimeout(() => right(item)); }
    `);
    for (let index = 0; index < 2; index += 1) {
      expect(
        collectPreviewRuntimeLocalHelperParameterDemands(
          ambiguous.callback,
          'item',
          ambiguous.file,
        ),
      ).toEqual([]);
      expect(
        collectPreviewRuntimeLocalHelperParameterDemands(cyclic.callback, 'item', cyclic.file),
      ).toHaveLength(2);
      expect(
        collectPreviewRuntimeLocalHelperArgumentDemands(cyclic.callback, cyclic.file),
      ).toHaveLength(1);
    }
  });
});
