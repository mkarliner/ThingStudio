// Thingstudio poc-rete — shared Rete type-scheme wiring, referenced by
// every other module. Kept in its own file since main.ts, validation.ts,
// insert-node.ts and PropertyPanel.vue all need the same `Schemes`/
// `AreaExtra` pair.

import { ClassicPreset, GetSchemes, NodeEditor } from "rete";
import type { VueArea2D } from "rete-vue-plugin";

// Deliberately typed against the plain `ClassicPreset.Node` base, not the
// `AnyThingstudioNode` union of concrete subclasses — matching
// retejs.org/docs/guides/basic's own pattern. Rete's plugin generics
// (VuePlugin/ConnectionPlugin/DockPlugin) all constrain their Schemes
// parameter to `ClassicScheme`, which a union of subclasses with different
// extra fields (width/height/kind/properties shapes) doesn't structurally
// satisfy. Application code that needs the concrete subclass (PropertyPanel,
// editor-setup's propagate()) narrows with `instanceof`/`.kind` at the point
// of use instead, same as pocs/poc-c's own `instanceof` checks in Drawflow's
// hand-rolled propagate().
export type Conn = ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>;
export type Schemes = GetSchemes<ClassicPreset.Node, Conn>;
export type AreaExtra = VueArea2D<Schemes>;
export type Editor = NodeEditor<Schemes>;
