;; -*- lexical-binding: t -*-

;(package-initialize)

(defconst S (float-time))
(unless (getenv "EMACS_HOME")
  (setenv "EMACS_HOME" (concat
                        (or (getenv "XDG_CONFIG_HOME") "~/.config")
                        "/emacs/")))
(load (concat (getenv "EMACS_HOME") "modules/bootstrap") nil :no-message)
(std::load "text-editing")
(std::load "misc-utils")
(std::load "ui")
(std::load "files-buffers")
(std::load "window-management")
(std::load "completion")
(std::load "selection")
(std::load "error-checking")
(std::load "modeline")
(std::load "help")
(std::load "search")
(std::load "elisp")
(std::load "projects")
(std::load "vcs")
(std::load "treemacs")
(std::load "org")
(std::load "org-capture")
(std::load "org-agenda")
(std::load "shell")
(std::load "dired")
(std::load "lsp")
(std::load "rust")
(message "Config loaded in %ss" (- (float-time) S))
