/** Verifies a selected tab changes only a proven initial controller input, never live tab props. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { instrumentReactConditionalRendering } from '../../../../src/adapters/esbuild/staticResources/reactConditionalRendering';
import { createPreviewInspectorPageTabDefaultRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageTabDefaultRuntimeSource';

const sourcePath = '/workspace/Page.tsx';
const source = `import {Tab,TabItem} from './tab'; import {useQueryTab} from './hook';
import {Selected,Other} from './body';
export const Page=()=>{
 const [tabProps]=useQueryTab('first','custom-query');
 return <Tab {...tabProps}>
   <TabItem eventKey="first"><Other/></TabItem>
   <TabItem eventKey="target"><Selected/></TabItem>
 </Tab>;
};`;

describe('selected page tab default', () => {
  it('wraps only the initial default and retains the real controller, query option and spread', () => {
    const result = instrumentReactConditionalRendering(
      sourcePath,
      source,
      undefined,
      new Set(['Selected']),
      new Set(['useQueryTab']),
    );
    expect(result).toContain(".resolveTargetPageTabDefault(('first'),");
    expect(result).toContain('"targetKey":"target"');
    expect(result).toContain(",'custom-query')");
    expect(result).toContain('<Tab {...tabProps}>');
    expect(result).not.toContain('activeKey=');
    expect(instrumentReactConditionalRendering(sourcePath, source)).toBe(source);
  });

  it.each([
    ['dynamic default', source.replace("useQueryTab('first'", 'useQueryTab(props.key')],
    ['dynamic key', source.replace('eventKey="target"', 'eventKey={key}')],
    ['duplicate key', source.replace('eventKey="target"', 'eventKey="first"')],
    ['ambiguous target', source.replace('<Other/>', '<Selected/>')],
    ['reused controller', source.replace('return <Tab', 'inspect(tabProps); return <Tab')],
    ['multiple spreads', source.replace('<Tab {...tabProps}', '<Tab {...extra} {...tabProps}')],
    [
      'explicit selection',
      source.replace('<Tab {...tabProps}', '<Tab activeKey="first" {...tabProps}'),
    ],
    ['shadowed controller', source.replace('()=>{', '(useQueryTab)=>{')],
    ['shadowed target', source.replace('()=>{', '(Selected)=>{')],
    ['unimported tab', source.replace('import {Tab,TabItem}', 'import {TabItem}')],
    ['non-default literal', source.replace("useQueryTab('first'", "useQueryTab('absent'")],
  ])('does not add an initial selector for %s', (_label, input) => {
    expect(
      instrumentReactConditionalRendering(
        sourcePath,
        input,
        undefined,
        new Set(['Selected']),
        new Set(['useQueryTab']),
      ),
    ).not.toContain('.resolveTargetPageTabDefault(');
  });

  it('preserves the selected default through the existing scoped hook instrumentation', () => {
    const wrapped = source.replace(
      "useQueryTab('first','custom-query')",
      `globalThis[Symbol.for('newdlops.react-file-preview.page-inspector')].resolveRuntimeHook(() => (useQueryTab('first','custom-query')), () => ([{}]), {})`,
    );
    expect(
      instrumentReactConditionalRendering(
        sourcePath,
        wrapped,
        undefined,
        new Set(['Selected']),
        new Set(['useQueryTab']),
      ),
    ).toContain(".resolveTargetPageTabDefault(('first'),");
    expect(
      instrumentReactConditionalRendering(
        sourcePath,
        wrapped.replace('.resolveRuntimeHook(', '.unrelatedWrapper('),
        undefined,
        new Set(['Selected']),
        new Set(['useQueryTab']),
      ),
    ).not.toContain('.resolveTargetPageTabDefault(');
    expect(
      instrumentReactConditionalRendering(sourcePath, source, undefined, new Set(['Selected'])),
    ).not.toContain('.resolveTargetPageTabDefault(');
  });

  it('resolves only the exact active owner/target path with fallback values enabled', () => {
    const candidate = {
      renderPath: {
        steps: [
          { label: 'Selected', sourcePath: '/workspace/body.tsx' },
          { label: 'Page', sourcePath },
        ],
      },
    };
    const context = {
      previewInspectorSession: { fallbackValuesEnabled: true },
      candidate,
      result: undefined as unknown,
    };
    vm.runInNewContext(
      `const findSelectedPreviewInspectorDescriptor=()=>({}); const readSelectedPreviewInspectorPageCandidate=()=>candidate; ${createPreviewInspectorPageTabDefaultRuntimeSource()} globalThis.result=resolvePreviewInspectorTargetPageTabDefault;`,
      context,
    );
    const resolve = context.result as (value: string, metadata: Record<string, unknown>) => string;
    const metadata = {
      sourcePath,
      ownerName: 'Page',
      targetName: 'Selected',
      targetKey: 'target',
      keys: ['first', 'target'],
    };
    expect(resolve('first', metadata)).toBe('target');
    expect(resolve('unknown', metadata)).toBe('unknown');
    expect(resolve('first', { ...metadata, sourcePath: '/workspace/other.tsx' })).toBe('first');
    expect(resolve('first', { ...metadata, ownerName: 'Other' })).toBe('first');
    expect(resolve('first', { ...metadata, targetName: 'Other' })).toBe('first');
    expect(resolve('first', { ...metadata, keys: ['first', 'first', 'target'] })).toBe('first');
    context.previewInspectorSession.fallbackValuesEnabled = false;
    expect(resolve('first', metadata)).toBe('first');
  });
});
