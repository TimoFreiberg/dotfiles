function spacemacs-update
	cd ~/.emacs.d/
git pull
emacs -nw --execute '(configuration-layer/update-packages t)' --execute '(kill-emacs)'
cd -
end
