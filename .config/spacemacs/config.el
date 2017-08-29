
(setq powerline-default-separator nil)


(add-to-list 'exec-path "~/.local/bin")
(setq-default eshell-path-env (concat "~/.local/bin:" eshell-path-env))
;; (setq-default dotspacemacs-configuration-layers
;;               '(auto-completion (haskell :variables haskell-completion-backend 'intero)))

(global-set-key (kbd "C-SPC") #'company-complete)
(spaceline-toggle-minor-modes-off)


(with-eval-after-load "haskell-mode"
  (defun std::haskell-hook ()
    (haskell-decl-scan-mode t)
    (evil-smartparens-mode t))
  (add-hook 'haskell-mode-hook #'std::haskell-hook))
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



(evil-leader/set-key
  "[[" #'anzu-query-replace
  "[f" #'std::defun-query-replace)