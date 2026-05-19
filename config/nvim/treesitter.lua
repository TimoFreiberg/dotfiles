require('nvim-treesitter').setup {}

-- Install parsers (asynchronous; no-op if already installed)
require('nvim-treesitter').install { 'lua', 'rust' }
