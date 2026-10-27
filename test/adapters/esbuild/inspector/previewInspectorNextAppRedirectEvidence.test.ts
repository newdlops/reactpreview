/** Ensures only unconditional imported Next redirects can add lazy filesystem route candidates. */
import { describe, expect, it } from 'vitest';
import { readPreviewInspectorNextAppRedirectDestination as read } from '../../../../src/adapters/esbuild/inspector/previewInspectorNextAppRedirectEvidence';

describe('Next App static redirect evidence', () => {
  it.each([
    "import {redirect} from 'next/navigation'; export default function Index(){ redirect('/mypage/profile'); }",
    "import {permanentRedirect as move} from 'next/navigation'; export default async function Index(){ return move('/mypage/profile'); }",
    "import {redirect} from 'next/navigation'; const Index=()=>redirect(`/mypage/profile`); export default Index;",
  ])('reads a literal destination without evaluating the page', (source) => {
    expect(read('/app/page.tsx', source)).toBe('/mypage/profile');
  });

  it.each([
    "import {redirect} from 'next/navigation'; export default function Index(){ if(authorized) redirect('/profile'); }",
    "import {redirect} from 'next/navigation'; export default function Index(){ const user=readUser(); redirect('/profile'); }",
    "import {redirect} from 'next/navigation'; export default function Index({redirect}){ redirect('/profile'); }",
    "import {redirect} from 'next/navigation'; export default function Index(){ redirect('/profile'); function redirect(){} }",
    "import {redirect} from 'next/navigation'; export default function Index(){ redirect('/profile'); const redirect=()=>{}; }",
    "import {redirect} from 'next/navigation'; export default function Index(){ redirect('/profile'); var {redirect}=local; }",
    "import {redirect} from 'next/navigation'; export default function Index(){ redirect('/profile');",
    "import {redirect} from 'next/navigation'; export default function Index(){ redirect(destination); }",
    "import {redirect} from './navigation'; export default function Index(){ redirect('/profile'); }",
    "import type {redirect} from 'next/navigation'; export default function Index(){ redirect('/profile'); }",
    "import {redirect} from 'next/navigation'; export default function Index(){ redirect('https://example.com'); }",
    "import {redirect} from 'next/navigation'; export default function Index(){ redirect('//example.com'); }",
    "import {redirect} from 'next/navigation'; export default function Index(){ redirect('/profile?tab=1'); }",
    "import {redirect} from 'next/navigation'; export default function Index(){ redirect('/profile#name'); }",
    "import {redirect} from 'next/navigation'; export default function* Index(){ redirect('/profile'); }",
  ])('leaves conditional, shadowed or nonlocal navigation to the runtime', (source) => {
    expect(read('/app/page.tsx', source)).toBeUndefined();
  });
});
