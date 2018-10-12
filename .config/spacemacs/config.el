
(setq powerline-default-separator nil)



(add-to-list 'exec-path "~/.local/bin")
(with-eval-after-load 'esh-util
 (setq-default eshell-path-env (concat "~/.local/bin:" eshell-path-env)))
;; (setq-default dotspacemacs-configuration-layers
;;               '(auto-completion (haskell :variables haskell-completion-backend 'intero)))

(global-set-key (kbd "C-SPC") #'company-complete)
(spaceline-toggle-minor-modes-off)

;; additional hotkeys

(with-eval-after-load 'company (add-hook 'evil-normal-state-entry-hook 'company-abort))

(defun xml-pretty-print ()
  (interactive)
  (save-excursion
    (shell-command-on-region (mark) (point) "xmllint --format -" (buffer-name) t)))

(defun std::defun-query-replace ()
  (interactive)
  (let ((case-fold-search nil))
    (mark-defun)
    (call-interactively 'anzu-query-replace)))

(evil-define-key '(normal motion) global-map (kbd "gh") #'helm-semantic-or-imenu)
(evil-define-key 'normal evil-normal-state-map (kbd "gh") #'helm-semantic-or-imenu)
(evil-define-key 'motion evil-motion-state-map (kbd "gh") #'helm-semantic-or-imenu)

;; make magit open as fullscreen buffer
(setq magit-display-buffer-function #'magit-display-buffer-fullframe-status-v1)

(evil-leader/set-key
  "[[" #'anzu-query-replace
  "[f" #'std::defun-query-replace)

(advice-add 'backward-kill-sexp :around 'evil--preceding-sexp '((name . evil)))

;; always follow symlinks to dotfiles
(setq
 vc-follow-symlinks t)

;; mouse wheel scrolling
(setq
 ;; constant mouse speed
 mouse-wheel-progressive-speed nil
 ;; slightly slower scrolling than default
 mouse-wheel-scroll-amount (quote (3 ((shift) . 1) ((control))))
 )

(setq
 ;; Makes C-i work. Without this, it is interpreted as tab
 dotspacemacs-distinguish-gui-tab t)

(with-eval-after-load 'cider
  (setq
   cider-repl-pop-to-buffer-on-connect 'display-only
   cider-repl-prompt-function 'cider-repl-prompt-abbreviated
   cider-repl-use-pretty-printing t
   cider-save-file-on-load t)
  ;; make eval-last-sexp work with evil normal mode cursor on closing paren
  (advice-add 'cider-last-sexp :around 'evil--preceding-sexp '((name . evil)))
  )

(with-eval-after-load 'company
 (company-flx-mode t))
