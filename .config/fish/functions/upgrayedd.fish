# Defined in /tmp/fish.w1zK1j/upgrayedd.fish @ line 2
function upgrayedd
	pacaur -Syu


## haskell part
#  stack upgrade
#	
#  set resolver (stack --resolver lts --install-ghc install hasktags hlint hoogle 2>&1 | tee (tty) | ag -o 'resolver:(.*)$')
#  stack --resolver nightly --install-ghc install hindent
#	
#	if test -n "$resolver"
#    if test "$resolver" = (tail -n 1 $HOME/.stack/global-project/stack.yaml)
#      echo "$resolver up to date"
#      return 0
#    else
#      head -n -1 $HOME/.stack/global-project/stack.yaml > /tmp/stack-resolver
#      echo $resolver >> /tmp/stack-resolver
#      mv $HOME/.stack/global-project/stack.yaml $HOME/.stack/global-project/stack.yaml.backup
#      mv /tmp/stack-resolver $HOME/.stack/global-project/stack.yaml
#
#      echo "updated stack $resolver"
#    end
#	else
#    echo "could not update stack resolver, doing nothing"
#  end
end
