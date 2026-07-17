/**
 * Verifies optional project Apollo resolution and the generated memory-only operation transport.
 * Temporary package roots keep the tests independent from the extension's own dependencies and
 * prove that a target-owned Apollo instance is selected when the capability is available.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewApolloBridgePlugin } from '../../../src/adapters/esbuild/previewApolloBridgePlugin';
import { installFakeApolloPackage } from './support/fakeApolloPackage';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('createPreviewApolloBridgePlugin', () => {
  /** Keeps ordinary React projects buildable when Apollo Client is not installed. */
  it('provides an identity wrapper when the project has no Apollo package', async () => {
    const projectRoot = await createTemporaryProject('apollo-absent-preview-');

    try {
      const result = await build({
        bundle: true,
        format: 'esm',
        logLevel: 'silent',
        plugins: [createPreviewApolloBridgePlugin({ projectRoot })],
        stdin: {
          contents: [
            "import { createApolloPreviewElement } from 'react-preview:apollo';",
            "console.log(createApolloPreviewElement('UNCHANGED_PREVIEW_MARKER'));",
          ].join('\n'),
          loader: 'js',
          resolveDir: projectRoot,
        },
        write: false,
      });

      const javascript = result.outputFiles[0]?.text ?? '';
      expect(javascript).toContain('UNCHANGED_PREVIEW_MARKER');
      expect(javascript).not.toContain('ApolloClient');
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Resolves and bundles the package installed under the target's nearest package root. */
  it('uses the project-owned Apollo implementation when available', async () => {
    const projectRoot = await createTemporaryProject('apollo-present-preview-');

    try {
      await installFakeApolloPackage(projectRoot);
      const result = await build({
        bundle: true,
        define: { 'process.env.NODE_ENV': '"test"' },
        format: 'esm',
        logLevel: 'silent',
        plugins: [createPreviewApolloBridgePlugin({ projectRoot })],
        stdin: {
          contents: [
            "import { createApolloPreviewElement } from 'react-preview:apollo';",
            "console.log(createApolloPreviewElement('target', {}));",
          ].join('\n'),
          loader: 'js',
          resolveDir: projectRoot,
        },
        platform: 'browser',
        write: false,
      });

      expect(result.outputFiles[0]?.text).toContain('PROJECT_OWNED_APOLLO_MARKER');
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Returns selection-shaped neutral data through the terminating link without calling fetch. */
  it('executes nested fields, aliases, and fragments entirely in memory', async () => {
    const projectRoot = await createTemporaryProject('apollo-static-result-preview-');

    try {
      await installFakeApolloPackage(projectRoot);
      const result = await build({
        bundle: true,
        define: { 'process.env.NODE_ENV': '"test"' },
        format: 'iife',
        globalName: 'ApolloPreviewFixture',
        logLevel: 'silent',
        plugins: [createPreviewApolloBridgePlugin({ projectRoot })],
        stdin: {
          contents: createStaticResultFixtureSource(),
          loader: 'js',
          resolveDir: projectRoot,
        },
        platform: 'browser',
        target: 'es2022',
        write: false,
      });
      const javascript = result.outputFiles[0]?.text;
      if (javascript === undefined) {
        throw new Error('The Apollo bridge fixture emitted no JavaScript.');
      }

      let fetchCalls = 0;
      const sandbox: Record<string, unknown> = {
        fetch(): never {
          fetchCalls += 1;
          throw new Error('The static Apollo preview must not call fetch.');
        },
        setTimeout,
      };
      sandbox.globalThis = sandbox;
      const context = createContext(sandbox);
      runInContext(javascript, context, { timeout: 10_000 });
      const staticResult = await readContextPromise(context, '__apolloStaticResult');

      expect(fetchCalls).toBe(0);
      expect(staticResult).toEqual({
        data: {
          company: {
            enabled: false,
            identifier: 'preview',
            monthlyPrice: '0',
            profile: { displayName: '' },
          },
          recentItems: [],
        },
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Delegates inferred GraphQL fallback data to the editable Page Inspector payload registry. */
  it('registers operation selection shapes when the Page Inspector data API is active', async () => {
    const projectRoot = await createTemporaryProject('apollo-inspector-payload-preview-');

    try {
      await installFakeApolloPackage(projectRoot);
      const result = await build({
        bundle: true,
        define: { 'process.env.NODE_ENV': '"test"' },
        format: 'iife',
        globalName: 'ApolloPreviewFixture',
        logLevel: 'silent',
        plugins: [createPreviewApolloBridgePlugin({ projectRoot })],
        stdin: {
          contents: createStaticResultFixtureSource(),
          loader: 'js',
          resolveDir: projectRoot,
        },
        platform: 'browser',
        target: 'es2022',
        write: false,
      });
      const javascript = result.outputFiles[0]?.text;
      if (javascript === undefined)
        throw new Error('The Apollo bridge fixture emitted no JavaScript.');

      let observedMetadata: unknown;
      const sandbox: Record<PropertyKey, unknown> = { setTimeout };
      sandbox[Symbol.for('newdlops.react-file-preview.page-inspector')] = {
        resolveDataPayload(metadata: unknown, seed: unknown) {
          observedMetadata = metadata;
          return { ...(seed as object), recentItems: [{ id: 'generated-item' }] };
        },
      };
      sandbox.globalThis = sandbox;
      const context = createContext(sandbox);
      runInContext(javascript, context, { timeout: 10_000 });

      await expect(readContextPromise(context, '__apolloStaticResult')).resolves.toMatchObject({
        data: { recentItems: [{ id: 'generated-item' }] },
      });
      expect(JSON.parse(JSON.stringify(observedMetadata))).toMatchObject({
        kind: 'graphql',
        label: 'src/Company.tsx · StaticCompany',
        method: 'QUERY',
        operationName: 'StaticCompany',
        shape: {
          fields: {
            company: { kind: 'object' },
            recentItems: { items: { kind: 'object' }, kind: 'array' },
          },
          kind: 'object',
        },
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Allows a setup resolver to provide exact static page data while retaining no-network transport. */
  it('uses an explicit operation result supplied by preview setup', async () => {
    const projectRoot = await createTemporaryProject('apollo-override-preview-');

    try {
      await installFakeApolloPackage(projectRoot);
      const result = await build({
        bundle: true,
        define: { 'process.env.NODE_ENV': '"test"' },
        format: 'iife',
        globalName: 'ApolloPreviewFixture',
        logLevel: 'silent',
        plugins: [createPreviewApolloBridgePlugin({ projectRoot })],
        stdin: {
          contents: createOverrideFixtureSource(),
          loader: 'js',
          resolveDir: projectRoot,
        },
        platform: 'browser',
        target: 'es2022',
        write: false,
      });
      const javascript = result.outputFiles[0]?.text;
      if (javascript === undefined) {
        throw new Error('The Apollo override fixture emitted no JavaScript.');
      }

      const sandbox: Record<string, unknown> = { setTimeout };
      sandbox.globalThis = sandbox;
      const context = createContext(sandbox);
      runInContext(javascript, context, { timeout: 10_000 });

      await expect(readContextPromise(context, '__apolloStaticResult')).resolves.toEqual({
        data: {
          findAvailableSubscriptionPromotion: null,
          standardSubscriptionPlan: { price: '0' },
        },
      });
      expect(context.__apolloOperationContext).toEqual({
        documentName: 'src/CoreIntroLayout.tsx',
        operationName: 'StandardPlanIntroPage',
        setupKind: 'custom',
        variables: { companyId: 'preview-company' },
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});

/** Creates an isolated nearest-package boundary beneath the repository's installed React package. */
async function createTemporaryProject(prefix: string): Promise<string> {
  const projectRoot = await mkdtemp(path.join(PROJECT_ROOT, `test/fixtures/${prefix}`));
  await writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8');
  return projectRoot;
}

/** Builds a GraphQL operation fixture containing an alias, nested fields, a list, and a fragment. */
function createStaticResultFixtureSource(): string {
  return String.raw`
import { createApolloPreviewElement } from 'react-preview:apollo';
const field = (name, selectionSet, alias) => ({
  kind: 'Field',
  name: { value: name },
  ...(alias === undefined ? {} : { alias: { value: alias } }),
  ...(selectionSet === undefined ? {} : { selectionSet }),
});
const query = {
  definitions: [
    {
      kind: 'OperationDefinition',
      name: { value: 'StaticCompany' },
      selectionSet: {
        selections: [
          field('company', {
            selections: [
              field('id', undefined, 'identifier'),
              field('price', undefined, 'monthlyPrice'),
              field('isEnabled', undefined, 'enabled'),
              { kind: 'FragmentSpread', name: { value: 'CompanyProfile' } },
            ],
          }),
          field('recentItems', { selections: [field('id')] }),
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { value: 'CompanyProfile' },
      selectionSet: {
        selections: [field('profile', { selections: [field('name', undefined, 'displayName')] })],
      },
    },
  ],
};
const element = createApolloPreviewElement('target', {
  configuration: undefined,
  documentName: 'src/Company.tsx',
  setupKind: 'none',
});
globalThis.__apolloStaticResult = new Promise((resolve, reject) => {
  element.props.client.link.request({ operationName: 'StaticCompany', query, variables: {} })
    .subscribe({ complete() {}, error: reject, next: resolve });
});
`;
}

/** Builds the reported CoreIntro operation with an exact setup-owned neutral response. */
function createOverrideFixtureSource(): string {
  return String.raw`
import { createApolloPreviewElement } from 'react-preview:apollo';
const query = {
  definitions: [{
    kind: 'OperationDefinition',
    name: { value: 'StandardPlanIntroPage' },
    selectionSet: { selections: [] },
  }],
};
const configuration = {
  resolveOperation(context) {
    const { query: _query, ...serializableContext } = context;
    globalThis.__apolloOperationContext = serializableContext;
    return {
      findAvailableSubscriptionPromotion: null,
      standardSubscriptionPlan: { price: '0' },
    };
  },
};
const element = createApolloPreviewElement('target', {
  configuration,
  documentName: 'src/CoreIntroLayout.tsx',
  setupKind: 'custom',
});
globalThis.__apolloStaticResult = new Promise((resolve, reject) => {
  element.props.client.link.request({
    operationName: 'StandardPlanIntroPage',
    query,
    variables: { companyId: 'preview-company' },
  }).subscribe({ complete() {}, error: reject, next: resolve });
});
`;
}

/** Reads a Promise assigned by bundled fixture code without trusting an arbitrary VM value shape. */
function readContextPromise(
  context: Record<string, unknown>,
  propertyName: string,
): Promise<unknown> {
  const value = context[propertyName];
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null ||
    !('then' in value) ||
    typeof value.then !== 'function'
  ) {
    return Promise.reject(new TypeError(`Fixture property ${propertyName} is not a Promise.`));
  }
  return Promise.resolve(value);
}
