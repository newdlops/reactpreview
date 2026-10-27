/** Verifies child contracts are read only for proven hook-to-JSX forwarding, with identical output. */
import { describe, expect, it, vi } from 'vitest';
import type { PreviewRuntimeHookChildPropDemandCatalog } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookChildPropDemand';
import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';

const SOURCE_PATH = '/workspace/Page.tsx';
const CATALOG: PreviewRuntimeHookChildPropDemandCatalog = new Map([
  [
    'Child',
    new Map([['item', { kind: 'object', properties: { name: { kind: 'string' } } } as const]]),
  ],
]);

describe('demand-driven runtime hook child contracts', () => {
  it.each([
    'export function Page() { return <Child item={{ name: "saved" }} />; }',
    'import { useIgnored } from "./hooks"; export function Page() { useIgnored(); return <Child item={{ name: "saved" }} />; }',
    'import { useItem } from "./hooks"; export function Page() { const item = useItem(); return <><p>{item.name}</p><Child item={{ name: "saved" }} /></>; }',
    'import { useItem } from "./hooks"; export function Page() { const item = useItem(); return <><p>{item.name}</p>{[1].map(item => <Child item={item} />)}</>; }',
    'import { useItem } from "./hooks"; export function Page() { const item = useItem(); return <><p>{item.name}</p><Child {...{ item: { name: "saved" } }} /></>; }',
  ])('does not traverse children without exact hook-result forwarding: %s', (source) => {
    const readCatalog = vi.fn(() => CATALOG);

    const eager = createPreviewRuntimeHookReplacements(SOURCE_PATH, source, CATALOG);
    const lazy = createPreviewRuntimeHookReplacements(SOURCE_PATH, source, readCatalog);

    expect(lazy).toEqual(eager);
    expect(readCatalog).not.toHaveBeenCalled();
  });

  it.each([
    'return <Child item={useItem()} />;',
    'const item = useItem(); return <Child item={item} />;',
    'const result = useItem(); const item = result.record; return <Child item={item} />;',
    'const { record: item } = useItem(); return <Child item={item} />;',
    'const item = useItem(); return <Child {...{ item }} />;',
    'const item = useItem(); const props = { item }; return <Child {...props} />;',
  ])('keeps the eager fallback for direct, aliased, destructured and spread values: %s', (body) => {
    const source = `import { useItem } from "./hooks"; export function Page() { ${body} }`;
    const readCatalog = vi.fn(() => CATALOG);

    const eager = createPreviewRuntimeHookReplacements(SOURCE_PATH, source, CATALOG);
    const lazy = createPreviewRuntimeHookReplacements(SOURCE_PATH, source, readCatalog);

    expect(eager.length).toBeGreaterThan(0);
    expect(JSON.stringify(eager)).toContain('name');
    expect(lazy).toEqual(eager);
    expect(readCatalog).toHaveBeenCalledTimes(1);
  });

  it('reads one source catalog once across multiple forwarded hooks and attributes', () => {
    const source = `import { useItem } from "./hooks";
      export function Page() {
        const first = useItem(); const second = useItem();
        return <><Child item={first} /><Child item={second} /><Child item={first} /></>;
      }`;
    const readCatalog = vi.fn(() => CATALOG);

    expect(createPreviewRuntimeHookReplacements(SOURCE_PATH, source, readCatalog)).toEqual(
      createPreviewRuntimeHookReplacements(SOURCE_PATH, source, CATALOG),
    );
    expect(readCatalog).toHaveBeenCalledTimes(1);
  });

  it('never retains a catalog across a fresh source transformation', () => {
    const source = `import { useItem } from "./hooks";
      export function Page() { return <Child item={useItem()} />; }`;
    const readCatalog = vi.fn(() => CATALOG);

    createPreviewRuntimeHookReplacements(SOURCE_PATH, source, readCatalog);
    createPreviewRuntimeHookReplacements(SOURCE_PATH, source, readCatalog);

    expect(readCatalog).toHaveBeenCalledTimes(2);
  });
});
