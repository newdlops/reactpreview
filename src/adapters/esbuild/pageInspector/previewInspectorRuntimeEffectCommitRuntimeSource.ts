/** Emits an owned React commit clock without changing authored effect dependencies or cleanups. */

/** Returns lexical browser helpers; React is accessed lazily so non-React fallback fixtures stay inert. */
export function createPreviewInspectorRuntimeEffectCommitRuntimeSource(): string {
  return String.raw`
let previewInspectorRuntimeEffectCommitContext;
const previewInspectorRuntimeEffectCommitCallbacks = new WeakSet();

/** Creates one private Context per entry; its opaque value cannot mutate the clock state. */
function readPreviewInspectorRuntimeEffectCommitContext() {
  if (previewInspectorRuntimeEffectCommitContext === undefined &&
    typeof React !== 'undefined' && typeof React.createContext === 'function') {
    previewInspectorRuntimeEffectCommitContext = React.createContext(undefined);
  }
  return previewInspectorRuntimeEffectCommitContext;
}

/** Reads an owned root token at the existing compiler-proven effect hook position. */
function usePreviewInspectorRuntimeEffectCommitToken() {
  const Context = readPreviewInspectorRuntimeEffectCommitContext();
  return Context === undefined ? undefined : React.useContext(Context);
}

/** Closes the provisional first layout batch even if this runtime never calls Profiler.onRender. */
function PreviewInspectorRuntimeEffectCommitScope({ clock, children }) {
  React.useLayoutEffect(() => {
    if (previewInspectorSession.runtimeEffectCommitClock === clock) {
      clock.initialCommitCompleted = true;
    }
  }, [clock]);
  return React.createElement(
    readPreviewInspectorRuntimeEffectCommitContext().Provider,
    { value: clock.token },
    children,
  );
}

/** Activates only beside the root render, never while a hot entry is merely being prepared. */
function createPreviewInspectorRuntimeEffectCommitElement(element) {
  const Context = readPreviewInspectorRuntimeEffectCommitContext();
  if (Context === undefined || typeof React.useLayoutEffect !== 'function') {
    previewInspectorSession.runtimeEffectCommitClock = undefined;
    return element;
  }
  const clock = {
    initialCommitCompleted: false,
    revision: typeof previewEntryRevision === 'number' ? previewEntryRevision : 0,
    serial: 0,
    token: Object.freeze({}),
  };
  previewInspectorSession.runtimeEffectCommitClock = clock;
  const scoped = React.createElement(PreviewInspectorRuntimeEffectCommitScope, { clock }, element);
  if (React.Profiler === undefined) return scoped;
  const onRender = () => {
    const revision = typeof previewEntryRevision === 'number' ? previewEntryRevision : 0;
    if (previewInspectorSession.runtimeEffectCommitClock !== clock || clock.revision !== revision) return;
    clock.initialCommitCompleted = true;
    clock.serial += 1;
  };
  previewInspectorRuntimeEffectCommitCallbacks.add(onRender);
  return React.createElement(React.Profiler, { id: 'react-preview-effect-commits', onRender }, scoped);
}

/** Keeps the private scope, Context and exact owned Profiler transparent in the authored tree. */
function isPreviewInspectorRuntimeEffectCommitFiber(fiber) {
  const type = readPreviewInspectorOwnData(fiber, 'type');
  const Context = previewInspectorRuntimeEffectCommitContext;
  if (type === PreviewInspectorRuntimeEffectCommitScope ||
    (Context !== undefined && (type === Context || type === Context.Provider))) return true;
  if (typeof React === 'undefined' || type !== React.Profiler) return false;
  const props = readPreviewInspectorOwnData(fiber, 'memoizedProps');
  return previewInspectorRuntimeEffectCommitCallbacks.has(readPreviewInspectorOwnData(props, 'onRender'));
}

/** Unknown roots, retired entries and unconfirmed production Profilers keep execution protection. */
function readPreviewInspectorRuntimeEffectCommitClock(token) {
  const clock = previewInspectorSession.runtimeEffectCommitClock;
  const revision = typeof previewEntryRevision === 'number' ? previewEntryRevision : 0;
  return token !== undefined && clock?.token === token && clock.revision === revision &&
    (clock.serial > 0 || clock.initialCommitCompleted === false)
      ? clock
      : undefined;
}
`;
}
