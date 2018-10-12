# Defined in - @ line 0
function magit --description="Opens magit in the current directory"
    if not git status >/dev/null 2>&1
        return 1
    end

	  emacsclient -nw --alternate-editor="" -e "(magit-status)"
end
