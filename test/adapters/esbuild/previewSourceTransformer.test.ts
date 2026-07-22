/**
 * Exercises source-rewrite semantics that are difficult to observe after esbuild minification.
 * Real temporary files keep context filtering and generated imports aligned with production paths.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PreviewSourceTransformer,
  PreviewSourceTransformError,
} from '../../../src/adapters/esbuild/staticResources/previewSourceTransformer';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((temporaryRoot) => rm(temporaryRoot, { force: true, recursive: true })),
  );
});

describe('PreviewSourceTransformer', () => {
  /** Instruments JSX conditions only for Page Inspector compilation, never for Export Gallery. */
  it('gates conditional branch controls behind the inspector transformer option', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const sourcePath = path.join(workspaceRoot, 'Page.tsx');
    const sourceText = [
      'export function Page({ loaded, visible }) {',
      '  return <main>{visible && <Panel />}{loaded ? <Content /> : <Loading />}</main>;',
      '}',
      'export function ModePage({ mode }) {',
      '  switch (mode) {',
      "    case 'detail': return <Detail />;",
      '    default: return <Summary />;',
      '  }',
      '}',
    ].join('\n');

    const galleryResult = await createTransformer(workspaceRoot).transform(sourcePath, sourceText);
    const inspectorResult = await createTransformer(workspaceRoot, true).transform(
      sourcePath,
      sourceText,
    );

    expect(galleryResult.contents).toBe(sourceText);
    expect(inspectorResult.contents.match(/\.resolveRenderCondition\(/gu)).toHaveLength(1);
    expect(inspectorResult.contents.match(/\.resolveRenderConditionLazy\(/gu)).toHaveLength(1);
    expect(inspectorResult.contents.match(/\.resolveRenderChoice\(/gu)).toHaveLength(1);
    expect(inspectorResult.contents).toContain('"truthyLabel":"<Panel>"');
    expect(inspectorResult.contents).toContain('"falsyLabel":"<Loading>"');
  });

  /** Keeps rendered children mounted when a proven React side-effect callback fails. */
  it('isolates only callbacks belonging to imported React effect hooks', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const sourcePath = path.join(workspaceRoot, 'AppShell.tsx');
    const sourceText = [
      `import React, { useEffect as useSideEffect, useLayoutEffect } from 'react';`,
      'const lifecycle = { useEffect(callback) { callback(); } };',
      'export function AppShell() {',
      '  useSideEffect(() => wsClient.onReconnected(), []);',
      '  useLayoutEffect(connectNavigation, [connectNavigation]);',
      '  React.useEffect(() => fetch("/api/session"), []);',
      '  lifecycle.useEffect(() => renderWidget());',
      '  return <main />;',
      '}',
    ].join('\n');
    const transformer = new PreviewSourceTransformer({
      instrumentDataRequests: true,
      instrumentRuntimeEffectIsolation: true,
      projectRoot: workspaceRoot,
      workspaceRoot,
    });

    const transformed = await transformer.transform(sourcePath, sourceText);

    expect(transformed.contents.match(/\.resolveRuntimeEffect\(/gu)).toHaveLength(3);
    expect(transformed.contents).toContain('wsClient.onReconnected()');
    expect(transformed.contents).toContain('previewFetch');
    expect(transformed.contents).toContain('lifecycle.useEffect(() => renderWidget())');
    expect(transformed.contents).toContain('"ownerName":"AppShell"');
    expect(transformed.contents).toContain('"hookName":"useLayoutEffect"');
  });

  /** Registers only Redux object containers proven by one reached selector module. */
  it('appends selector container registration to workspace-owned source', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const sourcePath = path.join(workspaceRoot, 'use-plan.ts');
    const sourceText = [
      'import { useSelector } from "common/ui/redux/use-selector";',
      'export function usePlan() {',
      '  const company = useSelector((state) => state.company);',
      '  const plan = company.subscription.subscriptionPlan;',
      '  return plan.renewType.value;',
      '}',
    ].join('\n');

    const transformed = await createTransformer(workspaceRoot).transform(sourcePath, sourceText);

    expect(transformed.contents).toContain(
      'import { registerPreviewReduxStateContainerPaths as __reactPreview_reduxState_0 } from "react-preview:redux";',
    );
    expect(transformed.contents).toContain(
      '__reactPreview_reduxState_0([["company"],["company","subscription"],["company","subscription","subscriptionPlan"],["company","subscription","subscriptionPlan","renewType"]]);',
    );
    expect(transformed.contents).not.toContain('"value"]]);');
  });

  /** Aggregates child-only consumers and setup-owned providers across reached workspace modules. */
  it('collects router requirements across successive source transforms', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const transformer = createTransformer(workspaceRoot);

    await transformer.transform(
      path.join(workspaceRoot, 'Child.tsx'),
      "import { useLocation } from 'react-router-dom'; export default useLocation;",
    );
    expect(transformer.getRouterRequirement()).toEqual({
      consumesRouter: true,
      ownsRouter: false,
    });

    await transformer.transform(
      path.join(workspaceRoot, '.react-preview/setup.tsx'),
      "import { MemoryRouter } from 'react-router-dom'; export default MemoryRouter;",
    );
    expect(transformer.getRouterRequirement()).toEqual({
      consumesRouter: true,
      ownsRouter: true,
    });
  });

  /** Includes react-router core imports in the graph-wide provider inventory. */
  it('collects router ownership from the react-router core package', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const transformer = createTransformer(workspaceRoot);

    await transformer.transform(
      path.join(workspaceRoot, 'RouterRoot.tsx'),
      "import { Router, useRoutes } from 'react-router'; export default Router;",
    );

    expect(transformer.getRouterRequirement()).toEqual({
      consumesRouter: true,
      ownsRouter: true,
    });
  });

  /** Synthesizes only a workspace-owned, statically typed missing React Context default. */
  it('adds bounded context defaults without rewriting external source', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const externalRoot = await createTemporaryWorkspace();
    const sourceText = [
      "import { createContext, useContext } from 'react';",
      'export const PageContext = createContext<{ title: string; setTitle(value: string): void }>(undefined as any);',
      'export const usePageContext = () => useContext(PageContext);',
    ].join('\n');
    const transformer = createTransformer(workspaceRoot);

    const workspaceResult = await transformer.transform(
      path.join(workspaceRoot, 'context.tsx'),
      sourceText,
    );
    const externalResult = await transformer.transform(
      path.join(externalRoot, 'context.tsx'),
      sourceText,
    );

    expect(workspaceResult.contents).toContain(`{ "title": '', "setTitle": () => undefined }`);
    expect(workspaceResult.contents).toContain(
      'registerPreviewContextIdentity as __reactPreview_contextIdentity_0',
    );
    expect(workspaceResult.contents).toContain(
      '__reactPreview_contextIdentity_0(usePageContext, PageContext);',
    );
    expect(externalResult.contents).toBe(sourceText);
  });

  /** Connects reached Formik evidence and demand-shaped custom Context hook fallback generation. */
  it('registers Formik consumers and appends stable Context hook fallbacks', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const sourcePath = path.join(workspaceRoot, 'Field.tsx');
    const sourceText = [
      "import * as formik from 'formik';",
      "import { useFormContext } from './form-context';",
      'export function Field() {',
      "  formik.useField('name');",
      '  const { formikProps } = useFormContext();',
      '  formikProps.setValues(formikProps.values);',
      '  return formikProps.values.name;',
      '}',
    ].join('\n');

    const transformed = await createTransformer(workspaceRoot).transform(sourcePath, sourceText);

    expect(transformed.contents).toContain(
      'registerPreviewFormikRequirement as __reactPreview_formikRequirement_0',
    );
    expect(transformed.contents).toContain(
      '__reactPreview_formikRequirement_0({"consumesFormik":true,"ownsFormik":false});',
    );
    expect(transformed.contents).toContain(
      '(useFormContext() ?? __reactPreviewContextHookFallback0)',
    );
    expect(transformed.contents).toContain(
      '"setValues": Object.freeze(() => undefined), "values": Object.freeze({})',
    );
    expect(transformed.contents).toContain(
      'registerPreviewContextRequirement as __reactPreview_contextRequirement_',
    );
    expect(transformed.contents).toMatch(
      /__reactPreview_contextRequirement_\d+\(useFormContext, __reactPreviewContextHookFallback0\);/u,
    );
  });

  /** Guards callable theme tokens only inside a tagged template owned by styled-components. */
  it('isolates malformed nested theme helpers with exact styled-template usage evidence', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const sourcePath = path.join(workspaceRoot, 'Card.tsx');
    const sourceText = [
      "import styled, { css } from 'styled-components';",
      'const shared = css`gap: ${(props) => props.theme.layout.gap(1)};`;',
      'export const Card = styled.div`margin: ${(props) => props.theme.spacing(2)}; ${shared}`;',
      'const domain = { theme: { spacing: (value) => value } };',
      'export const untouched = domain.theme.spacing(3);',
    ].join('\n');

    const transformed = await createTransformer(workspaceRoot).transform(sourcePath, sourceText);

    expect(transformed.contents).toContain(
      'import { resolvePreviewThemeHelper as __reactPreview_themeHelper_0 } from "react-preview:theme";',
    );
    expect(transformed.contents).toMatch(
      /__reactPreview_themeHelper_0\(\(props\.theme\), \["layout","gap"\], \{[^}]+\}\)\(1\)/u,
    );
    expect(transformed.contents).toMatch(
      /__reactPreview_themeHelper_0\(\(props\.theme\), \["spacing"\], \{[^}]+\}\)\(2\)/u,
    );
    expect(transformed.contents).toContain(`"sourcePath":"${sourcePath}"`);
    expect(transformed.contents).toContain('domain.theme.spacing(3)');
  });

  /** Guards non-callable mixins and scalar tokens while retaining their exact authored locations. */
  it('isolates missing non-callable theme paths only inside styled templates', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const sourcePath = path.join(workspaceRoot, 'Header.tsx');
    const sourceText = [
      "import styled, { css } from 'styled-components';",
      'const shared = css`color: ${(props) => props.theme.color.black};`;',
      'export const Header = styled.header`',
      '  ${(props) => props.theme.flex.rowBetween}',
      '  @media ${(props) => props.theme.device.sm_md} { ${shared} }',
      '`;',
      'const domain = { theme: { color: { black: "domain" } } };',
      'export const untouched = domain.theme.color.black;',
    ].join('\n');

    const transformed = await createTransformer(workspaceRoot).transform(sourcePath, sourceText);

    expect(transformed.contents).toContain(
      'import { resolvePreviewThemeValue as __reactPreview_themeValue_0 } from "react-preview:theme";',
    );
    expect(transformed.contents).toContain(
      '__reactPreview_themeValue_0((props.theme), ["flex","rowBetween"]',
    );
    expect(transformed.contents).toContain(
      '__reactPreview_themeValue_0((props.theme), ["color","black"]',
    );
    expect(transformed.contents).toContain(
      '__reactPreview_themeValue_0((props.theme), ["device","sm_md"]',
    );
    expect(transformed.contents).toContain(`"sourcePath":"${sourcePath}"`);
    expect(transformed.contents).toContain('domain.theme.color.black');
  });

  /** Reconciles Context registration with the richer demand-shaped runtime hook fallback. */
  it('keeps the most specific Context hook rewrite when analyzers target the same call', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const sourcePath = path.join(workspaceRoot, 'Page.tsx');
    const sourceText = [
      `import { useContext } from 'react';`,
      `import { AppContext } from './app-context';`,
      'export function Page() {',
      '  const app = useContext(AppContext);',
      '  return app.user.name;',
      '}',
    ].join('\n');
    const transformer = new PreviewSourceTransformer({
      instrumentRuntimeHookFallbacks: true,
      projectRoot: workspaceRoot,
      workspaceRoot,
    });

    const transformed = await transformer.transform(sourcePath, sourceText);

    expect(transformed.contents.match(/\.resolveRuntimeHook\(/gu)).toHaveLength(1);
    expect(transformed.contents).toContain('() => (useContext(AppContext))');
    expect(transformed.contents).toContain('"user": Object.freeze({ "name": "name" })');
    expect(transformed.contents).toContain('registerPreviewContextRequirement');
  });

  /** Falls back to the general hook analyzer when Context identity inference cannot follow a helper. */
  it('isolates a Context fragment carrier passed through an unknown project helper', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const sourcePath = path.join(workspaceRoot, 'Modal.tsx');
    const sourceText = [
      `import { useCompanyContext } from './company-context';`,
      'export function Modal() {',
      '  const { company: companyFragment, refetch } = useCompanyContext();',
      '  const { name } = getFragmentData(FRAGMENT, companyFragment);',
      '  return <button onClick={refetch}>{name}</button>;',
      '}',
    ].join('\n');
    const transformer = new PreviewSourceTransformer({
      instrumentRuntimeHookFallbacks: true,
      projectRoot: workspaceRoot,
      workspaceRoot,
    });

    const transformed = await transformer.transform(sourcePath, sourceText);

    expect(transformed.contents.match(/\.resolveRuntimeHook\(/gu)).toHaveLength(1);
    expect(transformed.contents).toContain('"company": Object.freeze({})');
    expect(transformed.contents).toContain('"refetch": Object.freeze(() => undefined)');
  });

  /** Completes Codegen fragment carriers from the authored selection before destructuring runs. */
  it('instruments a generated GraphQL fragment-unmasking helper', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const sourcePath = path.join(workspaceRoot, 'Modal.tsx');
    const sourceText = [
      `import { getFragmentData as readFragment } from './graphql-codegen/fragment-masking';`,
      `import { COMPANY_FRAGMENT } from './company-fragment';`,
      'export function Modal({ company }) {',
      '  const { name } = readFragment(COMPANY_FRAGMENT, company);',
      '  return <strong>{name}</strong>;',
      '}',
    ].join('\n');
    const transformer = new PreviewSourceTransformer({
      instrumentRuntimeHookFallbacks: true,
      projectRoot: workspaceRoot,
      workspaceRoot,
    });

    const transformed = await transformer.transform(sourcePath, sourceText);

    expect(transformed.contents).toContain('.resolveGraphqlFragment(');
    expect(transformed.contents).toContain('() => (readFragment(COMPANY_FRAGMENT, company))');
    expect(transformed.contents).toContain('() => (COMPANY_FRAGMENT)');
    expect(transformed.contents).toContain('"requiredPaths":["name"]');
    expect(transformed.contents).toContain('"ownerName":"Modal"');
  });

  /** Preserves a bounded resource macro when it is nested inside a general hook call. */
  it('prefers a nested dynamic import rewrite over its enclosing hook fallback', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const pagesDirectory = path.join(workspaceRoot, 'pages');
    await mkdir(pagesDirectory, { recursive: true });
    await writeFile(path.join(pagesDirectory, 'Home.tsx'), 'export default 1;');
    const sourcePath = path.join(workspaceRoot, 'Page.tsx');
    const sourceText = [
      `import { useLazyModule } from 'unknown-runtime';`,
      `const name = 'Home';`,
      'export function Page() {',
      '  const result = useLazyModule(() => import(`./pages/${name}.tsx`));',
      '  return result.title;',
      '}',
    ].join('\n');
    const transformer = new PreviewSourceTransformer({
      instrumentRuntimeHookFallbacks: true,
      projectRoot: workspaceRoot,
      workspaceRoot,
    });

    const transformed = await transformer.transform(sourcePath, sourceText);

    expect(transformed.contents).toContain('React Preview could not resolve dynamic import');
    expect(transformed.contents).not.toContain('.resolveRuntimeHook(');
  });

  /** Resolves extensionless template requests with the same finite aliases as normal TS imports. */
  it('maps extensionless dynamic templates to typed source files and directory indexes', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const iconsDirectory = path.join(workspaceRoot, 'icons');
    const panelsDirectory = path.join(workspaceRoot, 'panels', 'settings');
    await mkdir(iconsDirectory, { recursive: true });
    await mkdir(panelsDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(iconsDirectory, '__lucide__.ts'), 'export const Search = 1;'),
      writeFile(path.join(panelsDirectory, 'index.tsx'), 'export default function Panel() {}'),
    ]);
    const sourcePath = path.join(workspaceRoot, 'Loader.tsx');
    const sourceText = [
      'const library = "lucide";',
      'const section = "settings";',
      'export const icon = import(`./icons/__${library}__`);',
      'export const panel = import(`./panels/${section}`);',
    ].join('\n');

    const transformed = await createTransformer(workspaceRoot).transform(sourcePath, sourceText);

    expect(transformed.contents).toContain(
      '"./icons/__lucide__": () => import("./icons/__lucide__.ts")',
    );
    expect(transformed.contents).toContain(
      '"./panels/settings": () => import("./panels/settings/index.tsx")',
    );
  });

  /** Leaves human-readable JSX examples and a similarly named property chain byte-for-byte intact. */
  it('does not treat JSX text or another object property as a resource macro', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const sourcePath = path.join(workspaceRoot, 'Preview.tsx');
    const sourceText = [
      "const object = { import: { meta: { glob: () => 'ordinary method' } } };",
      "const ordinary = object.import.meta.glob('./pages/*.tsx');",
      "const commented = object. /* keep */ import.meta.glob('./pages/*.tsx');",
      'const globExample = /import.meta.glob(.*)/;',
      'const contextExample = /require.context(.*)/;',
      "if (ordinary) /import.meta.glob(.*)/.test('example');",
      "const πimport = object.import; πimport.meta.glob('./pages/*.tsx');",
      "const templateExample = `${`import.meta.glob('./pages/*.tsx')`}`;",
      'export default function Preview() {',
      '  return <code title="a > b">import.meta.glob("./pages/*.tsx")</code>;',
      '}',
      'void ordinary;',
      'void commented;',
      'void globExample;',
      'void contextExample;',
    ].join('\n');

    const transformed = await createTransformer(workspaceRoot).transform(sourcePath, sourceText);

    expect(transformed.contents).toBe(sourceText);
    expect(transformed.watchDirectories).toEqual([]);
  });

  /** Skips identifiers already present in user source when allocating generated eager imports. */
  it('allocates collision-free generated bindings', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const pagesDirectory = path.join(workspaceRoot, 'pages');
    await mkdir(pagesDirectory, { recursive: true });
    await writeFile(path.join(pagesDirectory, 'Home.tsx'), 'export default 1;');
    const sourcePath = path.join(workspaceRoot, 'Preview.tsx');
    const sourceText = [
      '"use strict";',
      'const __reactPreview_glob_\\u0030 = 1;',
      "const pages = (import.meta.glob\\u0045ager)('./pages/*.tsx');",
      'export default pages;',
    ].join('\n');

    const transformed = await createTransformer(workspaceRoot).transform(sourcePath, sourceText);

    expect(transformed.contents).toContain('import * as __reactPreview_glob_1');
    expect(transformed.contents.startsWith('"use strict";')).toBe(true);
    expect(transformed.contents).toContain('const __reactPreview_glob_\\u0030 = 1');
  });

  /** Rejects extra call arguments instead of deleting their runtime side effects during rewriting. */
  it('rejects macro overloads that cannot be preserved', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const sourcePath = path.join(workspaceRoot, 'Preview.tsx');
    const transformer = createTransformer(workspaceRoot);

    await expect(
      transformer.transform(
        sourcePath,
        'const page = import(`./pages/${name}.tsx`, { with: sideEffect() });',
      ),
    ).rejects.toThrow('dynamic import requires exactly 1');
    await expect(
      transformer.transform(
        sourcePath,
        "const image = new URL('./image.png', import.meta.url, sideEffect());",
      ),
    ).rejects.toThrow('new URL static assets require exactly two arguments');
    await expect(
      transformer.transform(sourcePath, 'const page = import(getPath());'),
    ).rejects.toThrow('must begin with');
    await expect(
      transformer.transform(sourcePath, 'const page = require(getPath());'),
    ).rejects.toThrow('must begin with');
  });

  /** Expands a Vite-commented relative template but leaves an escaped interpolation literal alone. */
  it('classifies commented and escaped dynamic import templates safely', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const pagesDirectory = path.join(workspaceRoot, 'pages');
    await mkdir(pagesDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(pagesDirectory, 'Home.tsx'), 'export default 1;'),
      writeFile(path.join(pagesDirectory, '${literal}-Home.tsx'), 'export default 2;'),
    ]);
    const sourcePath = path.join(workspaceRoot, 'Preview.tsx');
    const sourceText = [
      'const name = "Home";',
      'const page = import(/* @vite-ignore */ `./pages/${name}.tsx`);',
      'const spaced = import /* keep */ (`./pages/${name}.tsx`);',
      'const nested = `${import(`./pages/${name}.tsx`)}`;',
      "const concatenated = import('./pages/' + name + '.tsx');",
      "const required = require('./pages/' + name + '.tsx');",
      'const escaped = import(`./pages/\\${name}.tsx`);',
      'const mixed = import(`./pages/\\${literal}-${name}.tsx`);',
      "const rawNested = `${`import('../outside/' + name + '.tsx')`}`;",
    ].join('\n');

    const transformed = await createTransformer(workspaceRoot).transform(sourcePath, sourceText);

    expect(
      transformed.contents.match(/React Preview could not resolve dynamic import/gu),
    ).toHaveLength(5);
    expect(transformed.contents).toContain('React Preview could not resolve require');
    expect(transformed.contents).toContain('import(`./pages/\\${name}.tsx`)');
    expect(transformed.contents).toContain("import('../outside/' + name + '.tsx')");
  });

  /** Collapses adjacent runtime pieces so they cannot accidentally become a recursive globstar. */
  it('keeps adjacent dynamic path expressions at their fixed directory depth', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const deepDirectory = path.join(workspaceRoot, ...Array.from({ length: 22 }, () => 'deep'));
    await mkdir(deepDirectory, { recursive: true });
    await writeFile(path.join(workspaceRoot, 'AB.js'), 'export default 1;');
    const sourcePath = path.join(workspaceRoot, 'Preview.tsx');

    const transformed = await createTransformer(workspaceRoot).transform(
      sourcePath,
      'const first = "A"; const second = "B.js"; const value = import(`./${first}${second}`);',
    );

    expect(transformed.contents).toContain('./AB.js');
  });

  /** Fails closed for native esbuild glob shapes that previously bypassed workspace scan limits. */
  it('classifies nested, escaped, regex-bearing, and module require expressions', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const sourcePath = path.join(workspaceRoot, 'Preview.tsx');
    const unsafeSources = [
      'const value = `${import(`../outside/${name}.js`)}`;',
      "const value = requ\\u0069re('../outside/' + name + '.js');",
      "const value = (module['re' + 'quire'])('../outside/' + name + '.js');",
      "const value = import('../outside/' + name.replace(/\\(/g, '') + '.js');",
      'const value = import /* keep */ (`../outside/${name}.js`);',
    ];

    for (const sourceText of unsafeSources) {
      await expect(
        createTransformer(workspaceRoot).transform(sourcePath, sourceText),
      ).rejects.toBeInstanceOf(Error);
    }
  });

  /** Rejects executable glob options and runtime query interpolation rather than guessing semantics. */
  it('rejects non-static macro options and suffix expressions', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const sourcePath = path.join(workspaceRoot, 'Preview.tsx');

    await expect(
      createTransformer(workspaceRoot).transform(
        sourcePath,
        "const pages = import.meta.glob('./pages/*.tsx', getOptions());",
      ),
    ).rejects.toBeInstanceOf(PreviewSourceTransformError);
    await expect(
      createTransformer(workspaceRoot).transform(
        sourcePath,
        'const asset = import(`./image.png?kind=${kind}`);',
      ),
    ).rejects.toThrow('query and fragment expressions');
  });

  /** Applies a require-context regular expression before enforcing the 256 returned-module cap. */
  it('limits require.context after its static regular-expression filter', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const pagesDirectory = path.join(workspaceRoot, 'pages');
    await mkdir(pagesDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(pagesDirectory, 'Only.tsx'), 'export default 1;'),
      ...Array.from({ length: 256 }, (_, index) =>
        writeFile(path.join(pagesDirectory, `Noise-${index.toString()}.txt`), 'ignored'),
      ),
    ]);
    const sourcePath = path.join(workspaceRoot, 'Preview.tsx');

    const transformed = await createTransformer(workspaceRoot).transform(
      sourcePath,
      "const pages = require.context('./pages', false, /Only\\.tsx$/); export default pages;",
    );

    expect(transformed.contents).toContain('./pages/Only.tsx');
    expect(transformed.contents).not.toContain('Noise-');
    expect(transformed.contents).toContain('() => require("./pages/Only.tsx")');
    expect(transformed.contents).not.toContain('import * as');
  });

  /** Preserves regex punctuation and lazy context semantics while rejecting pathological filters. */
  it('parses bounded require.context regex literals with AST argument boundaries', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const pagesDirectory = path.join(workspaceRoot, 'pages');
    await mkdir(pagesDirectory, { recursive: true });
    await writeFile(path.join(pagesDirectory, 'A,B).tsx'), 'export default 1;');
    const sourcePath = path.join(workspaceRoot, 'Preview.tsx');

    const transformed = await createTransformer(workspaceRoot).transform(
      sourcePath,
      String.raw`const pages = require.context('./pages', false, /A,B\)\.tsx$/);`,
    );

    expect(transformed.contents).toContain('./pages/A,B).tsx');
    await expect(
      createTransformer(workspaceRoot).transform(
        sourcePath,
        "const pages = require.context('./pages', true, /(a+)+$/);",
      ),
    ).rejects.toThrow('nested quantified groups');
    await expect(
      createTransformer(workspaceRoot).transform(
        sourcePath,
        "const pages = require.context('./pages', true, /((a+))+$/);",
      ),
    ).rejects.toThrow('nested quantified groups');
    await expect(
      createTransformer(workspaceRoot).transform(
        sourcePath,
        "const pages = require.context('./pages', true, /^.*.*.*.*.*.*X$/);",
      ),
    ).rejects.toThrow('repeated unbounded quantifiers');
    await expect(
      createTransformer(workspaceRoot).transform(
        sourcePath,
        "const pages = require.context('./pages', true, /a{0,5000}X$/);",
      ),
    ).rejects.toThrow('large or repeated range quantifiers');
    await expect(
      createTransformer(workspaceRoot).transform(
        sourcePath,
        "const pages = require.context('./pa?es', true, /tsx$/);",
      ),
    ).rejects.toThrow('without glob metacharacters');
  });

  /** Accepts Vite-compatible comments and trailing commas in literal pattern arrays and options. */
  it('parses commented glob arrays with trailing commas', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const pagesDirectory = path.join(workspaceRoot, 'pages');
    await mkdir(pagesDirectory, { recursive: true });
    await writeFile(path.join(pagesDirectory, 'Home.tsx'), 'export default 1;');
    const sourcePath = path.join(workspaceRoot, 'Preview.tsx');

    const transformed = await createTransformer(workspaceRoot).transform(
      sourcePath,
      "const pages = import.meta.glob(/* paths */ ['./pages/*.tsx',], { eager: true, });",
    );

    expect(transformed.contents).toContain('./pages/Home.tsx');
  });

  /** Resolves Vite `/src` globs from the nearest package root while preserving public map keys. */
  it('transforms project-root import.meta.glob patterns with Vite-compatible keys', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const projectRoot = path.join(workspaceRoot, 'packages', 'client');
    const sourceDirectory = path.join(projectRoot, 'src', 'common', 'packages', 'uitest');
    const agentsDirectory = path.join(projectRoot, 'src', 'common', 'ui', 'agents');
    await Promise.all([
      mkdir(sourceDirectory, { recursive: true }),
      mkdir(agentsDirectory, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(agentsDirectory, 'button.md'), '# Button'),
      writeFile(path.join(agentsDirectory, 'index.md'), '# Index'),
    ]);
    const sourcePath = path.join(sourceDirectory, 'agent-doc-registry.ts');
    const sourceText = [
      'const docs = import.meta.glob("/src/common/ui/agents/*.md", { query: "?url", import: "default" });',
      'const index = import.meta.glob("/src/common/ui/agents/index.md", { query: "?raw", import: "default", eager: true });',
      'export { docs, index };',
    ].join('\n');
    const transformer = new PreviewSourceTransformer({ projectRoot, workspaceRoot });

    const transformed = await transformer.transform(sourcePath, sourceText);

    expect(transformed.contents).toContain('"/src/common/ui/agents/button.md"');
    expect(transformed.contents).toContain('"/src/common/ui/agents/index.md"');
    expect(transformed.contents).toContain('import("../../ui/agents/button.md?url")');
    expect(transformed.contents).toContain('from "../../ui/agents/index.md?raw"');
    expect(transformed.watchDirectories).toEqual([agentsDirectory]);
  });

  /** Lets a finite generated-icon registry use the build-wide cap instead of the legacy 256 cap. */
  it('supports large Vite glob registries within the bounded build reference budget', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const projectRoot = path.join(workspaceRoot, 'client');
    const iconsDirectory = path.join(projectRoot, 'src', 'common', 'ui', 'generated-icons');
    const sourcePath = path.join(projectRoot, 'src', 'registry.ts');
    await mkdir(iconsDirectory, { recursive: true });
    await Promise.all(
      Array.from({ length: 330 }, (_, index) =>
        writeFile(path.join(iconsDirectory, `Icon-${index.toString()}.tsx`), 'export default 1;'),
      ),
    );
    const transformer = new PreviewSourceTransformer({ projectRoot, workspaceRoot });

    const transformed = await transformer.transform(
      sourcePath,
      'export const icons = import.meta.glob("/src/common/ui/generated-icons/*.tsx");',
    );

    expect(transformed.contents).toContain('/src/common/ui/generated-icons/Icon-0.tsx');
    expect(transformed.contents).toContain('/src/common/ui/generated-icons/Icon-329.tsx');
    expect(transformed.contents.match(/:\s*\(\) => import\(/gu)).toHaveLength(330);
  });

  /** Rejects a root glob that attempts to leave its package even when the sibling is in workspace. */
  it('confines project-root import.meta.glob patterns to the nearest package', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const projectRoot = path.join(workspaceRoot, 'packages', 'client');
    const sourcePath = path.join(projectRoot, 'src', 'entry.tsx');
    await mkdir(path.dirname(sourcePath), { recursive: true });
    const transformer = new PreviewSourceTransformer({ projectRoot, workspaceRoot });

    await expect(
      transformer.transform(sourcePath, 'const files = import.meta.glob("/../shared/*.tsx");'),
    ).rejects.toThrow('must stay inside the workspace');
  });
});

/** Creates and records one empty workspace directory for cleanup after each test. */
async function createTemporaryWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-transformer-'));
  temporaryRoots.push(workspaceRoot);
  return workspaceRoot;
}

/** Creates a per-build transformer confined to one temporary workspace. */
function createTransformer(
  workspaceRoot: string,
  instrumentRenderConditions = false,
): PreviewSourceTransformer {
  return new PreviewSourceTransformer({
    instrumentRenderConditions,
    projectRoot: workspaceRoot,
    workspaceRoot,
  });
}
