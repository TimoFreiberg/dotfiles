#!/bin/sh

pactl set-source-mute @DEFAULT_SOURCE@ toggle

if pactl list sources | grep -q 'Mute: yes'; then
    notify-send --urgency=low --expire-time=2000 --category=pactl "Muted microphone"
else
    notify-send --urgency=low --expire-time=2000 --category=pactl "Unmuted microphone"
fi

