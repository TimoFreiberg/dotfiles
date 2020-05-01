;; -*- lexical-binding: t -*-

(std::using-packages
 rust-mode
 toml-mode)

(std::after (rust-mode lsp-mode)
  (setf lsp-rust-server 'rust-analyzer))

;; TODO(2020/05/01): Search symbol in project via <SPC *>
