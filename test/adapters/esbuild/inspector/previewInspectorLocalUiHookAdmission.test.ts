/** Frozen-frontier admission keeps authored transformations under the existing source-proof caps. */
import { describe, expect, it, vi } from 'vitest';
import { createPreviewInspectorLocalUiHookAdmission } from '../../../../src/adapters/esbuild/inspector/previewInspectorLocalUiHookAdmission';
import type { PreviewInspectorBundleResolvedStaticEdge } from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleSourceInventoryMemo';

describe('bounded authored UI hook admission', () => {
  it('retains callback transforms before freezing the graph and shares the same proof', async () => {
    const readSource = vi.fn(() =>
      Promise.resolve(`import {useCallback} from 'react';
      import {useSession} from './session';
      export function useColumns(){const session=useSession();
        const setColumn=useCallback(column=>({...column,label:column.label.trim()}),[]);
        return {setColumn,session};}`),
    );
    const admit = createPreviewInspectorLocalUiHookAdmission(readSource);
    const request = edge('/workspace/columns.ts');
    expect(await admit(request)).toBe(true);
    expect(await admit(request)).toBe(true);
    expect(readSource).toHaveBeenCalledTimes(1);
  });

  it.each([
    `import {useQuery} from './backend';export function useColumns(){return useQuery();}`,
    `import {useEffect} from 'react';import {subscribe} from './backend';
      export function useColumns(){useEffect(()=>subscribe(),[]);}`,
    'export function useColumns( { return',
    ' '.repeat(32 * 1024) + 'export function useColumns(){return [1,2,3];}',
  ])(
    'keeps pass-through, effect-only, malformed, and oversized sources outside admission',
    async (source) => {
      const admit = createPreviewInspectorLocalUiHookAdmission(() => Promise.resolve(source));
      expect(await admit(edge('/workspace/columns.ts'))).toBe(false);
    },
  );

  it('does not expand the number of source probes to retain more transformations', async () => {
    const readSource = vi.fn(() =>
      Promise.resolve('export function useColumns(value){return value.map(x=>x.label);}'),
    );
    const admit = createPreviewInspectorLocalUiHookAdmission(readSource);
    for (let index = 0; index < 64; index += 1) {
      expect(await admit(edge(`/workspace/columns-${index.toString()}.ts`))).toBe(true);
    }
    expect(await admit(edge('/workspace/overflow.ts'))).toBe(false);
    expect(readSource).toHaveBeenCalledTimes(64);
  });
});

/** Represents one already-proven hook-only projection edge, without any executable project input. */
function edge(targetPath: string): PreviewInspectorBundleResolvedStaticEdge {
  return {
    identity: targetPath,
    kind: 'authored',
    targetPath,
    projection: {
      exportNames: ['useColumns'],
      runtimeHookExportNames: ['useColumns'],
      moduleSpecifier: './columns',
      occurrenceStart: 0,
    },
  };
}
