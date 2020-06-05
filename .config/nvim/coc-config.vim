" TODO reenable this when nvim 0.5 is out
" set tagfunc=CocTagFunc

" TODO coc.nvim PR to improve codeaction selection UI

nmap <silent> [g <Plug>(coc-diagnostic-prev)
nmap <silent> ]g <Plug>(coc-diagnostic-next)
nnoremap <silent> <leader>e :CocList diagnostics<cr>

nmap <silent> gd <Plug>(coc-definition)
nmap <silent> gy <Plug>(coc-type-definition)
nmap <silent> gi <Plug>(coc-implementation)
nmap <silent> gr <Plug>(coc-references)
nnoremap <silent> <leader>t :<C-u>CocCommand rust-analyzer.run<cr>
nnoremap <silent> <leader>s :<C-u>CocList -I symbols<cr>
nnoremap <silent> <leader>o :<C-u>CocList outline<cr>
nnoremap <silent> <leader>i :<C-u>CocListResume<cr>
nnoremap <silent> <leader>j :<C-u>CocNext<cr>
nnoremap <silent> <leader>k :<C-u>CocPrev<cr>

" Use tab for trigger completion with characters ahead and navigate.
" Use command ':verbose imap <tab>' to make sure tab is not mapped by other plugin.
function! s:check_back_space() abort
  let col = col('.') - 1
  return !col || getline('.')[col - 1]  =~# '\s'
endfunction
inoremap <silent><expr> <TAB>
      \ pumvisible() ? "\<C-n>" :
      \ <SID>check_back_space() ? "\<TAB>" :
      \ coc#refresh()
inoremap <expr><S-TAB> pumvisible() ? "\<C-p>" : "\<C-h>"

" Use <c-space> to trigger completion.
inoremap <silent><expr> <c-space> coc#refresh()

" Use <cr> to confirm completion, `<C-g>u` means break undo chain at current
" position. Coc only does snippet and additional edit on confirm.
if exists('*complete_info')
  inoremap <expr> <cr> complete_info()["selected"] != "-1" ? "\<C-y>" : "\<C-g>u\<CR>"
else
  imap <expr> <cr> pumvisible() ? "\<C-y>" : "\<C-g>u\<CR>"
endif

" Use K to show documentation in preview window
function! s:show_documentation()
  if (index(['vim','help'], &filetype) >= 0)
    execute 'h '.expand('<cword>')
  else
    call CocActionAsync('doHover')
  endif
endfunction

nnoremap <silent> K :call <SID>show_documentation()<CR>

" Remap for rename current word
nmap <leader>r <Plug>(coc-rename)

nmap <silent> <M-w> v<Plug>(coc-range-select)
vmap <silent> <M-w> <Plug>(coc-range-select)
vmap <silent> <M-W> <Plug>(coc-range-select-backward)
" Highlight the symbol and its references when holding the cursor.
autocmd CursorHold * silent call CocActionAsync('highlight')

" Remap for do codeAction of selected region, ex: `<leader>aap` for current paragraph
xmap <leader>a  <Plug>(coc-codeaction-selected)
" nmap <leader>a  <Plug>(coc-codeaction-selected)

" Remap for do codeAction of current line
nmap <leader>a :CocCommand actions.open<cr>
" Fix autofix problem of current line
nmap <leader>qf  <Plug>(coc-fix-current)

nmap <leader>cc :CocCommand<CR>

" Introduce function text object
" NOTE: Requires 'textDocument.documentSymbol' support from the language server.
xmap if <Plug>(coc-funcobj-i)
xmap af <Plug>(coc-funcobj-a)
omap if <Plug>(coc-funcobj-i)
omap af <Plug>(coc-funcobj-a)

" coc-pairs
inoremap <silent><expr> <cr> pumvisible() ? coc#_select_confirm()
            \: "\<C-g>u\<CR>\<c-r>=coc#on_enter()\<CR>"
