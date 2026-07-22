/** Verifies bounded async server-component adaptation before code reaches the client renderer. */
import { describe, expect, it } from 'vitest';
import {
  isolatePreviewAsyncReactComponents,
  PREVIEW_ASYNC_COMPONENT_ATTRIBUTE,
} from '../../../../src/adapters/esbuild/staticResources/previewAsyncReactComponentIsolation';

describe('isolatePreviewAsyncReactComponents', () => {
  /** Keeps route output authored while adapting a locally rendered nested async component. */
  it('returns resolved authored JSX through one stable Suspense record', () => {
    const source = [
      'export default async function Dashboard({ id }: { id: string }) {',
      '  await fetch(`/api/dashboard/${id}`);',
      '  return <main>ASYNC_DASHBOARD_BODY</main>;',
      '}',
      'export async function StarsCount() {',
      '  const count = await Promise.resolve(42);',
      '  return <span className="count">{count}</span>;',
      '}',
      'export function Header() {',
      '  return <header><StarsCount /></header>;',
      '}',
    ].join('\n');

    const transformed = isolatePreviewAsyncReactComponents('/workspace/app/page.tsx', source);

    expect(transformed).toContain('export default async function Dashboard');
    expect(transformed).toContain('ASYNC_DASHBOARD_BODY');
    expect(transformed).not.toContain('async function StarsCount');
    expect(transformed).toContain('const count = await Promise.resolve(42)');
    expect(transformed).toContain('className="count"');
    expect(transformed).toContain(`${PREVIEW_ASYNC_COMPONENT_ATTRIBUTE}="StarsCount"`);
    expect(transformed).toContain('Promise.resolve().then(load)');
    expect(transformed).toContain("if(record.status==='pending')throw record.promise");
    expect(transformed).toContain('new Map()');
  });

  /** Supports direct async arrows while preserving their authored return body and public binding. */
  it('adapts a locally rendered async arrow without replacing its JSX', () => {
    const source = [
      'export const AsyncCard = async ({ label }) => {',
      '  const value = await Promise.resolve(label);',
      '  return <section>{value}</section>;',
      '};',
      'export function Grid() { return <AsyncCard label="A" />; }',
    ].join('\n');

    const transformed = isolatePreviewAsyncReactComponents('/workspace/src/Cards.tsx', source);

    expect(transformed).toContain('export const AsyncCard =       ({ label }) =>');
    expect(transformed).toContain('const value = await Promise.resolve(label)');
    expect(transformed).toContain('return <section>{value}</section>');
    expect(transformed).toContain(`${PREVIEW_ASYNC_COMPONENT_ATTRIBUTE}="AsyncCard"`);
  });

  /** Requires exact local render evidence and rejects non-component async control flow. */
  it('leaves roots, helpers, handlers, generators, and nested callback JSX unchanged', () => {
    const source = [
      'async function loadMarkup() { return <small>helper</small>; }',
      'export async function ExportedOnly() { return <article>external</article>; }',
      'async function DataLoader() { return { ok: true }; }',
      'async function CallbackOwner() {',
      '  const render = () => <i>nested</i>;',
      '  return render;',
      '}',
      'async function* StreamCard() { yield <b>stream</b>; }',
      'export function Button() { return <button onClick={CallbackOwner}>Run</button>; }',
    ].join('\n');

    expect(isolatePreviewAsyncReactComponents('/workspace/src/helpers.tsx', source)).toBe(source);
  });

  /** Protects explicit client modules and every common default-export identity form. */
  it('fails closed for client modules and aliased page roots', () => {
    const clientSource = [
      '"use client";',
      'async function Panel(){ return <div />; }',
      'function Owner(){ return <Panel />; }',
    ].join('\n');
    const defaultSource = [
      'async function Page(){ return <main />; }',
      'function Owner(){ return <Page />; }',
      'export { Page as default };',
    ].join('\n');

    expect(isolatePreviewAsyncReactComponents('/workspace/Client.tsx', clientSource)).toBe(
      clientSource,
    );
    expect(isolatePreviewAsyncReactComponents('/workspace/page.tsx', defaultSource)).toBe(
      defaultSource,
    );
  });

  /** Caps admitted render-use candidates so generated runtime state stays bounded. */
  it('bounds adaptation count per module', () => {
    const declarations = Array.from(
      { length: 35 },
      (_, index) =>
        `export async function Card${String(index)}(){ return <div>${String(index)}</div>; }`,
    );
    const usages = Array.from({ length: 35 }, (_, index) => `<Card${String(index)} />`).join('');
    const source = [...declarations, `export function Grid(){return <>${usages}</>;}`].join('\n');

    const transformed = isolatePreviewAsyncReactComponents('/workspace/src/Cards.tsx', source);
    const markerCount = transformed.split(PREVIEW_ASYNC_COMPONENT_ATTRIBUTE).length - 1;

    expect(markerCount).toBe(32);
    expect(transformed).not.toContain('async function Card31()');
    expect(transformed).toContain('async function Card32()');
    expect(transformed).toContain('async function Card34()');
  });

  /** Fails closed for non-source files and incomplete dirty-editor syntax. */
  it('preserves unsupported paths and parse-invalid snapshots', () => {
    const valid = 'async function Card(){return <div />;} function App(){return <Card />;}';
    const invalid = 'async function Card(){return <div> } function App(){return <Card/>;}';

    expect(isolatePreviewAsyncReactComponents('/workspace/Card.md', valid)).toBe(valid);
    expect(isolatePreviewAsyncReactComponents('/workspace/Card.tsx', invalid)).toBe(invalid);
  });
});
