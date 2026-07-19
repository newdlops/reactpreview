/**
 * Generates the Console detail view for React Page Inspector.
 *
 * The view consumes normalized strings from the console runtime and never touches live application
 * objects. Filtering state belongs to the existing per-webview DevTools preferences, while captured
 * entries themselves remain ephemeral and bounded by the console registry.
 */

/**
 * Creates browser source for a Chrome-like chronological Console tab.
 *
 * Expected lexical bindings include `React`, `previewInspectorDevtoolsSessionState`,
 * `readPreviewInspectorConsoleEntries`, `clearPreviewInspectorConsoleEntries`, and
 * `persistPreviewInspectorState`.
 *
 * @returns Plain JavaScript source concatenated after the Inspector layout helpers.
 */
export function createPreviewInspectorConsoleUiRuntimeSource(): string {
  return String.raw`
const previewInspectorConsoleFilterLevels = new Set([
  'all',
  'debug',
  'error',
  'info',
  'log',
  'warn',
]);
previewInspectorDevtoolsSessionState.consoleLevel = previewInspectorConsoleFilterLevels.has(
  previewInspectorDevtoolsSessionState.consoleLevel,
)
  ? previewInspectorDevtoolsSessionState.consoleLevel
  : 'all';
previewInspectorDevtoolsSessionState.consoleQuery =
  typeof previewInspectorDevtoolsSessionState.consoleQuery === 'string'
    ? previewInspectorDevtoolsSessionState.consoleQuery
    : '';

/** Returns a compact visible label for one normalized console level. */
function describePreviewInspectorConsoleLevel(level) {
  const labels = {
    debug: 'DEBUG',
    error: 'ERROR',
    info: 'INFO',
    log: 'LOG',
    warn: 'WARN',
  };
  return labels[level] ?? 'LOG';
}

/** Extracts a stable time-of-day label from the registry's ISO timestamp. */
function describePreviewInspectorConsoleTime(timestamp) {
  return typeof timestamp === 'string' && timestamp.length >= 23
    ? timestamp.slice(11, 23)
    : '--:--:--.---';
}

/** Returns all searchable diagnostic fields in lowercase without exposing hidden objects. */
function createPreviewInspectorConsoleSearchText(entry) {
  return [
    entry?.componentStack,
    entry?.details,
    entry?.exportName,
    entry?.level,
    entry?.location,
    entry?.message,
    entry?.phase,
    entry?.source,
  ].filter((value) => typeof value === 'string').join('\n').toLowerCase();
}

/** Renders one chronological console row with lazily expandable full diagnostics. */
function PreviewInspectorConsoleEntry({ entry }) {
  const metadata = [
    entry.source,
    entry.exportName,
    entry.phase,
    entry.location,
  ].filter((value) => typeof value === 'string' && value.length > 0);
  const hasDetails =
    typeof entry.details === 'string' &&
    entry.details.length > 0 &&
    entry.details !== entry.message;
  return React.createElement(
    'article',
    {
      className: 'rpi-console-entry',
      'data-level': entry.level,
      key: entry.id,
      role: 'listitem',
    },
    React.createElement(
      'div',
      { className: 'rpi-console-heading' },
      React.createElement(
        'span',
        { className: 'rpi-console-level' },
        describePreviewInspectorConsoleLevel(entry.level),
      ),
      React.createElement(
        'time',
        { className: 'rpi-console-time', dateTime: entry.timestamp },
        describePreviewInspectorConsoleTime(entry.timestamp),
      ),
      metadata.length > 0
        ? React.createElement('span', { className: 'rpi-console-meta', title: metadata.join(' · ') }, metadata.join(' · '))
        : null,
      entry.count > 1
        ? React.createElement('span', { className: 'rpi-console-repeat' }, '×' + String(entry.count))
        : null,
    ),
    React.createElement('pre', { className: 'rpi-console-message' }, entry.message),
    hasDetails
      ? React.createElement(
          'details',
          { className: 'rpi-console-details' },
          React.createElement('summary', undefined, 'Stack and failure context'),
          React.createElement('pre', undefined, entry.details),
        )
      : null,
  );
}

/** Renders filters, clear action, counts, and the bounded captured log inventory. */
function PreviewInspectorConsoleDetail() {
  const [level, setLevel] = React.useState(
    () => previewInspectorDevtoolsSessionState.consoleLevel,
  );
  const [query, setQuery] = React.useState(
    () => previewInspectorDevtoolsSessionState.consoleQuery,
  );
  const entries = readPreviewInspectorConsoleEntries();
  const normalizedQuery = query.trim().toLowerCase();
  const visibleEntries = entries.filter((entry) =>
    (level === 'all' || entry.level === level) &&
    (normalizedQuery.length === 0 || createPreviewInspectorConsoleSearchText(entry).includes(normalizedQuery)),
  );
  return React.createElement(
    'div',
    { className: 'rpi-detail-content rpi-console' },
    React.createElement(
      'div',
      { className: 'rpi-console-controls' },
      React.createElement(
        'select',
        {
          'aria-label': 'Filter console messages by level',
          className: 'rpi-select',
          onChange: (event) => {
            const nextLevel = event.target.value;
            previewInspectorDevtoolsSessionState.consoleLevel = nextLevel;
            setLevel(nextLevel);
            persistPreviewInspectorState();
          },
          value: level,
        },
        React.createElement('option', { value: 'all' }, 'All levels'),
        React.createElement('option', { value: 'error' }, 'Errors'),
        React.createElement('option', { value: 'warn' }, 'Warnings'),
        React.createElement('option', { value: 'info' }, 'Info'),
        React.createElement('option', { value: 'log' }, 'Logs'),
        React.createElement('option', { value: 'debug' }, 'Debug'),
      ),
      React.createElement('input', {
        'aria-label': 'Filter console message text',
        className: 'rpi-search',
        onChange: (event) => {
          const nextQuery = event.target.value;
          previewInspectorDevtoolsSessionState.consoleQuery = nextQuery;
          setQuery(nextQuery);
        },
        onBlur: persistPreviewInspectorState,
        placeholder: 'Filter messages, stacks, components…',
        type: 'search',
        value: query,
      }),
      React.createElement(
        'button',
        {
          className: 'rpi-button',
          disabled: entries.length === 0,
          onClick: clearPreviewInspectorConsoleEntries,
          type: 'button',
        },
        'Clear',
      ),
    ),
    React.createElement(
      'div',
      { className: 'rpi-note' },
      String(visibleEntries.length) + ' of ' + String(entries.length) +
        ' messages · newest 250 retained for this preview tab',
    ),
    React.createElement(
      'div',
      { className: 'rpi-note' },
      'Blocker resolver timeline: VS Code Output → React Preview. Search for “React preview blocker trace” to inspect source, Auto choices, render diffs, and following errors.',
    ),
    visibleEntries.length === 0
      ? React.createElement(
          'div',
          { className: 'rpi-empty' },
          entries.length === 0
            ? 'No console messages captured yet.'
            : 'No console messages match the current filters.',
        )
      : React.createElement(
          'div',
          {
            'aria-label': 'React preview console messages',
            'aria-live': 'off',
            className: 'rpi-console-list',
            role: 'list',
          },
          visibleEntries.map((entry) => React.createElement(
            PreviewInspectorConsoleEntry,
            { entry, key: entry.id },
          )),
        ),
  );
}
`;
}
