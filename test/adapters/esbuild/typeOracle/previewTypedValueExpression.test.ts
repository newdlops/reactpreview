/**
 * Verifies the JavaScript emitted for declared-type descriptors and the bundled lib lookup that a
 * packaged worker needs because it no longer ships TypeScript's installed package layout.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { resolvePreviewTypeLibDirectory } from '../../../../src/adapters/esbuild/typeOracle/previewTypeProgram';
import { createPreviewTypedValueExpression } from '../../../../src/adapters/esbuild/typeOracle/previewTypedValueExpression';
import { createPreviewSampleDateApiExpression } from '../../../../src/adapters/esbuild/previewSampleDateRuntimeSource';
import { PREVIEW_TYPED_VALUE_TAG } from '../../../../src/adapters/esbuild/typeOracle/previewTypeValueSynthesizer';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

describe('createPreviewTypedValueExpression', () => {
  /** Tagged descriptors become real runtime values inside a frozen object graph. */
  it('emits frozen objects, callables, dates, and collections', () => {
    const expression = createPreviewTypedValueExpression({
      createdAt: { [PREVIEW_TYPED_VALUE_TAG]: 'date', iso: '2026-01-15T09:00:00.000Z' },
      items: [{ id: 'preview-id' }],
      lookup: { [PREVIEW_TYPED_VALUE_TAG]: 'map' },
      refetch: { [PREVIEW_TYPED_VALUE_TAG]: 'function', returns: 3 },
      ['__proto__']: 'blocked',
    });
    const value = runInNewContext(`(${expression})`) as {
      readonly createdAt: Date;
      readonly items: readonly { readonly id: string }[];
      readonly lookup: Map<string, unknown>;
      readonly refetch: () => number;
    };

    expect(value.createdAt.toISOString()).toBe('2026-01-15T09:00:00.000Z');
    expect(value.items[0]?.id).toBe('preview-id');
    expect(value.lookup.size).toBe(0);
    expect(value.refetch()).toBe(3);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.keys(value)).not.toContain('__proto__');
  });

  /** Once the page installs its sample-date API, the canonical day lands on the current day. */
  it('rebases canonical sample dates through the installed sample-date API', () => {
    const expression = createPreviewTypedValueExpression({
      arrival: '2026-01-15',
      createdAt: { [PREVIEW_TYPED_VALUE_TAG]: 'date', iso: '2026-01-15T09:00:00.000Z' },
      label: 'kept',
    });
    const value = runInNewContext(
      `${createPreviewSampleDateApiExpression()}.baseOverride = new Date(2026, 9, 6, 12);
      (${expression})`,
    ) as { readonly arrival: string; readonly createdAt: Date; readonly label: string };

    expect(value.arrival).toBe('2026-10-06');
    expect(value.createdAt.toISOString()).toBe('2026-10-06T09:00:00.000Z');
    expect(value.label).toBe('kept');
  });
});

describe('resolvePreviewTypeLibDirectory', () => {
  /** A packaged extension's `dist/typescript-lib` wins over TypeScript's own location. */
  it('prefers the lib catalog beside the bundled node_modules', async () => {
    const root = await mkdtemp(path.join(REPOSITORY_ROOT, 'test/fixtures/type-lib-'));
    try {
      const libDirectory = path.join(root, 'dist', 'typescript-lib');
      await mkdir(libDirectory, { recursive: true });
      await writeFile(path.join(libDirectory, 'lib.es2022.d.ts'), '');

      expect(resolvePreviewTypeLibDirectory(path.join(root, 'node_modules'))).toBe(libDirectory);
      expect(resolvePreviewTypeLibDirectory(path.join(root, 'missing', 'node_modules'))).toBe(
        path.dirname(ts.getDefaultLibFilePath({})),
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
