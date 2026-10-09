import sys
mode = sys.argv[1]
if mode == "append":
    sys.path.append((__file__.rsplit("/", 1)[0] if "/" in __file__ else ".") + "/lib")    # what deps.ensure_on_path() does
else:
    sys.path.insert(0, (__file__.rsplit("/", 1)[0] if "/" in __file__ else ".") + "/lib")
print(mode, sys.path)
import font_body16
print("loaded:", getattr(font_body16, "MARK", "frozen copy"))
