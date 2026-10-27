/** Exercises generated factory composition with the real Router, selected slots, and Provider. */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectPreviewInspectorRouteFactoryEvidence } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteFactory';
import {
  createVariableRouteFactoryFixture,
  type VariableRouteFactoryFixture,
} from './previewInspectorVariableRouteFactoryFixture';
import {
  renderVariableRouteFactoryCase,
  type VariableRouteFactoryCase,
} from './previewInspectorVariableRouteFactoryRuntime';

const cases: readonly VariableRouteFactoryCase[] = [
  { name: 'frozen-outer-index', selection: 'ListPage', marker: 'LIST_PAGE_MARKER', frozen: true },
  {
    name: 'frozen-nested-detail',
    selection: 'ManagementApp',
    marker: 'MANAGEMENT_DETAIL_MARKER:1',
    frozen: true,
  },
  {
    name: 'frozen-outer-create',
    selection: 'CreatePage',
    marker: 'CREATE_PAGE_MARKER',
    frozen: true,
  },
  { name: 'outer-index', selection: 'ListPage', marker: 'LIST_PAGE_MARKER' },
  { name: 'outer-create', selection: 'CreatePage', marker: 'CREATE_PAGE_MARKER' },
  { name: 'nested-detail', selection: 'ManagementApp', marker: 'MANAGEMENT_DETAIL_MARKER:1' },
  {
    name: 'compiler-base-fallback',
    selection: 'CreatePage',
    marker: 'CREATE_PAGE_MARKER',
    omitRuntimeBase: true,
  },
  {
    name: 'wrong-owner-no-localization',
    selection: 'CreatePage',
    marker: 'NOT_FOUND_MARKER',
    omitRuntimeBase: true,
    wrongOwner: true,
  },
  {
    name: 'getter-static-skipped',
    selection: 'CreatePage',
    marker: 'CREATE_PAGE_MARKER',
    getterStatic: true,
  },
  {
    name: 'repeated-owner-compiler-fallback',
    selection: 'CreatePage',
    marker: 'CREATE_PAGE_MARKER',
    omitRuntimeBase: true,
    repeatedOwner: true,
  },
];

describe('variable route factory real-Router runtime', () => {
  let root: string | undefined;
  let fixture: VariableRouteFactoryFixture;

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'variable-route-factory-runtime-'));
    fixture = await createVariableRouteFactoryFixture(root);
  });

  afterAll(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it.each(cases)(
    '$name preserves exact matching and the authored route contract',
    async (variant) => {
      const result = await renderVariableRouteFactoryCase(fixture, variant);
      expect(result.html).toContain(variant.marker);
      expect(result.html).toContain('OUTER_LAYOUT_MARKER');
      if (!variant.wrongOwner) expect(result.html).not.toContain('NOT_FOUND_MARKER');
      if (variant.selection === 'ManagementApp') {
        expect(result.html).toContain('INNER_LAYOUT_MARKER');
        expect(result.html).toContain('INNER_PROVIDER_MARKER');
        expect(result.html).toContain('data-audit-provider="true"');
      }
      expect(result.siblingMarkers).toEqual([]);
      expect(result.getterReads).toBe(0);
      expect(result.branches.some((branch) => branch.componentName === 'NotFound')).toBe(false);
      if (variant.frozen) {
        expect(result.frozenFidelity).toBeDefined();
      } else {
        expect(result.fallbackHtml).toContain('NOT_FOUND_MARKER');
        expect(Object.values(result.statics).every(Boolean)).toBe(true);
      }
      if (variant.getterStatic) expect(result.copiedBase).toBeUndefined();
      if (variant.name === 'outer-create') {
        expect(result.initialEntry).toBe('/create');
        expect(result.runtimeStaticEntry).toBe('/create');
      }
      if (variant.wrongOwner) expect(result.initialEntry).toBe('/feature/create');
      if (variant.repeatedOwner) expect(result.initialEntry).toBe('/create');
    },
  );

  it('changes only the selected page body on the second build while keeping inventory stable', async () => {
    const first = await renderVariableRouteFactoryCase(fixture, {
      name: 'first-build',
      selection: 'ListPage',
      marker: 'LIST_PAGE_MARKER',
    });
    const second = await renderVariableRouteFactoryCase(fixture, {
      name: 'second-build',
      selection: 'CreatePage',
      marker: 'CREATE_PAGE_MARKER',
    });
    expect(first.html).toContain('LIST_PAGE_MARKER');
    expect(first.html).not.toContain('CREATE_PAGE_MARKER');
    expect(second.html).toContain('CREATE_PAGE_MARKER');
    expect(second.html).not.toContain('LIST_PAGE_MARKER');
    expect(second.routeCount).toBe(first.routeCount);
    expect(second.branches.map((branch) => branch.id)).toEqual(
      first.branches.map((branch) => branch.id),
    );
    expect(first.siblingMarkers).toEqual([]);
    expect(second.siblingMarkers).toEqual([]);
  });

  it('keeps original slot aliases and authored fallback proof through inert callback wrappers', () => {
    for (const [relative, names] of [
      ['src/app.tsx', ['ownRoutes', 'nestedRoutes']],
      ['src/management/management-app.tsx', ['ownRoutes']],
    ] as const) {
      const file = path.join(fixture.root, relative);
      const text = fixture.sourceByPath.get(file);
      expect(text).toBeDefined();
      const source = ts.createSourceFile(
        file,
        text ?? '',
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const evidence = collectPreviewInspectorRouteFactoryEvidence(source)[0];
      expect(evidence?.routeSlots.map((slot) => slot.localName)).toEqual(names);
      expect(evidence?.hasWildcardFallback).toBe(true);
      expect(Object.isFrozen(evidence?.routeSlots)).toBe(true);
    }
  });
});
