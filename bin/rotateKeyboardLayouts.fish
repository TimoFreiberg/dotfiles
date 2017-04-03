#!/bin/env fish
if test -z $LAYOUT
  set -U LAYOUT "en"
  xkb.fish
else if test en = $LAYOUT
  set  LAYOUT "de"
  xkb.fish de
else
  set LAYOUT "en"
  xkb.fish
end
