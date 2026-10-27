/** Creates bounded, source-backed factories with wrapped callbacks and a real Provider contract. */
import assert from 'node:assert/strict';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { PreviewInspectorRouteSelectionStep } from '../../../../src/domain/preview';
import {
  collectPreviewInspectorRouteBranchPlan,
  type PreviewInspectorRouteBranchPlan,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteBranchPlan';
import { createPreviewStaticModuleResolver } from '../../../../src/adapters/esbuild/previewStaticModuleResolver';
import type {
  PreviewRenderChainCandidate,
  PreviewRenderChainPlan,
  ResolvePreviewRenderGraphModule,
} from '../../../../src/adapters/esbuild/renderGraph';
import { variableRouteFactorySources } from './previewInspectorVariableRouteFactorySources';

/** Controlled source variants; overrides never read or execute an external project. */
export interface VariableRouteFactoryFixtureOptions {
  /** Explicit replacement source text inside the caller-owned fixture only. */
  readonly sourceOverrides?: Readonly<Record<string, string>>;
  /** Existing wrapper/decoy coverage remains enabled unless a colocated-owner case opts out. */
  readonly wrapCallbacks?: boolean;
}

/** Writes only controlled text into the caller's temporary directory; no module is evaluated. */
export async function createVariableRouteFactoryFixture(
  workspaceRoot: string,
  options: VariableRouteFactoryFixtureOptions = {},
): Promise<VariableRouteFactoryFixture> {
  await mkdir(workspaceRoot, { recursive: true });
  const root = await realpath(workspaceRoot);
  const appPath = path.join(root, 'src/app.tsx');
  const sourceByPath = new Map<string, string>();
  for (const [relative, text] of Object.entries({
    ...variableRouteFactorySources,
    ...options.sourceOverrides,
  })) {
    const sourcePath = path.join(root, relative);
    const wrapped =
      options.wrapCallbacks !== false &&
      (relative === 'src/app.tsx' || relative === 'src/management/management-app.tsx')
        ? wrapControlledCallback(text, sourcePath, relative.includes('/management/'))
        : text;
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, wrapped);
    sourceByPath.set(sourcePath, wrapped);
  }
  const sourcePaths = [...sourceByPath.keys()].filter(
    (file) => file !== path.join(root, 'package.json'),
  );
  const readSource = (file: string): Promise<string | undefined> =>
    Promise.resolve(sourceByPath.get(path.normalize(file)));
  const resolveModule = createPreviewStaticModuleResolver({ workspaceRoot: root }).resolve;
  const reference = { exportName: 'FeatureApp', sourcePath: appPath };
  const renderPath = {
    id: 'controlled-factory-app',
    entryPoint: {
      kind: 'create-root' as const,
      occurrenceStart: 0,
      sourcePath: appPath,
      wrapperNames: [],
    },
    steps: [
      {
        certainty: 'confirmed' as const,
        kind: 'component-render' as const,
        label: 'FeatureApp',
        occurrenceStart: 0,
        sourcePath: appPath,
        wrapperNames: [],
      },
    ],
  };
  const renderChain = {
    dependencyPaths: [appPath],
    paths: [renderPath],
    reachability: 'entry-connected' as const,
    target: reference,
    truncated: false,
  };
  const collect = async (
    selection?: readonly PreviewInspectorRouteSelectionStep[],
  ): Promise<PreviewInspectorRouteBranchPlan> =>
    collectPreviewInspectorRouteBranchPlan({
      documentPath: appPath,
      exportName: 'FeatureApp',
      readSource,
      resolveModule,
      renderChain,
      sourcePaths,
      ...(selection === undefined ? {} : { selection }),
    });
  const inventory = await collect();
  const select = (name: string): readonly PreviewInspectorRouteSelectionStep[] => {
    const branch = inventory.branches.find(
      (value) => value.componentName === name && value.selectable !== false,
    );
    assert.ok(branch, `Controlled route ${name} must be selectable`);
    return branch.selectionPath;
  };
  return {
    root,
    appPath,
    sourceByPath,
    readSource,
    resolveModule,
    reference,
    renderPath,
    renderChain,
    collect,
    select,
  };
}

/** Portable fixture state shared by the compiler and in-memory bundle without importing its files. */
export interface VariableRouteFactoryFixture {
  /** Canonical caller-owned temporary workspace. */
  readonly root: string;
  /** Exact outer factory owner identity. */
  readonly appPath: string;
  /** Wrapped source bytes used by both source readers and the real compiler. */
  readonly sourceByPath: ReadonlyMap<string, string>;
  /** Source reader restricted to this controlled workspace. */
  readonly readSource: (file: string) => Promise<string | undefined>;
  /** Normal static resolver used without importing application modules. */
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  /** Public root/export identity. */
  readonly reference: { exportName: string; sourcePath: string };
  /** Source-backed entry connection for production planning. */
  readonly renderPath: PreviewRenderChainCandidate;
  /** Frozen outer ancestry shared by route choices. */
  readonly renderChain: PreviewRenderChainPlan;
  /** Collects each selection through the actual branch planner. */
  readonly collect: (
    selection?: readonly PreviewInspectorRouteSelectionStep[],
  ) => Promise<PreviewInspectorRouteBranchPlan>;
  /** Uses compiler-offered identities instead of inventing a selected route. */
  readonly select: (name: string) => readonly PreviewInspectorRouteSelectionStep[];
}

/** Wraps the first authored callback; a later decoy must never replace its slot/owner evidence. */
function wrapControlledCallback(
  sourceText: string,
  sourcePath: string,
  asFunction: boolean,
): string {
  const source = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'createAppModule'
    )
      calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(calls.length, 1);
  const callback = calls[0]?.arguments[3];
  assert.ok(callback && ts.isArrowFunction(callback));
  const text = asFunction
    ? `function (${callback.parameters.map((parameter) => parameter.getText(source)).join(', ')}) { return ${callback.body.getText(source)}; }`
    : callback.getText(source);
  const wrapped = `(((${text}) satisfies unknown) as unknown)!, ({ entries: decoy }) => <Routes>{decoy}</Routes>`;
  return sourceText.slice(0, callback.getStart(source)) + wrapped + sourceText.slice(callback.end);
}
