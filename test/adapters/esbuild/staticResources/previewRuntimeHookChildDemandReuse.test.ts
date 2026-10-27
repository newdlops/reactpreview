/** Verifies exact child lookup avoids unrelated analysis while complete iteration retains all fields. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PreviewRuntimeHookChildPropDemandCatalogBuilder } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookChildPropDemand';

const parentPath = '/workspace/Parent.tsx';
const childPath = '/workspace/Child.tsx';
const grandchildPath = '/workspace/Grandchild.tsx';
const parentSource = [
  'import { useData } from "./use-data";',
  'import { Child } from "./Child";',
  'import { Decorative } from "./Decorative";',
  'export function Parent() {',
  '  const { user, settings } = useData();',
  '  return <><Child user={user} settings={settings} /><Decorative label="Fixed heading" /></>;',
  '}',
].join('\n');

/** A fresh builder owns one exact in-memory source snapshot and its existing bounded resolver. */
function createBuilder(readPaths: string[]): PreviewRuntimeHookChildPropDemandCatalogBuilder {
  const sources = new Map([
    [parentPath, parentSource],
    [
      childPath,
      'import { Grandchild } from "./Grandchild"; export const Child = ({ user, settings }) => <Grandchild user={user} settings={settings} />;',
    ],
    [
      grandchildPath,
      'export const Grandchild = ({ user, settings }) => <main>{user.name}{settings.title}</main>;',
    ],
    [
      '/workspace/Decorative.tsx',
      'export const Decorative = ({ label }: { label: string }) => <h2>{label}</h2>;',
    ],
  ]);
  return new PreviewRuntimeHookChildPropDemandCatalogBuilder({
    readSource: (sourcePath) => {
      readPaths.push(sourcePath);
      return sources.get(sourcePath);
    },
    resolveModule: (specifier, importer) => {
      const sourcePath = path.resolve(path.dirname(importer), specifier) + '.tsx';
      return sources.has(sourcePath) ? sourcePath : undefined;
    },
    workspaceRoot: '/workspace',
  });
}

describe('requested child contracts', () => {
  /** A hook read needs its data consumer; a fixed heading remains available for full enumeration. */
  it('defers unrelated child analysis and preserves complete catalog iteration', () => {
    const reads: string[] = [];
    const builder = createBuilder(reads);
    const catalog = builder.collect(parentPath, parentSource, { includeOptionalTypes: true });

    expect(reads).toEqual([]);
    expect(catalog.get('Child')?.get('user')?.properties?.name?.kind).toBe('string');
    expect(catalog.get('Child')?.get('settings')?.properties?.title?.kind).toBe('string');
    expect(reads).not.toContain('/workspace/Decorative.tsx');
    expect([...catalog.keys()]).toEqual(['Child', 'Decorative']);
    expect(catalog.get('Decorative')?.get('label')?.kind).toBe('string');
    expect(catalog.size).toBe(2);
  });
});
