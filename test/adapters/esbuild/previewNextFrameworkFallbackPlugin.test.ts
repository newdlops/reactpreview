/** Verifies inert Next.js render facades for declared projects without installed framework files. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {
  build,
  context,
  type BuildOptions,
  type BuildResult,
  type OnLoadResult,
  type Plugin,
} from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewNextFrameworkFallbackPlugin } from '../../../src/adapters/esbuild/previewNextFrameworkFallbackPlugin';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('Next framework render fallback', () => {
  /** Renders images, links, and named Google fonts from declaration evidence alone. */
  it('supplies exact visual modules for a declared dependency-free Next project', async () => {
    const projectRoot = await createProject('next-missing-', {
      dependencies: { next: '15.5.20', react: '19.1.0' },
    });
    const entryPath = path.join(projectRoot, 'src', 'entry.ts');
    await mkdir(path.dirname(entryPath), { recursive: true });
    await writeFile(
      entryPath,
      [
        "import Image, { getImageProps } from 'next/image';",
        "import Link from 'next/link';",
        "import { Geist, Roboto_Mono } from 'next/font/google';",
        'const image = Image({ alt: "Logo", height: 38, priority: true, src: "/logo.svg", width: 180 });',
        'const link = Link({ children: "Docs", href: { pathname: "/docs", query: { tab: "api" } } });',
        'export const result = {',
        '  font: Geist({ variable: "--font-geist" }),',
        '  image,',
        '  imageProps: getImageProps({ alt: "Small", priority: true, src: { default: { height: 12, src: "/small.svg", width: 16 } } }),',
        '  link,',
        '  mono: Roboto_Mono({ subsets: ["latin"] }),',
        '};',
      ].join('\n'),
      'utf8',
    );

    const result = await buildFixture(entryPath, projectRoot, [
      createPreviewNextFrameworkFallbackPlugin({ workspaceRoot: projectRoot }),
      createReactFixturePlugin(),
    ]);
    const exports = executeCommonJs(result.outputFiles[0]?.text ?? '') as {
      readonly result: {
        readonly font: { readonly className: string; readonly variable: string };
        readonly image: PreviewFixtureElement;
        readonly imageProps: {
          readonly props: {
            readonly height: number;
            readonly loading: string;
            readonly src: string;
            readonly width: number;
          };
        };
        readonly link: PreviewFixtureElement;
        readonly mono: { readonly style: { readonly fontFamily: string } };
      };
    };

    expect(exports.result.image).toMatchObject({
      props: {
        alt: 'Logo',
        'data-react-preview-next-image': '',
        height: 38,
        loading: 'eager',
        src: '/logo.svg',
        width: 180,
      },
      tag: 'img',
    });
    expect(exports.result.image.props).not.toHaveProperty('priority');
    expect(exports.result.imageProps.props).toMatchObject({
      height: 12,
      loading: 'eager',
      src: '/small.svg',
      width: 16,
    });
    expect(exports.result.imageProps.props).not.toHaveProperty('priority');
    expect(exports.result.link).toMatchObject({
      children: ['Docs'],
      props: { 'data-react-preview-next-link': '', href: '/docs?tab=api' },
      tag: 'a',
    });
    expect(exports.result.font).toMatchObject({
      className: 'react-preview-next-font',
      variable: '--font-geist',
    });
    expect(exports.result.mono.style.fontFamily).toContain('Arial');
    expect(result.warnings.map((warning) => warning.text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('next/font/google'),
        expect.stringContaining('next/image'),
        expect.stringContaining('next/link'),
      ]),
    );
    expect(result.warnings).toHaveLength(3);
    expect(result.metafile.inputs[path.join(projectRoot, 'package.json')]).toBeUndefined();
  });

  /** Replaces installed image code because raw Next interop may expose its module object as JSX. */
  it('uses the render facade even when the raw Next image module exists', async () => {
    const projectRoot = await createProject('next-installed-', {
      dependencies: { next: '15.5.20' },
    });
    const entryPath = path.join(projectRoot, 'src', 'entry.ts');
    const nextRoot = path.join(projectRoot, 'node_modules', 'next');
    await Promise.all([
      mkdir(path.dirname(entryPath), { recursive: true }),
      mkdir(nextRoot, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        path.join(nextRoot, 'package.json'),
        JSON.stringify({ exports: { './image': './image.js' }, name: 'next', version: '15.5.20' }),
        'utf8',
      ),
      writeFile(
        path.join(nextRoot, 'image.js'),
        'module.exports = { default: function InstalledImage() { return "installed"; } };',
        'utf8',
      ),
      writeFile(
        entryPath,
        "import Image from 'next/image'; export const result = Image({ src: '/safe.png' });",
        'utf8',
      ),
    ]);

    const result = await buildFixture(entryPath, projectRoot, [
      createPreviewNextFrameworkFallbackPlugin({ workspaceRoot: projectRoot }),
      createReactFixturePlugin(),
    ]);
    const exports = executeCommonJs(result.outputFiles[0]?.text ?? '');

    expect(exports.result).toMatchObject({ props: { src: '/safe.png' }, tag: 'img' });
    expect(result.warnings[0]?.text).toContain('next/image');
  });

  /** Keeps an installed link implementation authoritative because it does not need compilation. */
  it('preserves normal link resolution when the requested public module exists', async () => {
    const projectRoot = await createProject('next-installed-link-', {
      dependencies: { next: '15.5.20' },
    });
    const entryPath = path.join(projectRoot, 'src', 'entry.ts');
    const nextRoot = path.join(projectRoot, 'node_modules', 'next');
    await Promise.all([
      mkdir(path.dirname(entryPath), { recursive: true }),
      mkdir(nextRoot, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        path.join(nextRoot, 'package.json'),
        JSON.stringify({ exports: { './link': './link.js' }, name: 'next', version: '15.5.20' }),
        'utf8',
      ),
      writeFile(
        path.join(nextRoot, 'link.js'),
        'module.exports = function InstalledLink() { return "installed-next-link"; };',
        'utf8',
      ),
      writeFile(entryPath, "import Link from 'next/link'; export const result = Link();", 'utf8'),
    ]);

    const result = await buildFixture(entryPath, projectRoot, [
      createPreviewNextFrameworkFallbackPlugin({ workspaceRoot: projectRoot }),
    ]);
    const exports = executeCommonJs(result.outputFiles[0]?.text ?? '');

    expect(exports.result).toBe('installed-next-link');
    expect(result.warnings).toEqual([]);
  });

  /** Inerts Next's deliberate browser throw while preserving the reached server module body. */
  it('treats the installed server-only marker as a static preview boundary', async () => {
    const projectRoot = await createProject('next-server-only-', {
      dependencies: { next: '15.5.20', 'server-only': '0.0.1' },
    });
    const entryPath = path.join(projectRoot, 'src', 'entry.ts');
    const markerRoot = path.join(projectRoot, 'node_modules', 'server-only');
    await Promise.all([
      mkdir(path.dirname(entryPath), { recursive: true }),
      mkdir(markerRoot, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        path.join(markerRoot, 'package.json'),
        JSON.stringify({ main: 'index.js', name: 'server-only', version: '0.0.1' }),
        'utf8',
      ),
      writeFile(
        path.join(markerRoot, 'index.js'),
        `throw new Error('server-only browser throw');`,
        'utf8',
      ),
      writeFile(entryPath, `import 'server-only'; export const result = 'renderable';`, 'utf8'),
    ]);

    const result = await buildFixture(entryPath, projectRoot, [
      createPreviewNextFrameworkFallbackPlugin({ workspaceRoot: projectRoot }),
    ]);
    const exports = executeCommonJs(result.outputFiles[0]?.text ?? '');

    expect(exports.result).toBe('renderable');
    expect(result.outputFiles[0]?.text).not.toContain('server-only browser throw');
    expect(result.warnings.map((warning) => warning.text)).toEqual([
      expect.stringContaining('server-only'),
    ]);
    expect(result.warnings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'ignored-bare-import' })]),
    );
  });

  /** Replaces installed Google-font code because raw modules require Next compiler rewriting. */
  it('keeps named fonts callable even when an installed raw module exports undefined', async () => {
    const projectRoot = await createProject('next-font-installed-', {
      dependencies: { next: '15.5.20' },
    });
    const entryPath = path.join(projectRoot, 'src', 'entry.ts');
    const fontRoot = path.join(projectRoot, 'node_modules', 'next', 'font');
    await Promise.all([
      mkdir(path.dirname(entryPath), { recursive: true }),
      mkdir(fontRoot, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        path.join(projectRoot, 'node_modules', 'next', 'package.json'),
        JSON.stringify({
          exports: { './font/google': './font/google.js' },
          name: 'next',
          version: '15.5.20',
        }),
        'utf8',
      ),
      writeFile(path.join(fontRoot, 'google.js'), 'exports.Geist = undefined;', 'utf8'),
      writeFile(
        entryPath,
        "import { Geist } from 'next/font/google'; export const result = Geist({ variable: '--font' });",
        'utf8',
      ),
    ]);

    const result = await buildFixture(entryPath, projectRoot, [
      createPreviewNextFrameworkFallbackPlugin({ workspaceRoot: projectRoot }),
    ]);
    const exports = executeCommonJs(result.outputFiles[0]?.text ?? '');

    expect(exports.result).toMatchObject({
      className: 'react-preview-next-font',
      variable: '--font',
    });
    expect(result.warnings[0]?.text).toContain('without running Next build transforms');
  });

  /** Re-reads a changed package manifest instead of retaining a failed first-build lookup. */
  it('discovers a newly declared Next dependency on persistent rebuild', async () => {
    const projectRoot = await createProject('next-rebuild-', {
      dependencies: { react: '19.1.0' },
    });
    const manifestPath = path.join(projectRoot, 'package.json');
    const entryPath = path.join(projectRoot, 'src', 'entry.ts');
    await mkdir(path.dirname(entryPath), { recursive: true });
    await writeFile(
      entryPath,
      "import Image from 'next/image'; export const result = Image({ src: '/fresh.png' });",
      'utf8',
    );
    const buildContext = await context({
      absWorkingDir: projectRoot,
      bundle: true,
      entryPoints: [entryPath],
      format: 'cjs',
      logLevel: 'silent',
      platform: 'node',
      plugins: [
        createPreviewNextFrameworkFallbackPlugin({ workspaceRoot: projectRoot }),
        createReactFixturePlugin(),
      ],
      write: false,
    });

    try {
      await expect(buildContext.rebuild()).rejects.toThrow('Could not resolve "next/image"');
      await writeFile(
        manifestPath,
        JSON.stringify({ dependencies: { next: '15.5.20', react: '19.1.0' } }),
        'utf8',
      );
      const rebuilt = await buildContext.rebuild();
      const exports = executeCommonJs(rebuilt.outputFiles[0]?.text ?? '');

      expect(exports.result).toMatchObject({ props: { src: '/fresh.png' }, tag: 'img' });
    } finally {
      await buildContext.dispose();
    }
  });

  /** Leaves missing modules actionable when the nearest package never declared Next. */
  it('fails closed without a workspace-owned Next declaration', async () => {
    const projectRoot = await createProject('next-undeclared-', {
      dependencies: { react: '19.1.0' },
    });
    const entryPath = path.join(projectRoot, 'src', 'entry.ts');
    await mkdir(path.dirname(entryPath), { recursive: true });
    await writeFile(entryPath, "import Image from 'next/image'; export default Image;", 'utf8');

    await expect(
      buildFixture(entryPath, projectRoot, [
        createPreviewNextFrameworkFallbackPlugin({ workspaceRoot: projectRoot }),
      ]),
    ).rejects.toThrow('Could not resolve "next/image"');
  });

  /** Does not generalize manifest evidence to unreviewed framework runtime modules. */
  it('keeps unsupported Next runtime imports as hard errors', async () => {
    const projectRoot = await createProject('next-unsupported-', {
      dependencies: { next: '15.5.20' },
    });
    const entryPath = path.join(projectRoot, 'src', 'entry.ts');
    await mkdir(path.dirname(entryPath), { recursive: true });
    await writeFile(
      entryPath,
      "import { redirect } from 'next/navigation'; export default redirect;",
      'utf8',
    );

    await expect(
      buildFixture(entryPath, projectRoot, [
        createPreviewNextFrameworkFallbackPlugin({ workspaceRoot: projectRoot }),
      ]),
    ).rejects.toThrow('Could not resolve "next/navigation"');
  });
});

/** Plain element shape emitted by the deliberately tiny React test implementation. */
interface PreviewFixtureElement {
  readonly children: readonly unknown[];
  readonly props: Record<string, unknown>;
  readonly tag: string;
}

/** Literal build options make emitted files and the metafile non-optional in test assertions. */
interface PreviewFixtureBuildOptions extends BuildOptions {
  readonly metafile: true;
  readonly write: false;
}

/** Creates one isolated package and records it for deterministic cleanup. */
async function createProject(prefix: string, manifest: object): Promise<string> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), `react-preview-${prefix}`));
  temporaryRoots.push(projectRoot);
  await writeFile(path.join(projectRoot, 'package.json'), JSON.stringify(manifest), 'utf8');
  return projectRoot;
}

/** Bundles one fixture as executable CommonJS while retaining metadata and diagnostics. */
function buildFixture(
  entryPath: string,
  workspaceRoot: string,
  plugins: readonly Plugin[],
): Promise<BuildResult<PreviewFixtureBuildOptions>> {
  return build({
    absWorkingDir: workspaceRoot,
    bundle: true,
    entryPoints: [entryPath],
    format: 'cjs',
    logLevel: 'silent',
    metafile: true,
    platform: 'node',
    plugins: [...plugins],
    write: false,
  });
}

/** Provides only the structural React methods exercised by the generated visual facades. */
function createReactFixturePlugin(): Plugin {
  return {
    name: 'react-fixture',
    setup(build): void {
      build.onResolve({ filter: /^react$/ }, () => ({ namespace: 'react-fixture', path: 'react' }));
      build.onLoad({ filter: /.*/, namespace: 'react-fixture' }, (): OnLoadResult => ({
        contents: [
          'exports.createElement = (tag, props, ...children) => ({ children, props: props || {}, tag });',
          'exports.forwardRef = (render) => (props) => render(props, null);',
          'exports.isValidElement = (value) => value !== null && typeof value === "object" && "tag" in value;',
          'exports.cloneElement = (value, props) => ({ ...value, props: { ...value.props, ...props } });',
        ].join('\n'),
        loader: 'js',
      }));
    },
  };
}

/** Evaluates a fully bundled CommonJS artifact without exposing Node's module loader. */
function executeCommonJs(source: string): Record<string, unknown> {
  const module = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(source, {
    URLSearchParams,
    exports: module.exports,
    module,
  });
  return module.exports;
}
