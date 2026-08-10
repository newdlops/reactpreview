import type { PreviewDragDropRequirement } from './previewDragDropRequirement';

/** Generates the browser-only react-beautiful-dnd compatibility corridor. */
export function createPreviewDragDropRuntimeSource(
  modulePath: string,
  initialRequirement?: PreviewDragDropRequirement,
): string {
  const encodedModulePath = JSON.stringify(modulePath.replaceAll('\\', '/'));
  const initial = initialRequirement ?? {
    consumesDragDropContext: false,
    consumesDroppableContext: false,
    ownsDragDropContext: false,
    ownsDroppableContext: false,
  };
  return `
import * as React from 'react';
import * as DragDropModule from ${encodedModulePath};

let consumesDragDropContext = ${JSON.stringify(initial.consumesDragDropContext)};
let consumesDroppableContext = ${JSON.stringify(initial.consumesDroppableContext)};
let ownsDragDropContext = ${JSON.stringify(initial.ownsDragDropContext)};
let ownsDroppableContext = ${JSON.stringify(initial.ownsDroppableContext)};
let previewRuntimeStatus = 'available: drag-and-drop requirement has not been composed yet';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Aggregates monotonic syntax evidence registered by target-reachable source modules. */
export function registerPreviewDragDropRequirement(requirement) {
  if (!isRecord(requirement)) return;
  consumesDragDropContext ||= requirement.consumesDragDropContext === true;
  consumesDroppableContext ||= requirement.consumesDroppableContext === true;
  ownsDragDropContext ||= requirement.ownsDragDropContext === true;
  ownsDroppableContext ||= requirement.ownsDroppableContext === true;
}

export function readPreviewRuntimeStatus() {
  return previewRuntimeStatus;
}

function readDragDropExport(name) {
  return DragDropModule[name] ?? DragDropModule.default?.[name];
}

const supportedReactTypeSymbols = new Set([
  Symbol.for('react.forward_ref'),
  Symbol.for('react.lazy'),
  Symbol.for('react.memo'),
]);

function isReactComponentType(value) {
  return typeof value === 'function' ||
    (value !== null && typeof value === 'object' && supportedReactTypeSymbols.has(value.$$typeof));
}

function handleStaticDragEnd() {}

/** Supplies the concrete DOM ref and props required by the package's Droppable contract. */
function StaticDroppableChildren({ children, provided }) {
  const droppableProps = isRecord(provided?.droppableProps) ? provided.droppableProps : {};
  return React.createElement(
    'div',
    {
      ...droppableProps,
      'data-react-preview-drag-drop-corridor': '',
      ref: typeof provided?.innerRef === 'function' ? provided.innerRef : undefined,
      style: { display: 'flex', flexDirection: 'column', minWidth: 0 },
    },
    children,
    provided?.placeholder,
  );
}

function createStaticDroppableElement(Droppable, children) {
  return React.createElement(
    Droppable,
    { droppableId: 'react-preview-static-droppable', isDropDisabled: true },
    (provided) => React.createElement(StaticDroppableChildren, { children, provided }),
  );
}

/** Adds only the missing outer contexts and never nests over an application-owned root provider. */
export function createDragDropPreviewElement(children) {
  if (!consumesDragDropContext) {
    previewRuntimeStatus = 'inactive: no target-reachable drag-and-drop consumer was detected';
    return children;
  }
  if (ownsDragDropContext) {
    previewRuntimeStatus = 'inactive: target graph provides its own DragDropContext boundary';
    return children;
  }
  const DragDropContext = readDragDropExport('DragDropContext');
  const Droppable = readDragDropExport('Droppable');
  if (!isReactComponentType(DragDropContext)) {
    previewRuntimeStatus = 'unavailable: installed package has no DragDropContext export';
    return children;
  }
  let element = children;
  let suppliedDroppable = false;
  if (consumesDroppableContext && !ownsDroppableContext) {
    if (!isReactComponentType(Droppable)) {
      previewRuntimeStatus = 'unavailable: installed package has no Droppable export';
      return children;
    }
    element = createStaticDroppableElement(Droppable, element);
    suppliedDroppable = true;
  }
  previewRuntimeStatus = suppliedDroppable
    ? 'active: static DragDropContext and Droppable boundaries'
    : 'active: static DragDropContext boundary';
  return React.createElement(DragDropContext, { onDragEnd: handleStaticDragEnd }, element);
}
`;
}
