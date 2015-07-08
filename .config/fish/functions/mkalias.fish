function mkalias
  alias $argv
  set -l name (echo $argv | ag "^[^=]*")
  echo name=$name
  funcsave $name
end

