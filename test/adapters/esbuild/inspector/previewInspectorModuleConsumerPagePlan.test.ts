/** Verifies hook/factory modules recover real pages through statically proven render call paths. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorModuleConsumerPagePlan,
  hasPreviewInspectorCallableModuleExports,
  PREVIEW_INSPECTOR_MODULE_CONSUMER_LIMITS,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorModuleConsumerPagePlan';

/** Creates an extension-aware in-memory resolver without executing project configuration. */
function createFixture(sources: Readonly<Record<string, string>>): {
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule: (specifier: string, consumer: string) => string | undefined;
  readonly sourcePaths: readonly string[];
} {
  const sourceByPath = new Map(
    Object.entries(sources).map(([sourcePath, sourceText]) => [
      path.normalize(sourcePath),
      sourceText,
    ]),
  );
  return {
    readSource: (sourcePath) => Promise.resolve(sourceByPath.get(path.normalize(sourcePath))),
    resolveModule: (specifier, consumer) => {
      const aliasPath = specifier.startsWith('@feature/')
        ? path.join('/workspace/src/features', specifier.slice('@feature/'.length))
        : undefined;
      const base =
        aliasPath ??
        (specifier.startsWith('.') ? path.resolve(path.dirname(consumer), specifier) : undefined);
      if (base === undefined) return undefined;
      return [
        base,
        ...['.tsx', '.ts', '.jsx', '.js'].map((extension) => base + extension),
        ...['.tsx', '.ts', '.jsx', '.js'].map((extension) => path.join(base, `index${extension}`)),
      ].find((candidate) => sourceByPath.has(path.normalize(candidate)));
    },
    sourcePaths: Object.freeze([...sourceByPath.keys()]),
  };
}

describe('createPreviewInspectorModuleConsumerPagePlan', () => {
  /** Keeps the package inventory gate aligned with the planner's supported runtime exports. */
  it('recognizes default factories and mixed hook modules without classifying components as factories', () => {
    expect(
      hasPreviewInspectorCallableModuleExports(
        '/workspace/src/create-renderer.tsx',
        'export default function makeRenderer() { return () => <aside>dialog</aside>; }',
      ),
    ).toBe(true);
    expect(
      hasPreviewInspectorCallableModuleExports(
        '/workspace/src/use-dialog.tsx',
        [
          "export const DIALOG_OPTIONS = { placement: 'center' };",
          'export const useDialog = () => ({ render: () => <aside>dialog</aside> });',
        ].join('\n'),
      ),
    ).toBe(true);
    expect(
      hasPreviewInspectorCallableModuleExports(
        '/workspace/src/Page.tsx',
        'export default function Page() { return <main>ordinary component</main>; }',
      ),
    ).toBe(false);
    expect(
      hasPreviewInspectorCallableModuleExports(
        '/workspace/src/Card.tsx',
        'export function Card() { return <article>ordinary component</article>; }',
      ),
    ).toBe(false);
  });

  /** Reproduces the production hook that returns a modal renderer consumed below a real page. */
  it('promotes an aliased hook call and returned JSX callback into its authored page', async () => {
    const hookPath = '/workspace/src/features/company/use-phone-modal.tsx';
    const tablePath = '/workspace/src/features/company/UploadTable.tsx';
    const pagePath = '/workspace/src/pages/CompanyCreatePage.tsx';
    const appPath = '/workspace/src/App.tsx';
    const entryPath = '/workspace/src/main.tsx';
    const fixture = createFixture({
      [hookPath]: [
        "import gql from 'graphql-tag';",
        'export const COMPANY_CREATE_EDIT_USER_PHONE_MUTATION = gql`mutation EditPhone { editPhone }`;',
        'export function useCompanyCreateChangePhoneNumberModal() {',
        '  const renderModalForm = () => <aside>change phone</aside>;',
        '  return { renderModalForm };',
        '}',
      ].join('\n'),
      [tablePath]: [
        "import styled from 'styled-components';",
        "import { useCompanyCreateChangePhoneNumberModal as usePhoneDialog } from './use-phone-modal';",
        'export const AoiAndCaptableUploadTable = styled(() => {',
        '  const { renderModalForm } = usePhoneDialog();',
        '  return <section><h2>Uploads</h2>{renderModalForm()}</section>;',
        '})``;',
      ].join('\n'),
      [pagePath]: [
        "import { AoiAndCaptableUploadTable } from '../features/company/UploadTable';",
        'export default function CompanyCreatePage() {',
        '  return <main><AoiAndCaptableUploadTable /></main>;',
        '}',
      ].join('\n'),
      [appPath]: [
        "import CompanyCreatePage from './pages/CompanyCreatePage';",
        'export default function App() { return <CompanyCreatePage />; }',
      ].join('\n'),
      [entryPath]: [
        "import { createRoot } from 'react-dom/client';",
        "import App from './App';",
        'createRoot(document.body).render(<App />);',
      ].join('\n'),
    });

    const plan = await createPreviewInspectorModuleConsumerPagePlan({
      documentPath: hookPath,
      ...fixture,
    });

    expect(plan?.contextModule?.sourcePath).toBe(hookPath);
    expect(plan?.contextModule?.importPath).toEqual(
      expect.arrayContaining([appPath, pagePath, tablePath, hookPath]),
    );
    expect(plan?.target).toEqual({
      exportName: 'AoiAndCaptableUploadTable',
      sourcePath: tablePath,
    });
    expect(plan?.root.sourcePath).toBe(appPath);
    expect(plan?.renderChain.reachability).toBe('entry-connected');
    expect(plan?.dependencyPaths).toEqual(
      expect.arrayContaining([appPath, entryPath, hookPath, pagePath, tablePath]),
    );
  });

  /** Keeps named barrel aliases and consumer-local aliases transparent across the call path. */
  it('follows a callable through a barrel alias and a component-local import alias', async () => {
    const hookPath = '/workspace/src/features/dialog/use-dialog.tsx';
    const barrelPath = '/workspace/src/features/dialog/index.ts';
    const cyclePath = '/workspace/src/features/dialog/cycle.ts';
    const pagePath = '/workspace/src/pages/SettingsPage.tsx';
    const entryPath = '/workspace/src/main.tsx';
    const fixture = createFixture({
      [hookPath]: 'export const useDialog = () => ({ render: () => <aside>dialog</aside> });',
      [barrelPath]: [
        "export { useDialog as useSettingsDialog } from './use-dialog';",
        "export * from './cycle';",
      ].join('\n'),
      [cyclePath]: "export * from './index';",
      [pagePath]: [
        "import { useSettingsDialog as useModal } from '@feature/dialog';",
        'export default function SettingsPage() {',
        '  const modal = useModal();',
        '  return <main>{modal.render()}</main>;',
        '}',
      ].join('\n'),
      [entryPath]: [
        "import { createRoot } from 'react-dom/client';",
        "import SettingsPage from './pages/SettingsPage';",
        'createRoot(document.body).render(<SettingsPage />);',
      ].join('\n'),
    });

    const plan = await createPreviewInspectorModuleConsumerPagePlan({
      documentPath: hookPath,
      ...fixture,
    });

    expect(plan?.target).toEqual({ exportName: 'default', sourcePath: pagePath });
    expect(plan?.contextModule?.importPath.at(-1)).toBe(hookPath);
    expect(plan?.dependencyPaths).toContain(barrelPath);
    expect(plan?.root.sourcePath).toBe(pagePath);
  });

  /** Keeps optional context discovery under a fixed inventory cap on generated monorepos. */
  it('bounds source reads while preserving nearby consumers and conventional page entries', async () => {
    const hookPath = '/workspace/src/features/dialog/use-dialog.ts';
    const componentPath = '/workspace/src/features/dialog/DialogButton.tsx';
    const pagePath = '/workspace/src/pages/DialogPage.tsx';
    const sources: Record<string, string> = {
      [hookPath]: 'export function useDialog() { return { visible: true }; }',
      [componentPath]: [
        "import { useDialog } from './use-dialog';",
        'export function DialogButton() {',
        '  const dialog = useDialog();',
        '  return dialog.visible ? <button>Open</button> : null;',
        '}',
      ].join('\n'),
      [pagePath]: [
        "import { DialogButton } from '../features/dialog/DialogButton';",
        'export default function DialogPage() { return <main><DialogButton /></main>; }',
      ].join('\n'),
    };
    for (let index = 0; index < 4_300; index += 1) {
      sources[`/workspace/generated/value-${index.toString().padStart(4, '0')}.ts`] =
        `export const generatedValue${index.toString()} = ${index.toString()};`;
    }
    const fixture = createFixture(sources);
    const reads = new Set<string>();

    const plan = await createPreviewInspectorModuleConsumerPagePlan({
      documentPath: hookPath,
      ...fixture,
      readSource: async (sourcePath) => {
        reads.add(path.normalize(sourcePath));
        return fixture.readSource(sourcePath);
      },
    });

    expect(plan?.root.sourcePath).toBe(pagePath);
    expect(reads.size).toBeLessThanOrEqual(
      PREVIEW_INSPECTOR_MODULE_CONSUMER_LIMITS.maximumSourcePaths,
    );
    expect(reads).toContain(componentPath);
    expect(reads).toContain(pagePath);
  });

  /** Treats a returned JSX factory like a render edge even when it is not named as a hook. */
  it('connects a build-prefixed JSX factory to the component that invokes its result', async () => {
    const factoryPath = '/workspace/src/factories/build-actions.tsx';
    const pagePath = '/workspace/src/pages/ActionsPage.tsx';
    const fixture = createFixture({
      [factoryPath]: 'export const buildActions = () => () => <nav>actions</nav>;',
      [pagePath]: [
        "import { buildActions } from '../factories/build-actions';",
        'export function ActionsPage() {',
        '  const renderActions = buildActions();',
        '  return <main>{renderActions()}</main>;',
        '}',
      ].join('\n'),
    });

    const plan = await createPreviewInspectorModuleConsumerPagePlan({
      documentPath: factoryPath,
      ...fixture,
    });

    expect(plan?.target).toEqual({ exportName: 'ActionsPage', sourcePath: pagePath });
    expect(plan?.contextModule).toMatchObject({
      evidenceKind: 'import-chain',
      sourcePath: factoryPath,
    });
  });

  /** Does not invent a page for unused hooks or similarly named non-callable configuration. */
  it('returns no plan when no exported component calls the selected module', async () => {
    const hookPath = '/workspace/src/use-unused.ts';
    const fixture = createFixture({
      [hookPath]: [
        'export const useUnused = () => ({ ready: true });',
        'export const useConfiguration = { enabled: true };',
      ].join('\n'),
      '/workspace/src/App.tsx': 'export default function App() { return <main />; }',
      '/workspace/src/main.tsx': [
        "import { createRoot } from 'react-dom/client';",
        "import App from './App';",
        'createRoot(document.body).render(<App />);',
      ].join('\n'),
    });

    await expect(
      createPreviewInspectorModuleConsumerPagePlan({ documentPath: hookPath, ...fixture }),
    ).resolves.toBeUndefined();
  });
});
