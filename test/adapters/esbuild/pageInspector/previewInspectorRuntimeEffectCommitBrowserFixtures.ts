/** Generates inert fixture files for real React effect commits, with no project install scripts. */
import { cp, mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type EffectCommitScene =
  | 'siblings'
  | 'layout-siblings'
  | 'insertion-siblings'
  | 'strict-siblings'
  | 'update'
  | 'remount'
  | 'growth'
  | 'other-root';

/** Creates a test-owned package whose declared React peers resolve to the installed test runtimes. */
export async function writeEffectCommitBrowserFixture(
  root: string,
  major: 18 | 19,
  scene: EffectCommitScene,
): Promise<string> {
  await mkdir(path.join(root, 'node_modules'), { recursive: true });
  for (const name of ['react', 'react-dom', 'scheduler']) {
    const target = major === 18 ? `react-preview-${name}-18` : name;
    const source = path.resolve('node_modules', target);
    const destination = path.join(root, 'node_modules', name);
    // An npm alias symlink would make React DOM 18 resolve its peer back to this repo's React 19.
    if (major === 18 && name === 'react-dom') await cp(source, destination, { recursive: true });
    else await symlink(source, destination, process.platform === 'win32' ? 'junction' : 'dir');
  }
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'effect-commit-fixture',
      private: true,
      dependencies: {
        react: major === 18 ? '18.3.1' : '19.2.7',
        'react-dom': major === 18 ? '18.3.1' : '19.2.7',
      },
    }),
  );
  const hook =
    scene === 'insertion-siblings'
      ? 'useInsertionEffect'
      : scene === 'siblings' || scene === 'strict-siblings'
        ? 'useEffect'
        : 'useLayoutEffect';
  const siblings = scene.endsWith('siblings');
  const source = `import {StrictMode,useEffect,useInsertionEffect,useLayoutEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
function mark(id?:number){
 const state=((globalThis as any).__effectProof??={seen:new Set(),runs:0,cleanups:0});
 state.runs++;if(id!==undefined)state.seen.add(id);
 const output=document.getElementById('executions');if(output)output.textContent=String(${siblings ? 'state.seen.size' : 'state.runs'});
}
function cleanup(){const state=(globalThis as any).__effectProof;state.cleanups++;const output=document.getElementById('cleanups');if(output)output.textContent=String(state.cleanups)}
function Row({id,onRun}:{id:number,onRun?:()=>void}){
 ${hook}(()=>{mark(id);onRun?.();return cleanup},[]);
 return <span data-sibling={id}>Row {id}</span>;
}
function Updating(){const [value,setValue]=useState(0);useLayoutEffect(()=>{mark();setValue(x=>x+1);return cleanup},[value]);return <span data-value={value}>Updating</span>}
export default function Page(){
 const [value,setValue]=useState(0);
 ${scene === 'insertion-siblings' ? `useLayoutEffect(()=>{document.getElementById('executions')!.textContent=String((globalThis as any).__effectProof?.seen.size??0)},[]);` : ''}
 ${scene === 'other-root' ? `useEffect(()=>{const host=document.createElement('aside');document.body.append(host);const root=createRoot(host);root.render(<Updating/>);return()=>{root.unmount();host.remove()}},[]);` : ''}
 return <main><output id="executions">0</output><output id="cleanups">0</output>${siblings ? `${scene === 'strict-siblings' ? '<StrictMode>' : ''}{Array.from({length:40},(_,id)=><Row key={id} id={id}/>)}${scene === 'strict-siblings' ? '</StrictMode>' : ''}` : scene === 'update' ? '<Updating/>' : scene === 'remount' ? '<Row key={value} id={value} onRun={()=>setValue(x=>x+1)}/>' : scene === 'growth' ? '{Array.from({length:value+1},(_,id)=><Row key={id} id={id} onRun={()=>setValue(x=>x+1)}/>)}' : '<span>Other root</span>'}</main>
}`;
  await writeFile(path.join(root, 'Page.tsx'), source);
  return source;
}
