/** Verifies bounded reverse JSX evidence without loading or executing consumer modules. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  collectPreviewTargetUsageSourcePaths,
  discoverPreviewTargetUsageProps,
} from '../../../src/adapters/esbuild/previewTargetUsageProps';

describe('discoverPreviewTargetUsageProps', () => {
  /** Selects parent-authored primitive props through an alias import and ignores dynamic usages. */
  it('uses the first deterministic literal JSX example for a named export', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-usage-props-'));
    const targetPath = path.join(projectRoot, 'src/legal/company/Breadcrumb.tsx');
    const dynamicConsumerPath = path.join(projectRoot, 'src/legal/company/OwnerPage.tsx');
    const literalConsumerPath = path.join(projectRoot, 'src/legal/employee/EmployeePage.tsx');
    try {
      await Promise.all([
        mkdir(path.dirname(targetPath), { recursive: true }),
        mkdir(path.dirname(literalConsumerPath), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(targetPath, 'export const Breadcrumb = () => null;', 'utf8'),
        writeFile(
          dynamicConsumerPath,
          [
            "import { Breadcrumb } from 'legal/company/Breadcrumb';",
            'export const OwnerPage = ({ name }) => <Breadcrumb pageName={name} />;',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          literalConsumerPath,
          [
            "import { Breadcrumb as OwnerBreadcrumb } from 'legal/company/Breadcrumb';",
            'export const EmployeePage = () => (',
            '  <OwnerBreadcrumb pageName="EmployeePage" compact count={2} ignored={{ run: true }} />',
            ');',
          ].join('\n'),
          'utf8',
        ),
      ]);

      const result = await discoverPreviewTargetUsageProps({
        documentPath: targetPath,
        exports: [{ displayName: 'Breadcrumb', exportName: 'Breadcrumb', kind: 'explicit' }],
        projectRoot,
        snapshots: [],
        workspaceRoot: projectRoot,
      });

      expect(result.propsByExport).toEqual({
        Breadcrumb: { compact: true, count: 2, pageName: 'EmployeePage' },
      });
      expect(result.dependencyPaths).toEqual([literalConsumerPath]);
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Supports relative default imports and lets an unsaved consumer snapshot override disk text. */
  it('reads a primitive default-component usage from the current editor snapshot', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-usage-props-'));
    const targetPath = path.join(projectRoot, 'src/Card.tsx');
    const consumerPath = path.join(projectRoot, 'src/Page.tsx');
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await Promise.all([
        writeFile(targetPath, 'export default function Card() { return null; }', 'utf8'),
        writeFile(
          consumerPath,
          'import Card from \'./Card\'; export const Page = () => <Card label="saved" />;',
          'utf8',
        ),
      ]);

      const result = await discoverPreviewTargetUsageProps({
        documentPath: targetPath,
        exports: [{ displayName: 'default', exportName: 'default', kind: 'explicit' }],
        projectRoot,
        snapshots: [
          {
            documentPath: consumerPath,
            language: 'tsx',
            sourceText:
              'import Card from \'./Card\'; export const Page = () => <Card label="unsaved" />;',
          },
        ],
        workspaceRoot: projectRoot,
      });

      expect(result.propsByExport).toEqual({ default: { label: 'unsaved' } });
      expect(result.dependencyPaths).toEqual([consumerPath]);
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Selects a same-file JSX branch and retains wrappers proven before a dynamic Form barrier. */
  it('discovers a pinpoint parent render slice without retaining sibling components', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-parent-slice-'));
    const targetPath = path.join(projectRoot, 'src/TargetRow.tsx');
    const consumerPath = path.join(projectRoot, 'src/Owner.tsx');
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await Promise.all([
        writeFile(targetPath, 'export const TargetRow = () => null;', 'utf8'),
        writeFile(
          consumerPath,
          [
            "import { TargetRow } from './TargetRow';",
            "import { Table } from './Table';",
            "import { Form } from './Form';",
            'const Body = () => (',
            '  <Table variant="grid"><tbody><TargetRow /></tbody></Table>',
            ');',
            'export const Owner = ({ values }) => (',
            '  <Form initialValues={values}>',
            '    {() => <main><Body /><aside>ignored sibling</aside></main>}',
            '  </Form>',
            ');',
          ].join('\n'),
          'utf8',
        ),
      ]);

      const result = await discoverPreviewTargetUsageProps({
        documentPath: targetPath,
        exports: [{ displayName: 'TargetRow', exportName: 'TargetRow', kind: 'explicit' }],
        projectRoot,
        snapshots: [],
        workspaceRoot: projectRoot,
      });

      expect(result.propsByExport).toEqual({});
      expect(result.dependencyPaths).toEqual([consumerPath]);
      expect(result.parentSlicesByExport.TargetRow).toMatchObject({
        complete: false,
        localOwnerDepth: 1,
        ownerExportNames: ['Owner'],
        sourcePath: consumerPath,
      });
      expect(result.parentSlicesByExport.TargetRow?.frames).toEqual([
        { childMode: 'children', kind: 'intrinsic', props: {}, tagName: 'tbody' },
        {
          childMode: 'children',
          importReference: {
            consumerSourcePath: consumerPath,
            exportName: 'Table',
            moduleSpecifier: './Table',
          },
          kind: 'imported',
          props: { variant: 'grid' },
        },
        { childMode: 'children', kind: 'intrinsic', props: {}, tagName: 'main' },
      ]);
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Selects a real exported page root only when the caller explicitly requests Inspector data. */
  it('discovers an actual parent root with sibling-preserving ancestry for Page Inspector', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-inspector-root-'));
    const targetPath = path.join(projectRoot, 'src/Target.tsx');
    const sectionPath = path.join(projectRoot, 'src/Section.tsx');
    const pagePath = path.join(projectRoot, 'src/Page.tsx');
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await Promise.all([
        writeFile(
          targetPath,
          [
            'export const Target = () => <button>target</button>;',
            'export const Secondary = () => <button>secondary</button>;',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          sectionPath,
          [
            "import { Target } from './Target';",
            'export const Section = () => <section><Target enabled /></section>;',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          pagePath,
          [
            "import { Section } from './Section';",
            'export const Page = () => <main><nav>sibling</nav><Section /></main>;',
          ].join('\n'),
          'utf8',
        ),
      ]);

      const result = await discoverPreviewTargetUsageProps({
        documentPath: targetPath,
        exports: [
          { displayName: 'Target', exportName: 'Target', kind: 'explicit' },
          { displayName: 'Secondary', exportName: 'Secondary', kind: 'explicit' },
        ],
        inspectorExportName: 'Target',
        projectRoot,
        snapshots: [],
        workspaceRoot: projectRoot,
      });

      expect(result.inspectorPlan).toMatchObject({
        complete: true,
        root: { exportName: 'Page', sourcePath: pagePath },
        stopReason: 'root-reached',
        target: { exportName: 'Target', sourcePath: targetPath },
        targetAutomaticProps: { enabled: true },
      });
      expect(result.inspectorPlan?.edges).toHaveLength(2);
      expect(Object.keys(result.renderChainsByExport ?? {})).toEqual(['Target', 'Secondary']);
      expect(Object.keys(result.inspectorPlan?.renderChainsByExport ?? {})).toEqual([
        'Target',
        'Secondary',
      ]);
      expect(result.dependencyPaths).toEqual([pagePath, sectionPath, targetPath].sort());
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Reuses a package-local inventory while rejecting a monorepo sibling consumer. */
  it('accepts a cached inventory bounded by explicit workspace and package roots', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-usage-workspace-'));
    const projectRoot = path.join(workspaceRoot, 'packages/application');
    const siblingRoot = path.join(workspaceRoot, 'packages/sibling');
    const targetPath = path.join(projectRoot, 'src/Badge.tsx');
    const consumerPath = path.join(projectRoot, 'src/Page.tsx');
    const siblingConsumerPath = path.join(siblingRoot, 'src/SiblingPage.tsx');
    try {
      await Promise.all([
        mkdir(path.dirname(targetPath), { recursive: true }),
        mkdir(path.dirname(siblingConsumerPath), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(targetPath, 'export const Badge = () => null;', 'utf8'),
        writeFile(
          consumerPath,
          'import { Badge } from \'./Badge\'; export const Page = () => <Badge label="local" />;',
          'utf8',
        ),
        writeFile(
          siblingConsumerPath,
          'import { Badge } from \'application/src/Badge\'; export const Sibling = () => <Badge label="sibling" />;',
          'utf8',
        ),
      ]);

      const sourcePaths = await collectPreviewTargetUsageSourcePaths({
        projectRoot,
        workspaceRoot,
      });
      expect(sourcePaths).toEqual([consumerPath, targetPath].sort());

      const result = await discoverPreviewTargetUsageProps({
        documentPath: targetPath,
        exports: [{ displayName: 'Badge', exportName: 'Badge', kind: 'explicit' }],
        projectRoot,
        snapshots: [],
        sourcePaths: [...sourcePaths, siblingConsumerPath],
        workspaceRoot,
      });

      expect(result.propsByExport).toEqual({ Badge: { label: 'local' } });
      expect(result.dependencyPaths).toEqual([consumerPath]);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Proves a real usage remains discoverable after the former 4,096-source ceiling. */
  it('scans a deterministic literal usage beyond 4,096 earlier source files', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-usage-scale-'));
    const projectRoot = path.join(workspaceRoot, 'packages/application');
    const targetPath = path.join(projectRoot, 'src/target/LateComponent.tsx');
    const consumerDirectory = path.join(projectRoot, 'src/consumers');
    const literalConsumerPath = path.join(consumerDirectory, 'zzzz-literal-usage.tsx');
    try {
      await Promise.all([
        mkdir(path.dirname(targetPath), { recursive: true }),
        mkdir(consumerDirectory, { recursive: true }),
      ]);
      await writeFile(targetPath, 'export const LateComponent = () => null;', 'utf8');
      await writeSourceFilesInBatches(
        Array.from({ length: 4_112 }, (_, index) => ({
          filePath: path.join(consumerDirectory, `decoy-${index.toString().padStart(5, '0')}.tsx`),
          sourceText: 'export {};',
        })),
      );
      await writeFile(
        literalConsumerPath,
        [
          "import { LateComponent } from '../target/LateComponent';",
          'export const Usage = () => <LateComponent pageName="EmployeePage" />;',
        ].join('\n'),
        'utf8',
      );

      const result = await discoverPreviewTargetUsageProps({
        documentPath: targetPath,
        exports: [
          {
            displayName: 'LateComponent',
            exportName: 'LateComponent',
            kind: 'explicit',
          },
        ],
        projectRoot,
        snapshots: [],
        workspaceRoot,
      });

      expect(result.propsByExport).toEqual({
        LateComponent: { pageName: 'EmployeePage' },
      });
      expect(result.dependencyPaths).toEqual([literalConsumerPath]);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  }, 60_000);

  /** Rejects a package root outside the trusted workspace before any filesystem enumeration. */
  it('fails closed when the package boundary escapes the workspace', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-usage-boundary-'));
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-usage-outside-'));
    try {
      await expect(
        collectPreviewTargetUsageSourcePaths({
          projectRoot: outsideRoot,
          workspaceRoot,
        }),
      ).rejects.toThrow('package root must remain inside the workspace root');
    } finally {
      await Promise.all([
        rm(workspaceRoot, { force: true, recursive: true }),
        rm(outsideRoot, { force: true, recursive: true }),
      ]);
    }
  });

  /** Rejects a superseded inventory before entering another potentially large directory tree. */
  it('cancels package source enumeration through its revision signal', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-usage-cancel-'));
    const controller = new AbortController();
    controller.abort();
    try {
      await expect(
        collectPreviewTargetUsageSourcePaths({
          projectRoot: workspaceRoot,
          signal: controller.signal,
          workspaceRoot,
        }),
      ).rejects.toMatchObject({ name: 'PreviewBuildCancelledError' });
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});

/** Writes large synthetic inventories without exhausting the process file-descriptor limit. */
async function writeSourceFilesInBatches(
  files: readonly { readonly filePath: string; readonly sourceText: string }[],
): Promise<void> {
  const writeConcurrency = 128;
  for (let index = 0; index < files.length; index += writeConcurrency) {
    await Promise.all(
      files
        .slice(index, index + writeConcurrency)
        .map((file) => writeFile(file.filePath, file.sourceText, 'utf8')),
    );
  }
}
