/** Verifies weak AST-owned reuse without stale editor, scope, helper or state-origin answers. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  collectOwnerConstDeclarations,
  collectReactMemoBindings,
} from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookAliasBindings';
import {
  collectPreviewRuntimeHookAliasPaths,
  readPreviewRuntimeHookAliasUsagePaths,
} from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookAliasUsage';
import { collectPreviewRuntimeHookStateAliases } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookStateAlias';

/** Parses fresh editor syntax at a deliberately repeated path and selects a named owner. */
function parse(
  source: string,
  name = 'Page',
): {
  readonly file: ts.SourceFile;
  readonly owner: ts.FunctionDeclaration;
} {
  const file = ts.createSourceFile(
    '/workspace/Page.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const owner = file.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  if (owner === undefined) throw new Error('Fixture owner is missing.');
  return { file, owner };
}

/** Reads the exact owner declaration that adjacent hook/child consumers pass to alias analysis. */
function binding(owner: ts.FunctionDeclaration, name = 'root'): ts.Identifier {
  const node = collectOwnerConstDeclarations(owner).find(
    (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name,
  )?.name;
  if (node === undefined || !ts.isIdentifier(node)) throw new Error('Fixture binding is missing.');
  return node;
}

describe('runtime hook owner syntax reuse', () => {
  it('walks an immutable owner once and retains source order and callback boundaries', () => {
    const { owner } = parse(`function Page() {
      const root = useData(); const alias = root.items;
      const callback = () => { const nested = root; return nested; };
      return alias;
    }`);
    let bodyReads = 0;
    const observed = new Proxy(owner, {
      get(target, property, receiver): unknown {
        if (property === 'body') bodyReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const first = collectOwnerConstDeclarations(observed);
    const initialReads = bodyReads;
    expect(first.map((node) => node.name.getText())).toEqual(['root', 'alias', 'callback']);
    expect(initialReads).toBeGreaterThan(0);
    for (let index = 0; index < 30; index += 1)
      expect(collectOwnerConstDeclarations(observed)).toBe(first);
    expect(bodyReads).toBe(initialReads);
  });

  it('shares exact React memo imports without carrying imports into another editor tree', () => {
    const first = parse('import { useMemo as memo } from "react"; function Page() {}');
    let statementReads = 0;
    const observed = new Proxy(first.file, {
      get(target, property, receiver): unknown {
        if (property === 'statements') statementReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const imports = collectReactMemoBindings(observed);
    const initialReads = statementReads;
    expect([...imports.direct]).toEqual(['memo']);
    for (let index = 0; index < 30; index += 1)
      expect(collectReactMemoBindings(observed)).toBe(imports);
    expect(statementReads).toBe(initialReads);
    const changed = parse('import { useMemo as memo } from "./local"; function Page() {}');
    expect(collectReactMemoBindings(changed.file).direct.size).toBe(0);
  });

  it('preserves origins across cached syntax, edited imports, restored text and different owners', () => {
    const source = `import { useMemo } from "react";
      function Page() { const root = useData(); const items = root.items;
        const memo = useMemo(() => items, []); return memo; }
      function Other() { const root = useData(); const items = root.other; return items; }`;
    const first = parse(source);
    const origins = collectPreviewRuntimeHookAliasPaths(binding(first.owner), first.owner);
    expect(origins.get('memo')).toEqual([['items']]);
    for (let index = 0; index < 30; index += 1)
      expect(collectPreviewRuntimeHookAliasPaths(binding(first.owner), first.owner)).toEqual(
        origins,
      );
    const other = first.file.statements.find(
      (node): node is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(node) && node.name?.text === 'Other',
    );
    if (other === undefined) throw new Error('Second owner is missing.');
    expect(collectPreviewRuntimeHookAliasPaths(binding(other), other).get('items')).toEqual([
      ['other'],
    ]);
    const edited = parse(source.replace('from "react"', 'from "./local"'));
    expect(
      collectPreviewRuntimeHookAliasPaths(binding(edited.owner), edited.owner).has('memo'),
    ).toBe(false);
    const restored = parse(source);
    const restoredOrigins = collectPreviewRuntimeHookAliasPaths(
      binding(restored.owner),
      restored.owner,
    );
    expect(restoredOrigins).toEqual(origins);
    expect(restoredOrigins).not.toBe(origins);
  });

  it('keeps same-owner memo syntax separate from an identifier in a foreign parser tree', () => {
    const source = `import { useMemo } from "react"; function Page() {
      const root = useData(); const memo = useMemo(() => root.items, []); return memo; }`;
    const first = parse(source);
    const other = parse(source.replace('from "react"', 'from "./local"'));
    const origins = collectPreviewRuntimeHookAliasPaths(binding(first.owner), first.owner);
    expect(origins.has('memo')).toBe(true);
    expect(collectPreviewRuntimeHookAliasPaths(binding(other.owner), first.owner).has('memo')).toBe(
      false,
    );
    expect(collectPreviewRuntimeHookAliasPaths(binding(first.owner), first.owner)).toEqual(origins);
  });

  it('re-evaluates setter origins when an inference callback changes on the same tree', () => {
    const { owner } = parse(`import { useState } from "react"; function Page() {
      const [draft, setDraft] = useState(null); setDraft(origin); return draft; }`);
    for (const name of ['first', 'second', 'first']) {
      const aliases = collectPreviewRuntimeHookStateAliases({
        aliases: new Map(),
        owner,
        readOriginPaths: (node) =>
          ts.isIdentifier(node) && node.text === 'origin' ? [[name]] : [],
      });
      expect(aliases.get('draft')).toEqual([[name]]);
    }
  });

  it('rechecks React state import identity after editing and restoring the same source path', () => {
    const source = `import { useState } from "react"; function Page() {
      const root = useData(); const [draft, setDraft] = useState(null);
      setDraft(root); return draft; }`;
    const revisions = [source, source.replace('from "react"', 'from "./local"'), source];
    for (const [index, revision] of revisions.entries()) {
      const { owner } = parse(revision);
      const aliases = collectPreviewRuntimeHookAliasPaths(binding(owner), owner);
      expect(aliases.has('draft')).toBe(index !== 1);
    }
  });

  it('retains duplicate-binding rejection and state transitions after syntax reuse', () => {
    const ambiguous = parse(`import { useState } from "react"; function Page() {
      const root = useData(); const [draft, setDraft] = useState(null);
      { const setDraft = customSetter; setDraft(root); } return draft; }`);
    const valid = parse(`import { useState } from "react"; function Page() {
      const root = useData(); const [draft, setDraft] = useState(null);
      const items = root.items; setDraft({ ...items }); return draft; }`);
    for (let index = 0; index < 3; index += 1) {
      expect(
        collectPreviewRuntimeHookAliasPaths(binding(ambiguous.owner), ambiguous.owner).has('draft'),
      ).toBe(false);
      expect(
        collectPreviewRuntimeHookAliasPaths(binding(valid.owner), valid.owner).get('draft'),
      ).toEqual([['items']]);
    }
  });

  it('keeps caller-specific imported callback demand live when owner syntax is reused', () => {
    const { owner } = parse(`function Page() {
      const root = useData(); const items = root.items; return items.map(renderItem); }`);
    const root = binding(owner);
    for (const name of ['first', 'second']) {
      const usages = readPreviewRuntimeHookAliasUsagePaths(
        root,
        owner,
        undefined,
        undefined,
        (localName) =>
          localName === 'renderItem'
            ? { expression: name, kind: 'object', requiredPaths: [name] }
            : undefined,
      );
      expect(usages.some((usage) => usage.collectionItemRequiredPaths?.includes(name))).toBe(true);
      expect(
        usages.some((usage) =>
          usage.collectionItemRequiredPaths?.includes(name === 'first' ? 'second' : 'first'),
        ),
      ).toBe(false);
    }
  });
});
