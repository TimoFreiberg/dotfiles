#!/bin/env fish

set FILE (mktemp) 
pacman -Qqe > $FILE
for group in base-devel gnome gnome-extra
    for package in (pacman -Qqeg $group)
        sed -i "/$package/d" $FILE
    end
end
sed -i "/base/d" $FILE

cat $FILE
