# Defined in /tmp/fish.xWcH5j/eg.fish @ line 2
function eg --description 'alias e=emacsclient -n -c -a'
	emacsclient -n -c --alternate-editor="" $argv;
end
