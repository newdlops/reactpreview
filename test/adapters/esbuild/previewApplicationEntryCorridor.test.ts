/** Proves omitted application owners without evaluating entry code or following unrelated apps. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPreviewApplicationEntryCorridor } from '../../../src/adapters/esbuild/previewApplicationEntryCorridor';

const ROOT = path.resolve('/workspace/client');
const ENTRY = path.join(ROOT, 'src/index.tsx');
const APP = path.join(ROOT, 'src/app.tsx');
const PRODUCT = path.join(ROOT, 'src/product/app.tsx');
const PAGE = path.join(ROOT, 'src/product/Page.tsx');

/** Builds a current-source resolver and records inert source reads for budget assertions. */
function fixture(files: ReadonlyMap<string, string>): {
  readonly prove: (
    sourcePath: string,
    sourceText: string,
  ) => Promise<readonly { readonly sourcePath: string; readonly exportName: string }[] | undefined>;
  readonly reads: string[];
} {
  const reads: string[] = [];
  const prove = createPreviewApplicationEntryCorridor({
    projectRoot: ROOT,
    rootSourcePaths: [PAGE],
    readSource: ({ sourcePath }) => {
      reads.push(sourcePath);
      return Promise.resolve(files.get(sourcePath));
    },
    resolveModule: (specifier, importer) => {
      const candidate = path.resolve(path.dirname(importer), specifier);
      return ['', '.tsx', '.ts']
        .map((extension) => candidate + extension)
        .find((file) => files.has(file));
    },
  });
  return { prove, reads };
}

describe('application style owner corridor', () => {
  it('keeps runtime side-effect imports eligible for stylesheet ownership', async () => {
    const { prove } = fixture(new Map([[PAGE, 'export default () => null;']]));
    expect(await prove(ENTRY, "import './product/Page';")).toEqual([
      { sourcePath: ENTRY, exportName: 'default' },
    ]);
  });

  it('bounds module and source-text work without expanding a wide unrelated entry', async () => {
    const files = new Map(
      Array.from({ length: 80 }, (_, index) => [
        path.join(ROOT, 'src/leaf' + String(index) + '.tsx'),
        'export default () => null;',
      ]),
    );
    const text = Array.from(
      { length: 80 },
      (_, index) => 'import Leaf' + String(index) + " from './leaf" + String(index) + "';",
    ).join('\n');
    const { prove, reads } = fixture(files);
    expect(await prove(ENTRY, text)).toBeUndefined();
    expect(reads.length).toBeLessThanOrEqual(31);
    const large = fixture(files);
    expect(await large.prove(ENTRY, ' '.repeat(1024 * 1024 + 1))).toBeUndefined();
    expect(large.reads).toEqual([]);
  });

  it('recovers only the owners connecting a lazy entry to the selected product page', async () => {
    const text = "const App = lazy(() => import('./app')); throw new Error('NEVER_EXECUTE');";
    const files = new Map([
      [ENTRY, text],
      [APP, "import { Product } from './product/app'; import Other from './other';"],
      [PRODUCT, "import Page from './Page'; export const Product = () => <Page />;"],
      [PAGE, 'export default () => <main />;'],
      [path.join(ROOT, 'src/other.tsx'), 'throw new Error("UNRELATED");'],
    ]);
    const { prove, reads } = fixture(files);
    expect(await prove(ENTRY, text)).toEqual([
      { sourcePath: ENTRY, exportName: 'default' },
      { sourcePath: APP, exportName: 'default' },
      { sourcePath: PRODUCT, exportName: 'Product' },
    ]);
    expect(reads).not.toContain(path.join(ROOT, 'src/other.tsx'));
  });

  it.each([
    "import type Page from './product/Page';",
    "import {type Page} from './product/Page';",
    "export type {Page} from './product/Page';",
    'const App = import(dynamicPath);',
  ])('rejects erased or unproven edges: %s', async (text) => {
    const { prove } = fixture(new Map([[PAGE, 'export default function Page() {}']]));
    expect(await prove(ENTRY, text)).toBeUndefined();
  });

  it('bounds cycles and depth without admitting an unrelated owner', async () => {
    const text = "import App from './app';";
    const files = new Map([
      [ENTRY, text],
      [APP, "import App from './index'; import Product from './product/app';"],
      [PRODUCT, "import Leaf from './deep';"],
      [path.join(ROOT, 'src/product/deep.tsx'), "import Leaf from './deeper';"],
      [path.join(ROOT, 'src/product/deeper.tsx'), "import Page from './Page';"],
      [PAGE, 'export default () => null;'],
    ]);
    const { prove, reads } = fixture(files);
    expect(await prove(ENTRY, text)).toBeUndefined();
    expect(new Set(reads).size).toBe(reads.length);
  });

  it('does not cross the application boundary or installed-package trees', async () => {
    for (const relative of ['../../other/Page', '../node_modules/pkg/Page']) {
      const text = `import Page from '${relative}';`;
      const outside = path.resolve(path.dirname(ENTRY), relative + '.tsx');
      const { prove, reads } = fixture(
        new Map([
          [outside, "import Page from '" + path.relative(path.dirname(outside), PAGE) + "';"],
          [PAGE, 'export default () => null;'],
        ]),
      );
      expect(await prove(ENTRY, text)).toBeUndefined();
      expect(reads).toEqual([]);
    }
  });

  it('shares current source reads across candidates but rebuilds evidence on the next lookup', async () => {
    const files = new Map([
      [APP, "import Page from './product/Page';"],
      [PAGE, 'export default () => null;'],
    ]);
    const text = "import App from './app';";
    const first = fixture(files);
    expect(await first.prove(ENTRY, text)).toBeDefined();
    expect(await first.prove(ENTRY, text)).toBeDefined();
    expect(first.reads.filter((file) => file === APP)).toHaveLength(1);
    files.set(APP, 'export default () => null;');
    expect(await fixture(files).prove(ENTRY, text)).toBeUndefined();
  });
});
