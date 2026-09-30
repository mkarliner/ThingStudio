// SPDX-License-Identifier: Apache-2.0
// editor/src/app/menus.ts
//
// The toolbar's File / Tools / Help menus (2026-09-30, Mike's "top menu streamline"). Only opening and
// closing lives here: the items are the same buttons, with the same ids, main.ts has always driven, so
// their handlers and their hidden/disabled rules are unchanged. No library -- plain buttons and the
// [hidden] attribute (index.html's `.menu` markup).
//
// Behaviour: click the menu button to open or close; one menu open at a time; a click outside, Escape, or
// choosing an item closes it (Escape returns focus to the menu button). Up/Down move between the items
// that are shown and enabled; Down on a closed menu button opens it at the first item. A select inside a
// menu (Tools -> Native code) keeps the menu open while it's used.

const ITEM_SELECTOR = "button, a, select";

function items(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter(
    (el) => !el.hidden && !(el as HTMLButtonElement).disabled && el.closest("[hidden]") === null,
  );
}

export function setupMenus(root: ParentNode = document): void {
  const menus = Array.from(root.querySelectorAll<HTMLElement>(".menu"));
  const parts = menus
    .map((menu) => ({
      menu,
      button: menu.querySelector<HTMLButtonElement>(":scope > .menu-button"),
      list: menu.querySelector<HTMLElement>(":scope > .menu-list"),
    }))
    .filter((p): p is { menu: HTMLElement; button: HTMLButtonElement; list: HTMLElement } => !!p.button && !!p.list);

  function close(p: (typeof parts)[number], focusButton = false): void {
    if (p.list.hidden) return;
    p.list.hidden = true;
    p.button.setAttribute("aria-expanded", "false");
    if (focusButton) p.button.focus();
  }
  function closeAll(except?: (typeof parts)[number]): void {
    for (const p of parts) if (p !== except) close(p);
  }
  function open(p: (typeof parts)[number], focusFirst = false): void {
    closeAll(p);
    p.list.hidden = false;
    p.button.setAttribute("aria-expanded", "true");
    if (focusFirst) items(p.list)[0]?.focus();
  }

  for (const p of parts) {
    p.button.addEventListener("click", () => (p.list.hidden ? open(p) : close(p)));
    p.button.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        open(p, true);
      }
    });
    p.list.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(p, true);
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if ((e.target as HTMLElement).tagName === "SELECT") return; // the select's own arrows change its value
      e.preventDefault();
      const all = items(p.list);
      const at = all.indexOf(document.activeElement as HTMLElement);
      const next = e.key === "ArrowDown" ? (at + 1) % all.length : (at - 1 + all.length) % all.length;
      all[next]?.focus();
    });
    // Choosing an item closes the menu; its own click handler (main.ts) has already run by then, since
    // this listener is on the list and the event reaches the item first.
    p.list.addEventListener("click", (e) => {
      const item = (e.target as HTMLElement).closest("button, a");
      if (item && p.list.contains(item)) close(p);
    });
  }

  document.addEventListener("click", (e) => {
    const inMenu = (e.target as HTMLElement | null)?.closest?.(".menu");
    closeAll(parts.find((p) => p.menu === inMenu));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAll();
  });
}
