function update_fish
	cd ~/.local/fish-shell/
  set gitStatus (git pull)
  if echo $gitStatus | ag 'Already up-to-date' --nocolor
    echo fish repository up to date, exiting. 
  else
    autoconf
    ./configure
    make
    sudo make install
  end
end
