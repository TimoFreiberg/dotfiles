call plug#begin('~/.local/share/nvim/plugged')

Plug '/usr/bin/fzf'
Plug 'junegunn/fzf.vim'

" Disabled now because it's buggy
" Plug 'junegunn/vim-peekaboo'

Plug 'justinmk/vim-sneak'
Plug 'ciaranm/securemodelines'

Plug 'neoclide/coc.nvim', {'branch': 'release'}
" Plug 'TimoFreiberg/coc.nvim', {'branch': 'dev', 'do': 'yarn install --frozen-lockfile'}
" :CocInstall coc-rust-analyzer
" :CocInstall coc-pairs
" :CocInstall coc-actions
" Plug 'TimoFreiberg/coc-rust-analyzer', {'branch': 'dev', 'do': 'yarn install --frozen-lockfile'}

Plug 'itchyny/lightline.vim'
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
Plug 'tpope/vim-commentary'

" Autopairing plugin
" Plug 'tmsvg/pear-tree'

call plug#end()

" General

" Taken from burntsushi
syntax sync fromstart

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

nmap <C-j> a<cr><esc>

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

let g:secure_modelines_allowed_items = [
                \ "textwidth",   "tw",
                \ "softtabstop", "sts",
                \ "tabstop",     "ts",
                \ "shiftwidth",  "sw",
                \ "expandtab",   "et",   "noexpandtab", "noet",
                \ "filetype",    "ft",
                \ "foldmethod",  "fdm",
                \ "readonly",    "ro",   "noreadonly", "noro",
                \ "rightleft",   "rl",   "norightleft", "norl",
                \ "colorcolumn"
                \ ]

" Lightline
" let g:lightline = { 'colorscheme': 'wombat' }
let g:lightline = {
      \ 'component_function': {
      \   'filename': 'LightlineFilename',
      \   'cocstatus': 'coc#status',
      \ },
      \ 'active': {
      \   'right': [ [ 'lineinfo' ],
      \              [ 'percent' ],
      \              [ 'cocstatus', 'fileformat', 'fileencoding', 'filetype']]
      \ }
\ }
function! LightlineFilename()
  return expand('%:t') !=# '' ? @% : '[No Name]'
endfunction

" FZF
map <C-p> :Files<CR>
map <leader>p :Files<CR>
nmap <silent> <leader>b :Buffers<CR>
" Opens command prompt with `:Rg ` already typed -> project wide search
nmap <leader>/ :Rg 
" Opens a search over the lines of the open buffer
nmap <leader>l :BLines<CR>
" Calls `:Rg` with the current word under the cursor (<C-R><C-W> selects the
" current word under cursor)
nnoremap <leader>* yiw:Rg \b<C-R>"\b<CR>
map <leader>: :Commands<CR>

" sneak
let g:sneak#s_next = 1
" 2-character Sneak (default)
nmap <M-o> <Plug>Sneak_s
nmap <M-i> <Plug>Sneak_S
" visual-mode
xmap <M-o> <Plug>Sneak_s
xmap <M-i> <Plug>Sneak_S
" operator-pending-mode
omap <M-o> <Plug>Sneak_s
omap <M-i> <Plug>Sneak_S
map f <Plug>Sneak_f
map F <Plug>Sneak_F
map t <Plug>Sneak_t
map T <Plug>Sneak_T


" coc.nvim
"
source ~/.config/nvim/coc-config.vim

" Rust
let g:rustfmt_autosave = 1
nnoremap <leader>= :RustFmt<cr>

map <F1> <Esc>
imap <F1> <Esc>

autocmd BufRead *.csv let b:coc_enabled = 0
