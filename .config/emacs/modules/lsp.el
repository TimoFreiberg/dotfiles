;; -*- lexical-binding: t -*-

(std::using-packages
 lsp-mode
 lsp-ui
 lsp-treemacs)

(std::after lsp-mode
  (setf lsp-ui-flycheck-live-reporting nil
        lsp-prefer-capf                t
        read-process-output-max        (* 1024 1024)
        lsp-ui-doc-delay               9001
        lsp-idle-delay                 0.2)
  (std::keybind
   :keymap lsp-mode-map
   "K" #'lsp-ui-doc-show
   :evil (normal motion) lsp-mode-map
   "K" #'lsp-ui-doc-show
   "gr" #'lsp-find-references
   "gy" #'lsp-find-type-definition
   "gi" #'lsp-find-implementation
   :leader
   "a" #'lsp-execute-code-action))

(std::after lsp-ui
  (push '(no-accept-focus . t) lsp-ui-doc-frame-parameters))
