call plug#begin('~/.local/share/nvim/plugged')

Plug '/usr/bin/fzf'
Plug 'junegunn/fzf.vim'

Plug 'neoclide/coc.nvim', {'branch': 'release'}

Plug 'machakann/vim-highlightedyank'
Plug 'morhetz/gruvbox'

Plug 'tpope/vim-surround'
Plug 'airblade/vim-rooter'

Plug 'cespare/vim-toml'
Plug 'stephpy/vim-yaml'
Plug 'rust-lang/rust.vim'
Plug 'dag/vim-fish'

" Lets try without this
" Plug 'tmsvg/pear-tree'

call plug#end()

" General
set hidden
set hlsearch
nnoremap <silent> <C-l> :nohlsearch<CR><C-l>
set mouse=a
filetype plugin indent on
set autoindent
set noshowmode

set tabstop=4
set shiftwidth=4
set expandtab

" Some servers have issues with backup files, see #649
set nobackup
set nowritebackup

" You will have bad experience for diagnostic messages when it's default 4000.
set updatetime=300

" don't give |ins-completion-menu| messages.
set shortmess+=c

" always show signcolumns
set signcolumn=yes

set incsearch
set ignorecase
set smartcase
set gdefault

set lazyredraw

" Permanent undo
set undodir=~/.vimdid
set undofile

let mapleader="\<SPACE>"

" Custom keybinds

" spacemacs style!
nmap <silent> <leader>w :update<CR>
nnoremap <silent> <leader><leader> <c-^>

"""""""""""""""""""
" Plugin settings "
"
"""""""""""""""""""

" Gruvbox
"
colorscheme gruvbox

" FZF
map <C-p> :Files<CR>
map <leader>pf :Files<CR>
nmap <silent> <leader>bb :Buffers<CR>
nnoremap <leader>/ :Rg 
nnoremap <leader>* :Rg <C-R><C-W><CR>

" CoC.nvim
"
source ~/.config/nvim/coc-config.vim

" Rust
let g:rustfmt_autosave = 1 

map <F1> <Esc>
imap <F1> <Esc>

autocmd BufRead *.csv let b:coc_enabled = 0
