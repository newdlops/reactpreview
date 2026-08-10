/** Verifies exact react-beautiful-dnd consumer/provider evidence for automatic preview corridors. */
import { describe, expect, it } from 'vitest';
import { collectPreviewDragDropRequirement } from '../../../src/adapters/esbuild/previewDragDropRequirement';

describe('collectPreviewDragDropRequirement', () => {
  it('detects an aliased Draggable as a consumer of both required contexts', () => {
    expect(
      collectPreviewDragDropRequirement(
        '/workspace/Issue.jsx',
        "import { Draggable as Item } from 'react-beautiful-dnd'; export const Issue = () => <Item />;",
      ),
    ).toEqual({
      consumesDragDropContext: true,
      consumesDroppableContext: true,
      ownsDragDropContext: false,
      ownsDroppableContext: false,
    });
  });

  it('separates Droppable ownership from the application root provider', () => {
    expect(
      collectPreviewDragDropRequirement(
        '/workspace/List.tsx',
        "import * as Dnd from 'react-beautiful-dnd'; export const List = () => <Dnd.Droppable />;",
      ),
    ).toEqual({
      consumesDragDropContext: true,
      consumesDroppableContext: false,
      ownsDragDropContext: false,
      ownsDroppableContext: true,
    });
    expect(
      collectPreviewDragDropRequirement(
        '/workspace/Board.tsx',
        "import { DragDropContext } from 'react-beautiful-dnd'; export { DragDropContext };",
      ),
    ).toEqual({
      consumesDragDropContext: false,
      consumesDroppableContext: false,
      ownsDragDropContext: true,
      ownsDroppableContext: false,
    });
  });

  it('ignores erased, unused, similarly named, and malformed imports', () => {
    for (const source of [
      "import type { DraggableProvided } from 'react-beautiful-dnd'; export type P = DraggableProvided;",
      "import { Draggable } from 'react-beautiful-dnd'; export const marker = 'unused';",
      "import { Draggable } from './react-beautiful-dnd'; export const Item = Draggable;",
      "import { Draggable } from 'react-beautiful-dnd'; const broken = ;",
    ]) {
      expect(collectPreviewDragDropRequirement('/workspace/Preview.tsx', source)).toEqual({
        consumesDragDropContext: false,
        consumesDroppableContext: false,
        ownsDragDropContext: false,
        ownsDroppableContext: false,
      });
    }
  });
});
