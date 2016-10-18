function upgrayedd
	sudo pacman -Syu --ignore docker; and sudo aura -Au;
	stack upgrade;
	
	set resolver (stack --resolver nightly install hasktags hlint hindent stylish-haskell hoogle apply-refact 2>&1 | tee (tty) | ag -o 'resolver:(.*)$')
	
	if test $resolver = (tail -n 1 $HOME/.stack/global-project/stack.yaml)
		echo "$resolver up to date"
		return 0
	end
	head -n -1 $HOME/.stack/global-project/stack.yaml > /tmp/stack-resolver
	echo $resolver >> /tmp/stack-resolver

	mv $HOME/.stack/global-project/stack.yaml $HOME/.stack/global-project/stack.yaml.backup
	mv /tmp/stack-resolver $HOME/.stack/global-project/stack.yaml

	echo "updated stack $resolver"
end
