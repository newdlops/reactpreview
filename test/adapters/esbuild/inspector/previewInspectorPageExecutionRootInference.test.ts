/** Verifies props recovery for a Page Execution root pinned below the analyzed app candidate. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inferPreviewInspectorPageExecutionRootProps } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionRootInference';
import type { PreviewInspectorPageExecutionCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';

const WORKSPACE_ROOT = path.resolve('/workspace');
const ROOT_PATH = path.join(WORKSPACE_ROOT, 'src', 'Board.tsx');
const CHILD_PATH = path.join(WORKSPACE_ROOT, 'src', 'Lists.tsx');
const LIST_PATH = path.join(WORKSPACE_ROOT, 'src', 'List.tsx');
const ISSUE_PATH = path.join(WORKSPACE_ROOT, 'src', 'Issue.tsx');
const STATUS_PATH = path.join(WORKSPACE_ROOT, 'src', 'issues.ts');

/** Creates the smallest immutable candidate accepted by the inference boundary. */
function createCandidate(exportName = 'default'): PreviewInspectorPageExecutionCandidate {
  const root = { exportName, sourcePath: ROOT_PATH };
  const role = { ...root, surfaceId: 'root-surface' };
  return Object.freeze({
    browserCandidate: Object.freeze({
      complete: false,
      dependencyPaths: [ROOT_PATH, CHILD_PATH],
      edges: [],
      id: 'pinned-board',
      root,
      rootAutomaticProps: Object.freeze({}),
      rootOwnsRouter: false,
      stopReason: 'render-path-checkpoint',
      targetAutomaticProps: Object.freeze({}),
    }),
    compositionEdges: Object.freeze([]),
    criticalSurfaces: Object.freeze([]),
    evidenceSourcePaths: Object.freeze([]),
    executionRootContract: Object.freeze(role),
    executionRootSurfaceId: role.surfaceId,
    fidelity: 'page-authentic',
    id: 'execution-candidate',
    optionalSurfaces: Object.freeze([]),
    runtimeTargetContract: Object.freeze(role),
    runtimeTargetSurfaceId: role.surfaceId,
    watchSourcePaths: Object.freeze([ROOT_PATH, CHILD_PATH]),
  });
}

describe('inferPreviewInspectorPageExecutionRootProps', () => {
  /** Carries a reached child's nested collection contract back to the newly pinned root. */
  it('restores transitive props for the exact mounted execution root', async () => {
    const rootSource = [
      "import Lists from './Lists';",
      'export default function Board({ project, updateProject }) {',
      '  return <Lists project={project} updateProject={updateProject} />;',
      '}',
    ].join('\n');
    const childSource = [
      'export default function Lists({ project }) {',
      '  return project.issues.map((issue) => <span key={issue.id}>{issue.title}</span>);',
      '}',
    ].join('\n');
    const snapshots = new Map([
      [ROOT_PATH, rootSource],
      [CHILD_PATH, childSource],
    ]);
    const candidate = createCandidate();

    const [inferred] = await inferPreviewInspectorPageExecutionRootProps({
      candidates: [candidate],
      readSource: (sourcePath) => Promise.resolve(snapshots.get(path.normalize(sourcePath))),
      resolveModule: (specifier, importer) =>
        specifier === './Lists' && path.normalize(importer) === ROOT_PATH ? CHILD_PATH : undefined,
      snapshotSourceByPath: snapshots,
      workspaceRoot: WORKSPACE_ROOT,
    });

    expect(inferred).not.toBe(candidate);
    expect(inferred?.browserCandidate.rootInference?.shape).toMatchObject({
      kind: 'object',
      properties: {
        project: {
          kind: 'object',
          properties: {
            issues: {
              items: {
                kind: 'object',
                properties: {
                  id: { kind: 'string' },
                  title: { kind: 'string' },
                },
              },
              kind: 'array',
            },
          },
        },
        updateProject: { kind: 'function' },
      },
    });
    expect(candidate.browserCandidate.rootInference).toBeUndefined();
  });

  /** Keeps interaction-only collection fields reached through a local filtering helper. */
  it('restores nested item fields read after a child filter is enabled', async () => {
    const rootSource = [
      "import Lists from './Lists';",
      'const ProjectBoard = ({ project }) => <Lists project={project} />;',
      'export default ProjectBoard;',
    ].join('\n');
    const childSource = [
      "import List from './List';",
      'export default function Lists({ project }) {',
      '  return <List project={project} filters={{ myOnly: false }} currentUserId={1} />;',
      '}',
    ].join('\n');
    const listSource = [
      'export default function List({ project, filters, currentUserId }) {',
      '  const issues = filterIssues(project.issues, filters, currentUserId);',
      '  return issues.map((issue) => <span key={issue.id}>{issue.title}</span>);',
      '}',
      'const filterIssues = (issues, filters, currentUserId) => {',
      '  if (filters.myOnly && currentUserId) {',
      '    return issues.filter((issue) => issue.userIds.includes(currentUserId));',
      '  }',
      '  return issues;',
      '};',
    ].join('\n');
    const snapshots = new Map([
      [ROOT_PATH, rootSource],
      [CHILD_PATH, childSource],
      [LIST_PATH, listSource],
    ]);

    const [inferred] = await inferPreviewInspectorPageExecutionRootProps({
      candidates: [createCandidate('ProjectBoard')],
      readSource: (sourcePath) => Promise.resolve(snapshots.get(path.normalize(sourcePath))),
      resolveModule: (specifier, importer) => {
        if (specifier === './Lists' && path.normalize(importer) === ROOT_PATH) return CHILD_PATH;
        if (specifier === './List' && path.normalize(importer) === CHILD_PATH) return LIST_PATH;
        return undefined;
      },
      snapshotSourceByPath: snapshots,
      workspaceRoot: WORKSPACE_ROOT,
    });

    expect(
      inferred?.browserCandidate.rootInference?.shape.properties?.project?.properties?.issues?.items,
    ).toMatchObject({
      kind: 'object',
      properties: {
        userIds: { kind: 'array' },
      },
    });
  });

  /** Uses one imported registry key instead of a generic discriminator rejected by every list. */
  it('keeps generated collection items inside an authored status registry', async () => {
    const rootSource = [
      "import Lists from './Lists';",
      'const ProjectBoard = ({ project }) => <Lists project={project} />;',
      'export default ProjectBoard;',
    ].join('\n');
    const childSource = [
      "import { IssueStatus } from './issues';",
      "import List from './List';",
      'export default function Lists({ project }) {',
      '  return Object.values(IssueStatus).map((status) => (',
      '    <List key={status} status={status} project={project} />',
      '  ));',
      '}',
    ].join('\n');
    const listSource = [
      "import { IssueStatusCopy } from './issues';",
      "import Issue from './Issue';",
      'export default function List({ status, project }) {',
      '  const issues = getListIssues(project.issues, status);',
      '  return (',
      '    <section>',
      '      <h2>{IssueStatusCopy[status]}</h2>',
      '      {issues.map((issue) => <Issue key={issue.id} issue={issue} />)}',
      '    </section>',
      '  );',
      '}',
      'const getListIssues = (issues, status) =>',
      '  issues.filter((issue) => issue.status === status);',
    ].join('\n');
    const issueSource = [
      'export default function Issue({ issue }) {',
      '  return <article data-id={issue.id.toString()}>{issue.title}</article>;',
      '}',
    ].join('\n');
    const statusSource = [
      'export const IssueStatus = {',
      "  BACKLOG: 'backlog',",
      "  SELECTED: 'selected',",
      '};',
      'export const IssueStatusCopy = {',
      "  [IssueStatus.BACKLOG]: 'Backlog',",
      "  [IssueStatus.SELECTED]: 'Selected for development',",
      '};',
    ].join('\n');
    const snapshots = new Map([
      [ROOT_PATH, rootSource],
      [CHILD_PATH, childSource],
      [LIST_PATH, listSource],
      [ISSUE_PATH, issueSource],
      [STATUS_PATH, statusSource],
    ]);

    const [inferred] = await inferPreviewInspectorPageExecutionRootProps({
      candidates: [createCandidate('ProjectBoard')],
      readSource: (sourcePath) => Promise.resolve(snapshots.get(path.normalize(sourcePath))),
      resolveModule: (specifier, importer) => {
        const normalizedImporter = path.normalize(importer);
        if (specifier === './Lists' && normalizedImporter === ROOT_PATH) return CHILD_PATH;
        if (specifier === './List' && normalizedImporter === CHILD_PATH) return LIST_PATH;
        if (specifier === './Issue' && normalizedImporter === LIST_PATH) return ISSUE_PATH;
        if (specifier === './issues' && normalizedImporter === CHILD_PATH) return STATUS_PATH;
        if (specifier === './issues' && normalizedImporter === LIST_PATH) return STATUS_PATH;
        return undefined;
      },
      snapshotSourceByPath: snapshots,
      workspaceRoot: WORKSPACE_ROOT,
    });

    expect(
      inferred?.browserCandidate.rootInference?.shape.properties?.project?.properties?.issues?.items
        ?.properties?.status,
    ).toEqual({ exactValue: true, kind: 'string', value: 'backlog' });
    expect(
      inferred?.browserCandidate.rootInference?.shape.properties?.project?.properties?.issues?.items
        ?.properties,
    ).toMatchObject({
      id: { kind: 'string', value: 'preview-id' },
      title: { kind: 'string', value: 'title' },
    });
  });

  /** Supports a local component name selected by an authored route render checkpoint. */
  it('infers a named local root that is exported through the default binding', async () => {
    const rootSource = [
      'const ProjectBoard = ({ project, fetchProject }) => (',
      '  <main>{project.name}<button onClick={fetchProject}>Refresh</button></main>',
      ');',
      'export default ProjectBoard;',
    ].join('\n');
    const candidate = createCandidate('ProjectBoard');

    const [inferred] = await inferPreviewInspectorPageExecutionRootProps({
      candidates: [candidate],
      readSource: () => Promise.resolve(rootSource),
      resolveModule: () => undefined,
      snapshotSourceByPath: new Map([[ROOT_PATH, rootSource]]),
      workspaceRoot: WORKSPACE_ROOT,
    });

    expect(inferred?.browserCandidate.rootInference?.shape).toMatchObject({
      kind: 'object',
      properties: {
        fetchProject: { kind: 'function' },
        project: {
          kind: 'object',
          properties: { name: { kind: 'string' } },
        },
      },
    });
  });
});
