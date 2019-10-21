call plug#begin('~/.local/share/nvim/plugged')

Plug '/usr/bin/fzf'
Plug 'junegunn/fzf.vim'

Plug 'neoclide/coc.nvim', {'branch': 'release'}

Plug 'morhetz/gruvbox'

Plug 'tpope/vim-surround'

Plug 'ctrlpvim/ctrlp.vim'

call plug#end()

" General
set hidden
set hlsearch
nnoremap <silent> <C-l> :nohlsearch<CR><C-l>
set mouse=a

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

set ignorecase
set smartcase

let mapleader="\<SPACE>"

" Custom keybinds

" spacemacs style!
nmap <silent> <leader>fs :update<CR>

"""""""""""""""""""
" Plugin settings "
"
"""""""""""""""""""

" Gruvbox
"
colorscheme gruvbox

" CtrlP
"
let g:ctrlp_map = '<SPACE>p'
let g:ctrlp_cmd = 'CtrlP'
nmap <silent> <leader>bb :Buffers<CR>

" CoC.nvim
"
source ~/.config/nvim/coc-config.vim

" Rust
let g:rustfmt_autosave = 1 





