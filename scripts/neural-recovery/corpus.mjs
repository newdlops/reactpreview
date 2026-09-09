/**
 * Repository-owned recovery experiments, never project logs or user code. Labels come from React
 * server rendering after each admitted intervention, not from its rank or a model prediction.
 * These small executable templates measure structural recovery, not arbitrary application success.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { augmentRecoveryCase } from './causal-corpus.mjs';

export const families = Object.freeze([
  'exception',
  'collection',
  'identity',
  'page-choice',
  'page-execution',
  'local-ui',
]);

/** Returns a reproducible generator; each split uses a disjoint seed and composition template. */
export function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Emits the output marker only from the owned target, never from an error or loading wrapper. */
function target(value) {
  return React.createElement('strong', { 'data-recovery-target': 'verified' }, value);
}

/** Varies DOM composition across train/validation/test without changing the success criterion. */
function wrap(element, depth, template) {
  let result = element;
  for (let index = 0; index < depth; index += 1) {
    result =
      template === 0
        ? React.createElement('section', null, result)
        : template === 1
          ? React.createElement(React.Fragment, null, React.createElement('aside'), result)
          : React.createElement('article', null, React.createElement('header'), result);
  }
  return result;
}

/** Executes an intervention and treats exceptions, missing output and placeholder-only output as failure. */
function observe(render) {
  try {
    const html = renderToStaticMarkup(React.createElement(render));
    return {
      label: Number(html.includes('data-recovery-target="verified"') && !html.includes('>?</')),
      error: null,
    };
  } catch (error) {
    return { label: 0, error: error instanceof Error ? error.name : 'UnknownError' };
  }
}

/** Applies the same candidate/context merge as the production portfolio selector. */
export function mergeSpecification(specification, candidate) {
  return {
    blockerKind: specification.blockerKind,
    holeKind: specification.holeKind,
    candidateId: candidate.id,
    recoveryContext: specification.recoveryContext,
    numbers: { ...specification.numbers, ...candidate.numbers },
    texts: [...(specification.texts ?? []), ...(candidate.texts ?? [])],
    tokens: [...specification.tokens, ...candidate.tokens, 'candidate:' + candidate.id],
  };
}

/** Produces a typed nested-value repair with an actual pre-intervention TypeError. */
function exceptionCase(random, template) {
  const depth = 1 + Math.floor(random() * 5);
  const needsGate = random() > 0.35;
  const proof = needsGate && random() > 0.18;
  const method = Math.floor(random() * 3);
  const seedValue = method === 0 ? ['recovered'] : method === 1 ? 'recovered' : 42;
  const renderValue = (value) => {
    let node = value;
    for (let index = 0; index < depth; index += 1) node = node.child;
    const text =
      method === 0
        ? node.value.map(String).join(' ')
        : method === 1
          ? node.value.trim()
          : node.value.toFixed(0);
    return !needsGate || node.ready === true ? wrap(target(text), depth, template) : null;
  };
  const valueFor = (branch) => {
    let node = { value: seedValue, ready: branch && proof };
    for (let index = 0; index < depth; index += 1) node = { child: node };
    return node;
  };
  return {
    initial: observe(() => renderValue(false)),
    causalContext: {
      collectionDemandCount: Number(method === 0),
      callableDemandCount: Number(method === 2),
      stringDemandCount: Number(method === 1),
      numericDemandCount: Number(method === 2),
      scalarGuardCount: Number(proof),
      nestedThrowCount: 1,
      remainingCandidateCount: 2,
    },
    specification: {
      blockerKind: 'runtime-fallback',
      holeKind: 'blocker-exception-runtime-value',
      numbers: {
        nestedFallbackCount: depth,
        requiredPathCount: depth + 3 + template + Math.floor(random() * 15) * 3,
      },
      tokens: ['authored-kind:boolean', 'fallback-kind:object', 'required:child.value'],
    },
    candidates: [false, true].map((branch) => ({
      id: branch ? 'branch-opening' : 'shape-only',
      deterministicRank: Number(branch !== proof),
      numbers: { branchOpening: Number(branch), exactSmartPathCount: Number(branch && proof) },
      tokens: [
        'strategy:' + (branch ? 'branch-opening' : 'shape-only'),
        'compiler-branch-proof:' + String(branch && proof),
        'value-kind:object',
      ],
      observation: observe(() => renderValue(valueFor(branch))),
    })),
  };
}

/** Measures actual row retention through an admitted collection-filter predicate. */
function collectionCase(random, template) {
  const count = 1 + template + Math.floor(random() * 40) * 3;
  const rows = Array.from({ length: count }, (_, index) => ({ label: 'row-' + index }));
  return {
    specification: {
      blockerKind: 'runtime-fallback',
      holeKind: 'rendered-collection-consumer-data',
      numbers: { callableCandidateCount: 1 + Math.floor(random() * 8), requiredPathCount: count },
      tokens: ['compiler-call-result-candidate', 'role:collection-filter-predicate'],
    },
    candidates: [true, false].map((retains) => ({
      id: retains ? 'retain-generated-collection' : 'neutral-callable',
      deterministicRank: Number(!retains),
      numbers: { retainsData: Number(retains) },
      tokens: [
        'role:collection-filter-predicate',
        'strategy:' + (retains ? 'data-retaining-call-result' : 'neutral-call-result'),
      ],
      observation: observe(() =>
        wrap(
          rows
            .filter(() => retains)
            .map((row) => React.createElement('div', { key: row.label }, target(row.label))),
          template + 1,
          template,
        ),
      ),
    })),
  };
}

/** Exercises referential joins instead of labelling an identity candidate by its name. */
function identityCase(random, template) {
  const count = 2 + template + Math.floor(random() * 38) * 3;
  const rows = Array.from({ length: count }, (_, index) => ({
    id: index + 100,
    text: 'record-' + index,
  }));
  const selected = rows[Math.floor(random() * rows.length)].id;
  return {
    specification: {
      blockerKind: 'runtime-fallback',
      holeKind: 'render-state-reference-value',
      numbers: { requiredPathCount: count, semanticPathDepth: 1 + Math.floor(random() * 8) },
      tokens: [
        'compiler-semantic-demand:identity',
        'semantic-path-leaf:value',
        'value-source:generated-hook',
      ],
    },
    candidates: [true, false].map((coherent) => ({
      id: coherent ? 'generated-identity-reference' : 'independent-generated-value',
      deterministicRank: Number(!coherent),
      numbers: { referentialCoherence: Number(coherent) },
      tokens: [
        'strategy:' + (coherent ? 'generated-identity-reference' : 'independent-generated-value'),
      ],
      observation: observe(() => {
        const value = coherent ? selected : -selected;
        const row =
          template === 0
            ? rows.find((item) => item.id === value)
            : new Map(rows.map((item) => [item.id, item])).get(value);
        return row === undefined ? null : wrap(target(row.text), template + 1, template);
      }),
    })),
  };
}

/** Builds connected/disconnected call graphs with independently observed conditional branches. */
function pageCase(random, template) {
  const count = 2 + Math.floor(random() * 5);
  const candidates = Array.from({ length: count }, (_, index) => {
    const complete = index === 0 || random() > 0.3;
    const connected = index === 0 || random() > 0.3;
    const affinity = index === 0 || random() > 0.3;
    const conditions = index === 0 ? 0 : Math.floor(random() * 4);
    const depth = 1 + Math.floor(random() * 12);
    // The compiler knows a gate exists, not its live value. Preserve this irreducible uncertainty.
    const gates = Array.from({ length: conditions }, () => random() > 0.5);
    return {
      id: 'page-path:' + index,
      deterministicRank: random(),
      numbers: {
        complete: Number(complete),
        entryConnected: Number(connected),
        targetAffinity: Number(affinity),
        pathDepth: depth,
        conditionalCount: conditions,
        callerCount: depth,
        edgeCount: depth + Number(complete),
        wrapperCount: template + 1,
        invocationModeCount: 1,
        pathGroupSize: count,
        rootStepIndex: 1,
        routeSlotCount: 1,
      },
      tokens: [
        'complete:' + complete,
        'entry-connected:' + connected,
        'invocation:jsx',
        'route-evidence:authored',
        'root-owns-router:' + connected,
        'wrapper-kind:layout',
      ],
      observation: observe(() => {
        const leaf = affinity
          ? target('page-output')
          : React.createElement('span', null, 'other component');
        const corridor = complete ? wrap(leaf, depth, template) : wrap(null, depth, template);
        return connected && gates.every(Boolean) ? corridor : null;
      }),
    };
  });
  return {
    specification: {
      blockerKind: 'page-context',
      holeKind: 'page-choice-context',
      numbers: { candidateCount: count, possibilityCount: 1 + Math.floor(random() * count) },
      tokens: ['compiler-admitted:true', 'target-kind:component', 'module-context:false'],
    },
    candidates,
  };
}

/** Restores context providers and lets the target throw if an execution corridor omits one. */
function executionCase(random, template) {
  const required = 1 + Math.floor(random() * 6);
  const Context = React.createContext(new Set());
  const count = 2 + Math.floor(random() * 5);
  const candidates = Array.from({ length: count }, (_, index) => {
    const depth = index === 0 ? required + Math.floor(random() * 3) : Math.floor(random() * 10);
    const fidelity = Math.floor(random() * 4);
    const full = fidelity % 2 === 0;
    const providerCount = full ? depth : Math.max(0, depth - 1);
    const Target = () => {
      const providers = React.useContext(Context);
      for (let needed = 0; needed < required; needed += 1) {
        if (!providers.has(needed)) throw new Error('Missing owned provider');
      }
      return target('page-context-output');
    };
    return {
      id: 'page-execution:' + index,
      deterministicRank: fidelity * 100 + index,
      numbers: {
        authoredOwnerDepth: depth,
        fidelityRank: fidelity,
        nestedMountCount: 1 + template + Math.floor(random() * 5) * 3,
      },
      tokens: [
        'fidelity:' +
          ['route-page-authentic', 'route-page-sliced', 'page-authentic', 'page-sliced'][fidelity],
      ],
      observation: observe(() =>
        wrap(
          React.createElement(
            Context.Provider,
            { value: new Set(Array.from({ length: providerCount }, (_, level) => level)) },
            React.createElement(Target),
          ),
          depth,
          template,
        ),
      ),
    };
  });
  return {
    specification: {
      blockerKind: 'page-context',
      holeKind: 'page-execution-context',
      numbers: { candidateCount: count, missingOwnerCount: required },
      tokens: ['component-output-found:true', 'page-context-missing:true'],
    },
    candidates,
  };
}

/** Replays owned setter closures; only the active item reveals the target's output. */
function localUiCase(random, template) {
  const count = 2 + Math.floor(random() * 6);
  const active = Math.floor(random() * count);
  return {
    specification: {
      blockerKind: 'target-reachability',
      holeKind: 'authored-local-state-transition',
      numbers: {
        candidateCount: count,
        conditionLine: 1 + template + Math.floor(random() * 600) * 3,
      },
      tokens: ['condition-kind:condition', 'desired:true'],
    },
    candidates: Array.from({ length: count }, (_, index) => {
      const priority = index === active ? 100 : Math.floor(random() * 75);
      let selected;
      const invoke = () => {
        selected = index;
      };
      invoke();
      return {
        id: 'owned-trigger:' + index,
        deterministicRank: (100 - priority) * 1000 + index,
        numbers: { selectionPriority: priority },
        tokens: ['event:onClick', 'setter:setSelected'],
        observation: observe(() =>
          selected === active ? wrap(target('opened'), template + 1, template) : null,
        ),
      };
    }),
  };
}

/** Returns one bounded experiment; display ranks are never inputs to training or feature encoding. */
export function createRecoveryCase(family, random, template = 0, index = 0) {
  const builders = {
    exception: exceptionCase,
    collection: collectionCase,
    identity: identityCase,
    'page-choice': pageCase,
    'page-execution': executionCase,
    'local-ui': localUiCase,
  };
  const experiment = augmentRecoveryCase(
    builders[family](random, template),
    family,
    random,
    template,
    index,
  );
  return { ...experiment, family, template };
}
