source ~/.config/nvim/plug.vim
source ~/.config/nvim/appearance.vim
source ~/.config/nvim/lsp.lua

nnoremap <silent> <C-l> :nohlsearch<CR><C-l>
set mouse=a

set tabstop=2
set shiftwidth=2
set expandtab

" You will have bad experience for diagnostic messages when it's default 4000.
set updatetime=300

" don't give |ins-completion-menu| messages.
" TODO check if I miss this
" set shortmess+=c

" always show signcolumns

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

" TODO check if I miss this
" set lazyredraw

set diffopt+=iwhite " No whitespace in vimdiff
" Make diffing better: https://vimways.org/2018/the-power-of-diff/
set diffopt+=algorithm:patience
set diffopt+=indent-heuristic

" Permanent undo
set undodir=~/.vimundo
set undofile


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
      \ },
      \ 'active': {
      \   'right': [ [ 'lineinfo' ],
      \              [ 'percent' ],
      \              ]
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
" source ~/.config/nvim/coc-config.vim

" Rust
let g:rustfmt_autosave = 1
nnoremap <leader>= :RustFmt<cr>

map <F1> <Esc>
imap <F1> <Esc>

autocmd BufRead *.csv let b:coc_enabled = 0
