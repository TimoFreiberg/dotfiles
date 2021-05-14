#!/bin/sh

TOOL=~/bin/sway-screenshare.sh

show()  {
    if $TOOL is-recording; then
        printf '{"text": "  ", "class": "on"}' 
    else
        printf '{"text": "    ", "class": "off"}'
    fi
}

toggle() {
    if $TOOL is-recording; then
        $TOOL stop
    else
        $TOOL start
    fi
    pkill -RTMIN+3 waybar
}

if [ $# -gt 0 ]; then
    toggle
else 
    show
fi
