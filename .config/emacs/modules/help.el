;; -*- lexical-binding: t -*-

(std::using-packages
 helpful)

(std::autoload help
  #'std::help::pacman-pkg-info)

(std::after helpful
  (require 'framey-helpful))

(std::keybind
 :keymap (evil-normal-state-map evil-visual-state-map evil-motion-state-map)
 "K"  #'helpful-at-point
 :leader
 "hdv" #'helpful-variable
 "hdf" #'helpful-callable
 "hdk" #'helpful-key
 "hdc" #'describe-char
 "hdC" #'helpful-command
 "hdF" #'describe-face
 "hda" #'helm-apropos
 "hdP" #'std::help::pacman-pkg-info
 "hm"  #'helm-man-woman)

(evil-set-initial-state 'helpful-mode 'motion)
