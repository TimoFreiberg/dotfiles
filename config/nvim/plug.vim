call plug#begin()

Plug 'dracula/vim', {'as': 'dracula'}

Plug 'folke/trouble.nvim'
Plug 'gelguy/wilder.nvim'
Plug 'godlygeek/tabular'

Plug 'hrsh7th/cmp-buffer'
Plug 'hrsh7th/cmp-cmdline'
Plug 'hrsh7th/cmp-nvim-lsp'
Plug 'hrsh7th/cmp-path'
Plug 'hrsh7th/cmp-vsnip'
Plug 'hrsh7th/nvim-cmp'
Plug 'hrsh7th/vim-vsnip'

Plug 'kyazdani42/nvim-web-devicons'
Plug 'lambdalisue/nerdfont.vim'

Plug 'nvim-lua/plenary.nvim'
Plug 'nvim-telescope/telescope.nvim'

Plug 'neovim/nvim-lspconfig'

Plug 'ruanyl/vim-gh-line'

Plug 'rust-lang/rust.vim'
Plug 'simrat39/rust-tools.nvim'

Plug 'tpope/vim-fugitive'

Plug 'vim-airline/vim-airline'

Plug 'tpope/vim-commentary'
Plug 'tpope/vim-surround'
Plug 'machakann/vim-highlightedyank'

Plug 'vim-test/vim-test'

" Plug 'junegunn/fzf', { 'do': { -> fzf#install() } }
" Plug 'junegunn/fzf.vim'

Plug 'ciaranm/securemodelines'

Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}

" Disabled now because it's buggy
" Plug 'junegunn/vim-peekaboo'

" Plug 'justinmk/vim-sneak'

" Plug 'airblade/vim-rooter'
" Plug 'andymass/vim-matchup'

" Plug 'cespare/vim-toml'
" Plug 'stephpy/vim-yaml'
" Plug 'dag/vim-fish'


" Autopairing plugin
" Plug 'tmsvg/pear-tree'

call plug#end()

