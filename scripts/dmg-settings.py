"""Run dmgbuild from the repository root with -D app=/path/to/VTubeLeaf.app."""

from pathlib import Path

application = defines["app"]
app_name = Path(application).name

format = "UDZO"
files = [application]
symlinks = {"Applications": "/Applications"}
icon = "src-tauri/icons/icon.icns"
background = "src-tauri/dmg/background.png"

window_rect = ((160, 160), (720, 440))
icon_locations = {app_name: (180, 210), "Applications": (540, 210)}
default_view = "icon-view"
arrange_by = None
icon_size = 112
text_size = 14
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
