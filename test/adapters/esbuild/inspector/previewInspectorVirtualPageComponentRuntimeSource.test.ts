/**
 * Verifies the generated VirtualPage component-isolation runtime without coupling tests to a
 * browser. The runtime must preserve authored names because the page tree uses those identities to
 * distinguish one composed page root from its ordinary descendants.
 */
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorVirtualPageComponentRuntimeSource } from '../../../../src/adapters/esbuild/inspector/previewInspectorVirtualPageComponentRuntimeSource';

/** Observable component facade surface returned by the generated browser helper. */
interface VirtualPageComponentFacade {
  readonly displayName?: string;
  readonly reactPreviewFacadeKind?: string;
}

/** Minimal constructible React component base required by the emitted error-boundary class. */
class ReactComponentStub {
  /** Retains the props field that the generated boundary reads at render time. */
  constructor(readonly props: unknown) {}
}

/**
 * Evaluates the browser ESM source with a minimal React protocol stub and exposes its factory.
 *
 * The test intentionally exercises the emitted source rather than a duplicate host implementation,
 * catching escaping errors in filename inference as well as wrapper metadata regressions.
 */
function loadVirtualPageComponentFactory(): (
  Component: unknown,
  exportName: string,
  sourcePath: string,
) => VirtualPageComponentFacade {
  const generatedSource = createPreviewInspectorVirtualPageComponentRuntimeSource()
    .replace("import * as React from 'react';", '')
    .replaceAll('export function ', 'function ');
  const context = {
    React: {
      Component: ReactComponentStub,
      cloneElement: () => ({}),
      createElement: () => ({}),
      forwardRef: (render: (props: unknown, reference: unknown) => unknown) =>
        Object.assign((props: unknown) => render(props, null), { render }),
      isValidElement: () => false,
    },
  };
  runInNewContext(
    `${generatedSource}\nglobalThis.__factory = createVirtualPageComponent;`,
    context,
  );
  const factory = (
    context as typeof context & {
      __factory?: (
        Component: unknown,
        exportName: string,
        sourcePath: string,
      ) => VirtualPageComponentFacade;
    }
  ).__factory;
  if (factory === undefined) throw new Error('Generated VirtualPage component factory is missing.');
  return factory;
}

describe('createPreviewInspectorVirtualPageComponentRuntimeSource', () => {
  /** Named authored functions remain visible as themselves instead of nested VirtualPage roots. */
  it('preserves authored component names and marks only the isolation mechanism as metadata', () => {
    const createFacade = loadVirtualPageComponentFactory();
    /** Representative authored page function whose stable identity should survive the facade. */
    function EmailHistoryPage(): null {
      return null;
    }

    const facade = createFacade(
      EmailHistoryPage,
      'default',
      '/workspace/pages/email-history-page.tsx',
    );

    expect(facade.displayName).toBe('EmailHistoryPage');
    expect(facade.reactPreviewFacadeKind).toBe('virtual-page-component-isolation');
    expect(Object.keys(facade)).not.toContain('reactPreviewFacadeKind');
  });

  /** Anonymous default wrapper objects receive a readable identity from the source filename. */
  it('infers anonymous default component names without presenting another VirtualPage', () => {
    const createFacade = loadVirtualPageComponentFactory();
    const memoComponent = { $$typeof: Symbol.for('react.memo') };

    const facade = createFacade(
      memoComponent,
      'default',
      '/workspace/pages/ia-partner-investment-confirmation-email-history-page.tsx',
    );

    expect(facade.displayName).toBe('IaPartnerInvestmentConfirmationEmailHistoryPage');
    expect(facade.displayName).not.toContain('VirtualPage');
  });

  /** A useful ESM name is more precise than an anonymous implementation object's generic name. */
  it('uses named export identity for anonymous renderable objects', () => {
    const createFacade = loadVirtualPageComponentFactory();
    const memoComponent = { $$typeof: Symbol.for('react.memo') };

    const facade = createFacade(memoComponent, 'PageHeader', '/workspace/page-header.tsx');

    expect(facade.displayName).toBe('PageHeader');
  });
});
