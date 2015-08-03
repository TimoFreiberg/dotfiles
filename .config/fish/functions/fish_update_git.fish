function fish_update_git
	cd ~/.local/fish-shell/
  set gitStatus (git pull)
  if echo $gitStatus | ag 'Already up-to-date' --nocolor
    if not fish --version | ag (cat FISH-BUILD-VERSION-FILE | words | tail -n 1)
      autoconf
      ./configure
      make
      sudo make install
    else
      echo fish repository up to date, exiting. 
    end
  else
    autoconf
    ./configure
    make
    sudo make install
  end
  cd -
end
