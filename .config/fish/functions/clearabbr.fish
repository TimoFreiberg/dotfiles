# Defined in /tmp/fish.muqUHz/clearabbr.fish @ line 2
function clearabbr
	for ab in (abbr)
set aname (echo $ab | awk '{print $2}')
if echo $aname | grep -o "^'" > /dev/null
set aname (echo $aname | tr -d "'")
end
abbr -e $aname
echo "cleared $aname"
end
end
