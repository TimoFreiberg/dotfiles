;; -*- lexical-binding: t -*-

(std::using-packages
 ;; rust-mode
 rustic
 toml-mode)

(setf lsp-rust-analyzer-server-display-inlay-hints t)

(std::after (rustic lsp-mode)
  (setf lsp-rust-server 'rust-analyzer)
  (setf
   rustic-lsp-server 'rust-analyzer
   lsp-rust-analyzer-server-command '("~/.cargo/bin/rust-analyzer")
   rustic-lsp-format t
   rustic-format-on-save t))

;; TODO(2020/05/01): Search symbol in project via <SPC *>
;; TODO(2020/05/03): Popups sometimes get focus when they pop up over the mouse cursor. fix that!
;; TODO(2020/05/03): first `K` press in buffer is blocking?
;; TODO(2020/05/03): autoformat on save
