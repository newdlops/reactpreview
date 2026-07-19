/** Verifies static GraphQL fragment recovery without executing either side of a circular import. */
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PreviewSourceTransformer } from '../../../../src/adapters/esbuild/staticResources/previewSourceTransformer';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((temporaryRoot) => rm(temporaryRoot, { force: true, recursive: true })),
  );
});

describe('preview GraphQL document instrumentation', () => {
  /** Carries the exact authored fragment through a circular UI-module import as a runtime fallback. */
  it('wraps a statically resolved imported fragment interpolation', async () => {
    const workspaceRoot = await createWorkspace();
    const queryPath = path.join(workspaceRoot, 'query.ts');
    const fragmentPath = path.join(workspaceRoot, 'modal.tsx');
    const fragmentSource = [
      "import { default as gql } from 'graphql-tag';",
      "import { QUERY } from './query';",
      'void QUERY;',
      'export const MODAL_FRAGMENT = gql`',
      '  fragment ModalFields on Company {',
      '    name',
      '  }',
      '`;',
    ].join('\n');
    const querySource = [
      "import { default as gql } from 'graphql-tag';",
      "import { MODAL_FRAGMENT } from './modal';",
      'export const QUERY = gql`',
      '  ${MODAL_FRAGMENT}',
      '  query Company { company { ...ModalFields } }',
      '`;',
    ].join('\n');
    await Promise.all([writeFile(queryPath, querySource), writeFile(fragmentPath, fragmentSource)]);

    const transformed = await createTransformer(workspaceRoot).transform(queryPath, querySource);

    expect(transformed.contents).toContain('.resolveGraphqlInterpolation(');
    expect(transformed.contents).toContain('fragment ModalFields on Company');
    expect(transformed.contents).toContain(`"fragmentSourcePath":"${fragmentPath}"`);
    expect(transformed.contents).toContain('"fragmentNames":["ModalFields"]');
    expect(transformed.contents).toContain('() => (MODAL_FRAGMENT)');
  });

  /** Follows a barrel re-export and recursively includes nested fragments in one bounded fallback. */
  it('expands nested fragments through a named re-export', async () => {
    const workspaceRoot = await createWorkspace();
    const queryPath = path.join(workspaceRoot, 'query.ts');
    await Promise.all([
      writeFile(
        path.join(workspaceRoot, 'leaf.ts'),
        [
          "import gql from 'graphql-tag';",
          'export const LEAF = gql`fragment LeafFields on Company { id }`;',
        ].join('\n'),
      ),
      writeFile(
        path.join(workspaceRoot, 'fragment.ts'),
        [
          "import gql from 'graphql-tag';",
          "import { LEAF } from './leaf';",
          'export const ROOT = gql`${LEAF} fragment RootFields on Company { ...LeafFields name }`;',
        ].join('\n'),
      ),
      writeFile(path.join(workspaceRoot, 'barrel.ts'), "export { ROOT } from './fragment';"),
    ]);
    const querySource = [
      "import gql from 'graphql-tag';",
      "import { ROOT } from './barrel';",
      'export const QUERY = gql`${ROOT} query Q { company { ...RootFields } }`;',
    ].join('\n');
    await writeFile(queryPath, querySource);

    const transformed = await createTransformer(workspaceRoot).transform(queryPath, querySource);

    expect(transformed.contents).toContain('fragment LeafFields on Company');
    expect(transformed.contents).toContain('fragment RootFields on Company');
    expect(transformed.contents).toContain('"fragmentNames":["LeafFields","RootFields"]');
  });

  /** Leaves export-gallery source byte-for-byte unchanged when Inspector recovery is disabled. */
  it('does not instrument GraphQL documents outside Page Inspector policy', async () => {
    const workspaceRoot = await createWorkspace();
    const queryPath = path.join(workspaceRoot, 'query.ts');
    const querySource = [
      "import gql from 'graphql-tag';",
      "import { FRAGMENT } from './fragment';",
      'export const QUERY = gql`${FRAGMENT} query Q { node { id } }`;',
    ].join('\n');
    await Promise.all([
      writeFile(queryPath, querySource),
      writeFile(
        path.join(workspaceRoot, 'fragment.ts'),
        "import gql from 'graphql-tag'; export const FRAGMENT = gql`fragment F on Node { id }`;",
      ),
    ]);
    const transformer = new PreviewSourceTransformer({
      projectRoot: workspaceRoot,
      workspaceRoot,
    });

    const transformed = await transformer.transform(queryPath, querySource);

    expect(transformed.contents).toBe(querySource);
  });
});

/** Creates one disposable workspace used by TypeScript-like relative module resolution. */
async function createWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-graphql-'));
  temporaryRoots.push(workspaceRoot);
  return workspaceRoot;
}

/** Creates a GraphQL-enabled transformer with a deterministic relative-source resolver. */
function createTransformer(workspaceRoot: string): PreviewSourceTransformer {
  return new PreviewSourceTransformer({
    graphqlModuleResolver: {
      resolve(moduleSpecifier, consumerPath): string | undefined {
        if (!moduleSpecifier.startsWith('.')) return undefined;
        const basePath = path.resolve(path.dirname(consumerPath), moduleSpecifier);
        for (const extension of ['.ts', '.tsx']) {
          const candidate = `${basePath}${extension}`;
          if (existsSync(candidate)) return candidate;
        }
        return undefined;
      },
    },
    instrumentGraphqlDocuments: true,
    projectRoot: workspaceRoot,
    workspaceRoot,
  });
}
