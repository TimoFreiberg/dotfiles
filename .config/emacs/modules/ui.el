;; -*- lexical-binding: t -*-
;; TODO(2020/04/09): fringes
(std::using-packages
 rainbow-delimiters
 rainbow-mode
 gruvbox-theme
 ;; (morning-star :type git :host github :repo "Alexander-Miller/morning-star-theme")
 writeroom-mode
 fill-column-indicator)

(std::autoload ui
  #'std::ui::writeroom-hide-line-numbers)

(setf (alist-get 'font default-frame-alist)
      (font-xlfd-name (font-spec :family "Fira Mono" :size 18)))

(std::schedule 1 :no-repeat
  (add-hook 'prog-mode-hook #'prettify-symbols-mode))

(setq-default
 fill-column                    80
 cursor-in-non-selected-windows nil
 truncate-lines                 t)

(setf
 display-line-numbers-widen       t
 display-line-numbers-width-start t
 display-line-numbers-grow-only   t
 scroll-margin                    10
 scroll-conservatively            10
 scroll-preserve-screen-position  t
 ;; Fix scrolling for me
 mouse-wheel-progressive-speed nil
 ;; Try to prevent focusing doc popups
 mouse-autoselect-window 9001
 )

;; (load-theme 'morning-star :no-confirm)
(load-theme 'gruvbox-dark-medium :no-confirm)

(add-hook 'prog-mode-hook #'rainbow-delimiters-mode-enable)
(add-hook 'text-mode-hook #'rainbow-delimiters-mode-enable)
(add-hook 'conf-mode-hook #'rainbow-delimiters-mode-enable)
(remove-hook 'snippet-mode-hook #'rainbow-delimiters-mode-disable)

(add-hook 'prog-mode-hook #'rainbow-mode)
(add-hook 'conf-mode-hook #'rainbow-mode)
(add-hook 'text-mode-hook #'rainbow-mode)
(add-hook 'css-mode-hook #'rainbow-mode)

(add-hook 'prog-mode-hook #'display-line-numbers-mode)
(add-hook 'text-mode-hook #'display-line-numbers-mode)

(blink-cursor-mode -1)

(setf ring-bell-function (lambda () ))

(cl-defmacro std::downscale (char &key font (size 12))
  `(set-fontset-font "fontset-default" (cons ,char ,char) (font-spec :size ,size :name ,font)))

; (std::downscale ?\✿ :font "Symbola" :size 11)
; (std::downscale ?\◉ :font "Symbola")
; (std::downscale ?\• :font "Symbola")
; (std::downscale ?\→ :font "Symbola" :size 10)
; (std::downscale ?\❯ :font "Symbola")
; (std::downscale ?\✔ :font "Symbola" :size 9)
; (std::downscale ?\⎯ :font "Symbola" :size 10)
(std::downscale ?\➊ :font "DejaVu Sans" :size 14)
(std::downscale ?\➋ :font "DejaVu Sans" :size 14)
(std::downscale ?\➌ :font "DejaVu Sans" :size 14)
(std::downscale ?\➍ :font "DejaVu Sans" :size 14)
(std::downscale ?\➎ :font "DejaVu Sans" :size 14)
(std::downscale ?\➏ :font "DejaVu Sans" :size 14)
(std::downscale ?\➐ :font "DejaVu Sans" :size 14)
(std::downscale ?\➑ :font "DejaVu Sans" :size 14)
(std::downscale ?\➒ :font "DejaVu Sans" :size 14)
(std::downscale ?\➓ :font "DejaVu Sans" :size 14)

(std::after pos-tip
  (setq pos-tip-background-color "#2d2d2d"
        pos-tip-foreground-color "#ccb18b"))

(std::after writeroom-mode
  (add-to-list 'writeroom-global-effects #'std::ui::writeroom-hide-line-numbers)

  (setf
   writeroom-width                120
   writeroom-extra-line-spacing   0
   writeroom-bottom-divider-width 0
   writeroom-global-effects
   (delete 'writeroom-set-fullscreen writeroom-global-effects)))

(defconst std::fontsizes
  '((:default "Fantasque Sans Mono 12")
    (:large   "Fantasque Sans Mono 14")
    (:huge    "Fantasque Sans Mono 18")))

(defun colorize-compilation ()
  (let ((inhibit-read-only t))
    (ansi-color-apply-on-region compilation-filter-start (point))))
(add-hook 'compilation-filter-hook #'colorize-compilation)
