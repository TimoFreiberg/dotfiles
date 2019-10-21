# Defined in /tmp/fish.lS7EA1/vim.fish @ line 2
function vim --description 'alias vim=nvim'
    if type nvim > /dev/null 2>&1
	    nvim  $argv;
    else 
        vim $argv;
    end
end
