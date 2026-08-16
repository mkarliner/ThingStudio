
the following points and questions are for discussion around the scope of the MVP or the next prototype...

# Security 
- do we need a password for access to the board transport? I'm aware of how insecure iot devices are. I think we should at least basic security for the board from day 1

# Nodes - to be prioritised
   - Interrupt / pin change
   - ADC
   - debounce
   - http in/out
   - filter / event compression
   - udp / tcp
   - mdns
   - file ops
   - i2c actual operation - what happens with stuck devices?

# Documentation
- Basic user docs
- Developer guide (how to make new node types)
- Anything else ?


# CI
- should we use a CI that's independent of Github (add to claud a note about vendor neutral where possible)

# App Platform
node-red has a backend serving up the editor web pages, not a cross platform, GUI app as Electron or Tauri give you. Which do we want? A back end could be written in Python which might ease the pain of cross platform issues.



