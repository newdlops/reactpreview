/** Verifies isolated Inspector browser source without executing project React code in the host. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPreviewEntry } from '../../../../src/adapters/esbuild/createPreviewEntry';
import {
  createPreviewInspectorFacadeRuntimeSource,
  createPreviewPageInspectorRuntimeSource,
} from '../../../../src/adapters/esbuild/pageInspector';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

describe('Page Inspector runtime source', () => {
  /** Keeps marker/highlight/editor code out of the ordinary component-gallery entry. */
  it('includes the inspector runtime only for the explicit page-inspector mode', () => {
    const componentEntry = createPreviewEntry({
      documentName: 'Target.tsx',
      globalNamespaces: [],
      renderMode: 'component',
      setupKind: 'none',
    });
    const inspectorEntry = createPreviewEntry({
      documentName: 'Target.tsx',
      globalNamespaces: [],
      renderMode: 'page-inspector',
      setupKind: 'none',
    });

    expect(componentEntry).not.toContain('React Page Inspector');
    expect(componentEntry).not.toContain("import * as ReactDOMNamespace from 'react-dom'");
    expect(inspectorEntry).toContain('React Page Inspector');
    expect(inspectorEntry).toContain("import * as ReactDOMNamespace from 'react-dom'");
    expect(inspectorEntry).toContain('PreviewPageInspectorRootRenderer');
  });

  /** Uses a read-only tree adapter, isolated toolbar, persistent overrides, and proven ancestry. */
  it('generates selector-safe highlighting and editable root/target controls', () => {
    const source = createPreviewPageInspectorRuntimeSource();

    expect(source).not.toContain("React.createElement('template'");
    expect(source).toContain('boundary._reactInternals');
    expect(source).toContain('boundary._reactInternalFiber');
    expect(source).toContain("document.createElement('react-preview-inspector-host')");
    expect(source).toContain("attachShadow({ mode: 'open' })");
    expect(source).toContain('setPropsOverride');
    expect(source).toContain('React.cloneElement(Component, props)');
    expect(source).toContain('createPreviewInspectorRootName');
    expect(source).toContain('descriptor?.inspector === undefined');
    expect(source).toContain('DirectPreviewTarget');
    expect(source).toContain('describePreviewInspectorAncestry');
    expect(source).toContain('Internal hook state uses the page UI or a source edit');
    expect(source).not.toContain('__REACT_DEVTOOLS_GLOBAL_HOOK__');
  });

  /** Delegates facade wrappers through the same global API installed before target evaluation. */
  it('creates the exact target facade contract with a safe inactive fallback', () => {
    const source = createPreviewInspectorFacadeRuntimeSource();

    expect(source).toContain('export function wrapPreviewInspectorTarget');
    expect(source).toContain('inspectorApi?.TargetRenderer');
    expect(source).toContain('React.forwardRef');
    expect(source).toContain('React.cloneElement(Component, fallbackProps)');
  });

  /** Prevents copied memo/forwardRef/lazy protocol fields from bypassing the inspector delegate. */
  it('retains the inspector wrapper around React exotic component types', async () => {
    const facade = await importPreviewInspectorFacade();
    const wrapTarget = facade.wrapTarget;
    const apiKey = Symbol.for('newdlops.react-file-preview.page-inspector');
    const globalRecord = globalThis as unknown as Record<PropertyKey, unknown>;
    const delegatedLabels: string[] = [];
    globalRecord[apiKey] = {
      TargetRenderer({ Component, targetProps }: FacadeTargetRendererProps) {
        delegatedLabels.push(String(targetProps.label));
        return React.createElement(Component, targetProps);
      },
    };
    try {
      const PlainTarget = ({ label }: { readonly label: string }): React.ReactElement =>
        React.createElement('strong', undefined, label);
      const targets = [React.memo(PlainTarget), React.forwardRef(PlainTarget)];
      const lazyTarget = React.lazy(() => Promise.resolve({ default: PlainTarget }));
      const wrappedLazyTarget = wrapTarget(lazyTarget, { exportName: 'LazyTarget' });
      const html = targets.map((target, index) =>
        renderToStaticMarkup(
          React.createElement(wrapTarget(target, { exportName: `Target${index.toString()}` }), {
            label: `inspected-${index.toString()}`,
          }),
        ),
      );

      expect(delegatedLabels).toEqual(['inspected-0', 'inspected-1']);
      expect(html).toEqual(['<strong>inspected-0</strong>', '<strong>inspected-1</strong>']);
      expect(readReactTypeSymbol(wrappedLazyTarget)).toBe(Symbol.for('react.forward_ref'));
      expect(Reflect.ownKeys(wrappedLazyTarget as object)).not.toEqual(
        expect.arrayContaining(['_payload', '_init', '_debugInfo']),
      );
    } finally {
      Reflect.deleteProperty(globalRecord, apiKey);
      await rm(facade.fixtureDirectory, { force: true, recursive: true });
    }
  });

  /** Keeps descriptor/boundary names authoritative and resets errors for root prop revisions. */
  it('emits hot-safe inventory pruning and a root-aware error-boundary key', () => {
    const source = createPreviewPageInspectorRuntimeSource();

    expect(source).toContain('previewInspectorSession.boundariesByExport.keys()');
    expect(source).not.toContain('...previewInspectorSession.basePropsByExport.keys()');
    expect(source).toContain(
      'const rootRevision = previewInspectorSession.propsRevisionByExport.get(rootName)',
    );
    expect(source).toContain(
      "String(targetRevision) + ':' + rootName + ':' + String(rootRevision)",
    );
  });
});

/** Minimal public props consumed by the generated facade's entry-owned target renderer. */
interface FacadeTargetRendererProps {
  readonly Component: React.ElementType;
  readonly targetProps: Record<string, unknown>;
}

/** Imported generated facade plus its caller-owned temporary module directory. */
interface ImportedPreviewInspectorFacade {
  readonly fixtureDirectory: string;
  readonly wrapTarget: (
    component: React.ElementType,
    metadata: { readonly exportName: string },
  ) => React.ElementType;
}

/** Imports the generated facade as real ESM so the behavior test never relies on eval. */
async function importPreviewInspectorFacade(): Promise<ImportedPreviewInspectorFacade> {
  const fixtureDirectory = await mkdtemp(
    path.join(REPOSITORY_ROOT, 'test/fixtures/page-inspector-facade-'),
  );
  const modulePath = path.join(fixtureDirectory, 'facade.mjs');
  try {
    await writeFile(modulePath, createPreviewInspectorFacadeRuntimeSource(), 'utf8');
    const facadeModule = (await import(pathToFileURL(modulePath).href)) as {
      readonly wrapPreviewInspectorTarget: ImportedPreviewInspectorFacade['wrapTarget'];
    };
    return { fixtureDirectory, wrapTarget: facadeModule.wrapPreviewInspectorTarget };
  } catch (error) {
    await rm(fixtureDirectory, { force: true, recursive: true });
    throw error;
  }
}

/** Reads the public React type tag without coupling test types to one installed React version. */
function readReactTypeSymbol(component: React.ElementType): symbol | undefined {
  return (component as unknown as { readonly $$typeof?: symbol }).$$typeof;
}
