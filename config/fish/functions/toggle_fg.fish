function toggle_fg
    if jobs -q
        fg
        commandline -f repaint
    else
        emit fish_cancel_commandline
        commandline -f repaint
    end
end
