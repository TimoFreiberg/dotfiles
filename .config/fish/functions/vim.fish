function vim --description 'alias vim=nvim'
    if type nvim > /dev/null 2>&1
        nvim  $argv;
    else 
        command vim $argv;
    end
end
