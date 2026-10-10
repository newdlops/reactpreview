/**
 * Next.js archetypes for neural pre-training, kept in their own project so App Router and Pages
 * Router detection is not mixed with the single-page-app archetypes: an async server page with a
 * `notFound()` gate, a client page driven by search parameters, a server page reading settings,
 * and Pages Router pages whose props come from `getServerSideProps` and `getStaticProps`.
 */

/** Page files relative to the Next archetype project root. */
export const PREVIEW_NEURAL_NEXT_ARCHETYPE_PAGES = [
  'app/posts/[slug]/page.tsx',
  'app/dashboard/page.tsx',
  'app/settings/page.tsx',
  'pages/users/[id].tsx',
  'pages/orders/index.tsx',
] as const;

/** Files of the Next archetype project. */
export const PREVIEW_NEURAL_NEXT_ARCHETYPE_FILES: Readonly<Record<string, string>> = {
  'package.json': `${JSON.stringify(
    {
      dependencies: { next: '^15.0.0', react: '^19.0.0', 'react-dom': '^19.0.0' },
      name: 'react-preview-neural-next-archetypes',
      private: true,
    },
    undefined,
    2,
  )}\n`,
  'tsconfig.json': `${JSON.stringify(
    {
      compilerOptions: {
        jsx: 'preserve',
        module: 'esnext',
        moduleResolution: 'bundler',
        strict: true,
      },
    },
    undefined,
    2,
  )}\n`,
  'next.config.mjs': 'export default {};\n',
  'lib/content.ts': `export interface Post { slug: string; title: string; body: string; author: { name: string } }
export interface Settings { displayName: string; notifications: { email: boolean; push: boolean } }

export async function getPost(slug: string): Promise<Post | null> {
  const response = await fetch(\`https://cms.example.com/posts/\${slug}\`, { next: { revalidate: 60 } });
  return response.ok ? ((await response.json()) as Post) : null;
}

export async function getSettings(): Promise<Settings> {
  const response = await fetch('https://api.example.com/settings', { cache: 'no-store' });
  return (await response.json()) as Settings;
}
`,
  'app/layout.tsx': `import type { ReactNode } from 'react';

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><header>Archetype app</header>{children}</body></html>;
}
`,
  'app/posts/[slug]/page.tsx': `import { notFound } from 'next/navigation';
import { getPost } from '../../../lib/content';

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();
  return <article><h1>{post.title}</h1><p>By {post.author.name}</p><p>{post.body}</p></article>;
}
`,
  'app/dashboard/page.tsx': `'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

interface Metric { label: string; value: number }

export default function DashboardPage() {
  const range = useSearchParams().get('range') ?? '7d';
  const [metrics, setMetrics] = useState<Metric[] | null>(null);
  useEffect(() => {
    void fetch(\`/api/metrics?range=\${range}\`).then(async (response) => setMetrics((await response.json()) as Metric[]));
  }, [range]);
  if (!metrics) return <p>Loading {range} metrics…</p>;
  return <dl>{metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl>;
}
`,
  'app/settings/page.tsx': `import { getSettings } from '../../lib/content';

export default async function SettingsPage() {
  const settings = await getSettings();
  return (
    <form>
      <h1>{settings.displayName}</h1>
      <label><input type="checkbox" defaultChecked={settings.notifications.email} /> Email</label>
      <label><input type="checkbox" defaultChecked={settings.notifications.push} /> Push</label>
    </form>
  );
}
`,
  'pages/_app.tsx': `import type { AppProps } from 'next/app';

export default function App({ Component, pageProps }: AppProps) {
  return <main><Component {...pageProps} /></main>;
}
`,
  'pages/users/[id].tsx': `import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';

interface UserProfile { id: string; name: string; company: { name: string }; roles: string[] }

export const getServerSideProps = (async ({ params }) => {
  const response = await fetch(\`https://api.example.com/users/\${String(params?.id)}\`);
  return { props: { user: (await response.json()) as UserProfile } };
}) satisfies GetServerSideProps<{ user: UserProfile }>;

export default function UserPage({ user }: InferGetServerSidePropsType<typeof getServerSideProps>) {
  return <section><h1>{user.name}</h1><p>{user.company.name}</p><ul>{user.roles.map((role) => <li key={role}>{role}</li>)}</ul></section>;
}
`,
  'pages/orders/index.tsx': `import type { GetStaticProps } from 'next';

interface Order { id: string; customer: string; total: number }

export const getStaticProps: GetStaticProps<{ orders: Order[] }> = async () => {
  const response = await fetch('https://api.example.com/orders');
  return { props: { orders: (await response.json()) as Order[] }, revalidate: 60 };
};

export default function OrdersPage({ orders }: { orders: Order[] }) {
  return <table><tbody>{orders.map((order) => <tr key={order.id}><td>{order.customer}</td><td>{order.total}</td></tr>)}</tbody></table>;
}
`,
};
