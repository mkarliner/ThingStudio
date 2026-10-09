import gc, sys
sys.path.append((__file__.rsplit("/", 1)[0] if "/" in __file__ else ".") + "/stubs")
if len(sys.argv) > 1:
    sys.path.insert(0, sys.argv[1])
mods = ["mqtt_as", "thingstudio_gui", "tsgui_readout", "font_body16", "font_digits48", "font_digits64"]
total = 0
for m in mods:
    gc.collect(); before = gc.mem_alloc()
    mod = __import__(m)
    gc.collect(); after = gc.mem_alloc()
    total += after - before
    print("%-16s %6d  %s" % (m, after - before, getattr(mod, "__file__", "frozen?")))
print("total            %6d" % total)
