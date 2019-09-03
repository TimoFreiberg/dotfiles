set -x PATH $PATH ~/bin ~/bin/nogit ~/.local/bin ~/.cabal/bin

set -x EDITOR vim
set -x VISUAL vim


if which starship > /dev/null
    eval (starship init fish)
else
    echo "Consider installing `starship`"
end
