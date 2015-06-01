# Defined in /tmp/fish.Uck8uB/clearabbr.fish @ line 2
function clearabbr
	for ab in (abbr)
# awk print $5 because `abbr` prints the abbreviation as 5th element
set aname (echo $ab | awk '{print $5}')
if echo $aname | grep -o "^'" > /dev/null
set aname (echo $aname | tr -d "'")
end
abbr -e $aname
echo "cleared $aname"
end
end
