function screens
	set -l s (xrandr | ag -o '^\w+ connected' | words | ag -v 'connected')
  echo $s | words
end
