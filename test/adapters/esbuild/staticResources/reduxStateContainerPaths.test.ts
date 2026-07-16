/**
 * Verifies bounded Redux selector container discovery without executing hooks, reducers, or stores.
 * Fixtures focus on runtime object requirements while proving leaves and unsafe syntax stay absent.
 */
import { describe, expect, it } from 'vitest';
import { collectPreviewReduxStateContainerPaths } from '../../../../src/adapters/esbuild/staticResources/reduxStateContainerPaths';

const SOURCE_PATH = '/workspace/src/use-preview-state.tsx';

describe('collectPreviewReduxStateContainerPaths', () => {
  /** Reconstructs the exact non-null containers required by the reported subscription hook. */
  it('collects selector-result aliases and nested non-optional dereference prefixes', () => {
    const paths = collectPreviewReduxStateContainerPaths(
      SOURCE_PATH,
      [
        'import { useSelector } from "common/ui/redux/use-selector";',
        'export const usePlan = () => {',
        '  const company = useSelector((state) => state.company);',
        '  if (!company) throw new Error("never");',
        '  const subscriptionPlan = company.subscription.subscriptionPlan;',
        '  const planName = subscriptionPlan.name;',
        '  const renewalType = subscriptionPlan.renewType.value;',
        '  const isSuspended = company.subscription.isSuspended;',
        '  return { isSuspended, planName, renewalType };',
        '};',
      ].join('\n'),
    );

    expect(paths).toEqual([
      ['company'],
      ['company', 'subscription'],
      ['company', 'subscription', 'subscriptionPlan'],
      ['company', 'subscription', 'subscriptionPlan', 'renewType'],
    ]);
  });

  /** Follows an aliased selector import and object destructuring without materializing leaf values. */
  it('propagates state paths through one-level object destructuring', () => {
    const paths = collectPreviewReduxStateContainerPaths(
      SOURCE_PATH,
      [
        'import { useAppSelector as useProjectSelector } from "@app/hooks";',
        'function useProfile() {',
        '  const { session: currentSession } = useProjectSelector((root) => root.account);',
        '  const { profile } = currentSession;',
        '  return profile.name;',
        '}',
      ].join('\n'),
    );

    expect(paths).toEqual([['account'], ['account', 'session'], ['account', 'session', 'profile']]);
  });

  /** Leaves truthy and discriminant leaves absent while retaining only their shared object parents. */
  it('does not invent boolean or string leaves from conditions and strict equality', () => {
    const paths = collectPreviewReduxStateContainerPaths(
      SOURCE_PATH,
      [
        'import { useSelector } from "react-redux";',
        'function View() {',
        '  const company = useSelector((state) => state.company);',
        '  if (company.subscription.isSuspended) return null;',
        '  return company.subscription.status === "active" ? "yes" : "no";',
        '}',
      ].join('\n'),
    );

    expect(paths).toEqual([['company'], ['company', 'subscription']]);
    expect(paths).not.toContainEqual(['company', 'subscription', 'isSuspended']);
    expect(paths).not.toContainEqual(['company', 'subscription', 'status']);
  });

  /** Includes containers dereferenced inside the selector callback before the hook can return. */
  it('collects direct callback path containers while leaving the selected leaf absent', () => {
    const paths = collectPreviewReduxStateContainerPaths(
      SOURCE_PATH,
      [
        'import { useAppSelector } from "@app/hooks";',
        'const suspended = useAppSelector((state) => state.company.subscription.isSuspended);',
        'export default suspended;',
      ].join('\n'),
    );

    expect(paths).toEqual([['company'], ['company', 'subscription']]);
    expect(paths).not.toContainEqual(['company', 'subscription', 'isSuspended']);
  });

  /** Rejects syntax whose safe runtime container type cannot be proven as a direct plain object. */
  it('fails closed for optional, computed, array-method, and function-call access', () => {
    const paths = collectPreviewReduxStateContainerPaths(
      SOURCE_PATH,
      [
        'import * as ReactRedux from "react-redux";',
        'function View({ field }) {',
        '  const company = ReactRedux.useSelector((state) => state.company);',
        '  company?.subscription.plan;',
        '  company[field].name;',
        '  company.items.map((item) => item.name);',
        '  company.factory().result;',
        '  return null;',
        '}',
      ].join('\n'),
    );

    expect(paths).toEqual([]);
  });

  /** Does not treat another hook or a shadowed selector import as selector evidence. */
  it('requires an unshadowed selector-like imported hook name', () => {
    const unrelated = collectPreviewReduxStateContainerPaths(
      SOURCE_PATH,
      [
        'import { useValue } from "common/hooks/use-value";',
        'const value = useValue((state) => state.company);',
        'value.subscription.name;',
      ].join('\n'),
    );
    const shadowed = collectPreviewReduxStateContainerPaths(
      SOURCE_PATH,
      [
        'import { useSelector } from "react-redux";',
        'function View(useSelector) {',
        '  const value = useSelector((state) => state.company);',
        '  return value.subscription.name;',
        '}',
      ].join('\n'),
    );

    expect(unrelated).toEqual([]);
    expect(shadowed).toEqual([]);
  });

  /** Produces deterministic immutable output and does not leak paths between independent calls. */
  it('returns stable frozen paths with per-call collection state', () => {
    const source = [
      'import { useSelector } from "react-redux";',
      'const company = useSelector((state) => state.company);',
      'company.subscription.plan.name;',
      'company.subscription.plan.name;',
    ].join('\n');
    const first = collectPreviewReduxStateContainerPaths(SOURCE_PATH, source);
    const second = collectPreviewReduxStateContainerPaths(SOURCE_PATH, source);

    expect(first).toEqual([
      ['company'],
      ['company', 'subscription'],
      ['company', 'subscription', 'plan'],
    ]);
    expect(second).toEqual(first);
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.every((containerPath) => Object.isFrozen(containerPath))).toBe(true);
    expect(collectPreviewReduxStateContainerPaths(SOURCE_PATH, 'export const value = 1;')).toEqual(
      [],
    );
  });
});
