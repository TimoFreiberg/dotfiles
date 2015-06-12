set nocompatible
filetype off

syntax on               " enable syntax processing

set autoread                    " automatically reload files changed outside of Vim

let mapleader=","       " leader is comma

set tabstop=4           " number of visual spaces per tab
set softtabstop=4       " number of spaces per tab when editing
set shiftwidth=4
set expandtab           " tabs are spaces

set autoindent    " always set autoindenting on
set copyindent    " copy the previous indentation on autoindenting
set number        " always show line numbers
set shiftround    " use multiple of shiftwidth when indenting with '<' and '>'
set showmatch     " set show matching parenthesis
set ignorecase    " ignore case when searching
set smartcase     " ignore case if search pattern is all lowercase,
                    "    case-sensitive otherwise
set smarttab      " insert tabs on the start of a line according to
                    "    shiftwidth, not tabstop
set hlsearch      " highlight search terms
set incsearch     " show search matches as you type

set history=1000         " remember more commands and search history
set undolevels=1000      " use many muchos levels of undo

set showcmd             " show command in bottom bar
set cursorline          " highlight current line

set wildmode=longest,list,full
set wildmenu            " visual autocomplete for command menu

set lazyredraw          " redraw only when we need to.
set showmatch           " highlight matching [{()}]

" move vertically by visual line
nnoremap j gj
nnoremap k gk

" turn off search highlight
nnoremap <leader><space> :nohlsearch<CR>

set ruler

set nobackup
set noswapfile

filetype plugin indent on    " required
