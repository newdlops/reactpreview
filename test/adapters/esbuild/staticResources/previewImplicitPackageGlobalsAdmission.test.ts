/** Verifies lazy lexical checking preserves free-value admission while skipping proven bound imports. */
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectPreviewImplicitPackageGlobals } from '../../../../src/adapters/esbuild/staticResources/previewImplicitPackageGlobals';

vi.mock('typescript', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof ts }>();
  return {
    ...actual,
    default: { ...actual.default, createProgram: vi.fn(actual.default.createProgram) },
  };
});

beforeEach(() => {
  vi.mocked(ts.createProgram).mockClear();
});

/** Uses only exact fake package entry identities; lexical checking cannot read project files. */
function inventory(sourceText: string): {
  readonly result: ReturnType<typeof collectPreviewImplicitPackageGlobals>;
  readonly resolve: ReturnType<typeof vi.fn<(specifier: string) => string>>;
} {
  const resolve = vi.fn((specifier: string) => `/workspace/node_modules/${specifier}/index.js`);
  const result = collectPreviewImplicitPackageGlobals({
    candidateNames: ['dayjs', 'leftpad', 'lodash'],
    resolver: { resolve },
    sourcePath: '/workspace/Panel.tsx',
    sourceText,
  });
  return { result, resolve };
}

describe('implicit package lexical admission', () => {
  it('does not create a checker for value imports, including aliases and nested shadowing', () => {
    const { result, resolve } = inventory(
      [
        "import dayjs from 'dayjs';",
        "import { pad as leftpad } from 'leftpad';",
        "import * as lodash from 'lodash';",
        "const timestamp = dayjs('2026-10-26');",
        'function nested(dayjs: () => string) { return dayjs(); }',
        'export const value = leftpad(lodash.toString(timestamp));',
      ].join('\n'),
    );
    expect(result.globals).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
    expect(ts.createProgram).not.toHaveBeenCalled();
  });

  it('does not create a checker for identifiers used only in erased type positions', () => {
    const { result } = inventory('export type DateValue = dayjs.Dayjs;');
    expect(result.globals).toEqual([]);
    expect(ts.createProgram).not.toHaveBeenCalled();
  });

  it.each([
    "import type dayjs from 'dayjs'; export const value = dayjs();",
    'declare const dayjs: any; export const value = dayjs();',
  ])('keeps the existing semantic checker for erased or ambient declarations: %s', (source) => {
    const { result, resolve } = inventory(source);
    expect(result.globals.map((entry) => entry.globalName)).toEqual(['dayjs']);
    expect(resolve).toHaveBeenCalledWith('dayjs', '/workspace/Panel.tsx');
    expect(ts.createProgram).toHaveBeenCalledTimes(1);
  });

  it('creates one checker when a true free value remains beside a bound import', () => {
    const { result, resolve } = inventory(
      "import dayjs from 'dayjs'; export const value = leftpad(dayjs().format()) + leftpad('x');",
    );
    expect(result.globals.map((entry) => entry.globalName)).toEqual(['leftpad']);
    expect(result.globals[0]?.references).toHaveLength(2);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(ts.createProgram).toHaveBeenCalledTimes(1);
  });
});
