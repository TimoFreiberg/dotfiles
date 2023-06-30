## aliases

alias v = nvim
alias l = exa
alias la = exa -la
alias c = cargo
alias tp = trash

### git aliases

alias g = git

alias gl = git log

alias gs = git status --short
alias gss = git status

alias gps = git push
alias gpf = git push --force-with-lease
alias gpu = git push --set-upstream origin HEAD

alias gpl = git pull
alias gf = git fetch --all --prune

alias gc = git commit --verbose
alias gca = git commit --all --verbose
alias gcam = git commit --all --verbose --amend
alias gcamn = git commit --all --amend --no-edit

alias gb = git branch
alias gbd = git branch --delete
alias gbdf = git branch --delete --force

alias gco = git checkout
alias gcb = git checkout -b
alias gcB = git checkout -B

alias gd = git diff --stat
alias gdd = git diff

alias gst = git stash

alias gre = git remote

alias gr = git reset
alias grh = git reset --hard

alias grb = git rebase
alias grbc = git rebase --continue
alias grba = git rebase --abort

alias gw = git switch
alias gwc = git switch --create

alias gcp = git cherry-pick

alias gm = git merge
alias gmc = git merge --continue
alias gma = git merge --abort

alias grv = git revert
