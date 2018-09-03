# Defined in - @ line 0
function magit --description alias\ magit=emacsclient\ -nw\ -e\ \\\(magit-status\\\)
	emacsclient -nw -e \(magit-status\) $argv;
end
