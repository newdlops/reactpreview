import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createReactContextFallbackReplacements,
  type ReactContextFallbackReplacement,
} from '../../../../src/adapters/esbuild/staticResources/reactContextFallback';
import { PreviewSourceTransformer } from '../../../../src/adapters/esbuild/staticResources/previewSourceTransformer';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((temporaryRoot) => rm(temporaryRoot, { force: true, recursive: true })),
  );
});

describe('resolved React Context type fallback', () => {
  it('consults bounded type evidence only after local Context serialization fails', () => {
    const source = [
      "import { createContext } from 'react';",
      "import type { RemoteContext } from './remote';",
      'export const AppContext = createContext<RemoteContext>(null as any);',
    ].join('\n');
    const resolveTypeFallback = vi.fn(() => ({
      expression: 'Object.freeze({ user: Object.freeze({ fullName: "fullName" }) })',
    }));

    const replacements = createReactContextFallbackReplacements(
      '/workspace/app-context.tsx',
      source,
      resolveTypeFallback,
    );
    const rewritten = applyReplacements(source, replacements);

    expect(resolveTypeFallback).toHaveBeenCalledOnce();
    expect(rewritten).toContain(
      'createContext<RemoteContext>(((Object.freeze({ user: Object.freeze({ fullName: "fullName" }) })) as any))',
    );
  });

  it('reuses import-aware Page Inspector type inference for a partially external Context type', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-context-type-'));
    temporaryRoots.push(workspaceRoot);
    const sourcePath = path.join(workspaceRoot, 'app-context.tsx');
    const source = [
      "import { createContext } from 'react';",
      "import type { RemoteContext } from './remote';",
      'type AppContextType = {',
      '  user: { email: string; fullName: string };',
      '  siteSettings: { legalSiteUrl: string };',
      '  refetchContext: RemoteContext["refetch"];',
      '};',
      'export const AppContext = createContext<AppContextType>(null as any);',
    ].join('\n');
    await writeFile(sourcePath, source, 'utf8');
    const transformer = new PreviewSourceTransformer({
      graphqlModuleResolver: { resolve: () => undefined },
      instrumentRuntimeHookFallbacks: true,
      projectRoot: workspaceRoot,
      workspaceRoot,
    });

    const transformed = await transformer.transform(sourcePath, source);

    expect(transformed.contents).toContain('createContext<AppContextType>(((Object.freeze({');
    expect(transformed.contents).toContain(
      '"siteSettings": Object.freeze({ "legalSiteUrl": "https://example.invalid/" })',
    );
    expect(transformed.contents).toContain(
      '"user": Object.freeze({ "email": "preview@example.invalid", "fullName": "fullName" })',
    );
    expect(transformed.contents).not.toContain('createContext<AppContextType>(null as any)');
  });
});

/** Applies source replacements from right to left so authored offsets remain stable. */
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
