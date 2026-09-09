/**
 * Owned executable reproductions of route/owner/placeholder failures, not harvested user projects.
 * Train, validation and test use distinct rendering implementations. They remain synthetic suites;
 * structural work units are not milliseconds and no future observation enters an input feature.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { performance } from 'node:perf_hooks';

/** Renders an owned candidate and measures its output; loading/placeholder-only markup is negative. */
function observe(render) {
  const started = performance.now();
  try {
    const html = renderToStaticMarkup(React.createElement(render));
    return {
      label: Number(html.includes('data-recovery-target="verified"') && !html.includes('>?</')),
      error: null,
      milliseconds: performance.now() - started,
    };
  } catch (error) {
    return {
      label: 0,
      error: error instanceof Error ? error.name : 'UnknownError',
      milliseconds: performance.now() - started,
    };
  }
}

/** Keeps only the owned target able to emit the success marker. */
function target(text) {
  return React.createElement('strong', { 'data-recovery-target': 'verified' }, text);
}

/** Exercises a root route, an outlet route, and a nested router independently across splits. */
function routeCase(random, split) {
  const Router = React.createContext(null);
  const count = 3 + Math.floor(random() * 4);
  const reliable = Math.floor(random() * count);
  const gated = random() < 0.3;
  const candidates = Array.from({ length: count }, (_, index) => {
    const ownsRouter = index === reliable || random() > 0.65;
    const depth = 1 + split + Math.floor(random() * 8) * 3;
    const blocked = index !== reliable && gated;
    const path = split === 0 ? '/' : split === 1 ? '/inbox' : '/settings/account';
    const Component = () => {
      const router = React.useContext(Router);
      if (router === null) throw new Error('Owned route target has no router owner');
      if (blocked) return React.createElement('span', null, '?');
      if (split === 0) return router.pathname === '/' ? target('home') : null;
      if (split === 1) {
        const outlets = { '/inbox': () => target('inbox outlet') };
        return outlets[router.pathname]?.() ?? null;
      }
      const segments = router.pathname.split('/').filter(Boolean);
      return segments[0] === 'settings' && segments.at(-1) === 'account'
        ? React.createElement('article', null, target('nested account'))
        : null;
    };
    return {
      id: 'route-owner:' + index,
      deterministicRank: random(),
      numbers: {
        complete: 1,
        entryConnected: 1,
        targetAffinity: 1,
        pathDepth: depth,
        conditionalCount: Number(blocked),
        callerCount: depth,
        edgeCount: depth + 1,
        wrapperCount: 1 + split,
        pathGroupSize: count,
        invocationModeCount: 1,
        rootStepIndex: 1,
        routeSlotCount: 1,
      },
      tokens: [
        'complete:true',
        'entry-connected:true',
        'root-owns-router:' + ownsRouter,
        'route-evidence:authored',
        'wrapper-kind:layout',
        'invocation:jsx',
      ],
      observation: observe(() =>
        ownsRouter
          ? React.createElement(
              Router.Provider,
              { value: { pathname: path } },
              React.createElement(Component),
            )
          : React.createElement(Component),
      ),
    };
  });
  return {
    suite: ['root-route-owner', 'outlet-map-owner', 'nested-router-owner'][split],
    specification: {
      blockerKind: 'page-context',
      holeKind: 'page-choice-context',
      numbers: { candidateCount: count, possibilityCount: split + 1 },
      tokens: ['compiler-admitted:true', 'target-kind:component', 'module-context:false'],
    },
    candidates,
  };
}

/** Reproduces provider loss through authentic/sliced corridors using different owner layouts. */
function providerCase(random, split) {
  const required = 1 + Math.floor(random() * 6);
  const Owner = React.createContext(null);
  const count = 3 + Math.floor(random() * 4);
  const reliable = Math.floor(random() * count);
  const candidates = Array.from({ length: count }, (_, index) => {
    const fidelity = index === reliable ? 0 : Math.floor(random() * 4);
    const depth = index === reliable ? required : Math.floor(random() * 10);
    const available = Math.max(0, depth - (fidelity % 2));
    const Body = () => {
      const owners = React.useContext(Owner);
      if (owners === null) throw new Error('Owned provider missing');
      const complete =
        split === 0
          ? owners.length >= required
          : split === 1
            ? Array.from({ length: required }, (_, key) => owners.has(key)).every(Boolean)
            : Array.from({ length: required }, (_, key) => owners['owner' + key] === true).every(
                Boolean,
              );
      return complete
        ? target('provider corridor complete')
        : React.createElement('span', null, '?');
    };
    const values = Array.from({ length: available }, (_, key) => key);
    const value =
      split === 0
        ? values
        : split === 1
          ? new Set(values)
          : Object.fromEntries(values.map((key) => ['owner' + key, true]));
    return {
      id: 'provider-corridor:' + index,
      deterministicRank: fidelity * 100 + index,
      numbers: {
        authoredOwnerDepth: depth,
        fidelityRank: fidelity,
        nestedMountCount: 1 + split + Math.floor(random() * 8) * 3,
      },
      tokens: [
        'fidelity:' +
          ['route-page-authentic', 'route-page-sliced', 'page-authentic', 'page-sliced'][fidelity],
      ],
      observation: observe(() =>
        React.createElement(Owner.Provider, { value }, React.createElement(Body)),
      ),
    };
  });
  return {
    suite: ['provider-array', 'provider-set', 'provider-record'][split],
    specification: {
      blockerKind: 'page-context',
      holeKind: 'page-execution-context',
      numbers: { candidateCount: count, missingOwnerCount: required },
      tokens: ['component-output-found:true', 'page-context-missing:true'],
    },
    candidates,
  };
}

/** Adds receiver demand facts matching the production nested-fallback encoder, never source paths. */
function contextualizeException(experiment) {
  experiment.specification.recoveryContext = { ...experiment.causalContext };
  return experiment;
}

/** Mixes retained v1 coverage with new owned route/provider regressions without changing admission. */
export function augmentRecoveryCase(experiment, family, random, split, index) {
  if (index % 2 === 0) return { ...experiment, suite: 'legacy-' + family };
  if (family === 'page-choice') return routeCase(random, split);
  if (family === 'page-execution') return providerCase(random, split);
  if (family === 'exception') return contextualizeException(experiment);
  return { ...experiment, suite: 'legacy-' + family };
}

/** Creates retry states only after actually observed failed interventions; no unseen label is input. */
export function recoveryStages(experiment) {
  const stages = [experiment];
  const ordering = [...experiment.candidates].sort(
    (left, right) => left.deterministicRank - right.deterministicRank,
  );
  const failed = [];
  for (const candidate of ordering) {
    if (candidate.observation.label === 1 || failed.length >= 3) break;
    failed.push(candidate.id);
    const remaining = experiment.candidates.filter((item) => !failed.includes(item.id));
    if (remaining.length < 2) break;
    stages.push({
      ...experiment,
      specification: {
        ...experiment.specification,
        recoveryContext: {
          ...experiment.specification.recoveryContext,
          failedCandidateCount: failed.length,
          verifiedFailureCount: failed.length,
          remainingCandidateCount: remaining.length,
        },
      },
      candidates: remaining,
      observedFailures: [...failed],
    });
  }
  return stages;
}
