import { describe, expect, it } from 'vitest';
import { createPreviewDragDropRuntimeSource } from '../../../src/adapters/esbuild/previewDragDropRuntimeSource';

describe('createPreviewDragDropRuntimeSource', () => {
  it('creates an inert exact-package provider corridor only for unowned consumers', () => {
    const source = createPreviewDragDropRuntimeSource('/project/node_modules/rbd/index.js', {
      consumesDragDropContext: true,
      consumesDroppableContext: true,
      ownsDragDropContext: false,
      ownsDroppableContext: false,
    });
    expect(source).toContain(
      'import * as DragDropModule from "/project/node_modules/rbd/index.js"',
    );
    expect(source).toContain('if (ownsDragDropContext)');
    expect(source).toContain("Symbol.for('react.memo')");
    expect(source).toContain("droppableId: 'react-preview-static-droppable'");
    expect(source).toContain('isDropDisabled: true');
    expect(source).toContain("'data-react-preview-drag-drop-corridor': ''");
    expect(source).toContain('onDragEnd: handleStaticDragEnd');
    expect(source).toContain('let consumesDragDropContext = true');
  });
});
