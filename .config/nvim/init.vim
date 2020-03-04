call plug#begin('~/.local/share/nvim/plugged')

Plug '/usr/bin/fzf'
Plug 'junegunn/fzf.vim'

Plug 'neoclide/coc.nvim', {'branch': 'release'}
" Run :CocInstall coc-rust-analyzer
" Run :CocInstall coc-pairs

Plug 'machakann/vim-highlightedyank'
Plug 'morhetz/gruvbox'

Plug 'tpope/vim-surround'
Plug 'airblade/vim-rooter'
Plug 'godlygeek/tabular'
Plug 'andymass/vim-matchup'

Plug 'cespare/vim-toml'
Plug 'stephpy/vim-yaml'
Plug 'rust-lang/rust.vim'
Plug 'dag/vim-fish'

Plug 'tpope/vim-fugitive'

" Autopairing plugin
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

set wildmenu
set wildmode=longest:full,full

" Search results centered please
nnoremap <silent> n nzz
nnoremap <silent> N Nzz
nnoremap <silent> * *zz
nnoremap <silent> # #zz
nnoremap <silent> g* g*zz
"
" Very magic by default
nnoremap ? ?\v
nnoremap / /\v
cnoremap %s/ %sm/

set lazyredraw

set diffopt+=iwhite " No whitespace in vimdiff
" Make diffing better: https://vimways.org/2018/the-power-of-diff/
set diffopt+=algorithm:patience
set diffopt+=indent-heuristic

" Permanent undo
set undodir=~/.vimdid
set undofile

set relativenumber " Relative line numbers
set number " Also show current absolute line

let mapleader="\<SPACE>"

" Custom keybinds

" spacemacs style!
nmap <silent> <leader>w :update<CR>
nnoremap <silent> <leader><leader> <c-^>

" Ctrl+c and Ctrl+j as Esc
" Ctrl-j is a little awkward unfortunately:
" https://github.com/neovim/neovim/issues/5916
" So we also map Ctrl+k
inoremap <C-j> <Esc>

nnoremap <C-k> <Esc>
inoremap <C-k> <Esc>
vnoremap <C-k> <Esc>
snoremap <C-k> <Esc>
xnoremap <C-k> <Esc>
cnoremap <C-k> <Esc>
onoremap <C-k> <Esc>
lnoremap <C-k> <Esc>
tnoremap <C-k> <Esc>

nnoremap <C-c> <Esc>
inoremap <C-c> <Esc>
vnoremap <C-c> <Esc>
snoremap <C-c> <Esc>
xnoremap <C-c> <Esc>
cnoremap <C-c> <Esc>
onoremap <C-c> <Esc>
lnoremap <C-c> <Esc>
tnoremap <C-c> <Esc>

"""""""""""""""""""
" Plugin settings "
"
"""""""""""""""""""

if has('nvim')
    set guicursor=n-v-c:block-Cursor/lCursor-blinkon0,i-ci:ver25-Cursor/lCursor,r-cr:hor20-Cursor/lCursor
    set inccommand=nosplit
    noremap <C-q> :confirm qall<CR>
end

" Gruvbox
"
colorscheme gruvbox

" FZF
map <C-p> :Files<CR>
map <leader>p :Files<CR>
nmap <silent> <leader>b :Buffers<CR>
" Opens command prompt with `:Rg ` already typed -> project wide search
nnoremap <leader>/ :Rg 
" Calls `:Rg` with the current word under the cursor (<C-R><C-W> selects the
" current word under cursor)
nnoremap <leader>* :Rg \b<C-R><C-W>\b<CR>
map <leader>: :Commands<CR>

" CoC.nvim
"
source ~/.config/nvim/coc-config.vim

" Rust
let g:rustfmt_autosave = 1
nnoremap <leader>= :RustFmt<cr>

map <F1> <Esc>
imap <F1> <Esc>

autocmd BufRead *.csv let b:coc_enabled = 0
