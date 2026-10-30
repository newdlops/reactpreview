/** Keeps proven local visibility controllers authentic before Page Execution freezes its imports. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPreviewCompilerFrontierPolicy } from '../../../../src/domain/previewCompilerFrontier';
import { preparePreviewInspectorBundleFrontier } from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontier';
import {
  createRepresentationDominanceCandidate,
  createRepresentationDominancePlan,
} from './previewInspectorBundleFrontierFixtures';

describe('frozen local UI hook frontier', () => {
  it('retains callbacks that transform render inputs while projecting their external data leaves', async () => {
    const app = '/workspace/Page.tsx';
    const helper = '/workspace/use-column-helpers.ts';
    const remote = '/workspace/use-data.ts';
    const sources = new Map([
      [
        app,
        `import {useColumnHelpers} from './use-column-helpers'; import {useColumns} from './use-columns';
        export function SlicedPage(){const {setColumn}=useColumnHelpers();
          const {columns}=useColumns({setColumn});return <div>{columns.map(column=><span>{column.label}</span>)}</div>;}
        export function AuthenticTarget(){return null;}`,
      ],
      [
        helper,
        `import {useCallback} from 'react'; import {useRemoteData} from './use-data';
        export function useColumnHelpers(){const data=useRemoteData();
          const setColumn=useCallback(column=>({...column,label:column.label.trim()}),[]);
          return {setColumn,data};}`,
      ],
      [
        remote,
        `import {useQuery} from './backend';export function useRemoteData(){return useQuery();}`,
      ],
      [
        '/workspace/use-columns.ts',
        `export function useColumns({setColumn}){
        return {columns:[{label:' Authored '}].map(setColumn)};}`,
      ],
      [
        '/workspace/backend.ts',
        'export function useQuery(){throw new Error("backend must stay projected");}',
      ],
    ]);
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Missing fast policy');
    const result = await preparePreviewInspectorBundleFrontier({
      executionCandidate: createRepresentationDominanceCandidate(app, true),
      plan: createRepresentationDominancePlan(app),
      policy,
      workspaceRoot: '/workspace',
      readSource: (source) => Promise.resolve(sources.get(source)),
      resolveModule: (specifier, importer) =>
        specifier.startsWith('.')
          ? path.resolve(path.dirname(importer), specifier + '.ts')
          : undefined,
    });
    expect(result.rejected).toBe(false);
    expect(result.frontier.authenticSourcePaths).toContain(helper);
    expect(result.frontier.projectedEdges.some((edge) => edge.targetPath === helper)).toBe(false);
    expect(result.frontier.authenticSourcePaths).not.toContain('/workspace/backend.ts');
    expect(
      result.frontier.projectedEdges.some(
        (edge) => edge.targetPath === remote || edge.targetPath === '/workspace/backend.ts',
      ),
    ).toBe(true);
  });

  it('retains a local state/action hook and leaves data hooks projected', async () => {
    const app = '/workspace/Page.tsx',
      local = '/workspace/use-modal.ts',
      remote = '/workspace/use-rows.ts';
    const sources = new Map([
      [
        app,
        `import {useModal} from './use-modal'; import {useSession} from './use-rows';
        export function SlicedPage(){const modal=useModal();const {user}=useSession();
          return <button onClick={modal.show}>{modal.open && user.name}</button>;}
        export function AuthenticTarget(){return null;}`,
      ],
      [
        local,
        `import {useState} from 'react'; export function useModal(){
        const [open,setOpen]=useState(false); const show=()=>setOpen(true);return{open,show};}`,
      ],
      [remote, `import {useQuery} from './api';export function useSession(){return useQuery();}`],
      ['/workspace/api.ts', 'export function useQuery(){return [];}'],
    ]);
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Missing fast policy');
    const result = await preparePreviewInspectorBundleFrontier({
      executionCandidate: createRepresentationDominanceCandidate(app, true),
      plan: createRepresentationDominancePlan(app),
      policy,
      workspaceRoot: '/workspace',
      readSource: (source) => Promise.resolve(sources.get(source)),
      resolveModule: (specifier, importer) =>
        specifier.startsWith('.')
          ? path.resolve(path.dirname(importer), specifier + '.ts')
          : undefined,
    });
    expect(result.rejected).toBe(false);
    expect(result.frontier.authenticSourcePaths).toContain(local);
    expect(result.frontier.projectedEdges.some((edge) => edge.targetPath === local)).toBe(false);
    expect(
      result.frontier.projectedEdges.some((edge) => edge.targetPath === '/workspace/api.ts'),
    ).toBe(true);
    expect(result.frontier.authenticSourcePaths).not.toContain('/workspace/api.ts');
  });
});
