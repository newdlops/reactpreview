/** Verifies build-only TypeScript sharing without changing the actual compiler API or source scope. */
import { createRequire } from 'node:module';
import { strict as assert } from 'node:assert';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { build, type Plugin } from 'esbuild';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const typescriptPath = require.resolve('typescript');
const ownedRoot = path.resolve('src');
const { createPreviewTypeScriptInteropPlugin } =
  (await import('../../scripts/preview-typescript-interop.mjs')) as {
    createPreviewTypeScriptInteropPlugin: (root: string) => Plugin;
  };

/** Builds only in-memory source files; the real TypeScript API stays an external test dependency. */
async function buildOwnedImports(sources: ReadonlyMap<string, string>): Promise<string> {
  const imports = [...sources.keys()].map(
    (filePath, index) => `import value${index.toString()} from ${JSON.stringify(filePath)};`,
  );
  const result = await build({
    bundle: true,
    external: [typescriptPath, 'typescript'],
    format: 'cjs',
    logLevel: 'silent',
    platform: 'node',
    plugins: [
      createPreviewTypeScriptInteropPlugin(ownedRoot),
      {
        name: 'owned-interop-test-fixture',
        setup(context) {
          context.onResolve({ filter: /interop-fixture-/ }, (args) => {
            if (sources.has(args.path)) return { path: args.path, namespace: 'file' };
            return undefined;
          });
          context.onLoad({ filter: /interop-fixture-/ }, (args) => {
            const source = sources.get(args.path);
            return source === undefined
              ? undefined
              : { contents: source, loader: 'ts', resolveDir: path.dirname(args.path) };
          });
        },
      },
    ],
    stdin: {
      contents: `${imports.join('\n')} export default [${imports.map((_, index) => `value${index.toString()}`).join(',')}];`,
      loader: 'ts',
      resolveDir: ownedRoot,
      sourcefile: 'interop-fixture-entry.ts',
    },
    write: false,
  });
  const [output] = result.outputFiles;
  assert(output !== undefined);
  return output.text;
}

/** Evaluates the owned bundle with a transparent API proxy that counts CJS namespace enumerations. */
function evaluateInterop(source: string): { copies: number; results: readonly unknown[] } {
  let copies = 0;
  const compiler = new Proxy(ts, {
    ownKeys: (target) => {
      copies += 1;
      return Reflect.ownKeys(target);
    },
  });
  const module = { exports: {} as { default: readonly unknown[] } };
  runInNewContext(source, {
    module,
    exports: module.exports,
    require: (specifier: string) => {
      expect([typescriptPath, 'typescript']).toContain(specifier);
      return compiler;
    },
  });
  return { copies, results: module.exports.default };
}

describe('owned TypeScript bundle interop', () => {
  it('copies the compiler namespace only once across forty default imports', async () => {
    const sources = new Map(
      Array.from({ length: 40 }, (_, index) => [
        path.join(ownedRoot, `interop-fixture-${index.toString()}.ts`),
        'import ts from "typescript"; export default ts.createSourceFile("fixture.ts", "const value = 1;", ts.ScriptTarget.Latest).kind;',
      ]),
    );
    const observed = evaluateInterop(await buildOwnedImports(sources));
    expect(observed.copies).toBe(1);
    expect(observed.results).toEqual(Array.from({ length: 40 }, () => ts.SyntaxKind.SourceFile));
  });

  it('leaves sibling directories and CommonJS requires outside default-import rewriting', async () => {
    const observed = evaluateInterop(
      await buildOwnedImports(
        new Map([
          [
            path.join(ownedRoot, 'interop-fixture-owned.ts'),
            'import ts from "typescript"; export default ts.version;',
          ],
          [
            path.join(`${ownedRoot}-sibling`, 'interop-fixture-outside.ts'),
            'import ts from "typescript"; export default ts.version;',
          ],
          [
            path.join(ownedRoot, 'interop-fixture-require.ts'),
            'const ts = require("typescript"); export default ts.version;',
          ],
          [
            path.join(ownedRoot, 'node_modules/vendor/interop-fixture-vendor.ts'),
            'import ts from "typescript"; export default ts.version;',
          ],
        ]),
      ),
    );
    expect(observed.copies).toBe(3);
    expect(observed.results).toEqual([ts.version, ts.version, ts.version, ts.version]);
  });

  it('rejects unsupported named imports instead of silently returning an incorrect API', async () => {
    await expect(
      buildOwnedImports(
        new Map([
          [
            path.join(ownedRoot, 'interop-fixture-named.ts'),
            'import { version } from "typescript"; export default version;',
          ],
        ]),
      ),
    ).rejects.toThrow('No matching export');
  });
});
