#!/bin/sh

setxkbmap -option ctrl:nocaps,lv3:ralt_switch us
xmodmap ~/.config/xkb/umlauts.xmodmap
xmodmap ~/.config/xkb/tarmak1.xmodmap
