/** Verifies narrow Next dynamic-import interop repair without executing Next or imported modules. */
import { describe, expect, it } from 'vitest';
import {
  collectRenderedNextDynamicSpecifiers,
  createNextDynamicReplacements,
} from '../../../../src/adapters/esbuild/staticResources/previewNextDynamicInstrumentation';
import { applyPreviewSourceReplacements } from '../../../../src/adapters/esbuild/staticResources/previewSourceReplacement';

const SOURCE_PATH = '/workspace/src/Video.tsx';

/** Applies discovered edits for readable source-level assertions. */
function transform(source: string): string {
  return applyPreviewSourceReplacements(source, createNextDynamicReplacements(SOURCE_PATH, source));
}

describe('Next dynamic instrumentation', () => {
  /** Unwraps the exact double-default shape emitted for the logged react-player CommonJS package. */
  it('normalizes literal imports returned by next/dynamic loaders', () => {
    const source = [
      `import dynamic from 'next/dynamic';`,
      `const ReactPlayer = dynamic(() => import('react-player/lazy'), { ssr: false });`,
    ].join('\n');
    const result = transform(source);

    expect(result).toContain(
      `import('react-player/lazy').then((__reactPreviewDynamicModule) => (__reactPreviewDynamicModule?.default?.default ?? __reactPreviewDynamicModule?.default ?? __reactPreviewDynamicModule))`,
    );
    expect(result).toContain('{ ssr: false }');
  });

  /** Supports an awaited direct import and a default import alias. */
  it('normalizes awaited direct loader imports', () => {
    const source = [
      `import { default as loadDynamic } from 'next/dynamic';`,
      `const Player = loadDynamic(async () => await import('player'));`,
    ].join('\n');

    expect(transform(source)).toContain(
      `await import('player').then((__reactPreviewDynamicModule) =>`,
    );
  });

  /** Keeps an authored named component first while providing a default-only corridor fallback. */
  it('normalizes conventional named-export selectors without replacing their chosen export', () => {
    const source = [
      `import dynamic from 'next/dynamic';`,
      `const Named = dynamic(() => import('./named').then((module) => module.Named));`,
    ].join('\n');

    expect(transform(source)).toContain(
      `(module.Named ?? module?.default?.default ?? module?.default ?? (() => null))`,
    );
  });

  /** Leaves computed imports, transforming callbacks, and shadowed calls untouched. */
  it('fails closed for authored transforms and unproven loaders', () => {
    const source = [
      `import dynamic from 'next/dynamic';`,
      `const Adapted = dynamic(() => import('./named').then((module) => wrap(module.Named)));`,
      'const Computed = dynamic(() => import(moduleName));',
      'function local(dynamic) { return dynamic(() => import("./local")); }',
    ].join('\n');

    expect(transform(source)).toBe(source);
  });

  /** Distinguishes page-mounted lazy JSX from registry-only deferred declarations. */
  it('collects only next/dynamic literal bindings rendered in local JSX', () => {
    const source = [
      `import dynamic from 'next/dynamic';`,
      `const Welcome = dynamic(() => import('./welcome').then((module) => module.Welcome));`,
      `const RegistryOnly = dynamic(() => import('./other'));`,
      `export function Page() { return <section><Welcome /></section>; }`,
    ].join('\n');

    expect([...collectRenderedNextDynamicSpecifiers('/workspace/Page.tsx', source)]).toEqual([
      './welcome',
    ]);
  });
});
