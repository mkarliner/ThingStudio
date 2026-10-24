<!--
  editor/src/app/rete/ScreenOutline.vue

  The layout editor for a gui screen node: each page (and modal) is a list of elements placed on the screen's
  cell grid (gui-grid-layout-scoping.md, 2026-10-24). Row/column are 0-based cells; spans default to 1. A panel
  is an element with `card` ticked, drawn behind whatever shares its cells. Edits go through gui/screen-edit.ts
  into screens-store.ts; whether the result fits is decided at Deploy (and shown below the outline when the
  layout is compiled). Not a visual grid yet -- that is the next step -- but every value is a cell, not a pixel.
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
      <ElementRows :elements="page.elements" :target="{ page: page.name }" :names="nameOf" :unplaced="widgetsFor(page.elements)" @op="onOp" @add="onAdd" />
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
        <ElementRows :elements="m.elements" :target="{ modal: m.node }" :names="nameOf" :unplaced="widgetsFor(m.elements)" @op="onOp" @add="onAdd" />
      </div>
      <div v-if="unplacedModals.length" class="addrow">
        <select v-model="newModal" @change="addModalNow">
          <option value="">lay out a modal…</option>
          <option v-for="n in unplacedModals" :key="n.id" :value="n.id">{{ n.name }}</option>
        </select>
      </div>
    </template>

    <p class="hint">Rows and columns are cells of the screen's grid (0-based); spans default to 1. Tick <em>panel</em> to draw a card behind the cells.</p>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, ref, type PropType } from "vue";
import { bumpPropertyVersion } from "./store";
import { listGuiNodes, screens, updateScreen, type GuiNodeInfo } from "./screens-store";
import { GUI_MODAL, type GridElement, type ScreenSpec } from "../../gui/screens";
import { add, addModal, addPage, move, movePage, remove, removeModal, removePage, setProps, type OutlineRow, type Target } from "../../gui/screen-edit";

const props = defineProps<{ screenId: string }>();

const spec = computed<ScreenSpec>(() => screens.value[props.screenId] ?? { pages: [] });

const newPage = ref("");
const newModal = ref("");

function edit(fn: (s: ScreenSpec) => ScreenSpec): void {
  const next = fn(spec.value);
  if (next !== spec.value) {
    updateScreen(props.screenId, next);
    bumpPropertyVersion();
  }
}

function addPageNow(): void {
  const name = newPage.value.trim();
  if (!name) return;
  edit((s) => addPage(s, name));
  newPage.value = "";
}

function addModalNow(): void {
  const node = newModal.value;
  if (!node) return;
  edit((s) => addModal(s, node));
  newModal.value = "";
}

const guiNodes = computed<GuiNodeInfo[]>(() => listGuiNodes());
function nameOf(id: string): string {
  return guiNodes.value.find((n) => n.id === id)?.name ?? id.slice(0, 6);
}
function widgetsFor(elements: readonly GridElement[]): GuiNodeInfo[] {
  const here = new Set(elements.filter((e) => !e.card && e.node).map((e) => e.node!));
  return guiNodes.value.filter((n) => n.kind === "widget" && !here.has(n.id));
}
const unplacedModals = computed<GuiNodeInfo[]>(() => {
  const here = new Set((spec.value.modals ?? []).map((m) => m.node));
  return guiNodes.value.filter((n) => n.kind === "modal" && !here.has(n.id));
});

function onOp(o: { op: "up" | "down" | "remove" | "props"; target: Target; index: number; props?: Record<string, unknown> }): void {
  edit((s) => {
    switch (o.op) {
      case "up": return move(s, o.target, o.index, -1);
      case "down": return move(s, o.target, o.index, 1);
      case "remove": return remove(s, o.target, o.index);
      case "props": return setProps(s, o.target, o.index, o.props ?? {});
    }
  });
}

function onAdd(a: { target: Target; element: GridElement }): void {
  edit((s) => add(s, a.target, a.element));
}

const ElementRows = defineComponent({
  props: {
    elements: { type: Array as PropType<readonly GridElement[]>, required: true },
    target: { type: Object as PropType<Target>, required: true },
    names: { type: Function as PropType<(id: string) => string>, required: true },
    unplaced: { type: Array as PropType<GuiNodeInfo[]>, required: true },
  },
  emits: ["op", "add"],
  setup(p, { emit }) {
    const open = ref<Record<number, boolean>>({});
    return () => {
      const rows: OutlineRow[] = p.elements.map((element, index) => ({
        index,
        element,
        canUp: index > 0,
        canDown: index < p.elements.length - 1,
        label: element.card
          ? "panel"
          : element.kind === "text"
            ? `“${element.text ?? ""}”`
            : element.kind === "pagedots"
              ? "page dots"
              : p.names(element.node ?? ""),
      }));
      return h("div", { class: "rows" }, rows.map((r) => {
        const e = r.element;
        const field = (name: string, k: keyof GridElement, width: number, numeric: boolean) =>
          h("label", { class: "f" }, [
            name,
            h("input", {
              class: "mini", style: { width: `${width}px` }, value: e[k] ?? "",
              onChange: (ev: Event) => {
                const v = (ev.target as HTMLInputElement).value.trim();
                emit("op", { op: "props", target: p.target, index: r.index, props: { [k]: numeric ? (v === "" ? undefined : Number(v)) : v } });
              },
            }),
          ]);
        const extras = [
          field("row", "row", 34, true),
          field("col", "col", 34, true),
          field("rows", "rowSpan", 34, true),
          field("cols", "colSpan", 34, true),
        ];
        extras.push(h("label", { class: "f", title: "draw a card behind these cells" }, [
          "panel",
          h("input", {
            type: "checkbox",
            checked: e.card === true,
            onChange: (ev: Event) => emit("op", { op: "props", target: p.target, index: r.index, props: { card: (ev.target as HTMLInputElement).checked ? true : undefined } }),
          }),
        ]));
        if (e.kind === "text") {
          extras.push(field("text", "text", 110, false));
          extras.push(h("label", { class: "f" }, [
            "align",
            h("select", {
              class: "mini",
              onChange: (ev: Event) => emit("op", { op: "props", target: p.target, index: r.index, props: { align: (ev.target as HTMLSelectElement).value || undefined } }),
            }, ["left", "center", "right"].map((a) => h("option", { value: a, selected: (e.align ?? "left") === a }, a))),
          ]));
        }
        const btn = (txt: string, title: string, on: boolean, op: "up" | "down" | "remove") =>
          h("button", { title, disabled: !on, onClick: () => emit("op", { op, target: p.target, index: r.index }) }, txt);
        const addInto = () => {
          const go = (element: GridElement) => emit("add", { target: p.target, element });
          const choices: Record<string, () => GridElement> = {
            "@text": () => ({ kind: "text", text: "Text", row: 0, col: 0 }),
            "@dots": () => ({ kind: "pagedots", row: 0, col: 0, colSpan: 2, align: "center" }),
            "@panel": () => ({ card: true, row: 0, col: 0, rowSpan: 1, colSpan: 2 }),
          };
          return h("select", {
            class: "addsel", title: "add to this page", value: "",
            onChange: (ev: Event) => {
              const sel = ev.target as HTMLSelectElement;
              const v = sel.value;
              sel.value = "";
              if (!v) return;
              go(v.startsWith("@") ? choices[v]!() : { kind: "widget", node: v, row: 0, col: 0 });
            },
          }, [
            h("option", { value: "" }, "+ add…"),
            ...(p.unplaced.length ? [h("optgroup", { label: "widgets" }, p.unplaced.map((n) => h("option", { value: n.id }, n.name)))] : []),
            h("optgroup", { label: "other" }, [
              h("option", { value: "@text" }, "text"), h("option", { value: "@dots" }, "page dots"), h("option", { value: "@panel" }, "panel"),
            ]),
          ]);
        };
        return h("div", { class: "rowwrap" }, [
          h("div", { class: "row" }, [
            h("span", { class: "lbl" }, r.label),
            h("span", { class: "btns" }, [
              addInto(),
              h("button", { title: "placement", class: open.value[r.index] ? "on" : "", onClick: () => (open.value = { ...open.value, [r.index]: !open.value[r.index] }) }, "⚙"),
              btn("↑", "earlier in the list", r.canUp, "up"),
              btn("↓", "later in the list", r.canDown, "down"),
              btn("✕", "remove", true, "remove"),
            ]),
          ]),
          open.value[r.index] ? h("div", { class: "extras", style: { paddingLeft: "8px" } }, extras) : null,
        ]);
      }));
    };
  },
});
</script>

<style scoped>
.outline h4 { margin: 8px 0 4px; font-size: 12px; }
.outline .target { border: 1px solid #444; border-radius: 4px; padding: 4px; margin-bottom: 8px; }
.target-head { display: flex; align-items: center; justify-content: space-between; gap: 4px; margin-bottom: 3px; }
.outline .dim { opacity: 0.6; font-size: 11px; }
.outline .row { display: flex; align-items: center; gap: 4px; padding: 1px 0; justify-content: space-between; flex-wrap: nowrap; }
.outline .lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.outline .extras { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 3px; }
.outline .f { display: flex; align-items: center; gap: 3px; font-size: 11px; }
.outline .mini { padding: 0 2px; font-size: 11px; }
.outline .btns { display: flex; gap: 2px; flex: none; }
.outline .btns button,.outline .addrow button,.target-head button { padding: 0 5px !important; margin: 0 !important; height: 20px !important; min-width: 20px; line-height: 1; font-size: 11px !important; }
.outline .addrow { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
.outline .hint { font-size: 11px; opacity: 0.7; }
</style>
