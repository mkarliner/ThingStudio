// Thingstudio poc-rete — shared Rete type-scheme wiring, referenced by
// every other module. Kept in its own file since main.ts, validation.ts,
// insert-node.ts and PropertyPanel.vue all need the same `Schemes`/
// `AreaExtra` pair.

import { ClassicPreset, GetSchemes, NodeEditor } from "rete";
import type { VueArea2D } from "rete-vue-plugin";
import type { AnyThingstudioNode } from "./nodes";

export type Conn = ClassicPreset.Connection<AnyThingstudioNode, AnyThingstudioNode>;
export type Schemes = GetSchemes<AnyThingstudioNode, Conn>;
export type AreaExtra = VueArea2D<Schemes>;
export type Editor = NodeEditor<Schemes>;
