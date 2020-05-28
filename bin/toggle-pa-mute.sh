#!/bin/sh

pactl set-source-mute @DEFAULT_SOURCE@ toggle

if pactl list sources | grep -q 'Mute: yes'; then
    notify-send -t 2000 "Muted microphone"
else
    notify-send -t 2000 "Unmuted microphone"
fi

