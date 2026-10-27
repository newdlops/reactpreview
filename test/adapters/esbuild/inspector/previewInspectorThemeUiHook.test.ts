/** Theme controls remain authentic while arbitrary event work stays outside the frozen frontier. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { hasPreviewInspectorThemeUiHookInSourceFile } from '../../../../src/adapters/esbuild/inspector/previewInspectorThemeUiHook';

const source = `"use client";
import {useTheme} from 'next-themes';
import {flushSync} from 'react-dom';
type Theme = 'light' | 'dark';
export function useThemeSwitch() {
 const {resolvedTheme,setTheme}=useTheme();
 const isDark=resolvedTheme==='dark';
 const flip=()=>{
  const next:Theme=document.documentElement.classList.contains('dark')?'light':'dark';
  setTheme(next);
 };
 const toggle=()=>{
  const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduceMotion || typeof document.startViewTransition!=='function') {flip();return;}
  const transition=document.startViewTransition(()=>flushSync(flip));
  transition.ready.catch(()=>{});
 };
 return {isDark,toggle};
}`;

/** Uses inert source syntax, matching admission's already parsed module. */
function admits(text: string, names = ['useThemeSwitch']): boolean {
  return hasPreviewInspectorThemeUiHookInSourceFile(
    ts.createSourceFile(
      '/workspace/theme.ts',
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    ),
    names,
  );
}

describe('theme UI hook admission', () => {
  it('retains real provider state, motion preference and synchronous transition callbacks', () => {
    expect(admits(source)).toBe(true);
    expect(
      admits(
        source
          .replace('useTheme}', 'useTheme as readTheme}')
          .replace('=useTheme()', '=readTheme()'),
      ),
    ).toBe(true);
    expect(admits(source, [])).toBe(false);
    expect(admits(source, ['useUnknown'])).toBe(false);
  });

  it.each([
    [
      'runtime import',
      source.replace('import {flushSync}', "import {save} from './api'; import {flushSync}"),
    ],
    ['module initialization', source + "\nfetch('/bootstrap');"],
    ['render IO', source.replace('const isDark=', "fetch('/theme');const isDark=")],
    ['event IO', source.replace('setTheme(next);', "fetch('/save');setTheme(next);")],
    [
      'hidden callback IO',
      source.replace('()=>flushSync(flip)', "()=>{fetch('/save');flushSync(flip);}"),
    ],
    ['promise callback IO', source.replace('catch(()=>{})', "catch(()=>{fetch('/save')})")],
    ['unknown store', source.replace("resolvedTheme==='dark'", "store.theme==='dark'")],
    ['global mutation', source.replace('setTheme(next);', 'window.value=next;setTheme(next);')],
    [
      'computed call',
      source.replace('setTheme(next);', "window['fetch']('/save');setTheme(next);"),
    ],
    [
      'computed property',
      source.replace('return {isDark,toggle}', "return {[fetch('/key')]:isDark,toggle}"),
    ],
    ['browser shadow', source.replace('const flip=()=>{', 'const flip=(document)=>{')],
    [
      'import shadow',
      source.replace('const flip=()=>{', 'const flip=()=>{const useTheme=()=>null;'),
    ],
    ['async action', source.replace('const toggle=()=>', 'const toggle=async ()=>')],
    ['async hook', source.replace('export function', 'export async function')],
    [
      'data construction',
      source.replace(
        'const isDark=',
        'const socket=new WebSocket("wss://example.invalid");const isDark=',
      ),
    ],
    ['state without action', source.replace('return {isDark,toggle}', 'return {isDark}')],
  ])('rejects %s', (_label, input) => {
    expect(admits(input)).toBe(false);
  });
});
