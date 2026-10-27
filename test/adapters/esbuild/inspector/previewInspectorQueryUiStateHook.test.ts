/** Keeps URL-backed visual state while excluding data hooks and navigation/effect escapes. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { hasPreviewInspectorQueryUiStateHookInSourceFile } from '../../../../src/adapters/esbuild/inspector/previewInspectorQueryUiStateHook';

const source = `import {useEffect,useState} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import type {TabProps} from './types';
export const useQueryTab = <T extends string>(defaultKey:T, queryName?:string) => {
 const navigate=useNavigate(), location=useLocation();
 const searchParams=new URLSearchParams(location.search);
 const queryString=queryName||'tab';
 const [key,setKey]=useState<T>((searchParams.get(queryString) as T)||defaultKey);
 useEffect(()=>{
   const searchParams=new URLSearchParams(location.search);
   const fromUrl=searchParams.get(queryString) as T;
   if(fromUrl)setKey(fromUrl);
 },[location.search,queryString]);
 const selectKey=(key:T)=>{
   setKey(key); searchParams.set(queryString,key);
   navigate({pathname:location.pathname,search:\`?\${searchParams.toString()}\`},{replace:true});
 };
 return [{activeKey:key,selectKey,onSelect:(key:T)=>{if(key)selectKey(key);}}];
};`;

/** Parses the same inert TypeScript source shape used by frontier admission. */
function admits(text: string, names = ['useQueryTab']): boolean {
  return hasPreviewInspectorQueryUiStateHookInSourceFile(
    ts.createSourceFile('/workspace/hook.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
    names,
  );
}

describe('query UI hook admission', () => {
  it('retains a query/local-state controller including its read-only synchronization effect', () => {
    expect(admits(source)).toBe(true);
    expect(
      admits(
        source
          .replace('useLocation,useNavigate', 'useLocation as readLocation,useNavigate')
          .replace('location=useLocation()', 'location=readLocation()'),
      ),
    ).toBe(true);
    expect(admits(source, [])).toBe(false);
    expect(admits(source, ['useUnknown'])).toBe(false);
  });

  it.each([
    [
      'data import',
      source.replace(
        'import type {TabProps}',
        "import {load} from './api'; import type {TabProps}",
      ),
    ],
    ['module initialization', source + "\nfetch('/bootstrap');"],
    [
      'effect request',
      source.replace('if(fromUrl)setKey(fromUrl)', "fetch('/data'); if(fromUrl)setKey(fromUrl)"),
    ],
    [
      'effect navigation',
      source.replace(
        'if(fromUrl)setKey(fromUrl)',
        'navigate({pathname:location.pathname,search:"?tab=x"},{replace:true}); if(fromUrl)setKey(fromUrl)',
      ),
    ],
    [
      'effect query mutation',
      source.replace(
        'if(fromUrl)setKey(fromUrl)',
        'searchParams.set(queryString,"x"); if(fromUrl)setKey(fromUrl)',
      ),
    ],
    [
      'different pathname',
      source.replace('pathname:location.pathname', 'pathname:"/another-page"'),
    ],
    [
      'external navigation',
      source.replace(
        'navigate({pathname:location.pathname,search:',
        'navigate({pathname:"https://example.invalid",search:',
      ),
    ],
    ['hidden event request', source.replace('setKey(key);', "fetch('/save'); setKey(key);")],
    ['unknown helper', source.replace('searchParams.get(queryString) as T', 'readSession() as T')],
    ['setter shadow', source.replace('const selectKey=(key:T)', 'const selectKey=(setKey:T)')],
    [
      'Router shadow',
      source.replace('(defaultKey:T, queryName?:string)', '(defaultKey:T, useNavigate?:string)'),
    ],
    [
      'query constructor shadow',
      source.replace(
        '(defaultKey:T, queryName?:string)',
        '(defaultKey:T, URLSearchParams?:string)',
      ),
    ],
    ['async callback', source.replace('const selectKey=(key:T)', 'const selectKey=async (key:T)')],
    ['global mutation', source.replace('setKey(key);', 'globalThis.value=key; setKey(key);')],
    [
      'state without returned action',
      source.replace(
        'return [{activeKey:key,selectKey,onSelect:(key:T)=>{if(key)selectKey(key);}}]',
        'return [{activeKey:key}]',
      ),
    ],
    [
      'store read',
      source.replace("const queryString=queryName||'tab'", 'const queryString=store.tab'),
    ],
  ])('rejects %s', (_label, input) => {
    expect(admits(input)).toBe(false);
  });
});
