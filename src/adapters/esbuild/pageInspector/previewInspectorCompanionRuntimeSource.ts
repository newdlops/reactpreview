/**
 * Generates the browser bridge that mirrors Page Inspector chrome into a separate VS Code tab.
 * Project React executes only in the preview webview; the bridge serializes extension-owned DOM
 * and reconstructs a strict set of companion interactions against the authoritative controls.
 */

/** Maximum mirror document emitted by the runtime before falling back to a bounded status shell. */
export const PREVIEW_INSPECTOR_COMPANION_HTML_LIMIT = 8 * 1024 * 1024;

/**
 * Creates bridge source concatenated before the DevTools UI declarations in the preview entry.
 *
 * @returns Plain JavaScript that expects `previewHotRuntime` and `previewInspectorPostHostMessage`.
 */
export function createPreviewInspectorCompanionRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_COMPANION_HTML_LIMIT = ${PREVIEW_INSPECTOR_COMPANION_HTML_LIMIT};
const previousPreviewInspectorCompanionState = previewHotRuntime.inspectorCompanionState;
try { previousPreviewInspectorCompanionState?.dispose?.(); } catch { /* Older bridge cleanup is best effort. */ }
const previewInspectorCompanionState = {
  dispose: undefined,
  disposed: false,
  elementById: new Map(),
  frame: undefined,
  lastCss: '',
  lastHtml: '',
  messageListener: undefined,
  nextId: Number.isSafeInteger(previousPreviewInspectorCompanionState?.nextId)
    ? previousPreviewInspectorCompanionState.nextId
    : 1,
  observer: undefined,
  sequence: Number.isSafeInteger(previousPreviewInspectorCompanionState?.sequence)
    ? previousPreviewInspectorCompanionState.sequence
    : 0,
  shell: undefined,
};
previewHotRuntime.inspectorCompanionState = previewInspectorCompanionState;
const previewInspectorCompanionEventConstructor = globalThis.Event;
const previewInspectorCompanionKeyboardEventConstructor = globalThis.KeyboardEvent;
const previewInspectorCompanionMouseEventConstructor = globalThis.MouseEvent;
const previewInspectorCompanionClick = globalThis.HTMLElement?.prototype?.click;

/** Assigns opaque stable IDs only to controls whose existing React handlers may be reconstructed. */
function indexPreviewInspectorCompanionControls(shell) {
  previewInspectorCompanionState.elementById.clear();
  const controls = shell.querySelectorAll?.(
    'button,input,select,textarea,[role="separator"],[data-react-preview-tree-row]',
  ) ?? [];
  for (const control of controls) {
    let remoteId = control.getAttribute?.('data-rpi-remote-id');
    if (!/^rpi-[1-9][0-9]{0,9}$/u.test(remoteId ?? '')) {
      remoteId = 'rpi-' + String(previewInspectorCompanionState.nextId++);
      control.setAttribute?.('data-rpi-remote-id', remoteId);
    }
    previewInspectorCompanionState.elementById.set(remoteId, control);
  }
}

/** Copies live form properties because cloneNode otherwise retains stale markup attributes. */
function synchronizePreviewInspectorCompanionControls(shell, clone) {
  const selector = 'input,select,textarea';
  const sources = [...(shell.querySelectorAll?.(selector) ?? [])];
  const targets = [...(clone.querySelectorAll?.(selector) ?? [])];
  sources.forEach((source, index) => {
    const target = targets[index];
    if (target === undefined) return;
    if ('value' in source && typeof source.value === 'string') {
      target.setAttribute('value', source.value);
      if (target.tagName === 'TEXTAREA') target.textContent = source.value;
    }
    if ('checked' in source) {
      if (source.checked === true) target.setAttribute('checked', '');
      else target.removeAttribute('checked');
    }
    if (source.tagName === 'SELECT') {
      const sourceOptions = [...source.options];
      const targetOptions = [...target.options];
      sourceOptions.forEach((option, optionIndex) => {
        if (option.selected) targetOptions[optionIndex]?.setAttribute?.('selected', '');
        else targetOptions[optionIndex]?.removeAttribute?.('selected');
      });
    }
  });
}

/** Publishes one changed inert shell and static stylesheet through the extension-host relay. */
function publishPreviewInspectorCompanionSnapshot() {
  previewInspectorCompanionState.frame = undefined;
  if (previewInspectorCompanionState.disposed) return;
  const shell = previewInspectorCompanionState.shell;
  if (shell === undefined || shell === null || shell.isConnected === false) return;
  indexPreviewInspectorCompanionControls(shell);
  const clone = shell.cloneNode(true);
  synchronizePreviewInspectorCompanionControls(shell, clone);
  let html = clone.outerHTML;
  const css = typeof previewInspectorDevtoolsCss === 'string' ? previewInspectorDevtoolsCss : '';
  if (html.length > PREVIEW_INSPECTOR_COMPANION_HTML_LIMIT) {
    html = '<aside class="rpi-shell" data-react-preview-companion-source="true">' +
      '<div class="rpi-empty">Inspector tree exceeded the bounded companion UI size. ' +
      'Filter or reduce the active page graph and refresh.</div></aside>';
  }
  if (html === previewInspectorCompanionState.lastHtml && css === previewInspectorCompanionState.lastCss) {
    return;
  }
  previewInspectorCompanionState.lastHtml = html;
  previewInspectorCompanionState.lastCss = css;
  previewInspectorCompanionState.sequence += 1;
  try {
    previewInspectorPostHostMessage?.({
      css,
      html,
      sequence: previewInspectorCompanionState.sequence,
      type: 'react-preview-inspector-companion-snapshot',
    });
  } catch (error) {
    console.warn('[React Preview] Could not update the separate Inspector tab.', error);
  }
}

/** Coalesces dense React and tree mutations into at most one serialized mirror per animation frame. */
function schedulePreviewInspectorCompanionSnapshot() {
  if (
    previewInspectorCompanionState.disposed ||
    previewInspectorCompanionState.frame !== undefined
  ) return;
  previewInspectorCompanionState.frame = requestAnimationFrame(
    publishPreviewInspectorCompanionSnapshot,
  );
}

/** Registers the currently mounted Inspector shell while hiding only that shell from the renderer. */
function setPreviewInspectorCompanionShell(shell) {
  if (previewInspectorCompanionState.shell === shell) {
    if (shell !== null) schedulePreviewInspectorCompanionSnapshot();
    return;
  }
  previewInspectorCompanionState.observer?.disconnect?.();
  previewInspectorCompanionState.observer = undefined;
  previewInspectorCompanionState.shell = shell ?? undefined;
  previewInspectorCompanionState.elementById.clear();
  if (shell === null || shell === undefined) return;
  shell.setAttribute('data-react-preview-companion-source', 'true');
  if (typeof MutationObserver === 'function') {
    const observer = new MutationObserver(schedulePreviewInspectorCompanionSnapshot);
    observer.observe(shell, { childList: true, subtree: true });
    previewInspectorCompanionState.observer = observer;
  }
  schedulePreviewInspectorCompanionSnapshot();
}

/** Uses the native value setter so React's controlled-input tracker observes remote edits. */
function writePreviewInspectorCompanionControl(control, message) {
  if (typeof message.value === 'string' && 'value' in control) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'value');
    if (typeof descriptor?.set === 'function') descriptor.set.call(control, message.value);
    else control.value = message.value;
  }
  if (typeof message.checked === 'boolean' && 'checked' in control) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'checked');
    if (typeof descriptor?.set === 'function') descriptor.set.call(control, message.checked);
    else control.checked = message.checked;
  }
}

/** Reconstructs only click, form, and accessible tree events accepted by the host protocol. */
function handlePreviewInspectorCompanionAction(event) {
  const message = event?.data;
  if (
    message?.type !== 'react-preview-inspector-companion-action' ||
    !/^rpi-[1-9][0-9]{0,9}$/u.test(message.remoteId ?? '')
  ) return;
  const control = previewInspectorCompanionState.elementById.get(message.remoteId);
  if (control === undefined || control.isConnected === false) {
    schedulePreviewInspectorCompanionSnapshot();
    return;
  }
  try {
    if (message.eventType === 'click') {
      previewInspectorCompanionClick?.call(control);
    } else if (message.eventType === 'dblclick') {
      if (typeof previewInspectorCompanionMouseEventConstructor !== 'function') return;
      control.dispatchEvent(new previewInspectorCompanionMouseEventConstructor('dblclick', {
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
    } else if (message.eventType === 'keydown') {
      if (typeof previewInspectorCompanionKeyboardEventConstructor !== 'function') return;
      control.dispatchEvent(new previewInspectorCompanionKeyboardEventConstructor('keydown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        key: message.key,
      }));
    } else if (message.eventType === 'input' || message.eventType === 'change') {
      if (typeof previewInspectorCompanionEventConstructor !== 'function') return;
      writePreviewInspectorCompanionControl(control, message);
      control.dispatchEvent(new previewInspectorCompanionEventConstructor(message.eventType, {
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
    }
  } catch (error) {
    console.warn('[React Preview] Inspector companion interaction failed.', error);
  }
  schedulePreviewInspectorCompanionSnapshot();
}

globalThis.addEventListener?.('message', handlePreviewInspectorCompanionAction);
previewInspectorCompanionState.messageListener = handlePreviewInspectorCompanionAction;
previewInspectorCompanionState.dispose = () => {
  previewInspectorCompanionState.disposed = true;
  previewInspectorCompanionState.observer?.disconnect?.();
  if (previewInspectorCompanionState.frame !== undefined) {
    cancelAnimationFrame(previewInspectorCompanionState.frame);
  }
  globalThis.removeEventListener?.('message', previewInspectorCompanionState.messageListener);
  previewInspectorCompanionState.elementById.clear();
};
`;
}
