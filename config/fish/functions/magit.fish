# Defined in /tmp/fish.GLpjSW/magit.fish @ line 2
function magit --description 'Opens magit in the current directory'
	if not git status >/dev/null 2>&1
	echo 'Not in a git repository'
        return 1
    end

	  emacsclient -nw --alternate-editor="" -e "(magit-status)"
end
