<!--
  editor/src/app/rete/ScreenOutline.vue

  The primitive layout editor for a gui screen node: each page (and modal) as an outline of its row/column tree,
  top to bottom in the order things appear on screen. Move up/down reorders among siblings, indent/outdent
  moves an element into the container before it or out of its container, add puts a widget, text, spacer or
  container at the end of a container. Edits go through gui/screen-edit.ts into screens-store.ts; whether the
  result fits is still decided at Deploy (and shown below the outline when the layout is compiled).
  Not the GUI view (no preview, no dragging) -- just enough to arrange a screen without editing JSON.
-->
<template>
  <div class="outline">
    <h4>Pages</h4>
    <p v-if="!spec.pages.length" class="hint">No pages yet. Add one below.</p>

    <div v-for="(page, pi) in spec.pages" :key="page.name" class="target">
      <div class="target-head">
        <strong>{{ page.name }}</strong><span v-if="page.parent" class="dim"> (inside {{ page.parent }})</span>
        <span class="btns">
          <button v-if="!page.parent" :disabled="pi === 0" title="earlier in the page order" @click="edit((s) => movePage(s, page.name, -1))">↑</button>
          <button v-if="!page.parent" title="later in the page order" @click="edit((s) => movePage(s, page.name, 1))">↓</button>
          <button title="remove this page" @click="edit((s) => removePage(s, page.name))">✕</button>
        </span>
      </div>
      <TreeRows :root="page.root" :target="{ page: page.name }" :names="nameOf" @op="onOp" />
      <AddBar :target="{ page: page.name }" :unplaced="unplaced" :name-of="nameOf" @add="onAdd" />
    </div>

    <div class="addrow">
      <input v-model="newPage" placeholder="new page name" @keyup.enter="addPageNow" />
      <button :disabled="!newPage.trim()" @click="addPageNow">add page</button>
    </div>

    <template v-if="spec.modals?.length || unplacedModals.length">
      <h4>Modals</h4>
      <div v-for="m in spec.modals ?? []" :key="m.node" class="target">
        <div class="target-head">
          <strong>{{ nameOf(m.node) }}</strong>
          <span class="btns"><button title="remove this modal's layout" @click="edit((s) => removeModal(s, m.node))">✕</button></span>
        </div>
        <TreeRows :root="m.root" :target="{ modal: m.node }" :names="nameOf" @op="onOp" />
        <AddBar :target="{ modal: m.node }" :unplaced="unplaced" :name-of="nameOf" @add="onAdd" />
      </div>
      <div v-if="unplacedModals.length" class="addrow">
        <select v-model="newModal">
          <option value="">lay out a modal…</option>
          <option v-for="n in unplacedModals" :key="n.id" :value="n.id">{{ n.name }}</option>
        </select>
        <button :disabled="!newModal" @click="addModalNow">add</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, ref, type PropType } from "vue";
import { bumpPropertyVersion } from "./store";
import { listGuiNodes, screens, updateScreen, type GuiNodeInfo } from "./screens-store";
import { GUI_MODAL, type ElementSpec, type ScreenSpec } from "../../gui/screens";
import { add, addModal, addPage, indent, move, movePage, newColumn, outdent, outline, placedWidgets, remove, removeModal, removePage, setProps, type Path, type Target } from "../../gui/screen-edit";

const props = defineProps<{ screenId: string }>();

const spec = computed<ScreenSpec>(() => screens.value[props.screenId] ?? { pages: [] });
const nodes = computed<GuiNodeInfo[]>(() => {
  screens.value; // re-list when the layout changes
  return listGuiNodes();
});
const nameOf = (id: string): string => nodes.value.find((n) => n.id === id)?.name ?? id;
const unplaced = computed(() => {
  const placed = new Set<string>();
  for (const s of Object.values(screens.value)) for (const id of placedWidgets(s)) placed.add(id);
  return nodes.value.filter((n) => n.type !== "thingstudio/gui_screen" && n.type !== GUI_MODAL && n.type !== "thingstudio/gui_navigator" && n.type !== "thingstudio/gui_touch" && !placed.has(n.id));
});
const unplacedModals = computed(() => {
  const have = new Set((spec.value.modals ?? []).map((m) => m.node));
  return nodes.value.filter((n) => n.type === GUI_MODAL && !have.has(n.id));
});

function edit(fn: (s: ScreenSpec) => ScreenSpec): void {
  updateScreen(props.screenId, fn);
}

const newPage = ref("");
function addPageNow(): void {
  const name = newPage.value.trim();
  if (!name) return;
  edit((s) => addPage(s, name));
  newPage.value = "";
}
const newModal = ref("");
function addModalNow(): void {
  if (!newModal.value) return;
  const id = newModal.value;
  edit((s) => addModal(s, id));
  newModal.value = "";
}

type Op = { op: "up" | "down" | "indent" | "outdent" | "remove"; target: Target; path: Path } | { op: "props"; target: Target; path: Path; props: Record<string, unknown> };
function onOp(o: Op): void {
  edit((s) => {
    switch (o.op) {
      case "up": return move(s, o.target, o.path, -1);
      case "down": return move(s, o.target, o.path, 1);
      case "indent": return indent(s, o.target, o.path);
      case "outdent": return outdent(s, o.target, o.path);
      case "remove": return remove(s, o.target, o.path);
      case "props": return setProps(s, o.target, o.path, o.props);
    }
  });
}

function onAdd(a: { target: Target; path: Path; element: ElementSpec }): void {
  edit((s) => add(s, a.target, a.element, a.path));
}

// ---- the rows of one tree --------------------------------------------------------------------------------

const KIND_LABEL: Record<string, string> = { row: "row →", column: "column ↓", text: "text", spacer: "spacer", pagedots: "page dots", widget: "widget" };

const TreeRows = defineComponent({
  props: {
    root: { type: Object as PropType<ElementSpec>, required: true },
    target: { type: Object as PropType<Target>, required: true },
    names: { type: Function as PropType<(id: string) => string>, required: true },
  },
  emits: ["op"],
  setup(p, { emit }) {
    const open = ref<Record<string, boolean>>({});
    return () =>
      h("div", { class: "rows" }, outline(p.root).map((r) => {
        const e = r.element as ElementSpec & Record<string, unknown>;
        const key = r.path.join(".");
        const label = e.kind === "widget" ? `${p.names(e.node as string)}` : e.kind === "text" ? `“${String(e.text)}”` : KIND_LABEL[e.kind] ?? e.kind;
        const btn = (txt: string, title: string, on: boolean, op: Op["op"]) =>
          h("button", { title, disabled: !on, onClick: () => emit("op", { op, target: p.target, path: r.path }) }, txt);
        const field = (name: string, k: string, width: number, numeric: boolean) =>
          h("label", { class: "f" }, [
            name,
            h("input", {
              class: "mini", style: { width: `${width}px` }, value: e[k] ?? "",
              onChange: (ev: Event) => {
                const v = (ev.target as HTMLInputElement).value.trim();
                emit("op", { op: "props", target: p.target, path: r.path, props: { [k]: numeric ? (v === "" ? undefined : Number(v)) : v } });
              },
            }),
          ]);
        const extras = [];
        if (e.kind === "widget" || e.kind === "text") extras.push(field("font", "font", 100, false));
        if (e.kind === "text") extras.push(field("text", "text", 100, false));
        extras.push(field("grow", "grow", 34, true));
        if (r.container) extras.push(field("gap", "gap", 34, true), field("padding", "padding", 34, true));
        return h("div", { class: "rowwrap" }, [
          h("div", { class: "row", style: { paddingLeft: `${r.depth * 14}px` } }, [
            h("span", { class: ["lbl", r.container ? "ctr" : ""] }, label),
            h("span", { class: "btns" }, [
              h("button", { title: "properties", class: open.value[key] ? "on" : "", onClick: () => (open.value = { ...open.value, [key]: !open.value[key] }) }, "⚙"),
              ...(r.path.length === 0 ? [] : [
                btn("↑", "earlier", r.canUp, "up"),
                btn("↓", "later", r.canDown, "down"),
                btn("⇥", "into the container above", r.canIndent, "indent"),
                btn("⇤", "out of its container", r.canOutdent, "outdent"),
                btn("✕", "remove from the page", true, "remove"),
              ]),
            ]),
          ]),
          open.value[key] ? h("div", { class: "extras", style: { paddingLeft: `${r.depth * 14 + 8}px` } }, extras) : null,
        ]);
      }));
  },
});

// ---- adding things ---------------------------------------------------------------------------------------

const AddBar = defineComponent({
  props: {
    target: { type: Object as PropType<Target>, required: true },
    unplaced: { type: Array as PropType<GuiNodeInfo[]>, required: true },
    nameOf: { type: Function as PropType<(id: string) => string>, required: true },
  },
  emits: ["add"],
  setup(p, { emit }) {
    const pick = ref("");
    const go = (element: ElementSpec) => emit("add", { target: p.target, path: [] as Path, element });
    return () =>
      h("div", { class: "addrow" }, [
        h("select", { value: pick.value, onChange: (ev: Event) => (pick.value = (ev.target as HTMLSelectElement).value) }, [
          h("option", { value: "" }, "add widget…"),
          ...p.unplaced.map((n) => h("option", { value: n.id }, n.name)),
        ]),
        h("button", { disabled: !pick.value, onClick: () => { go({ kind: "widget", node: pick.value }); pick.value = ""; } }, "add"),
        h("button", { title: "empty space that can grow", onClick: () => go({ kind: "spacer", grow: 1 }) }, "+ spacer"),
        h("button", { onClick: () => go({ kind: "text", text: "Text", font: "font_body16" }) }, "+ text"),
        h("button", { title: "a row or column to group widgets", onClick: () => go({ ...newColumn(), kind: "row", gap: 6, padding: 0 }) }, "+ row"),
        h("button", { onClick: () => go({ ...newColumn(), padding: 0 }) }, "+ column"),
        h("button", { onClick: () => go({ kind: "pagedots", alignSelf: "center" }) }, "+ dots"),
      ]);
  },
});
void bumpPropertyVersion;
</script>

<style>
.outline { margin-top: 8px; font-size: 12px; }
.outline h4 { margin: 10px 0 4px; }
.outline .target { border: 1px solid #444; border-radius: 4px; padding: 4px; margin-bottom: 8px; }
.outline .target-head { display: flex; align-items: center; justify-content: space-between; }
.outline .dim { opacity: 0.6; }
.outline .row { display: flex; align-items: center; gap: 4px; padding: 1px 0; justify-content: space-between; flex-wrap: nowrap; }
.outline .lbl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.outline .lbl.ctr { font-weight: 600; }
.outline .extras { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 3px; }
.outline .f { display: flex; align-items: center; gap: 3px; font-size: 11px; }
.outline .mini { padding: 0 2px; font-size: 11px; }
.outline .btns { display: flex; gap: 2px; flex: none; }
.outline .btns .on { background: #3f6e5c; }
.outline .btns button,.outline .addrow button,.outline .target-head button { padding: 0 5px !important; margin: 0 !important; height: 20px !important; min-width: 20px; line-height: 1; font-size: 11px !important; }
.outline .addrow select,.outline .addrow input { height: 22px; font-size: 11px; }
.outline .addrow { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
.outline .addrow input,.outline .addrow select { flex: 1; min-width: 80px; }
</style>
