# Installation

Run `bootstrap.fish`

# Sway setup

## Required packages for Sway

Feel free to use the `-git` versions of these packages.

* sway
* swaybg
* swayidle
* swaylock-effects
* wl-clipboard
* clipman
* wofi
* mako
* waybar
* alacritty
* grim
* slurp
* redshift-wayland-git
* kanshi
* swaynagmode
* greetd

## greetd config

/usr/local/bin/run-sway.sh:
```
#!/bin/sh

# Session
export XDG_SESSION_TYPE=wayland
export XDG_SESSION_DESKTOP=sway
export XDG_CURRENT_DESKTOP=sway

source /usr/local/bin/wayland_enablement.sh

systemd-cat --identifier=sway sway $@
```

/usr/local/bin/wayland_enablement.sh:
```
#!/bin/sh
export MOZ_ENABLE_WAYLAND=1
export CLUTTER_BACKEND=wayland
export QT_QPA_PLATFORM=wayland-egl
export ECORE_EVAS_ENGINE=wayland-egl
export ELM_ENGINE=wayland_egl
export SDL_VIDEODRIVER=wayland
export _JAVA_AWT_WM_NOREPARENTING=1
export NO_AT_BRIDGE=1
```

## Sway config

`ln -s PATH_TO_DESIRED_WALLPAPER ~/Wallpapers/current`

If you want to add more applications to autostart, create `~/.config/sway/config.d/custom-autostart.conf` and add lines like `exec MY_AWESOME_APP`

If programs like zoom don't start after setting env variables like `export QT_QPA_PLATFORM=wayland-egl`, copy the `.desktop` file from `/usr/share/applications/` to `~/.local/share/applications` and edit the `Exec=` line to say (e.g.) `Exec=env -u QT_QPA_PLATFORM zoom %U`.
