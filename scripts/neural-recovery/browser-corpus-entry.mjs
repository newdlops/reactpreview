/** Browser-only owned React failure reproductions; never bundled into the shipped extension. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

const Owner = React.createContext(null);

/** Contains expected fixture exceptions so an error panel cannot become a target success label. */
class OwnedBoundary extends React.Component {
  state = { failed: false };
  /** Converts an owned render error into an explicitly non-successful boundary. */
  static getDerivedStateFromError() {
    return { failed: true };
  }
  /** Reports only the closed exception class, never its message or stack. */
  componentDidCatch(error) {
    this.props.onError(error instanceof TypeError ? 'TypeError' : 'Error');
  }
  /** The boundary does not carry the owned target marker. */
  render() {
    return this.state.failed ? React.createElement('aside', null, '?') : this.props.children;
  }
}

/** Emits the real target only after its owner and route/provider checks succeed. */
function OwnedBody({ family, required, phase }) {
  const owner = React.useContext(Owner);
  if (owner === null) throw new TypeError('Owned hook has no context');
  if (phase === 0) return React.createElement('span', null, 'waiting');
  const complete = family === 'page-choice' ? owner.pathname === '/' : owner.providers >= required;
  return complete
    ? React.createElement('strong', { 'data-recovery-target': 'verified' }, 'ready')
    : React.createElement('span', null, '?');
}

/** Models a microtask-backed hook without repeatedly subscribing to changing object props. */
function EffectBody({ family, required }) {
  const [phase, setPhase] = React.useState(0);
  React.useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (current) setPhase(1);
    });
    return () => {
      current = false;
    };
  }, []);
  return React.createElement(OwnedBody, { family, required, phase });
}

/** A transient target followed by missing data must fail the repeated-output observation. */
function RegressingBody({ family, required }) {
  const [settled, setSettled] = React.useState(false);
  React.useEffect(() => {
    const timer = setTimeout(() => setSettled(true), 8);
    return () => clearTimeout(timer);
  }, []);
  return settled
    ? React.createElement(OwnedBody, { family, required, phase: 1 })
    : React.createElement('strong', { 'data-recovery-target': 'verified' }, 'transient');
}

/** Waits for a browser frame; each candidate owns a bounded three-observation verification window. */
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** Executes separate async-effect, lazy/Suspense, and delayed-regression fixture suites by split. */
export async function collectBrowserRecoveryCorpus(count) {
  const violations = [];
  document.addEventListener('securitypolicyviolation', (event) =>
    violations.push(event.violatedDirective),
  );
  const host = document.getElementById('root');
  const root = createRoot(host);
  const splits = {};
  let sequence = 0;
  let positives = 0;
  let negatives = 0;
  let exceptions = 0;
  for (const [split, name] of ['train', 'validation', 'test'].entries()) {
    const cases = [];
    const total = split === 0 ? count : Math.max(8, Math.floor(count / 4));
    for (const family of ['page-choice', 'page-execution']) {
      for (let index = 0; index < total; index += 1) {
        const required = 1 + (index % 6);
        const good = index % 3;
        const candidates = [];
        for (let option = 0; option < 3; option += 1) {
          const reliable = option === good;
          const depth = reliable ? required + 1 : Math.max(0, required - 2);
          const fidelity = option === 2 ? 1 : 0;
          const providerCount = Math.max(0, depth - fidelity);
          const owner =
            family === 'page-choice'
              ? reliable
                ? { pathname: '/' }
                : null
              : { providers: providerCount };
          let error = null;
          let Body = EffectBody;
          if (split === 1) {
            // An owned in-memory lazy module, not eval or a network request under the webview CSP.
            Body = React.lazy(() => Promise.resolve({ default: EffectBody }));
          } else if (split === 2) Body = RegressingBody;
          const started = performance.now();
          flushSync(() =>
            root.render(
              React.createElement(
                OwnedBoundary,
                {
                  key: ++sequence,
                  onError: (value) => {
                    error = value;
                  },
                },
                React.createElement(
                  Owner.Provider,
                  { value: owner },
                  React.createElement(
                    React.Suspense,
                    { fallback: React.createElement('span', null, '?') },
                    React.createElement(Body, { family, required }),
                  ),
                ),
              ),
            ),
          );
          // Give lazy/effect commits time to settle, then require three consecutive owned outputs.
          await new Promise((resolve) => setTimeout(resolve, split === 1 ? 330 : 12));
          const samples = [];
          for (let observation = 0; observation < 3; observation += 1) {
            await frame();
            samples.push(
              Number(
                error === null &&
                  host.querySelector('[data-recovery-target="verified"]') !== null &&
                  !host.textContent.includes('?'),
              ),
            );
          }
          const label = Number(samples.every(Boolean));
          if (reliable && label !== 1)
            throw new Error(
              'Known owned fixture did not settle: ' + name + ':' + family + ':' + index,
            );
          positives += label;
          negatives += 1 - label;
          exceptions += Number(error !== null);
          candidates.push({
            id: 'browser-owned:' + option,
            deterministicRank: option,
            numbers:
              family === 'page-choice'
                ? {
                    complete: 1,
                    entryConnected: 1,
                    targetAffinity: 1,
                    pathDepth: 1 + split + (index % 8) * 3,
                    conditionalCount: 0,
                    callerCount: 2,
                    edgeCount: 3,
                    wrapperCount: split + 1,
                    pathGroupSize: 3,
                    invocationModeCount: 1,
                    rootStepIndex: 1,
                    routeSlotCount: 1,
                  }
                : {
                    authoredOwnerDepth: depth,
                    fidelityRank: fidelity,
                    nestedMountCount: 1 + split + (index % 8) * 3,
                  },
            tokens:
              family === 'page-choice'
                ? [
                    'root-owns-router:' + reliable,
                    'route-evidence:route-jsx',
                    'wrapper-kind:layout',
                    'invocation:jsx',
                  ]
                : ['fidelity:' + (fidelity === 0 ? 'route-page-authentic' : 'route-page-sliced')],
            observation: { label, error, samples, milliseconds: performance.now() - started },
          });
        }
        cases.push({
          family,
          suite: ['browser-effect', 'browser-lazy', 'browser-regression'][split],
          specification: {
            blockerKind: 'page-context',
            holeKind: family === 'page-choice' ? 'page-choice-context' : 'page-execution-context',
            numbers: {
              candidateCount: 3,
              ...(family === 'page-choice'
                ? { possibilityCount: split + 1 }
                : { missingOwnerCount: required }),
            },
            tokens:
              family === 'page-choice'
                ? ['compiler-admitted:true', 'target-kind:component', 'module-context:false']
                : ['component-output-found:true', 'page-context-missing:true'],
          },
          candidates,
        });
      }
    }
    splits[name] = cases;
  }
  flushSync(() => root.unmount());
  if (violations.length > 0 || performance.getEntriesByType('resource').length > 0)
    throw new Error('Owned browser corpus violated isolation/CSP.');
  return {
    manifest: {
      observations: positives + negatives,
      positives,
      negatives,
      exceptions,
      consecutiveObservations: 3,
      suites: ['effect', 'lazy-suspense', 'delayed-regression'],
      violations,
      externalResources: 0,
      userAgent: navigator.userAgent,
    },
    splits,
  };
}
