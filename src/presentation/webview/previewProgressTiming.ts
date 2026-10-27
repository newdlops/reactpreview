/** Owns elapsed-time chrome and a single document-local clock shared by loading and retained views. */
import type { PreviewProgressStage, PreviewProgressTiming } from '../../domain/previewProgress';
import { PREVIEW_PROGRESS_STEPS } from '../previewProgress';

/** Scoped styles used in the loading document and the isolated retained-preview shadow root. */
export const PREVIEW_PROGRESS_TIMING_STYLES = `
[data-react-preview-timings] { display: grid; min-width: 0; gap: 12px; font: 12px/1.5 var(--vscode-font-family); text-align: left; }
.react-preview-timing-total { display: flex; justify-content: space-between; gap: 12px; color: var(--vscode-descriptionForeground); }
[data-react-preview-total-time], [data-react-preview-duration] { font-variant-numeric: tabular-nums; white-space: nowrap; }
[data-react-preview-total-time] { color: var(--vscode-editor-foreground); font-weight: 600; }
.react-preview-timing-rows { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
[data-react-preview-timing-stage] { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; gap: 12px; min-width: 0; color: var(--vscode-descriptionForeground); }
[data-react-preview-timing-stage] > :first-child { min-width: 0; overflow-wrap: anywhere; }
[data-react-preview-timing-stage][data-state='active'] { color: var(--vscode-editor-foreground); font-weight: 600; }
`;

/** Renders inert timing rows; the nonce-authorized bootstrap advances only their text nodes. */
export function createPreviewProgressTimingMarkup(
  stage: PreviewProgressStage,
  timing?: PreviewProgressTiming,
): string {
  const activeIndex = PREVIEW_PROGRESS_STEPS.findIndex((step) => step.stage === stage);
  const rows = PREVIEW_PROGRESS_STEPS.map((step, index) => {
    const measured = timing?.stages.find((entry) => entry.stage === step.stage);
    const state =
      index === activeIndex
        ? 'active'
        : measured !== undefined
          ? 'complete'
          : index < activeIndex
            ? 'skipped'
            : 'pending';
    const duration =
      measured !== undefined
        ? `${(measured.elapsedMs / 1000).toFixed(1)}s`
        : state === 'active'
          ? '0.0s'
          : state === 'skipped'
            ? 'Skipped'
            : 'Waiting';
    return `<li data-react-preview-timing-stage="${step.stage}" data-state="${state}"${state === 'active' ? ' aria-current="step"' : ''}><span>${step.label}</span><span data-react-preview-duration>${duration}</span></li>`;
  }).join('');
  return `<div data-react-preview-timings role="timer" aria-live="off" aria-label="Preparation elapsed times"><div class="react-preview-timing-total"><span>Elapsed</span><strong data-react-preview-total-time>${((timing?.elapsedMs ?? 0) / 1000).toFixed(1)}s</strong></div><ol class="react-preview-timing-rows" aria-label="Preview preparation steps">${rows}</ol></div>`;
}

/**
 * Installs an idempotent clock without host polling, storage, network requests, or React updates.
 * The owning document clears its sole interval on completion, disconnection, or pagehide. Host
 * durations seed each new document; performance.now advances the visible current stage locally.
 */
export function createPreviewProgressTimingRuntimeSource(): string {
  return `
(() => {
  if (globalThis.__reactPreviewProgressClock?.version === 1) return;
  const steps = ${JSON.stringify(PREVIEW_PROGRESS_STEPS.map(({ stage, label }) => ({ stage, label })))};
  let active;
  let interval;
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  const format = (value) => (Math.max(0, value) / 1000).toFixed(1) + 's';
  const assign = (element, value) => { if (element && element.textContent !== value) element.textContent = value; };

  /** Rejects malformed timing snapshots before touching the retained document or its clock. */
  function readTiming(value, stage) {
    if (value === undefined) return undefined;
    const index = stage === 'ready' ? steps.length : steps.findIndex((step) => step.stage === stage);
    if (!value || typeof value !== 'object' || !Number.isFinite(value.elapsedMs) || value.elapsedMs < 0 || value.elapsedMs > Number.MAX_SAFE_INTEGER || !Array.isArray(value.stages) || value.stages.length > steps.length || index < 0) return null;
    let previous = -1;
    let sum = 0;
    const measured = [];
    for (const row of value.stages) {
      if (!row || typeof row !== 'object') return null;
      const position = steps.findIndex((step) => step.stage === row.stage);
      if (position <= previous || position > index || !Number.isFinite(row.elapsedMs) || row.elapsedMs < 0 || row.elapsedMs > value.elapsedMs) return null;
      previous = position;
      sum += row.elapsedMs;
      measured.push({ stage: row.stage, elapsedMs: row.elapsedMs });
    }
    if (sum > value.elapsedMs + 1 || (stage !== 'ready' && measured.at(-1)?.stage !== stage)) return null;
    return { elapsedMs: value.elapsedMs, stages: measured };
  }

  /** Creates bounded fallback rows with text nodes when an older document has no timing chrome. */
  function ensureRows(root) {
    if (typeof root?.querySelector !== 'function' || typeof document.createElement !== 'function') return undefined;
    let container = root.querySelector('[data-react-preview-timings]');
    if (!container) {
      const panel = root.getElementById?.('react-preview-progress-panel');
      if (!panel) return undefined;
      const style = document.createElement('style');
      style.textContent = ${JSON.stringify(PREVIEW_PROGRESS_TIMING_STYLES)};
      container = document.createElement('div');
      container.setAttribute('data-react-preview-timings', '');
      container.setAttribute('role', 'timer');
      container.setAttribute('aria-live', 'off');
      container.setAttribute('aria-label', 'Preparation elapsed times');
      const header = document.createElement('div');
      header.className = 'react-preview-timing-total';
      const label = document.createElement('span'); label.textContent = 'Elapsed';
      const total = document.createElement('strong'); total.setAttribute('data-react-preview-total-time', '');
      header.append(label, total);
      const rows = document.createElement('ol'); rows.className = 'react-preview-timing-rows';
      rows.setAttribute('aria-label', 'Preview preparation steps');
      for (const step of steps) {
        const row = document.createElement('li'); row.setAttribute('data-react-preview-timing-stage', step.stage);
        const text = document.createElement('span'); text.textContent = step.label;
        const time = document.createElement('span'); time.setAttribute('data-react-preview-duration', '');
        row.append(text, time); rows.append(row);
      }
      container.append(header, rows); panel.append(style, container);
    }
    return { container, total: container.querySelector('[data-react-preview-total-time]'), rows: steps.map((step) => {
      const row = container.querySelector('[data-react-preview-timing-stage="' + step.stage + '"]');
      return { row, time: row?.querySelector('[data-react-preview-duration]') };
    }) };
  }

  /** Reads only the active monotonic interval; completed and skipped stages remain frozen. */
  function currentTiming() {
    if (!active) return undefined;
    const delta = Math.max(0, now() - active.at);
    return { elapsedMs: active.timing.elapsedMs + delta, stages: active.timing.stages.map((row) => ({
      stage: row.stage, elapsedMs: row.elapsedMs + (row.stage === active.stage ? delta : 0),
    })) };
  }

  /** Cancels the sole timer and leaves its last displayed durations frozen. */
  function stop() {
    if (interval !== undefined) { globalThis.clearInterval(interval); interval = undefined; }
    active = undefined;
  }

  /** Updates a bounded set of text nodes without remounting React or announcing every tick. */
  function tick() {
    if (!active) return;
    if (active.root.isConnected === false || active.root.host?.hidden === true) { stop(); return; }
    const timing = currentTiming();
    assign(active.refs.total, format(timing.elapsedMs));
    const index = steps.findIndex((step) => step.stage === active.stage);
    for (const [position, step] of steps.entries()) {
      const measured = timing.stages.find((row) => row.stage === step.stage);
      const state = position === index ? 'active' : measured ? 'complete' : position < index ? 'skipped' : 'pending';
      const { row, time } = active.refs.rows[position];
      if (row?.getAttribute('data-state') !== state) {
        row?.setAttribute('data-state', state);
        if (state === 'active') row?.setAttribute('aria-current', 'step');
        else row?.removeAttribute('aria-current');
      }
      assign(time, measured ? format(measured.elapsedMs) : state === 'skipped' ? 'Skipped' : 'Waiting');
    }
  }

  /** Seeds or advances one revision; duplicate legacy reports retain their existing interval. */
  function apply(root, message) {
    if (!Number.isSafeInteger(message?.revision) || message.revision < 0 || !steps.some((step) => step.stage === message.stage)) return;
    if (active && (message.revision < active.revision || (message.revision === active.revision && steps.findIndex((step) => step.stage === message.stage) < steps.findIndex((step) => step.stage === active.stage)))) return;
    let timing = readTiming(message.timing, message.stage);
    if (timing === null) return;
    if (timing === undefined && active?.revision === message.revision) {
      if (active.stage === message.stage && active.root === root) return;
      timing = currentTiming();
      if (!timing.stages.some((row) => row.stage === message.stage)) timing.stages.push({ stage: message.stage, elapsedMs: 0 });
    }
    timing ??= { elapsedMs: 0, stages: [{ stage: message.stage, elapsedMs: 0 }] };
    if (active?.revision === message.revision) {
      const previous = currentTiming();
      const lag = Math.max(0, previous.elapsedMs - timing.elapsedMs);
      if (lag > 0) timing = { elapsedMs: timing.elapsedMs + lag, stages: timing.stages.map((row) => ({ stage: row.stage, elapsedMs: row.elapsedMs + (row.stage === message.stage ? lag : 0) })) };
    }
    const refs = active?.root === root ? active.refs : ensureRows(root);
    if (!refs) return;
    active = { root, refs, revision: message.revision, stage: message.stage, timing, at: now() };
    tick();
    if (active && interval === undefined && typeof globalThis.setInterval === 'function') interval = globalThis.setInterval(tick, 250);
  }
  globalThis.__reactPreviewProgressClock = { version: 1, apply, stop, readTiming };
  globalThis.addEventListener?.('pagehide', stop, { once: true });
})();
`;
}
