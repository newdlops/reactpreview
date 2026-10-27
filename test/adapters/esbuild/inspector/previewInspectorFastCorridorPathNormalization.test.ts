/** Preserves actual POSIX/Windows corridor boundaries while Node performs relative normalization. */
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const variants = [
  {
    name: 'POSIX',
    implementation: path.posix,
    cases: [
      ['/workspace/app', '/workspace/app', true],
      ['/workspace/app', '/workspace/app/src/page.tsx', true],
      ['/workspace/app/', '/workspace/app/src/../page.tsx', true],
      ['/workspace/app', '/workspace/application/page.tsx', false],
      ['/workspace/app', '/workspace/app-other/page.tsx', false],
      ['/workspace/app', '/workspace/app/../private/page.tsx', false],
      ['/workspace/app', '/workspace/app/src/../../private/page.tsx', false],
      ['/workspace/work/../app', '/workspace/app/page.tsx', true],
      ['workspace/app', 'workspace/app/src/page.tsx', true],
      ['', 'src/page.tsx', true],
      ['', '', true],
      ['/', '/else/page.tsx', true],
      ['/workspace/App', '/workspace/app/page.tsx', false],
      ['/workspace/팀', '/workspace/팀/페이지.tsx', true],
    ] as const,
    relativeRoot: '/workspace/App',
    relativeChild: '/workspace/App/SRC/Page.tsx',
  },
  {
    name: 'Windows',
    implementation: path.win32,
    cases: [
      [String.raw`C:\workspace\app`, String.raw`C:\workspace\app`, true],
      [String.raw`C:\workspace\app`, String.raw`C:\workspace\app\src\page.tsx`, true],
      ['C:\\workspace\\app\\', String.raw`C:\workspace\app\src\..\page.tsx`, true],
      [String.raw`C:\workspace\app`, String.raw`C:\workspace\application\page.tsx`, false],
      [String.raw`C:\workspace\app`, String.raw`C:\workspace\app-other\page.tsx`, false],
      [String.raw`C:\workspace\app`, String.raw`C:\workspace\app\..\private\page.tsx`, false],
      [String.raw`C:\workspace\work\..\app`, String.raw`C:\workspace\app\page.tsx`, true],
      [String.raw`C:\WORKSPACE\App`, String.raw`c:\workspace\app\page.tsx`, true],
      [String.raw`C:\workspace\app`, String.raw`D:\workspace\app\page.tsx`, false],
      [String.raw`\\server\share\app`, String.raw`\\server\share\app\page.tsx`, true],
      [String.raw`\\server\share\app`, String.raw`\\server\share\application\page.tsx`, false],
      [String.raw`\\server\share\app`, String.raw`\\other\share\app\page.tsx`, false],
      [String.raw`\\server\share`, String.raw`\\server\share\app\page.tsx`, true],
      [String.raw`C:\workspace\팀`, String.raw`C:\workspace\팀\페이지.tsx`, true],
      ['', 'src/page.tsx', true],
      ['', '', true],
    ] as const,
    relativeRoot: String.raw`C:\Workspace\App`,
    relativeChild: String.raw`c:\workspace\app\SRC\Page.tsx`,
  },
] as const;

describe.each(variants)('$name fast corridor path boundaries', (variant) => {
  let corridor: typeof import('../../../../src/adapters/esbuild/inspector/previewInspectorFastCorridorPaths');

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('node:path', () => ({ default: variant.implementation }));
    corridor =
      await import('../../../../src/adapters/esbuild/inspector/previewInspectorFastCorridorPaths');
  });

  afterAll(() => {
    vi.doUnmock('node:path');
    vi.resetModules();
  });

  it.each(variant.cases)('keeps %s → %s containment at %s', (root, candidate, expected) => {
    expect(corridor.isPathInside(root, candidate)).toBe(expected);
  });

  it('preserves portable relative semantic paths', () => {
    expect(
      corridor.normalizePortableRelativePath(variant.relativeRoot, variant.relativeChild),
    ).toBe('src/page.tsx');
  });
});
