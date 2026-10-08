# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/vendor/thingstudio_gui/gui.py -- on the board: thingstudio_gui.py (`import thingstudio_gui`)
#
# The device-side GUI subsystem (phase 4 of docs/working-notes/gui-layout-widget-system-scoping.md, "The
# device-side GUI subsystem and its two calls"). Thingstudio's own code, delivered as a flow dependency (only
# flows with a GUI carry it -- the Pico constraint), which is why it lives under vendor/.
#
# One GUI object owns: the value store (one value and state per widget, whatever display shows it), one or
# more surfaces (each a view: a display's framebuffer, or a remote view; with its rect tables, pages,
# navigation, modal queue and dirty widgets),
# and the render step. Widget nodes only call set_value(); nothing draws when a msg arrives. step() (run()
# calls it in a loop) derives stale, times out modals, redraws what's dirty on the visible page of each
# surface, and pushes the frame -- at most once per surface's min_interval_ms, so message rate is not frame
# rate.
#
# The editor compiles every table this takes (gui-layout's rects, page tree, modals); nothing is laid out
# here. Locked-in rules this follows: tables per surface; values keyed by widget id, never by placement;
# navigation state per surface; set_value takes no display; pages and modals named, not indexed; widget
# draw routines reached through a lookup (the `draw` callable registered per widget), never assuming a
# full-frame RGB565 buffer.
#
# Faults: a draw routine that raises is reported against its widget (NODE_ERROR through `on_error`), its rect
# is crossed out, and every other widget and surface carries on. Unknown widget ids, pages, modals and
# navigation commands raise ValueError naming them, which generated code turns into NODE_ERROR.

try:
    import time

    _ticks_ms = time.ticks_ms
    _ticks_diff = time.ticks_diff
except AttributeError:  # CPython, for host tooling only
    import time

    def _ticks_ms():
        return int(time.monotonic() * 1000)

    def _ticks_diff(a, b):
        return a - b


UNKNOWN = 0
KNOWN = 1
STALE = 2
STATE_NAMES = ("unknown", "known", "stale")

try:
    import framebuf

    # Foreground, dimmed (stale) and background colours per frame format, and whether dim is a real shade
    # (False on mono: stale is shown by a pattern instead). Widgets read them from their surface.
    _STYLE = {
        framebuf.MONO_VLSB: (1, 1, 0, False),
        framebuf.MONO_HLSB: (1, 1, 0, False),
        framebuf.MONO_HMSB: (1, 1, 0, False),
        framebuf.GS2_HMSB: (3, 1, 0, True),
        framebuf.GS4_HMSB: (15, 6, 0, True),
        framebuf.GS8: (255, 100, 0, True),
        framebuf.RGB565: (0xFFFF, 0x632C, 0, True),
    }
except ImportError:  # host tooling
    framebuf = None
    _STYLE = {}

try:
    from uctypes import addressof, bytearray_at
except ImportError:
    bytearray_at = None

NAV_COMMANDS = ("next", "prev", "back", "home")
CLOSE_REASONS = ("ack", "timeout", "closed")


class _Widget:
    __slots__ = ("id", "draw", "stale_after_ms", "value", "state", "at", "placements")

    def __init__(self, wid, draw, stale_after_ms):
        self.id = wid
        self.draw = draw
        self.stale_after_ms = stale_after_ms
        self.value = None
        self.state = UNKNOWN
        self.at = 0
        self.placements = []  # (surface, page or modal name, rect)


class Surface:
    """One view of the model: a display, or a remote view. Holds what every view has -- its page tree,
    navigation state, modal queue and dirty widgets. Subclasses say how a change reaches the viewer:
    FrameSurface draws into a framebuffer and pushes it to a panel; RemoteSurface sends the changes as
    messages (a browser, phone or the editor's live preview draws them).
    `pages`: {page: {"parent": name or None, "widgets": [(widget_id, (x, y, w, h)), ...]}}.
    `carousel`: top-level page names in order. `modals`: {name: {"widgets": [...], "priority": n,
    "timeout_ms": n or 0}}."""

    def __init__(self, name, pages, carousel, modals=None, wrap=True, min_interval_ms=100):
        if not carousel:
            raise ValueError("display %s has no pages" % name)
        for p in carousel:
            if p not in pages:
                raise ValueError("display %s: carousel page %r isn't in its pages" % (name, p))
        for p, spec in pages.items():
            parent = spec.get("parent")
            if parent is not None and parent not in pages:
                raise ValueError("display %s: page %r has unknown parent %r" % (name, p, parent))
        self.name = name
        self.pages = pages
        self.carousel = list(carousel)
        self.modals = modals or {}
        self.wrap = wrap
        self.min_interval_ms = min_interval_ms
        self.page = self.carousel[0]
        self.queue = []  # waiting modals, highest priority first: [name, payload, priority, shown_at]
        self.modal = None  # the visible modal, same shape, or None
        self.dirty = set()
        self.full = True  # everything on the visible page/modal needs (re)sending or (re)drawing
        self.last_push = None
        self.on_page = None  # callback(page_name): the navigator's output
        self.pushes = 0

    def visible(self):
        """Name of the page or modal on screen."""
        return self.modal[0] if self.modal else self.page

    def visible_widgets(self):
        spec = self.modals[self.modal[0]] if self.modal else self.pages[self.page]
        return spec["widgets"]

    def page_info(self):
        """(index, count) of the top-level page shown or drilled into, for a page indicator."""
        top = self.page
        while self.pages[top].get("parent") is not None:
            top = self.pages[top]["parent"]
        return (self.carousel.index(top), len(self.carousel)) if top in self.carousel else (0, len(self.carousel))

    def queued(self):
        """How many modals wait behind the visible one ("+N more")."""
        return len(self.queue)

    def render(self, gui):
        """Brings the viewer up to date with what's dirty. Called by GUI.step(), rate-limited."""
        raise NotImplementedError


class FrameSurface(Surface):
    """A physical display. `fb` is a framebuf.FrameBuffer in the panel's own format; `push(fb)` sends the
    frame to it. `background` is the fill colour for cleared areas, in that format."""

    def __init__(self, name, fb, push, pages, carousel, modals=None, wrap=True, min_interval_ms=100, fmt=None, colours=None):
        Surface.__init__(self, name, pages, carousel, modals, wrap, min_interval_ms)
        self.fb = fb
        self.push = push
        style = _STYLE.get(fmt, (1, 1, 0, False))
        self.fg, self.dim, self.background, self.shades = colours + (True,) if colours else style
        self.fmt = fmt if fmt is not None else (framebuf.MONO_HLSB if framebuf else 0)
        # A two-pixel palette in the frame's own format: glyph bit 0 -> [0], 1 -> [1] (nano-gui's BoolPalette).
        self._palette = framebuf.FrameBuffer(bytearray(4), 2, 1, self.fmt) if framebuf else None

    # -- drawing helpers for widgets ------------------------------------------------------------------------

    def text(self, font, s, x, y, colour, right=None):
        """Draws `s` in `font` (a font_to_py module) with its top-left at x, y. Stops before a glyph that would
        cross `right` (exclusive; default: the frame's edge), so text never paints over a neighbour. Returns
        the x after the last glyph drawn. The editor measured the same widths (font-metrics.ts)."""
        fb = self.fb
        pal = self._palette
        pal.pixel(0, 0, self.background)
        pal.pixel(1, 0, colour)
        limit = right if right is not None else 1 << 15
        for ch in s:
            glyph, h, w = font.get_ch(ch)
            if x + w > limit:
                break
            buf = bytearray_at(addressof(glyph), len(glyph)) if bytearray_at else bytearray(glyph)
            fb.blit(framebuf.FrameBuffer(buf, w, h, framebuf.MONO_HLSB), x, y, -1, pal)
            x += w
        return x

    def stale_mark(self, x, y, w):
        """A dotted line: how stale shows where there's no dimmed shade (mono)."""
        for i in range(x, x + w, 2):
            self.fb.pixel(i, y, self.fg)

    def colour_for(self, state):
        """The colour to draw a value in: dim when stale (if the format has shades)."""
        return self.dim if state == STALE and self.shades else self.fg

    def render(self, gui):
        fb = self.fb
        widgets = self.visible_widgets()
        if self.full:
            fb.fill(self.background)
            todo = widgets
        else:
            todo = [(wid, rect) for wid, rect in widgets if wid in self.dirty]
        for wid, rect in todo:
            if not self.full:
                fb.fill_rect(rect[0], rect[1], rect[2], rect[3], self.background)
            self._draw_widget(gui, wid, rect)
        self.push(fb)

    def _draw_widget(self, gui, wid, rect):
        fb = self.fb
        w = gui.widgets[wid]
        x, y, rw, rh = rect
        try:
            w.draw(self, rect, w.value, w.state)
        except Exception as e:  # noqa: BLE001 -- one widget's bug must not blank the screen
            fb.fill_rect(x, y, rw, rh, self.background)
            fb.rect(x, y, rw, rh, self.fg)
            fb.line(x, y, x + rw - 1, y + rh - 1, self.fg)
            fb.line(x, y + rh - 1, x + rw - 1, y, self.fg)
            gui._error(wid, e)


if framebuf is not None:

    class _Band(framebuf.FrameBuffer):
        """A framebuffer holding `rows` rows of a taller screen, starting at row `y0`. Drawing calls take screen
        coordinates and land in the band; anything outside it is clipped by framebuf as usual. (The nano-gui
        spike's band.py; a FrameBuffer subclass must call super(), not FrameBuffer.method(self, ...).)"""

        def __init__(self, buf, width, rows, fmt):
            super().__init__(buf, width, rows, fmt)
            self.y0 = 0

        def pixel(self, x, y, c=None):
            if c is None:
                return super().pixel(x, y - self.y0)
            super().pixel(x, y - self.y0, c)

        def fill_rect(self, x, y, w, h, c):
            super().fill_rect(x, y - self.y0, w, h, c)

        def rect(self, x, y, w, h, c, f=False):
            super().rect(x, y - self.y0, w, h, c, f)

        def hline(self, x, y, w, c):
            super().hline(x, y - self.y0, w, c)

        def vline(self, x, y, h, c):
            super().vline(x, y - self.y0, h, c)

        def line(self, x1, y1, x2, y2, c):
            super().line(x1, y1 - self.y0, x2, y2 - self.y0, c)

        def ellipse(self, x, y, xr, yr, c, f=False, m=15):
            super().ellipse(x, y - self.y0, xr, yr, c, f, m)

        def blit(self, src, x, y, key=-1, palette=None):
            super().blit(src, x, y - self.y0, key, palette)


class BandSurface(FrameSurface):
    """A display drawn in horizontal strips (gui-layout-widget-system-scoping.md, "banded rendering"): only one
    strip of `band_rows` rows is ever in RAM, so a 240x320 gs4 screen needs 4.8 KB instead of a 38.4 KB frame
    that a classic ESP32's fragmented heap often can't give (CYD, 2026-10-08: MemoryError allocating 38400).
    The screen node's coroutine awaits next_band(), which draws the next strip that needs it and returns
    (y, rows); the strip's bytes are band_buf[:rows * stride]. A strip is redrawn whole (every widget crossing
    it), because the display shows exactly what's sent. GUI.step() doesn't render these; it still runs stale
    timers and modal timeouts for them."""

    banded = True

    def __init__(self, name, width, height, fmt, pages, carousel, modals=None, wrap=True, min_interval_ms=100,
                 band_rows=40, stride=None, colours=None):
        self.width = width
        self.height = height
        self.band_rows = max(1, min(band_rows, height))
        self.stride = stride
        self.band_buf = bytearray(stride * self.band_rows)
        fb = _Band(self.band_buf, width, self.band_rows, fmt)
        FrameSurface.__init__(self, name, fb, None, pages, carousel, modals, wrap, min_interval_ms, fmt, colours)
        self.gui = None
        self._todo = []

    def _bands_for(self, rects):
        out = set()
        for x, y, w, h in rects:
            first = max(0, y) // self.band_rows
            last = min(self.height - 1, y + h - 1) // self.band_rows
            for b in range(first, last + 1):
                out.add(b)
        return sorted(out)

    def _draw_band(self, y0, rows):
        fb = self.fb
        fb.y0 = y0
        fb.fill(self.background)
        for wid, rect in self.visible_widgets():
            if rect[1] < y0 + rows and rect[1] + rect[3] > y0:
                self._draw_widget(self.gui, wid, rect)

    async def next_band(self, tick_ms=20):
        """Waits until a strip needs sending, draws it, and returns (y, rows)."""
        try:
            import asyncio
        except ImportError:
            import uasyncio as asyncio
        while True:
            if self._todo:
                b = self._todo.pop(0)
                y0 = b * self.band_rows
                rows = min(self.band_rows, self.height - y0)
                try:
                    self._draw_band(y0, rows)
                except Exception as e:  # noqa: BLE001 -- keep the screen going
                    if self.gui is not None:
                        self.gui._error("display " + self.name, e)
                return y0, rows
            now = _ticks_ms()
            if (self.full or self.dirty) and (self.last_push is None or _ticks_diff(now, self.last_push) >= self.min_interval_ms):
                if self.full:
                    self._todo = list(range((self.height + self.band_rows - 1) // self.band_rows))
                else:
                    self._todo = self._bands_for([r for wid, r in self.visible_widgets() if wid in self.dirty])
                self.full = False
                self.dirty = set()
                self.last_push = now
                self.pushes += 1
                continue
            await asyncio.sleep_ms(tick_ms)


class RemoteSurface(Surface):
    """A view drawn somewhere else (gui-layout-widget-system-scoping.md, "Remote views"): no framebuffer on
    the board, so a board with no display can still have a GUI. `send(msg)` gets plain dicts:
      {"type": "screen", "display", "page", "modal", "modalPayload", "queued", "values": {id: [value, state]}}
        when the page or modal changes (everything the viewer needs to redraw);
      {"type": "values", "display", "values": {id: [value, state]}} for dirty widgets on the visible page.
    States are STATE_NAMES strings. The transport (MQTT, the editor connection) is the caller's."""

    def __init__(self, name, send, pages, carousel, modals=None, wrap=True, min_interval_ms=100):
        Surface.__init__(self, name, pages, carousel, modals, wrap, min_interval_ms)
        self.send = send

    def render(self, gui):
        widgets = self.visible_widgets()
        ids = [wid for wid, _r in widgets] if self.full else [wid for wid, _r in widgets if wid in self.dirty]
        values = {}
        for wid in ids:
            w = gui.widgets[wid]
            values[wid] = [w.value, STATE_NAMES[w.state]]
        if self.full:
            self.send({
                "type": "screen", "display": self.name, "page": self.page,
                "modal": self.modal[0] if self.modal else None,
                "modalPayload": self.modal[1] if self.modal else None,
                "queued": len(self.queue), "values": values,
            })
        else:
            self.send({"type": "values", "display": self.name, "values": values})


class GUI:
    def __init__(self, on_error=None):
        self.widgets = {}
        self.surfaces = {}
        self.on_error = on_error
        self.on_modal_close = None  # callback(surface_name, modal_name, reason)
        # callback(widget_id, value, state_name) on every value or state change, on or off screen: a feed of
        # the whole model for a remote view that does its own paging (e.g. one retained MQTT topic per widget).
        self.on_value = None

    # -- setup, from generated code ---------------------------------------------------------------------

    def widget(self, wid, draw, stale_after_ms=0):
        """Registers widget `wid`. draw(surface, rect, value, state) paints it inside rect=(x, y, w, h) on
        surface.fb, using the surface's helpers and colours (text(), colour_for(), fg/dim/background).
        stale_after_ms 0: never stale."""
        self.widgets[wid] = _Widget(wid, draw, stale_after_ms)

    def add_surface(self, surface):
        if surface.name in self.surfaces:
            raise ValueError("display %s added twice" % surface.name)
        for kind, table in (("page", surface.pages), ("modal", surface.modals)):
            for pname, spec in table.items():
                for wid, rect in spec["widgets"]:
                    w = self.widgets.get(wid)
                    if w is None:
                        raise ValueError("%s %r on display %s places unknown widget %r" % (kind, pname, surface.name, wid))
                    w.placements.append((surface, pname, rect))
        self.surfaces[surface.name] = surface
        surface.gui = self
        return surface

    # -- model: values ----------------------------------------------------------------------------------

    def set_value(self, wid, value, now=None):
        """Stores `value` for widget `wid` (None: unknown) and marks it dirty wherever it's on screen. Never
        draws."""
        w = self.widgets.get(wid)
        if w is None:
            raise ValueError("unknown widget %r" % (wid,))
        w.value = value
        w.state = UNKNOWN if value is None else KNOWN
        w.at = _ticks_ms() if now is None else now
        self._mark(w)
        self._notify(w)

    def state(self, wid):
        return self.widgets[wid].state

    def value(self, wid):
        return self.widgets[wid].value

    def _notify(self, w):
        if self.on_value is not None:
            try:
                self.on_value(w.id, w.value, STATE_NAMES[w.state])
            except Exception as e:  # noqa: BLE001 -- a broken feed must not break set_value
                self._error(w.id, e)

    def _mark(self, w):
        for s, pname, _rect in w.placements:
            if s.visible() == pname:
                s.dirty.add(w.id)

    # -- model: navigation ------------------------------------------------------------------------------

    def navigate(self, surface_name, command):
        """`next`, `prev`, `back`, `home`, or a page name. Returns the page or modal shown afterwards."""
        s = self._surface(surface_name)
        if s.modal is not None:
            # Under a modal: back acknowledges it; next/prev do nothing; home or a page name changes the page
            # underneath, shown when the modal closes.
            if command == "back":
                self._close_visible(s, "ack")
            elif command == "home":
                self._show_page(s, s.carousel[0])
            elif command in s.pages:
                self._show_page(s, command)
            elif command not in ("next", "prev"):
                raise ValueError("unknown navigation command or page %r for display %s" % (command, s.name))
            return s.visible()
        if command in ("next", "prev"):
            top = s.page
            while s.pages[top].get("parent") is not None:
                top = s.pages[top]["parent"]
            i = s.carousel.index(top) if top in s.carousel else 0
            j = i + (1 if command == "next" else -1)
            if s.wrap:
                j %= len(s.carousel)
            else:
                j = max(0, min(len(s.carousel) - 1, j))
            target = s.carousel[j]
        elif command == "back":
            target = s.pages[s.page].get("parent") or s.page
        elif command == "home":
            target = s.carousel[0]
        elif command in s.pages:
            target = command
        else:
            raise ValueError("unknown navigation command or page %r for display %s" % (command, s.name))
        self._show_page(s, target)
        return s.page

    def _show_page(self, s, target):
        if target == s.page:
            return
        s.page = target
        s.full = True
        if s.on_page is not None:
            s.on_page(target)

    # -- model: modals ----------------------------------------------------------------------------------

    def open_modal(self, surface_name, modal, payload, now=None):
        """Opens modal `modal` with `payload` (its content); payload None closes it ('closed') wherever it is,
        on screen or queued. One visible per display; a higher priority takes the screen and the interrupted
        one goes back to the queue. Nothing is dropped."""
        s = self._surface(surface_name)
        spec = s.modals.get(modal)
        if spec is None:
            raise ValueError("unknown modal %r on display %s" % (modal, s.name))
        now = _ticks_ms() if now is None else now
        if payload is None:
            if s.modal is not None and s.modal[0] == modal:
                self._close_visible(s, "closed", now)
            else:
                before = len(s.queue)
                s.queue = [q for q in s.queue if q[0] != modal]
                if len(s.queue) != before:
                    self._report_close(s, modal, "closed")
                    s.full = True  # "+N more" changed
            return
        entry = [modal, payload, spec.get("priority", 0), now]
        if s.modal is not None and s.modal[0] == modal:
            s.modal[1] = payload  # update content in place
            s.full = True
            return
        for q in s.queue:
            if q[0] == modal:
                q[1] = payload
                s.full = True
                return
        if s.modal is None:
            s.modal = entry
        elif entry[2] > s.modal[2]:
            s.queue.insert(0, s.modal)
            s.modal = entry
        else:
            s.queue.append(entry)
            s.queue.sort(key=lambda q: -q[2])  # stable: same priority keeps arrival order
        s.full = True

    def modal_payload(self, surface_name):
        s = self._surface(surface_name)
        return s.modal[1] if s.modal else None

    def _close_visible(self, s, reason, now=None):
        name = s.modal[0]
        s.modal = None
        if s.queue:
            s.modal = s.queue.pop(0)
            s.modal[3] = _ticks_ms() if now is None else now  # its timeout runs from when it's shown
        s.full = True
        self._report_close(s, name, reason)

    def _report_close(self, s, name, reason):
        if self.on_modal_close is not None:
            self.on_modal_close(s.name, name, reason)

    def _surface(self, name):
        s = self.surfaces.get(name)
        if s is None:
            raise ValueError("unknown display %r" % (name,))
        return s

    # -- view: the render step --------------------------------------------------------------------------

    def step(self, now=None):
        """One pass: stale timers, modal timeouts, redraw and push what's due. Returns the number of frames
        pushed."""
        now = _ticks_ms() if now is None else now
        for w in self.widgets.values():
            if w.state == KNOWN and w.stale_after_ms and _ticks_diff(now, w.at) >= w.stale_after_ms:
                w.state = STALE
                self._mark(w)
                self._notify(w)
        pushed = 0
        for s in self.surfaces.values():
            if s.modal is not None:
                timeout = s.modals[s.modal[0]].get("timeout_ms", 0)
                if timeout and _ticks_diff(now, s.modal[3]) >= timeout:
                    self._close_visible(s, "timeout", now)
            if getattr(s, "banded", False) or not (s.full or s.dirty):
                continue  # a banded surface is drawn by its screen's own coroutine (BandSurface.next_band)
            if s.last_push is not None and _ticks_diff(now, s.last_push) < s.min_interval_ms:
                continue
            try:
                s.render(self)
            except Exception as e:  # noqa: BLE001 -- a failing panel or link must not stop the other surfaces
                self._error("display " + s.name, e)
            s.dirty = set()
            s.full = False
            s.last_push = now
            s.pushes += 1
            pushed += 1
        return pushed

    def _error(self, who, exc):
        if self.on_error is not None:
            try:
                self.on_error(who, exc)
                return
            except Exception:  # noqa: BLE001
                pass
        print("GUI_ERROR %s %r" % (who, exc))

    async def run(self, tick_ms=50):
        """The render loop: step() every tick_ms, for the life of the flow."""
        try:
            import asyncio
        except ImportError:
            import uasyncio as asyncio
        sleep_ms = getattr(asyncio, "sleep_ms", None)
        while True:
            self.step()
            if sleep_ms is not None:
                await sleep_ms(tick_ms)
            else:
                await asyncio.sleep(tick_ms / 1000)
