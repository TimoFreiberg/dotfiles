#!/bin/env fish

set TMP (mktemp)

set IGNORED \
    ca/desrt/dconf-editor \
    com/github/wwmm/pulseeffects \
    org/gnome/Characters \
    org/gnome/Totem \
    org/gnome/baobab/ui \
    org/gnome/boxes \
    org/gnome/builder \
    org/gnome/calculator \
    org/gnome/calendar \
    org/gnome/cheese \
    org/gnome/clocks \
    org/gnome/control-center \
    org/gnome/desktop/app-folders \
    org/gnome/desktop/notifications \
    org/gnome/eog/view \
    org/gnome/evince \
    org/gnome/evolution-data-server \
    org/gnome/feedreader/saved-state \
    org/gnome/file-roller \
    org/gnome/gedit \
    org/gnome/gnome-screenshot \
    org/gnome/gnome-system-monitor \
    org/gnome/meld/window-state \
    org/gnome/nautilus \
    org/gnome/software \
    org/gtk/settings/color-chooser \
    org/gtk/settings/file-chooser \
    org/gnome/desktop/background \
    org/gnome/desktop/screensaver \
    org/gnome/maps \
    org/gnome/documents \
    org/gnome/nm-applet

dconf dump / > $TMP

for IGNORE_PARAGRAPH in $IGNORED
    set ESCAPED (echo $IGNORE_PARAGRAPH | regex-escape.py)
    gawk -i inplace -v RS= -v ORS='\n\n' "!/$ESCAPED/" $TMP
end
sed -i '/^night-light-last-coordinates/d' $TMP

bat $TMP
