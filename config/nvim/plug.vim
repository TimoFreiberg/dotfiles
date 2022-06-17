call plug#begin('~/.local/share/nvim/plugged')

Plug 'junegunn/fzf', { 'do': { -> fzf#install() } }
Plug 'junegunn/fzf.vim'

" Disabled now because it's buggy
" Plug 'junegunn/vim-peekaboo'

Plug 'justinmk/vim-sneak'
Plug 'ciaranm/securemodelines'

" Plug 'neoclide/coc.nvim', {'branch': 'release'}
" Plug 'TimoFreiberg/coc.nvim', {'branch': 'dev', 'do': 'yarn install --frozen-lockfile'}
" :CocInstall coc-rust-analyzer
" :CocInstall coc-pairs
" Plug 'TimoFreiberg/coc-rust-analyzer', {'branch': 'dev', 'do': 'yarn install --frozen-lockfile'}
" Plug 'fannheyward/coc-rust-analyzer', {'branch': 'master', 'do': 'yarn install --frozen-lockfile'}

Plug 'vim-airline/vim-airline'
Plug 'machakann/vim-highlightedyank'

Plug 'dracula/vim', {'as': 'dracula'}

Plug 'tpope/vim-surround'
Plug 'airblade/vim-rooter'
Plug 'godlygeek/tabular'
Plug 'andymass/vim-matchup'

" Plug 'cespare/vim-toml'
Plug 'stephpy/vim-yaml'
Plug 'rust-lang/rust.vim'
Plug 'dag/vim-fish'

Plug 'tpope/vim-fugitive'
Plug 'tpope/vim-commentary'

" Autopairing plugin
" Plug 'tmsvg/pear-tree'

call plug#end()

