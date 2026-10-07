import gc, sys
for name in ('digits32', 'digits48', 'body10', 'body16', 'body20', 'full48'):
    gc.collect(); a = gc.mem_free()
    m = __import__(name)
    gc.collect(); b = gc.mem_free()
    print('%-9s %6d bytes RAM' % (name, a - b))
    del sys.modules[name]; del m
