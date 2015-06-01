function firefox-inputfield-fix
	set path (find $HOME/.mozilla -name "*.default")
  mkdir --verbose --parents $path/chrome
  echo 'INPUT, TEXTAREA {color: #222222 !important; background: #f7f7f7 !important; }' > $path/chrome/userContent.css
end
