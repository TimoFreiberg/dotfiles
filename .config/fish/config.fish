set -x PATH $PATH ~/bin ~/bin/nogit ~/.local/bin ~/.cabal/bin

set -x EDITOR vim
set -x VISUAL vim

if type starship > /dev/null 2>&1
    eval (starship init fish)
else
    echo "Consider installing `starship`"
end

