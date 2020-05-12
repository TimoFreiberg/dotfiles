#!/usr/bin/env bash

geometry(){
    windowGeometries=$(
    # `height - 1` is there because of: https://github.com/ammen99/wf-recorder/pull/56 (I could remove it if it's merged, maybe)
    swaymsg -t get_workspaces -r | jq -r '.[] | select(.focused) | .rect | "\(.x),\(.y) \(.width)x\(.height - 1)"'; \
        swaymsg -t get_outputs -r | jq -r '.[] | select(.active) | .rect | "\(.x),\(.y) \(.width)x\(.height)"'
    )
    geometry=$(slurp -b "#45858820" -c "#45858880" -w 3 -d <<< "$windowGeometries") || exit $?
    echo "$geometry"
}

{
    if [ "$1" == "stop" ]; then
        if pgrep ffplay > /dev/null; then
            pkill ffplay > /dev/null
        fi
        if pgrep wf-recorder > /dev/null; then
            pkill wf-recorder > /dev/null
        fi
        notify-send -t 2000 "Wayland recording has been stopped"
    elif [ "$1" == "show-state" ]; then
        if pgrep wf-recorder > /dev/null && pgrep ffplay > /dev/null; then
            notify-send -t 2000 "Wayland recording is up"
        else
            notify-send -t 2000 "No Wayland recording"
        fi
    elif [ "$1" == "is-recording" ]; then
        if pgrep wf-recorder > /dev/null && pgrep ffplay > /dev/null; then
            true
        else
            false
        fi
    elif [ "$1" == "start" ]; then
        if ! pgrep wf-recorder > /dev/null; then
            geometry=$(geometry) || exit $?
            wf-recorder --muxer=v4l2 --codec=rawvideo --pixel-format=yuv420p --file=/dev/video2 --geometry="$geometry" &
        fi
        if ! pgrep ffplay; then
            unset SDL_VIDEODRIVER
            ffplay /dev/video2 -loglevel 24 &
            sleep 0.5
            # a hack so FPS is not dropping
            swaymsg "[class=ffplay]" move workspace screencast
            swaymsg focus tiling
        fi
        notify-send -t 2000 "Wayland recording has been started"
    else
        cat << EOF
Usage:
$0 start
$0 stop
$0 is-recording
$0 show-state
EOF
    fi
}
