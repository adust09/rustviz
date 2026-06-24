import { LayeredRenderer } from "./LayeredRenderer";
import type { DiagramScene, RendererProps } from "./types";

// 2.5D = the flat renderer tilted back into 3D via CSS perspective. For the
// structure map the dependency layers recede like steps (bin near, foundation
// far); for sequence the temporal plane tilts back. Semantic zoom, the minimap
// and pan all come from the flat renderer underneath — only the visual plane is
// rotated, so there is no separate geometry to maintain.
export function IsometricRenderer(props: RendererProps<DiagramScene>): JSX.Element {
  return (
    <div className="iso-tilt">
      <LayeredRenderer {...props} />
    </div>
  );
}
