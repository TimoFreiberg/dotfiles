let mapleader="\<Space>"       

set tabstop=2           " number of visual spaces per tab
set shiftwidth=2
set expandtab

set copyindent    " copy the previous indentation on autoindenting
set number        " always show line numbers
set shiftround    " use multiple of shiftwidth when indenting with '<' and '>'
set smartcase     " ignore case if search pattern is all lowercase,

set lazyredraw          " redraw only when we need to.

" move vertically by visual line
nnoremap j gj
nnoremap k gk

" turn off search highlight
nnoremap <leader><space> :nohlsearch<CR>

set ruler

set noswapfile

" Return to last edit position when opening files (You want this!)
augroup last_edit
  autocmd!
  autocmd BufReadPost *
       \ if line("'\"") > 0 && line("'\"") <= line("$") |
       \   exe "normal! g`\"" |
       \ endif
augroup END

nnoremap K i<CR><Esc>

vmap <Leader>y "+y
vmap <Leader>d "+d
nmap <Leader>p "+p
nmap <Leader>P "+P
vmap <Leader>p "+p
vmap <Leader>P "+P
nmap <Leader>e :e 
nmap <Leader>wq :wq<CR>
nmap <Leader>q :q<CR>
