/**
 * Synthetic page archetypes for Page Inspector neural pre-training.
 *
 * Real projects mostly exercise page choice and unreached targets, so the model's data-collection,
 * render-state, local-UI, exception, and page-execution heads see few labels. Each archetype is a
 * small, ordinary page that needs exactly one of those recoveries to show its content: an empty
 * query list, a consumer table, a status scalar, a nullable record, a dialog behind local state,
 * a crash on missing nested settings, required page props, and a provider-only context.
 *
 * `previewNeuralPretrainingArchetypeCatalog.ts` adds the common gated, paginated, and
 * state-library pages, and `previewNeuralPretrainingNextArchetypes.ts` a separate Next.js project.
 * `writePreviewNeuralArchetypes` writes both outside every user project; install their
 * dependencies there before previewing the pages it returns.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PREVIEW_NEURAL_EXTENDED_DEPENDENCIES,
  PREVIEW_NEURAL_EXTENDED_FILES,
  PREVIEW_NEURAL_EXTENDED_ROUTES,
} from './previewNeuralPretrainingArchetypeCatalog';
import {
  PREVIEW_NEURAL_NEXT_ARCHETYPE_FILES,
  PREVIEW_NEURAL_NEXT_ARCHETYPE_PAGES,
} from './previewNeuralPretrainingNextArchetypes';
import type { PreviewNeuralPretrainingWorkspace } from './previewNeuralPretraining';

/** Base page files, one per archetype, relative to the single-page-app project root. */
const BASE_PAGES = [
  'src/pages/OrderListPage.tsx',
  'src/pages/OrderTablePage.tsx',
  'src/pages/SyncStatusPage.tsx',
  'src/pages/ProfilePage.tsx',
  'src/pages/InvoiceDialogPage.tsx',
  'src/pages/ThemeSettingsPage.tsx',
  'src/pages/InvoiceDetailPage.tsx',
  'src/pages/WorkspacePage.tsx',
] as const;

/** Every single-page-app archetype page. */
export const PREVIEW_NEURAL_ARCHETYPE_PAGES: readonly string[] = [
  ...BASE_PAGES,
  ...PREVIEW_NEURAL_EXTENDED_ROUTES.map(([, , file]) => file),
];

const FILES: Readonly<Record<string, string>> = {
  'package.json': `${JSON.stringify(
    {
      dependencies: {
        '@tanstack/react-query': '^5.59.0',
        react: '^18.3.1',
        'react-dom': '^18.3.1',
        'react-router-dom': '^6.28.0',
        ...PREVIEW_NEURAL_EXTENDED_DEPENDENCIES,
      },
      name: 'react-preview-neural-archetypes',
      private: true,
      type: 'module',
    },
    undefined,
    2,
  )}\n`,
  'tsconfig.json': `${JSON.stringify(
    { compilerOptions: { jsx: 'react-jsx', module: 'esnext', strict: true, target: 'es2022' } },
    undefined,
    2,
  )}\n`,
  'src/api.ts': `export interface Order { id: string; customer: string; total: number; status: 'paid' | 'open' }
export interface User { id: string; name: string; email: string; team: { name: string } }
export interface Settings { theme: { colors: { primary: string; surface: string } }; locale: string }

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(\`Request failed: \${response.status}\`);
  return (await response.json()) as T;
}
`,
  'src/hooks.ts': `import { useQuery } from '@tanstack/react-query';
import { fetchJson, type Order, type Settings, type User } from './api';

export function useOrders() {
  return useQuery({ queryKey: ['orders'], queryFn: () => fetchJson<{ items: Order[] }>('/api/orders') });
}

export function useCurrentUser() {
  return useQuery({ queryKey: ['me'], queryFn: () => fetchJson<User>('/api/me') }).data ?? null;
}

export function useSyncStatus(): 'idle' | 'syncing' | 'failed' | 'done' {
  const { data } = useQuery({ queryKey: ['sync'], queryFn: () => fetchJson<{ state: 'idle' | 'syncing' | 'failed' | 'done' }>('/api/sync') });
  return data?.state ?? 'idle';
}

export function useSettings(): Settings {
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => fetchJson<Settings>('/api/settings') });
  return data ?? ({} as Settings);
}
`,
  'src/workspace.tsx': `import { createContext, useContext, type ReactNode } from 'react';

export interface Workspace { id: string; name: string; plan: 'free' | 'team'; seats: number }
const WorkspaceContext = createContext<Workspace | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  return <WorkspaceContext.Provider value={{ id: 'w1', name: 'Acme', plan: 'team', seats: 12 }}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (workspace === undefined) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return workspace;
}
`,
  'src/components/OrderTable.tsx': `import type { Order } from '../api';

export function OrderTable({ rows }: { rows: Order[] }) {
  return (
    <table>
      <thead><tr><th>Customer</th><th>Total</th><th>Status</th></tr></thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}><td>{row.customer}</td><td>{row.total.toFixed(2)}</td><td>{row.status}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
`,
  'src/pages/OrderListPage.tsx': `import { useOrders } from '../hooks';

export default function OrderListPage() {
  const { data, isLoading } = useOrders();
  if (isLoading) return <p>Loading orders…</p>;
  const orders = data?.items ?? [];
  if (orders.length === 0) return <p>No orders yet.</p>;
  return (
    <ul>
      {orders.map((order) => (
        <li key={order.id}>{order.customer} · {order.total.toFixed(2)}</li>
      ))}
    </ul>
  );
}
`,
  'src/pages/OrderTablePage.tsx': `import { OrderTable } from '../components/OrderTable';
import { useOrders } from '../hooks';

export default function OrderTablePage() {
  const { data } = useOrders();
  return (
    <section>
      <h1>Orders</h1>
      <OrderTable rows={data?.items ?? []} />
    </section>
  );
}
`,
  'src/pages/SyncStatusPage.tsx': `import { useSyncStatus } from '../hooks';

export default function SyncStatusPage() {
  const status = useSyncStatus();
  if (status === 'idle') return <p>Waiting for the first sync.</p>;
  if (status === 'syncing') return <p>Syncing…</p>;
  if (status === 'failed') return <p role="alert">Sync failed.</p>;
  return (
    <section>
      <h1>Sync complete</h1>
      <p>All 3 sources are up to date.</p>
    </section>
  );
}
`,
  'src/pages/ProfilePage.tsx': `import { useCurrentUser } from '../hooks';

export default function ProfilePage() {
  const user = useCurrentUser();
  if (!user) return null;
  return (
    <article>
      <h1>{user.name}</h1>
      <p>{user.email}</p>
      <p>Team: {user.team.name}</p>
    </article>
  );
}
`,
  'src/pages/InvoiceDialogPage.tsx': `import { useState } from 'react';

export default function InvoiceDialogPage() {
  const [open, setOpen] = useState(false);
  return (
    <main>
      <button type="button" onClick={() => setOpen(true)}>Show invoice</button>
      {open && (
        <div role="dialog" aria-label="Invoice">
          <h2>Invoice INV-001</h2>
          <p>Amount due: 120.00</p>
          <button type="button" onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </main>
  );
}
`,
  'src/pages/ThemeSettingsPage.tsx': `import { useSettings } from '../hooks';

export default function ThemeSettingsPage() {
  const settings = useSettings();
  return (
    <section style={{ background: settings.theme.colors.surface }}>
      <h1 style={{ color: settings.theme.colors.primary }}>Theme</h1>
      <p>Locale: {settings.locale}</p>
    </section>
  );
}
`,
  'src/pages/InvoiceDetailPage.tsx': `interface Invoice { number: string; customer: { name: string }; lines: { label: string; amount: number }[] }

export default function InvoiceDetailPage({ invoice }: { invoice: Invoice }) {
  return (
    <article>
      <h1>Invoice {invoice.number}</h1>
      <p>{invoice.customer.name}</p>
      <ul>{invoice.lines.map((line) => <li key={line.label}>{line.label}: {line.amount}</li>)}</ul>
    </article>
  );
}
`,
  'src/pages/WorkspacePage.tsx': `import { useWorkspace } from '../workspace';

export default function WorkspacePage() {
  const workspace = useWorkspace();
  return (
    <section>
      <h1>{workspace.name}</h1>
      <p>{workspace.plan === 'team' ? \`\${workspace.seats} seats\` : 'Free plan'}</p>
    </section>
  );
}
`,
  'src/App.tsx': `import { Route, Routes } from 'react-router-dom';
${PREVIEW_NEURAL_EXTENDED_ROUTES.map(([, name]) => `import ${name} from './pages/${name}';`).join('\n')}
import { FlagsProvider, SessionProvider } from './session';
import InvoiceDetailPage from './pages/InvoiceDetailPage';
import InvoiceDialogPage from './pages/InvoiceDialogPage';
import OrderListPage from './pages/OrderListPage';
import OrderTablePage from './pages/OrderTablePage';
import ProfilePage from './pages/ProfilePage';
import SyncStatusPage from './pages/SyncStatusPage';
import ThemeSettingsPage from './pages/ThemeSettingsPage';
import WorkspacePage from './pages/WorkspacePage';
import { WorkspaceProvider } from './workspace';

export default function App() {
  return (
    <SessionProvider>
    <FlagsProvider>
    <WorkspaceProvider>
      <Routes>
${PREVIEW_NEURAL_EXTENDED_ROUTES.map(([route, name]) => `        <Route path="${route}" element={<${name}${name === 'InboxPage' ? ' messages={[]}' : ''} />} />`).join('\n')}
        <Route path="/orders" element={<OrderListPage />} />
        <Route path="/orders/table" element={<OrderTablePage />} />
        <Route path="/sync" element={<SyncStatusPage />} />
        <Route path="/me" element={<ProfilePage />} />
        <Route path="/invoices/dialog" element={<InvoiceDialogPage />} />
        <Route path="/invoices/:id" element={<InvoiceDetailPage invoice={{ number: '', customer: { name: '' }, lines: [] }} />} />
        <Route path="/settings/theme" element={<ThemeSettingsPage />} />
        <Route path="/workspace" element={<WorkspacePage />} />
      </Routes>
    </WorkspaceProvider>
    </FlagsProvider>
    </SessionProvider>
  );
}
`,
  'src/main.tsx': `import { ApolloProvider } from '@apollo/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { apolloClient } from './apollo';
import { store } from './store/cart';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <ApolloProvider client={apolloClient}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </ApolloProvider>
    </Provider>
  </StrictMode>,
);
`,
  'index.html': `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>Archetypes</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
`,
};

/**
 * Writes the single-page-app project to `<root>/spa` and the Next.js project to `<root>/next`.
 *
 * @param root Directory outside every user project; created when missing.
 * @returns One pre-training workspace per written project.
 */
export async function writePreviewNeuralArchetypes(
  root: string,
): Promise<readonly PreviewNeuralPretrainingWorkspace[]> {
  const projects = [
    {
      files: { ...FILES, ...PREVIEW_NEURAL_EXTENDED_FILES },
      name: 'archetypes-spa',
      pages: PREVIEW_NEURAL_ARCHETYPE_PAGES,
      root: path.join(root, 'spa'),
    },
    {
      files: PREVIEW_NEURAL_NEXT_ARCHETYPE_FILES,
      name: 'archetypes-next',
      pages: [...PREVIEW_NEURAL_NEXT_ARCHETYPE_PAGES],
      root: path.join(root, 'next'),
    },
  ];
  for (const project of projects) {
    for (const [relativePath, contents] of Object.entries(project.files)) {
      const filePath = path.join(project.root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, contents, 'utf8');
    }
  }
  return projects.map(({ name, pages, root: projectRoot }) => ({ name, pages, root: projectRoot }));
}
