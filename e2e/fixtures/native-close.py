import ctypes as c
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time


class ClientMessage(c.Structure):
    _fields_ = [("type", c.c_int), ("serial", c.c_ulong), ("send_event", c.c_int),
                ("display", c.c_void_p), ("window", c.c_ulong), ("message_type", c.c_ulong),
                ("format", c.c_int), ("data", c.c_long * 5)]


class Event(c.Union):
    _fields_ = [("client", ClientMessage), ("padding", c.c_long * 24)]


def main():
    entry_id, expected, receipt_path = sys.argv[1:]
    assert re.fullmatch(r":[0-9]+(?:\.[0-9]+)?", os.environ.get("DISPLAY", "")), "Requires isolated local Xvfb DISPLAY"
    authority = Path(os.environ.get("XAUTHORITY", ""))
    assert authority.is_file() and authority.parent.name.startswith("xvfb-run."), "Run native close inside xvfb-run with its isolated XAUTHORITY"
    database = Path(os.environ["QA_SCRIBE_E2E_APP_DATA_DIR"]) / "qa-scribe.sqlite"
    x11 = c.CDLL("libX11.so.6")
    signatures = {
        "XOpenDisplay": ([c.c_char_p], c.c_void_p),
        "XDefaultRootWindow": ([c.c_void_p], c.c_ulong),
        "XQueryTree": ([c.c_void_p, c.c_ulong, c.POINTER(c.c_ulong), c.POINTER(c.c_ulong), c.POINTER(c.POINTER(c.c_ulong)), c.POINTER(c.c_uint)], c.c_int),
        "XFetchName": ([c.c_void_p, c.c_ulong, c.POINTER(c.c_void_p)], c.c_int),
        "XFree": ([c.c_void_p], c.c_int),
        "XInternAtom": ([c.c_void_p, c.c_char_p, c.c_int], c.c_ulong),
        "XSendEvent": ([c.c_void_p, c.c_ulong, c.c_int, c.c_long, c.POINTER(Event)], c.c_int),
        "XSync": ([c.c_void_p, c.c_int], c.c_int),
        "XCloseDisplay": ([c.c_void_p], c.c_int),
    }
    for name, (arguments, result) in signatures.items():
        function = getattr(x11, name)
        function.argtypes, function.restype = arguments, result
    display = x11.XOpenDisplay(None)
    assert display, "Cannot open isolated Xvfb DISPLAY"

    def windows(parent):
        root, owner, children, count = c.c_ulong(), c.c_ulong(), c.POINTER(c.c_ulong)(), c.c_uint()
        assert x11.XQueryTree(display, parent, c.byref(root), c.byref(owner), c.byref(children), c.byref(count))
        result = list(children[:count.value])
        if children:
            x11.XFree(children)
        return result

    def body():
        with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as connection:
            row = connection.execute("SELECT body FROM entries WHERE id = ? AND type = 'note'", (entry_id,)).fetchone()
            assert row, "Native close Note is missing from SQLite"
            return row[0]

    try:
        root = x11.XDefaultRootWindow(display)
        matches, titles = [], []
        for window in windows(root):
            name = c.c_void_p()
            if x11.XFetchName(display, window, c.byref(name)) and name.value:
                title = c.string_at(name).decode("utf-8")
                x11.XFree(name)
                titles.append(title)
                if title in ("QA Scribe E2E", "QA Scribe E2E (dev)"):
                    matches.append(window)
        assert len(matches) == 1, f"Expected exactly one owned QA Scribe E2E window, found {len(matches)} among {titles}"
        window = matches[0]
        before = body()
        assert expected not in before, "Autosave preempted the native close experiment"
        event = Event()
        event.client = ClientMessage(33, 0, 1, display, window,
                                    x11.XInternAtom(display, b"WM_PROTOCOLS", 0), 32,
                                    (c.c_long * 5)(x11.XInternAtom(display, b"WM_DELETE_WINDOW", 0), 0, 0, 0, 0))
        # WebDriver closeWindow destroys the window directly and bypasses Tauri's close-request guard.
        assert x11.XSendEvent(display, window, 0, 0, c.byref(event)), "Native close event was not sent"
        x11.XSync(display, 0)
        deadline = time.monotonic() + 10
        while True:
            receipt = {"beforeBody": before, "afterBody": body(), "windowClosed": window not in windows(root),
                       "dirtyAtClose": True}
            if receipt["windowClosed"] and receipt["afterBody"] == expected:
                break
            if time.monotonic() >= deadline:
                break
            time.sleep(0.025)
        Path(receipt_path).write_text(json.dumps(receipt, indent=2) + "\n")
        assert receipt["afterBody"] == expected, f"Native close did not persist dirty Note: {receipt}"
        assert receipt["windowClosed"], "Native close did not destroy the actual X11 window"
    finally:
        x11.XCloseDisplay(display)


if __name__ == "__main__":
    main()
