# Defined in /tmp/fish.uf0Xkt/tmux-new.fish @ line 2
function tmux-new
	if test -z $argv
        set dir (pwd)
    else
        set dir (realpath $argv)
    end
    set sessname (basename "$dir")
    if test -z $TMUX
        tmux new -c "$dir" -s "$sessname"
    else
        tmux new -c "$dir" -s "$sessname" -d
        tmux switch-client -t "$sessname"
    end
end
