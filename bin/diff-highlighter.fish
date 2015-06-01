#!/bin/env fish

if type diffr > /dev/null 2>&1
    command diffr $argv
else
    cat $argv
end
