vim.keymap.set('n', '<leader>T', ':Telescope<cr>')
vim.keymap.set('n', '<leader>f', ':Telescope fd<cr>', {silent = true})
vim.keymap.set('n', '<leader>:', ':Telescope commands<cr>', {silent = true})
vim.keymap.set('n', '<leader>b', ':Telescope buffers<cr>', {silent = true})
vim.keymap.set('n', '<leader>*', ':Telescope grep_string<cr>', {silent = true})
vim.keymap.set('n', '<leader>/', ':Telescope live_grep<cr>', {silent = true})
vim.keymap.set('n', '<leader>p', ':Telescope registers<cr>', {silent = true})
vim.keymap.set('n', '<leader>.', ':Telescope resume<cr>', {silent = true})
vim.keymap.set('n', '<leader>>', ':Telescope pickers<cr>', {silent = true})

vim.keymap.set('n', '<leader>s', ':Telescope lsp_workspace_symbols<cr>', {silent = true})
vim.keymap.set('n', '<leader>o', ':Telescope lsp_document_symbols<cr>', {silent = true})
vim.keymap.set('n', '<leader>d', ':Telescope diagnostics<cr>', {silent = true})
vim.keymap.set('n', 'gr', ':Telescope lsp_references<cr>', {silent = true})
vim.keymap.set('n', 'gi', ':Telescope lsp_implementations<cr>', {silent = true})
vim.keymap.set('n', 'gd', ':Telescope lsp_definitions<cr>', {silent = true})
vim.keymap.set('n', 'gy', ':Telescope lsp_type_definitions<cr>', {silent = true})


require('telescope').setup{
  defaults = {
    -- Default configuration for telescope goes here:
    -- config_key = value,
    mappings = {
      i = {
        -- map actions.which_key to <C-h> (default: <C-/>)
        -- actions.which_key shows the mappings for your picker,
        -- e.g. git_{create, delete, ...}_branch for the git_branches picker
        ["<C-h>"] = "which_key"
      }
    }
  },
  pickers = {
    -- Default configuration for builtin pickers goes here:
    -- picker_name = {
    --   picker_config_key = value,
    --   ...
    -- }
    -- Now the picker_config_key will be applied every time you call this
    -- builtin picker
  },
  extensions = {
    -- Your extension configuration goes here:
    -- extension_name = {
    --   extension_config_key = value,
    -- }
    -- please take a look at the readme of the extension you want to configure
    ['ui-select'] = {
      require('telescope.themes').get_dropdown {
        -- even more opts
      }

      -- pseudo code / specification for writing custom displays, like the one
      -- for "codeactions"
      -- specific_opts = {
      --   [kind] = {
      --     make_indexed = function(items) -> indexed_items, width,
      --     make_displayer = function(widths) -> displayer
      --     make_display = function(displayer) -> function(e)
      --     make_ordinal = function(e) -> string
      --   },
      --   -- for example to disable the custom builtin "codeactions" display
      --      do the following
      --   codeactions = false,
      -- }
    }
  }
}

require('telescope').load_extension('ui-select')
