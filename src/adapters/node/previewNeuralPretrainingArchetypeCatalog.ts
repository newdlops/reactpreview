/**
 * Further single-page-app archetypes for neural pre-training: the common page shapes that gate,
 * paginate, or derive their content in ways the Page Inspector must recover.
 *
 * Each page is ordinary application code: authentication and permission gates, feature flags,
 * tabs, a wizard, a form, lazy routes, several exports, pagination, an infinite feed, dates,
 * session storage, search parameters, a context without a provider, SWR, chart data, nested
 * guards, a role switch, Apollo, Redux, Zustand, and an empty state. They share the base project's
 * React Router and TanStack Query setup and add their own state libraries.
 */

/** Extra dependencies of the extended pages. */
export const PREVIEW_NEURAL_EXTENDED_DEPENDENCIES: Readonly<Record<string, string>> = {
  '@apollo/client': '^3.11.0',
  '@reduxjs/toolkit': '^2.3.0',
  graphql: '^16.9.0',
  'react-hook-form': '^7.53.0',
  'react-redux': '^9.1.2',
  swr: '^2.2.5',
  zustand: '^5.0.0',
};

/** Routes of the extended pages as `[path, component, file]`. */
export const PREVIEW_NEURAL_EXTENDED_ROUTES: readonly (readonly [string, string, string])[] = [
  ['/dashboard', 'AuthGatePage', 'src/pages/AuthGatePage.tsx'],
  ['/billing/permissions', 'PermissionGatePage', 'src/pages/PermissionGatePage.tsx'],
  ['/billing', 'FeatureFlagPage', 'src/pages/FeatureFlagPage.tsx'],
  ['/team', 'TeamTabsPage', 'src/pages/TeamTabsPage.tsx'],
  ['/onboarding', 'OnboardingWizardPage', 'src/pages/OnboardingWizardPage.tsx'],
  ['/signup', 'SignupFormPage', 'src/pages/SignupFormPage.tsx'],
  ['/reports', 'LazyReportsPage', 'src/pages/LazyReportsPage.tsx'],
  ['/customers', 'CustomersPage', 'src/pages/CustomersPage.tsx'],
  ['/payments', 'PaymentsTablePage', 'src/pages/PaymentsTablePage.tsx'],
  ['/feed', 'ActivityFeedPage', 'src/pages/ActivityFeedPage.tsx'],
  ['/events', 'EventSchedulePage', 'src/pages/EventSchedulePage.tsx'],
  ['/session', 'SessionPage', 'src/pages/SessionPage.tsx'],
  ['/search', 'SearchResultsPage', 'src/pages/SearchResultsPage.tsx'],
  ['/brand', 'BrandThemePage', 'src/pages/BrandThemePage.tsx'],
  ['/account', 'AccountSwrPage', 'src/pages/AccountSwrPage.tsx'],
  ['/metrics', 'MetricsChartPage', 'src/pages/MetricsChartPage.tsx'],
  ['/subscription', 'SubscriptionPage', 'src/pages/SubscriptionPage.tsx'],
  ['/home', 'RoleHomePage', 'src/pages/RoleHomePage.tsx'],
  ['/projects', 'ProjectsApolloPage', 'src/pages/ProjectsApolloPage.tsx'],
  ['/cart', 'CartPage', 'src/pages/CartPage.tsx'],
  ['/preferences', 'PreferencesPage', 'src/pages/PreferencesPage.tsx'],
  ['/inbox', 'InboxPage', 'src/pages/InboxPage.tsx'],
];

/** Shared modules and pages of the extended archetypes. */
export const PREVIEW_NEURAL_EXTENDED_FILES: Readonly<Record<string, string>> = {
  'src/session.tsx': `import { createContext, useContext, type ReactNode } from 'react';

export interface Member { id: string; name: string; role: 'admin' | 'member' | 'guest'; permissions: string[] }
export interface Flags { newBilling: boolean; betaReports: boolean }

const SessionContext = createContext<{ user: Member | null }>({ user: null });
const FlagsContext = createContext<Flags>({ newBilling: false, betaReports: false });

export function SessionProvider({ children }: { children: ReactNode }) {
  return <SessionContext.Provider value={{ user: null }}>{children}</SessionContext.Provider>;
}

export function FlagsProvider({ children }: { children: ReactNode }) {
  return <FlagsContext.Provider value={{ newBilling: false, betaReports: false }}>{children}</FlagsContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
export const useFlags = () => useContext(FlagsContext);
`,
  'src/theme.tsx': `import { createContext } from 'react';

export interface BrandTheme { primary: string; accent: string; radius: number }
export const BrandThemeContext = createContext<BrandTheme | undefined>(undefined);
`,
  'src/store/cart.ts': `import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface CartItem { sku: string; title: string; quantity: number; price: number }
const cart = createSlice({
  name: 'cart',
  initialState: { items: [] as CartItem[] },
  reducers: { add: (state, action: PayloadAction<CartItem>) => { state.items.push(action.payload); } },
});
export const store = configureStore({ reducer: { cart: cart.reducer } });
export type RootState = ReturnType<typeof store.getState>;
`,
  'src/store/preferences.ts': `import { create } from 'zustand';

export interface Preferences { language: string; digest: 'daily' | 'weekly'; channels: string[] }
export const usePreferencesStore = create<{ preferences: Preferences | null }>(() => ({ preferences: null }));
`,
  'src/apollo.ts': `import { ApolloClient, gql, InMemoryCache } from '@apollo/client';

export const apolloClient = new ApolloClient({ cache: new InMemoryCache(), uri: '/graphql' });
export const PROJECTS_QUERY = gql\`
  query Projects {
    viewer { id projects { edges { node { id name status openIssues } } } }
  }
\`;
`,
  'src/components/Reports.tsx': `export default function Reports({ rows }: { rows: { name: string; total: number }[] }) {
  return <ul>{rows.map((row) => <li key={row.name}>{row.name}: {row.total}</li>)}</ul>;
}
`,
  'src/pages/AuthGatePage.tsx': `import { Navigate } from 'react-router-dom';
import { useSession } from '../session';

export default function AuthGatePage() {
  const { user } = useSession();
  if (!user) return <Navigate to="/login" replace />;
  return <section><h1>Welcome back, {user.name}</h1><p>You have 3 pending approvals.</p></section>;
}
`,
  'src/pages/PermissionGatePage.tsx': `import { useSession } from '../session';

export default function PermissionGatePage() {
  const { user } = useSession();
  if (!user?.permissions.includes('billing:read')) return <p role="alert">You do not have access to billing.</p>;
  return <section><h1>Billing</h1><p>Next invoice on the 1st.</p></section>;
}
`,
  'src/pages/FeatureFlagPage.tsx': `import { useFlags } from '../session';

function LegacyBilling() { return <p>Legacy billing</p>; }
function NewBilling() { return <section><h1>Billing 2.0</h1><p>Usage-based plans</p></section>; }

export default function FeatureFlagPage() {
  const flags = useFlags();
  return flags.newBilling ? <NewBilling /> : <LegacyBilling />;
}
`,
  'src/pages/TeamTabsPage.tsx': `import { useState } from 'react';

const MEMBERS = [{ id: 'm1', name: 'Kim' }, { id: 'm2', name: 'Lee' }];

export default function TeamTabsPage() {
  const [tab, setTab] = useState<'overview' | 'members' | 'billing'>('overview');
  return (
    <main>
      <nav>{(['overview', 'members', 'billing'] as const).map((name) => <button key={name} type="button" onClick={() => setTab(name)}>{name}</button>)}</nav>
      {tab === 'overview' && <p>Team overview</p>}
      {tab === 'members' && <ul>{MEMBERS.map((member) => <li key={member.id}>{member.name}</li>)}</ul>}
      {tab === 'billing' && <p>Billing details</p>}
    </main>
  );
}
`,
  'src/pages/OnboardingWizardPage.tsx': `import { useState } from 'react';

const STEPS = ['Company', 'Members', 'Plan'];

export default function OnboardingWizardPage() {
  const [step, setStep] = useState(0);
  if (step < STEPS.length) {
    return <section><h2>Step {step + 1}: {STEPS[step]}</h2><button type="button" onClick={() => setStep(step + 1)}>Next</button></section>;
  }
  return <section><h1>All set</h1><p>Your workspace is ready.</p></section>;
}
`,
  'src/pages/SignupFormPage.tsx': `import { useForm } from 'react-hook-form';

interface SignupValues { email: string; company: string; seats: number }

export default function SignupFormPage() {
  const { register, handleSubmit, formState } = useForm<SignupValues>();
  return (
    <form onSubmit={handleSubmit(() => undefined)}>
      <input {...register('email', { required: 'Email is required' })} placeholder="Email" />
      {formState.errors.email && <p role="alert">{formState.errors.email.message}</p>}
      <input {...register('company')} placeholder="Company" />
      <input type="number" {...register('seats', { min: 1 })} />
      <button type="submit">Create account</button>
    </form>
  );
}
`,
  'src/pages/LazyReportsPage.tsx': `import { lazy, Suspense } from 'react';

const Reports = lazy(() => import('../components/Reports'));

export default function LazyReportsPage() {
  return (
    <Suspense fallback={<p>Loading reports…</p>}>
      <Reports rows={[{ name: 'Q1', total: 120 }, { name: 'Q2', total: 180 }]} />
    </Suspense>
  );
}
`,
  'src/pages/CustomersPage.tsx': `export function PageHeader({ title }: { title: string }) {
  return <header><h1>{title}</h1></header>;
}

export function CustomerRow({ name, plan }: { name: string; plan: string }) {
  return <li>{name} · {plan}</li>;
}

export default function CustomersPage() {
  return (
    <main>
      <PageHeader title="Customers" />
      <ul><CustomerRow name="Acme" plan="team" /><CustomerRow name="Globex" plan="free" /></ul>
    </main>
  );
}
`,
  'src/pages/PaymentsTablePage.tsx': `import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchJson } from '../api';

interface Payment { id: string; payer: string; amount: number }

export default function PaymentsTablePage() {
  const [page, setPage] = useState(0);
  const { data } = useQuery({ queryKey: ['payments'], queryFn: () => fetchJson<{ rows: Payment[]; total: number }>('/api/payments') });
  const rows = (data?.rows ?? []).slice(page * 10, page * 10 + 10);
  return (
    <section>
      <table><tbody>{rows.map((row) => <tr key={row.id}><td>{row.payer}</td><td>{row.amount}</td></tr>)}</tbody></table>
      <button type="button" disabled={(page + 1) * 10 >= (data?.total ?? 0)} onClick={() => setPage(page + 1)}>Next</button>
    </section>
  );
}
`,
  'src/pages/ActivityFeedPage.tsx': `import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchJson } from '../api';

interface Activity { id: string; actor: string; verb: string }

export default function ActivityFeedPage() {
  const { data, fetchNextPage, hasNextPage } = useInfiniteQuery({
    queryKey: ['feed'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchJson<{ items: Activity[]; next?: number }>(\`/api/feed?cursor=\${pageParam}\`),
    getNextPageParam: (last) => last.next,
  });
  const items = data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section>
      <ul>{items.map((item) => <li key={item.id}>{item.actor} {item.verb}</li>)}</ul>
      {hasNextPage && <button type="button" onClick={() => void fetchNextPage()}>Load more</button>}
    </section>
  );
}
`,
  'src/pages/EventSchedulePage.tsx': `import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../api';

interface CalendarEvent { id: string; title: string; startsAt: string }
const formatter = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });

export default function EventSchedulePage() {
  const { data } = useQuery({ queryKey: ['events'], queryFn: () => fetchJson<CalendarEvent[]>('/api/events') });
  return <ol>{(data ?? []).map((event) => <li key={event.id}>{event.title} — {formatter.format(new Date(event.startsAt))}</li>)}</ol>;
}
`,
  'src/pages/SessionPage.tsx': `interface StoredSession { user: { name: string; email: string }; expiresAt: string }

export default function SessionPage() {
  const session = JSON.parse(localStorage.getItem('session') ?? 'null') as StoredSession;
  return <section><h1>{session.user.name}</h1><p>{session.user.email}</p><p>Expires {session.expiresAt}</p></section>;
}
`,
  'src/pages/SearchResultsPage.tsx': `import { useSearchParams } from 'react-router-dom';

const RESULTS = ['Annual report', 'Board minutes', 'Cap table'];

export default function SearchResultsPage() {
  const [params] = useSearchParams();
  const query = params.get('q');
  if (!query) return <p>Type something to search.</p>;
  const matches = RESULTS.filter((result) => result.toLowerCase().includes(query.toLowerCase()));
  return <section><h1>Results for “{query}”</h1><ul>{matches.map((match) => <li key={match}>{match}</li>)}</ul></section>;
}
`,
  'src/pages/BrandThemePage.tsx': `import { useContext } from 'react';
import { BrandThemeContext } from '../theme';

export default function BrandThemePage() {
  const theme = useContext(BrandThemeContext)!;
  return <section style={{ borderRadius: theme.radius, color: theme.primary }}><h1>Brand</h1><p style={{ color: theme.accent }}>Accent sample</p></section>;
}
`,
  'src/pages/AccountSwrPage.tsx': `import useSWR from 'swr';
import { fetchJson, type User } from '../api';

export default function AccountSwrPage() {
  const { data } = useSWR<User>('/api/account', fetchJson);
  return <section><h1>{data!.name}</h1><p>{data!.email}</p><p>{data!.team.name}</p></section>;
}
`,
  'src/pages/MetricsChartPage.tsx': `import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../api';

interface Series { name: string; points: { label: string; value: number }[] }

export default function MetricsChartPage() {
  const { data } = useQuery({ queryKey: ['metrics'], queryFn: () => fetchJson<{ series: Series[] }>('/api/metrics') });
  if (!data) return <p>Loading metrics…</p>;
  return (
    <figure>
      {data.series.map((series) => {
        const total = series.points.reduce((sum, point) => sum + point.value, 0);
        return <div key={series.name} style={{ width: Math.min(100, total) + '%' }}>{series.name}: {total}</div>;
      })}
    </figure>
  );
}
`,
  'src/pages/SubscriptionPage.tsx': `import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../api';

interface Organization { name: string; subscription: { plan: string; status: 'active' | 'past_due' | 'canceled'; renewsAt: string } | null }

export default function SubscriptionPage() {
  const { data: org } = useQuery({ queryKey: ['org'], queryFn: () => fetchJson<Organization>('/api/organization') });
  if (!org) return null;
  if (!org.subscription) return <p>Choose a plan to get started.</p>;
  if (org.subscription.status !== 'active') return <p role="alert">Your subscription is {org.subscription.status}.</p>;
  return <section><h1>{org.name}</h1><p>{org.subscription.plan} plan · renews {org.subscription.renewsAt}</p></section>;
}
`,
  'src/pages/RoleHomePage.tsx': `import { useSession } from '../session';

export default function RoleHomePage() {
  const { user } = useSession();
  switch (user?.role) {
    case 'admin':
      return <section><h1>Admin console</h1><p>12 open requests</p></section>;
    case 'member':
      return <section><h1>My work</h1><p>4 tasks due</p></section>;
    default:
      return null;
  }
}
`,
  'src/pages/ProjectsApolloPage.tsx': `import { useQuery } from '@apollo/client';
import { PROJECTS_QUERY } from '../apollo';

interface ProjectsData { viewer: { id: string; projects: { edges: { node: { id: string; name: string; status: string; openIssues: number } }[] } } }

export default function ProjectsApolloPage() {
  const { data, loading } = useQuery<ProjectsData>(PROJECTS_QUERY);
  if (loading) return <p>Loading projects…</p>;
  return <ul>{data!.viewer.projects.edges.map(({ node }) => <li key={node.id}>{node.name} · {node.status} · {node.openIssues}</li>)}</ul>;
}
`,
  'src/pages/CartPage.tsx': `import { useSelector } from 'react-redux';
import type { RootState } from '../store/cart';

export default function CartPage() {
  const items = useSelector((state: RootState) => state.cart.items);
  if (items.length === 0) return <p>Your cart is empty.</p>;
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return <section><ul>{items.map((item) => <li key={item.sku}>{item.title} × {item.quantity}</li>)}</ul><p>Total {total}</p></section>;
}
`,
  'src/pages/PreferencesPage.tsx': `import { usePreferencesStore } from '../store/preferences';

export default function PreferencesPage() {
  const preferences = usePreferencesStore((state) => state.preferences);
  if (!preferences) return <p>Loading preferences…</p>;
  return <section><h1>Preferences</h1><p>{preferences.language} · {preferences.digest}</p><ul>{preferences.channels.map((channel) => <li key={channel}>{channel}</li>)}</ul></section>;
}
`,
  'src/pages/InboxPage.tsx': `interface Message { id: string; from: string; subject: string }

export default function InboxPage({ messages }: { messages: Message[] }) {
  return messages.length === 0 ? (
    <p>Inbox zero.</p>
  ) : (
    <ul>{messages.map((message) => <li key={message.id}>{message.from}: {message.subject}</li>)}</ul>
  );
}
`,
};
