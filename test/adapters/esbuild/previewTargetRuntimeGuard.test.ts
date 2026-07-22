/** Verifies conservative framework ownership checks before a target reaches the React bundler. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PreviewDependencyProfile } from '../../../src/adapters/node/previewDependencyProfile';
import type { PreviewStaticModuleResolver } from '../../../src/adapters/esbuild/previewStaticModuleResolver';
import { assertPreviewTargetUsesSupportedReactRuntime } from '../../../src/adapters/esbuild/previewTargetRuntimeGuard';
import { PreviewCompilationError } from '../../../src/domain/preview';

const WORKSPACE_ROOT = path.resolve('/workspace');
const TARGET_PATH = path.join(WORKSPACE_ROOT, 'src', 'Page.tsx');

/** Creates an inert normalized profile without touching a package manager or filesystem. */
function createDependencyProfile(
  dependencies: Readonly<Record<string, string>>,
): PreviewDependencyProfile {
  return {
    dependencyPaths: [path.join(WORKSPACE_ROOT, 'package.json')],
    fingerprint: 'target-runtime-guard-fixture',
    hasReusableLockEvidence: false,
    lockfileDigests: {},
    lockfileEvidenceStatus: 'absent',
    manifestPath: path.join(WORKSPACE_ROOT, 'package.json'),
    requirementsByField: {
      dependencies,
      devDependencies: {},
      optionalDependencies: {},
      peerDependencies: {},
    },
    schemaVersion: 2,
  };
}

/** Supplies exact JSX ownership separately from the legacy broad alternative-runtime signal. */
function createJsxResolver(
  jsxImportSource?: string,
): Pick<PreviewStaticModuleResolver, 'getJsxImportSource' | 'usesAlternativeJsxRuntime'> {
  return {
    getJsxImportSource: () => jsxImportSource,
    usesAlternativeJsxRuntime: () => jsxImportSource !== undefined && jsxImportSource !== 'react',
  };
}

/** Runs the assertion with stable defaults while preserving each test's relevant evidence. */
function assertTarget(
  sourceText: string,
  dependencies: Readonly<Record<string, string>>,
  jsxImportSource?: string,
): void {
  assertPreviewTargetUsesSupportedReactRuntime({
    dependencyProfile: createDependencyProfile(dependencies),
    documentPath: TARGET_PATH,
    sourceText,
    staticModuleResolver: createJsxResolver(jsxImportSource),
  });
}

/** Captures the structured error so tests can verify user-facing source evidence and guidance. */
function captureCompilationError(action: () => void): PreviewCompilationError {
  try {
    action();
  } catch (error) {
    if (error instanceof PreviewCompilationError) return error;
    throw error;
  }
  throw new Error('Expected an unsupported target runtime compilation error.');
}

describe('assertPreviewTargetUsesSupportedReactRuntime', () => {
  /** A dedicated Solid package plus a runtime import is sufficient without resolving node_modules. */
  it('rejects a Solid-only component import with a source-backed compiler explanation', () => {
    const error = captureCompilationError(() => {
      assertTarget(
        "// component\nimport { createSignal } from 'solid-js';\nexport const Page = () => <main />;",
        { 'solid-js': '^1.9.5' },
      );
    });

    expect(error.message).toContain('Page.tsx because it is a SolidJS target');
    const diagnostic = error.diagnostics[0];
    expect(diagnostic?.location?.file).toBe(TARGET_PATH);
    expect(diagnostic?.location?.line).toBe(2);
    expect(diagnostic?.message).toContain('imports "solid-js"');
    expect(diagnostic?.notes?.join('\n')).toContain('vite-plugin-solid');
    expect(diagnostic?.severity).toBe('error');
  });

  /** Solid DOM bootstrap semantics remain definitive during a React-to-Solid migration. */
  it('rejects a solid-js/web entry even when the manifest also declares React', () => {
    expect(() => {
      assertTarget(
        "import { render } from 'solid-js/web';\nrender(() => <main />, document.body);",
        { react: '^19.0.0', 'solid-js': '^1.9.5' },
      );
    }).toThrow(/SolidJS target/u);
  });

  /** Lit's direct template runtime and Lit-only manifest prove that React cannot mount its result. */
  it('rejects a Lit-only template target with TemplateResult guidance', () => {
    const error = captureCompilationError(() => {
      assertTarget(
        "import { html } from 'lit';\nexport const Page = () => html`<main>Lit</main>`;",
        { lit: '^3.3.0' },
      );
    });

    expect(error.message).toContain('Page.tsx because it is a Lit target');
    expect(error.diagnostics[0]?.notes?.join('\n')).toContain('TemplateResult');
  });

  /** A React component may use a Solid primitive as an auxiliary value in a hybrid package. */
  it('fails open for a React and Solid hybrid using createSignal under the React JSX runtime', () => {
    expect(() => {
      assertTarget(
        "import { createSignal } from 'solid-js';\nexport const Page = () => <main />;",
        { react: '^19.0.0', 'react-dom': '^19.0.0', 'solid-js': '^1.9.5' },
        'react',
      );
    }).not.toThrow();
  });

  /** Exact TypeScript JSX ownership resolves an otherwise ambiguous hybrid in Solid's favor. */
  it('rejects JSX with an exact Solid config even without an explicit solid-js import', () => {
    expect(() => {
      assertTarget('export const Page = () => <main />;', { react: '^19.0.0' }, 'solid-js');
    }).toThrow(/SolidJS target/u);
  });

  /** A leading source pragma is compiler ownership evidence even when config defaults to React. */
  it('rejects an exact leading Solid JSX pragma without requiring a runtime import', () => {
    expect(() => {
      assertTarget(
        '/** @jsxImportSource solid-js */\nexport const Page = () => <main />;',
        { react: '^19.0.0' },
        'react',
      );
    }).toThrow(/SolidJS target/u);
  });

  /** React-only source and dependencies never trip alternate-framework package-name checks. */
  it('leaves an ordinary React target unaffected', () => {
    expect(() => {
      assertTarget(
        "import { useState } from 'react';\nexport const Page = () => <main />;",
        { react: '^19.0.0', 'react-dom': '^19.0.0' },
        'react',
      );
    }).not.toThrow();
  });

  /** Erased type imports cannot prove that the target executes another framework at runtime. */
  it('ignores type-only Solid references in React source', () => {
    expect(() => {
      assertTarget(
        "import type { JSX } from 'solid-js';\nexport const Page = (): JSX.Element => <main />;",
        { react: '^19.0.0', 'solid-js': '^1.9.5' },
        'react',
      );
    }).not.toThrow();
  });

  /** Textual examples below the pragma preamble and inside strings are not runtime ownership. */
  it('ignores comments and strings that only mention Solid package names', () => {
    expect(() => {
      assertTarget(
        [
          'const example = "import { render } from \'solid-js/web\'";',
          '// @jsxImportSource solid-js is documentation below the first statement.',
          'export const Page = () => <main>{example}</main>;',
        ].join('\n'),
        { react: '^19.0.0', 'solid-js': '^1.9.5' },
        'react',
      );
    }).not.toThrow();
  });

  /** Other alternative JSX owners are left to their own compatibility policy, never mislabeled. */
  it.each(['preact', 'custom-jsx-runtime'])(
    'does not classify the exact %s JSX runtime as SolidJS',
    (jsxImportSource) => {
      expect(() => {
        assertTarget('export const Page = () => <main />;', { react: '^19.0.0' }, jsxImportSource);
      }).not.toThrow();
    },
  );

  /** A module-local React pragma overrides a broader Solid tsconfig in a hybrid package. */
  it('honors an explicit React pragma before the nearest configured JSX owner', () => {
    expect(() => {
      assertTarget(
        '/** @jsxImportSource react */\nimport { createSignal } from "solid-js";\nexport const Page = () => <main />;',
        { react: '^19.0.0', 'solid-js': '^1.9.5' },
        'solid-js',
      );
    }).not.toThrow();
  });
});
