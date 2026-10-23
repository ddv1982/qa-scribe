import ctypes as c
import os
from pathlib import Path
import subprocess

from importlib.util import module_from_spec, spec_from_file_location
spec = spec_from_file_location('native_close', Path(__file__).with_name('native-close.py'))
module = module_from_spec(spec)
spec.loader.exec_module(module)
assert Path(os.environ['XAUTHORITY']).parent.name.startswith('xvfb-run.')
ids = subprocess.check_output(['xdotool', 'search', '--onlyvisible', '--name', '^QA Scribe E2E( \\(dev\\))?$'], text=True).split()
assert len(ids) == 1, ids
window = int(ids[0])
x11 = c.CDLL('libX11.so.6')
x11.XOpenDisplay.argtypes, x11.XOpenDisplay.restype = [c.c_char_p], c.c_void_p
x11.XInternAtom.argtypes, x11.XInternAtom.restype = [c.c_void_p, c.c_char_p, c.c_int], c.c_ulong
x11.XSendEvent.argtypes, x11.XSendEvent.restype = [c.c_void_p, c.c_ulong, c.c_int, c.c_long, c.POINTER(module.Event)], c.c_int
x11.XSync.argtypes = [c.c_void_p, c.c_int]
x11.XCloseDisplay.argtypes = [c.c_void_p]
display = x11.XOpenDisplay(None)
assert display
try:
    event = module.Event()
    event.client = module.ClientMessage(33, 0, 1, display, window, x11.XInternAtom(display, b'WM_PROTOCOLS', 0), 32,
        (c.c_long * 5)(x11.XInternAtom(display, b'WM_DELETE_WINDOW', 0), 0, 0, 0, 0))
    assert x11.XSendEvent(display, window, 0, 0, c.byref(event))
    x11.XSync(display, 0)
    print(window)
finally:
    x11.XCloseDisplay(display)
