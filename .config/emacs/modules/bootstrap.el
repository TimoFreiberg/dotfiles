;; -*- lexical-binding: t -*-

;; TODO(2020/03/16): reset
;; TODO scroll bug report

(defconst std::emacs-dir (eval-when-compile (getenv "EMACS_HOME")))
(defconst std::org-dir "~/Documents/Org")

;; PATH stuff (warning: hacky)
(setenv "PATH" (shell-command-to-string "fish -c 'echo \"$PATH\"'"))
(setf exec-path (split-string (shell-command-to-string "fish -c 'echo $PATH'") " " t))

(setf gc-cons-threshold       most-positive-fixnum
      gc-cons-percentage      0.6
      custom-file             "/home/a/.emacs.d/custom.el"
      load-prefer-newer       nil
      inhibit-startup-screen  t
      inhibit-startup-message t
      package-enable-at-startup nil
      ;; Manual load-path override to use straight's org
      load-path (delete "/usr/share/emacs/26.3/lisp/org" load-path))

(scroll-bar-mode -1)
(tool-bar-mode -1)
(menu-bar-mode -1)

(eval-when-compile (require 'cl-lib))

(defmacro std::files (dir &optional match)
  `(with-temp-buffer
     (cl-loop
      for file in (directory-files ,dir :full ,match :no-sort)
      if (not (or (string-suffix-p "/." file)
                  (string-suffix-p "/.." file)))
      collect file)))

(defconst std::module-dir (concat std::emacs-dir "modules"))
(defconst std::autoloads-dir (concat std::emacs-dir "modules/autoloads"))
(defconst std::pkg-build-dir (concat user-emacs-directory "straight/build"))

;; Todo rename bootstrap
(defconst std::init-packages (getenv "EMACS_INIT_PACKAGES"))
(defconst std::pkg-directories
  (eval-when-compile
    (when (file-exists-p std::pkg-build-dir)
      (std::files std::pkg-build-dir))))
(defconst std::pkg-autoload-files
  (eval-when-compile
    (let (files)
      (when (file-exists-p std::pkg-build-dir)
	(dolist (dir (std::files std::pkg-build-dir))
	  (dolist (file (std::files dir))
	    (when (string-suffix-p "autoloads.el" file)
	      (push file files)))))
      files)))

(if std::init-packages
    (progn
      (defvar bootstrap-version)
      (let ((bootstrap-file
             (concat user-emacs-directory "straight/repos/straight.el/bootstrap.el"))
            (bootstrap-version 5))
        (unless (file-exists-p bootstrap-file)
          (with-current-buffer
              (url-retrieve-synchronously
               "https://raw.githubusercontent.com/raxod502/straight.el/develop/install.el"
               'silent 'inhibit-cookies)
            (goto-char (point-max))
            (eval-print-last-sexp)))
        (load bootstrap-file nil 'nomessage)))
  (setf load-path (nconc load-path std::pkg-directories))
  (dolist (it std::pkg-autoload-files)
    (load it :no-error :no-message)))

(defmacro std::using-packages (&rest pkgs)
  `(if std::init-packages
       (dolist (pkg ',(mapcar (lambda (it) it) pkgs))
	 (straight-use-package pkg))
     (ignore ',pkgs)))

(std::using-packages
 dash
 pfuture)

(require 'dash)
(unless (bound-and-true-p dash-font-lock-done)
  (defvar dash-font-lock-done t)
  (dash-enable-font-lock))

(defmacro std::if-version (v &rest body)
  (declare (indent 1))
  (when (version<= (number-to-string v) emacs-version)
    `(progn ,@body)))

(defmacro std::after (features &rest body)
  "Run BODY after loading FEATURE.
    Same as `with-eval-after-load', but there is no need to quote FEATURES."
  (declare (debug (sexp body)) (indent 1))
  (setf features (if (listp features) (nreverse features) (list features)))
  (let* ((module (pop features))
         (form `(with-eval-after-load
                    ,(if (stringp module)
                         module
                       `(quote ,module))
                  ,@body)))
    (while features
      (-let [module (pop features)]
        (setf form `(with-eval-after-load
                        ,(if (stringp module)
                             module
                           `(quote ,module))
                      ,form))))
    form))

(defmacro std::static-assert (predicate &optional error-msg &rest error-args)
  (declare (indent 1))
  `(unless ,predicate
     (error (apply #'format
                   (or ,error-msg "Assertion Failure")
                   (list ,@error-args)))))

(defmacro std::autoload (location &rest cmds)
  (declare (indent 1))
  (let (form)
    (dolist (it cmds)
      (push `(autoload ,it ,(concat std::emacs-dir "modules/autoloads/" (symbol-name location)))
            form))
    `(progn
       ,@(nreverse form))))

(defmacro std::load (file)
  `(load (concat std::emacs-dir "modules/" ,file ".el") nil :no-messages))

(defmacro std::schedule (time repeat &rest body)
  (declare (indent 2))
  `(run-with-timer
    ,time ,(eq repeat :repeat)
    ,(pcase body
       (`((function ,_)) (car body))
       (_ `(lambda () ,@body)))))

(defmacro std::idle-schedule (time repeat &rest body)
  (declare (indent 2))
  `(run-with-idle-timer
    ,time ,(eq repeat :repeat)
    ,(pcase body
       (`((function ,_)) (car body))
       (_ `(lambda () ,@body)))))

(defgroup std nil
  "Std faces."
  :group 'std
  :prefix "std::")

(defmacro std::keybind (&rest keys)
  "All-in-one keybind macro.
Accepts the following segments:
 - :leader
 - :global
 - :keymap followed by keymap symbol
 - :mode-leader followed by major-mode symbol
 - :evil followed by evil state(s) and keymap or minor-mode symbol"
  (cl-flet ((as-kbd (key) (if (vectorp key) key `(kbd ,key))))
    (let ((forms)
          (segments (-partition-by-header #'keywordp keys)))
      (dolist (segment segments)
        (pcase (pop segment)
          (:leader
           (while segment
             (push
              `(evil-define-key '(normal motion visual) 'global ,(kbd (concat "<leader>" (pop segment))) ,(pop segment))
              forms)))
          (:global
           (while segment
             (push `(global-set-key ,(as-kbd (pop segment)) ,(pop segment)) forms)))
          (:keymap
           (let ((maps (pop segment))
                 (pairs (-partition-all 2 segment)))
             (unless (listp maps) (setf maps (list maps)))
             (dolist (map maps)
               (dolist (pair pairs)
                 (push `(define-key ,map ,(as-kbd (car pair)) ,(cadr pair)) forms)))))
          (:mode-leader
           (let* ((mode       (pop segment))
                  (leader-map (intern (format "std::%s-leader-map" (symbol-name mode))))
                  (mode-map   (intern (format "%s-map" (symbol-name mode)))))
             (unless (boundp leader-map)
               (push `(defvar ,leader-map (make-sparse-keymap)) forms)
               (push `(evil-define-key '(normal motion) ,mode-map "," ,leader-map) forms))
             (while segment
               (push `(define-key ,leader-map ,(as-kbd (pop segment)) ,(pop segment)) forms))))
          (:evil
           (let* ((states (pop segment))
                  (maps (pop segment))
                  (pairs (-partition-all 2 segment)))
             (if (and (sequencep maps)
                      (= 2 (length maps))
                      (eq 'quote (car maps)))
                 (dolist (pair pairs)
                   (push `(evil-define-key ',states ,maps ,(as-kbd (car pair)) ,(cadr pair)) forms))
               (unless (listp maps) (setf maps (list maps)))
               (dolist (map maps)
                 (dolist (pair pairs)
                   (push `(evil-define-key ',states ,map ,(as-kbd (car pair)) ,(cadr pair)) forms))))))))
      `(progn ,@(nreverse forms)))))

(defmacro std::add-hook (hook-var &rest forms)
  (declare (indent 1))
  `(add-hook ,hook-var (lambda () ,@forms)))

(defmacro std::advice-add (advice where fns &optional ignore-args)
  (declare (indent 2))
  (unless (listp fns)
    (setf fns (list fns)))
  (when (and (= 2 (length fns))
             (eq 'function (car fns)))
    (setf fns (list (cadr fns))))
  (when ignore-args
    (setf advice `(lambda (&rest _) (,(cadr advice)))))
  (let (forms)
    (dolist (fn fns)
      (push `(advice-add #',fn ,where ,advice) forms))
    `(progn ,@(nreverse forms))))

(defmacro std::add-transient-advice (advice-name where fns &rest body)
  (declare (indent 3))
  (unless (listp fns)
    (setf fns (list fns)))
  (when (and (= 2 (length fns))
             (eq 'function (car fns)))
    (setf fns (list (cadr fns))))
  (let ((add-adv-forms nil)
        (rem-adv-forms nil))
    (dolist (fn fns)
      (push `(std::advice-add #',advice-name ,where #',fn) add-adv-forms)
      (push `(advice-remove #',fn #',advice-name) rem-adv-forms))
    `(progn
       (defun ,advice-name ()
         ,@body
         ,@rem-adv-forms)
       ,@add-adv-forms)))

(defmacro std::silent (&rest body)
  `(let ((inhibit-message t)) ,@body))

(defmacro std::time (name &rest body)
  (declare (indent 1))
  `(let ((start (float-time)))
     ,@body
     (message "Finish %s in %.3fs" ,name (- (float-time) start))))

(defmacro std::face (str face)
  `(propertize ,str 'face ,face))
