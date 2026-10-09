# Unix-port freeze manifest for the spike. make_mods.sh fills mods/ from device-runtime/src/vendor. Relative
# paths in a manifest are relative to the manifest's own directory.
include("$(PORT_DIR)/variants/standard/manifest.py")
freeze("mods")
