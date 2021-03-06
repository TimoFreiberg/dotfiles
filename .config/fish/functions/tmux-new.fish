# Defined in /home/tf/.config/fish/functions/tmux-new.fish @ line 2
function tmux-new
	if test -z $argv
        set dir (pwd)
    else
        set dir (realpath $argv)
    end
    set sessname (basename "$dir" | tr -d '.')
    if test -z $TMUX
        tmux new -A -c "$dir" -s "$sessname"
    else
        tmux new -A -c "$dir" -s "$sessname" -d
        tmux switch-client -t "$sessname"
    end
end
