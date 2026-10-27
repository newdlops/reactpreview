/** Verifies source-only controller admission stays exact, finite and request-owned. */
import { describe, expect, it, vi } from 'vitest';
import {
  createPreviewSelectedPageTabHookProof,
  readPreviewSelectedPageTabHookNames,
} from '../../../../src/adapters/esbuild/staticResources/previewSelectedPageTabHookProof';

const hook = `import {useState} from 'react'; import {useLocation,useNavigate} from 'react-router-dom';
export const useQueryTab=(defaultKey)=>{
 const location=useLocation(),navigate=useNavigate();
 const params=new URLSearchParams(location.search);
 const [key,setKey]=useState(params.get('tab')||defaultKey);
 const select=(next)=>{setKey(next);params.set('tab',next);navigate({pathname:location.pathname,search:\`?\${params.toString()}\`},{replace:true});};
 return [{activeKey:key,onSelect:select}];
};`;

describe('selected page tab hook source proof', () => {
  it('reuses one exact source/export promise and never evaluates a module', async () => {
    const read = vi.fn(() => Promise.resolve(hook));
    const proof = createPreviewSelectedPageTabHookProof(() => '/workspace/hook.ts', read);
    const first = proof('./hook', '/workspace/Page.tsx', 'useQueryTab');
    expect(proof('./alias', '/workspace/Other.tsx', 'useQueryTab')).toBe(first);
    expect(await first).toBe(true);
    expect(read).toHaveBeenCalledExactlyOnceWith('/workspace/hook.ts', 32768);
    expect(await proof('./hook', '/workspace/Page.tsx', 'useUnknown')).toBe(false);
  });

  it('rejects missing, oversized and malformed source', async () => {
    for (const source of [undefined, hook + ' '.repeat(32768), hook.slice(0, -2)]) {
      const proof = createPreviewSelectedPageTabHookProof(
        () => '/workspace/hook.ts',
        () => Promise.resolve(source),
      );
      expect(await proof('./hook', '/workspace/Page.tsx', 'useQueryTab')).toBe(false);
    }
    const read = vi.fn(() => Promise.resolve(hook));
    expect(
      await createPreviewSelectedPageTabHookProof(() => undefined, read)(
        './missing',
        '/workspace/Page.tsx',
        'useQueryTab',
      ),
    ).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it('caps request probes without reading a thirty-third source', async () => {
    const read = vi.fn(() => Promise.resolve(hook));
    const proof = createPreviewSelectedPageTabHookProof(
      (specifier) => '/workspace/' + specifier + '.ts',
      read,
    );
    for (let index = 0; index < 32; index += 1)
      expect(await proof('hook' + index.toString(), '/workspace/Page.tsx', 'useQueryTab')).toBe(
        true,
      );
    expect(await proof('hook32', '/workspace/Page.tsx', 'useQueryTab')).toBe(false);
    expect(read).toHaveBeenCalledTimes(32);
  });

  it('accepts only proven imported bindings, including an exact exported-name alias', async () => {
    const admit = vi.fn((_specifier: string, _importer: string, exportName: string) =>
      Promise.resolve(exportName === 'useQueryTab'),
    );
    const source = `import {useQueryTab as useTabs, useSession} from './hooks'; export const Page=()=> <Tab/>;`;
    expect(await readPreviewSelectedPageTabHookNames('/workspace/Page.tsx', source, admit)).toEqual(
      new Set(['useTabs']),
    );
    expect(admit).toHaveBeenCalledWith('./hooks', '/workspace/Page.tsx', 'useQueryTab');
    admit.mockClear();
    expect(
      await readPreviewSelectedPageTabHookNames(
        '/workspace/Page.tsx',
        source.replace('<Tab/>', '<main/>'),
        admit,
      ),
    ).toBeUndefined();
    expect(admit).not.toHaveBeenCalled();
  });
});
