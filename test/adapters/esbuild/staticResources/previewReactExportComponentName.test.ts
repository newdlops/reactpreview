/**
 * Verifies the declared component name read behind a module export: what React mounts for a
 * default export (RootLayout, MyApp) rather than its file name, and nothing for anonymous exports.
 */
import { describe, expect, it } from 'vitest';
import { readPreviewReactExportComponentName } from '../../../../src/adapters/esbuild/staticResources/previewReactExportComponentName';

/** Reads one export of a TSX module. */
function read(sourceText: string, exportName = 'default'): string | undefined {
  return readPreviewReactExportComponentName({
    exportName,
    sourcePath: '/workspace/app/layout.tsx',
    sourceText,
  });
}

describe('readPreviewReactExportComponentName', () => {
  it.each([
    ['a default function', 'export default function RootLayout() { return null; }', 'RootLayout'],
    [
      'a wrapper call on a local function',
      'function MyApp() { return null; }\nexport default wrapper.withRedux(MyApp);',
      'MyApp',
    ],
    [
      'a curried wrapper call',
      'const Page = () => null;\nexport default connect(mapState)(Page);',
      'Page',
    ],
    [
      'a local identifier',
      'function AppShell() { return null; }\nexport default AppShell;',
      'AppShell',
    ],
    [
      'a default class',
      'export default class MyApp extends App { render() { return null; } }',
      'MyApp',
    ],
    ['an arrow bound to a const', 'const Home = () => null;\nexport default Home;', 'Home'],
    [
      'an export clause alias',
      'function Local() { return null; }\nexport { Local as default };',
      'Local',
    ],
  ])('names %s', (_label, sourceText, expected) => {
    expect(read(sourceText)).toBe(expected);
  });

  it('returns nothing for anonymous or unresolved exports', () => {
    expect(read('export default () => null;')).toBeUndefined();
    expect(read("import Layout from './Layout';\nexport default Layout;")).toBeUndefined();
    expect(read('export default styled.div`color: red;`;')).toBeUndefined();
  });

  it('reads named exports by their own declaration', () => {
    expect(read('export const Header = () => null;', 'Header')).toBe('Header');
    expect(read('export function Footer() { return null; }', 'Footer')).toBe('Footer');
    expect(read('export default function Footer() { return null; }', 'Footer')).toBeUndefined();
  });
});
