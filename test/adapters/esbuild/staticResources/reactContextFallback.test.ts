/**
 * Verifies the syntax-only React Context fallback independently from the broader source transformer.
 * Tests apply returned ranges themselves so replacement boundaries and generated values stay visible.
 */
import { describe, expect, it } from 'vitest';
import {
  createReactContextFallbackReplacements,
  type ReactContextFallbackReplacement,
} from '../../../../src/adapters/esbuild/staticResources/reactContextFallback';

describe('createReactContextFallbackReplacements', () => {
  /** Replaces the application pattern that otherwise dereferences an undefined Context default. */
  it('creates a neutral object for a named React createContext import', () => {
    const source = [
      "import { createContext } from 'react';",
      'export const DocumentTitleContext = createContext<{',
      '  title: string;',
      '  setTitle: (newTitle: string) => void;',
      '}>(undefined as any);',
    ].join('\n');

    const replacements = createReactContextFallbackReplacements('/workspace/context.tsx', source);
    const rewritten = applyReplacements(source, replacements);

    expect(replacements).toHaveLength(1);
    expect(replacements[0]).toMatchObject({
      end: source.lastIndexOf('undefined as any') + 'undefined as any'.length,
      start: source.lastIndexOf('undefined as any'),
    });
    expect(rewritten).toContain(`>((({ "title": '', "setTitle": () => undefined }) as any));`);
  });

  /** Recognizes named aliases plus namespace and default React object imports. */
  it('classifies supported React import shapes without module resolution', () => {
    const source = [
      "import React, { createContext as makeContext } from 'react';",
      "import * as ReactNamespace from 'react';",
      'const direct = makeContext<{ ready: boolean }>(null);',
      'const namespaced = ReactNamespace.createContext<{ count: number }>(void 0);',
      'const defaulted = React.createContext<{ label: string }>((undefined as unknown) as any);',
      'void direct; void namespaced; void defaulted;',
    ].join('\n');

    const rewritten = rewrite('/workspace/imports.tsx', source);

    expect(createReactContextFallbackReplacements('/workspace/imports.tsx', source)).toHaveLength(
      3,
    );
    expect(rewritten).toContain(`makeContext<{ ready: boolean }>((({ "ready": false }) as any))`);
    expect(rewritten).toContain(
      `ReactNamespace.createContext<{ count: number }>((({ "count": 0 }) as any))`,
    );
    expect(rewritten).toContain(
      `React.createContext<{ label: string }>((({ "label": '' }) as any))`,
    );
  });

  /** Builds bounded nested objects, arrays, tuples, functions, methods, and nullable unions. */
  it('derives neutral values from supported inline structural types', () => {
    const source = [
      "import { createContext } from 'react';",
      'const context = createContext<null | {',
      '  items: string[];',
      '  pair: readonly [number, string];',
      '  callback: (name: string) => boolean;',
      '  nested: { enabled: boolean; load(id: string): Promise<void> };',
      '  code: 200 | 404;',
      '  label: `item-${string}`;',
      '  metadata: Record<string, number>;',
      '} | undefined>(null);',
      'void context;',
    ].join('\n');

    const rewritten = rewrite('/workspace/structural.ts', source);

    expect(rewritten).toContain(`"items": []`);
    expect(rewritten).toContain(`"pair": []`);
    expect(rewritten).toContain(`"callback": () => undefined`);
    expect(rewritten).toContain(`"nested": { "enabled": false, "load": () => undefined }`);
    expect(rewritten).toContain(`"code": 0`);
    expect(rewritten).toContain(`"label": ''`);
    expect(rewritten).toContain(`"metadata": {}`);
  });

  /** Supports only the globally well-known empty container references allowed by the contract. */
  it('accepts safe root container references and an inline function type', () => {
    const source = [
      "import { createContext } from 'react';",
      'const array = createContext<Array<string>>(undefined);',
      'const readonlyArray = createContext<ReadonlyArray<number>>(undefined);',
      'const record = createContext<Record<string, boolean>>(undefined);',
      'const callback = createContext<(value: string) => void>(undefined);',
      'void array; void readonlyArray; void record; void callback;',
    ].join('\n');

    const rewritten = rewrite('/workspace/containers.ts', source);

    expect(createReactContextFallbackReplacements('/workspace/containers.ts', source)).toHaveLength(
      4,
    );
    expect(rewritten.match(/\(\(\[\]\) as any\)/gu)).toHaveLength(2);
    expect(rewritten).toContain(`Record<string, boolean>>((({}) as any))`);
    expect(rewritten).toContain(`((() => undefined) as any)`);
  });

  /** Expands acyclic non-generic interfaces and aliases declared in the same source module. */
  it('derives neutral values from local named structural types', () => {
    const source = [
      "import { createContext } from 'react';",
      'type Controls = { close(): void; labels: readonly string[] };',
      'interface LocalContextState {',
      '  ready: boolean;',
      '  controls: Controls;',
      '}',
      'const context = createContext<LocalContextState>(undefined);',
      'void context;',
    ].join('\n');

    const rewritten = rewrite('/workspace/local-types.tsx', source);

    expect(rewritten).toContain(
      `{ "ready": false, "controls": { "close": () => undefined, "labels": [] } }`,
    );
  });

  /** Leaves real defaults, imported types, side effects, and unrelated callees untouched. */
  it('fails closed when a call needs semantic knowledge or would discard behavior', () => {
    const source = [
      "import { createContext as reactContext } from 'react';",
      "import type { RemoteState } from './remote-state';",
      "import { createContext } from './context-factory';",
      'const real = reactContext<{ ready: boolean }>({ ready: true });',
      'const imported = reactContext<RemoteState>(undefined);',
      'const executable = reactContext<{ ready: boolean }>(void initialize());',
      'const unrelated = createContext<{ ready: boolean }>(undefined);',
      'const property = factory.createContext<{ ready: boolean }>(undefined);',
      'void real; void imported; void executable; void unrelated; void property;',
    ].join('\n');

    expect(createReactContextFallbackReplacements('/workspace/conservative.ts', source)).toEqual(
      [],
    );
  });

  /** Rejects recursive, generic, inherited, and declaration-merged local named structures. */
  it('fails closed for local named types that require semantic expansion', () => {
    const source = [
      "import { createContext } from 'react';",
      'interface Recursive { next: Recursive }',
      'interface Base { value: string }',
      'interface Extended extends Base { ready: boolean }',
      'interface Merged { first: string }',
      'interface Merged { second: string }',
      'type Generic<T> = { value: T };',
      'const recursive = createContext<Recursive>(undefined);',
      'const extended = createContext<Extended>(undefined);',
      'const merged = createContext<Merged>(undefined);',
      'const generic = createContext<Generic<string>>(undefined);',
      'void recursive; void extended; void merged; void generic;',
    ].join('\n');

    expect(createReactContextFallbackReplacements('/workspace/unsafe-types.ts', source)).toEqual(
      [],
    );
  });

  /** Avoids ambiguous local shadows even when another call could refer to the imported binding. */
  it('skips a React binding that is shadowed anywhere in the module', () => {
    const source = [
      "import { createContext } from 'react';",
      'const importedCall = createContext<{ ready: boolean }>(undefined);',
      'function local(createContext: unknown) {',
      '  return (createContext as any)<{ ready: boolean }>(undefined);',
      '}',
      'void importedCall; void local;',
    ].join('\n');

    expect(createReactContextFallbackReplacements('/workspace/shadowed.ts', source)).toEqual([]);
  });

  /** Restricts the feature to project-owned runtime TypeScript with value-capable React imports. */
  it('skips JavaScript, declaration files, dependencies, type-only imports, and invalid source', () => {
    const source = [
      "import type { createContext } from 'react';",
      'const context = createContext<{ ready: boolean }>(undefined);',
    ].join('\n');
    const valueImportSource = source.replace('import type', 'import');

    expect(createReactContextFallbackReplacements('/workspace/context.ts', source)).toEqual([]);
    expect(
      createReactContextFallbackReplacements('/workspace/context.js', valueImportSource),
    ).toEqual([]);
    expect(
      createReactContextFallbackReplacements('/workspace/context.d.ts', valueImportSource),
    ).toEqual([]);
    expect(
      createReactContextFallbackReplacements(
        '/workspace/node_modules/package/context.ts',
        valueImportSource,
      ),
    ).toEqual([]);
    expect(
      createReactContextFallbackReplacements(
        '/workspace/invalid.ts',
        `${valueImportSource}\nconst broken = ;`,
      ),
    ).toEqual([]);
  });

  /** Enforces nesting, property-count, and generated-output budgets instead of creating huge code. */
  it('rejects structural fallbacks that exceed a bounded generation budget', () => {
    const excessiveProperties = Array.from(
      { length: 65 },
      (_, index) => `property${index.toString()}: string;`,
    ).join(' ');
    let excessiveDepth = 'string';
    for (let index = 0; index < 10; index += 1) {
      excessiveDepth = `{ next: ${excessiveDepth} }`;
    }
    const longPropertyName = 'x'.repeat(4_200);
    const source = [
      "import { createContext } from 'react';",
      `const wide = createContext<{ ${excessiveProperties} }>(undefined);`,
      `const deep = createContext<${excessiveDepth}>(undefined);`,
      `const long = createContext<{ '${longPropertyName}': string }>(undefined);`,
      'void wide; void deep; void long;',
    ].join('\n');

    expect(createReactContextFallbackReplacements('/workspace/bounded.ts', source)).toEqual([]);
  });
});

/** Applies original-source ranges from right to left, mirroring the production rewrite strategy. */
function applyReplacements(
  source: string,
  replacements: readonly ReactContextFallbackReplacement[],
): string {
  let rewritten = source;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    rewritten = `${rewritten.slice(0, replacement.start)}${replacement.replacement}${rewritten.slice(replacement.end)}`;
  }
  return rewritten;
}

/** Finds and applies context fallbacks for one concise test fixture. */
function rewrite(sourcePath: string, source: string): string {
  return applyReplacements(source, createReactContextFallbackReplacements(sourcePath, source));
}
