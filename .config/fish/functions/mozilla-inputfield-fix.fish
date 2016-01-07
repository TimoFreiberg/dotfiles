function mozilla-inputfield-fix
	set path (find $HOME/.mozilla -name "*.default")
  mkdir -v $path/chrome
  echo 'INPUT, TEXTAREA {color: black !important; background: #aaaaaa !important; }' > $path/chrome/userContent.css
end
