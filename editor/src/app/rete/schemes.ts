// SPDX-License-Identifier: Apache-2.0
// editor/src/app/rete/schemes.ts
//
// Shared Rete type-scheme wiring, ported from pocs/poc-rete/src/schemes.ts
// verbatim (same reasoning applies unchanged -- see that file's header).
// Typed against the plain ClassicPreset.Node base, not a union of this
// project's concrete node subclasses: Rete's plugin generics (VuePlugin,
// ConnectionPlugin) constrain their Schemes parameter to ClassicScheme,
// which a union with differing `properties`/`kind`/width/height shapes
// doesn't structurally satisfy. Call sites that need the concrete subclass
// narrow with `instanceof`/`.kind` instead, same as poc-rete's own
// PropertyPanel/editor-setup did.

import { ClassicPreset, GetSchemes, NodeEditor } from "rete";
import type { VueArea2D } from "rete-vue-plugin";

export type Conn = ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>;
export type Schemes = GetSchemes<ClassicPreset.Node, Conn>;
export type AreaExtra = VueArea2D<Schemes>;
export type Editor = NodeEditor<Schemes>;
