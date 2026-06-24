# Vim → Helix Cheat Sheet

A reference for a fluent Vim user moving to Helix (or Helix emulation). Helix's
keys are based on [Kakoune](https://kakoune.org/), not Vim, so the *grammar* is
inverted. Read the "Mental Model" section first — most of your friction comes
from that one inversion, not from memorizing keys.

Source of truth: <https://docs.helix-editor.com/keymap.html> (this sheet is
distilled from the official keymap, textobjects, and surround docs).

---

## The Mental Model (read this first)

**Vim is `verb → noun`. Helix is `noun → verb`.**

- Vim: `d` `w` — "delete a word." You state the action, then the target.
- Helix: `w` `d` — "(select to) next word, then delete it." You select the
  target first (and *see* the selection), then act on it.

Consequences that follow from this single rule:

1. **Every motion moves *and selects*.** `w`, `e`, `b`, `f`, `t`, `/` all create
   or replace a selection. There is always a selection (minimum: one char under
   the cursor).
2. **Operators take no motion.** `d`, `c`, `y`, `>`, `~`, `r` act on the
   *current selection*. They are complete commands by themselves.
3. **The selection is the object.** Instead of "delete inside parens" (`di(`)
   you "select inside parens, then delete" (`mi(` then `d`).
4. **Feedback is immediate.** You can verify what you're about to operate on
   before you commit, because it's highlighted.

If you internalize "select, *then* act," 80% of the surprises disappear.

---

## Gotchas That Bite Vim Users (the short list)

These are the specific differences that make a Vim user feel broken. Memorize
these even if you skip the rest.

| You press | Vim does | Helix does | What you actually want |
| --- | --- | --- | --- |
| `x` | delete char | **selects the whole line** | delete char → `d` (one char is already selected) |
| `dd` | delete line | nothing useful (`d` deletes the 1-char selection) | delete line → `x` `d` |
| `%` | jump to matching bracket | **selects the entire file** | match bracket → `m` `m` |
| `0` | go to line start | **starts a count** (digit prefix) | line start → `g` `h` (or `Home`) |
| `$` | go to line end | nothing | line end → `g` `l` |
| `^` | first non-blank | nothing | first non-blank → `g` `s` |
| `Ctrl-r` | redo | (insert-mode register paste) | **redo → `U`** (capital U) |
| `s` | substitute char | **select all regex matches in selection** | substitute → `c` (after selecting) |
| `S` | change line | **split selection on regex** | — |
| `r` | replace one char | replaces **every selected char** | same idea, but watch multi-char selections |
| `cw` | change word | `c` changes 1-char selection | `c` after a word motion: `w` `c` or `e` `c` |
| `;` `,` | repeat / reverse f-find | `;` collapses selection, `,` keeps primary cursor | repeat last find → `Alt-.` |
| `.` | repeat last *change* | repeats last *insert* only | (no general "repeat change"; use macros) |
| `i(` `a(` etc. | textobject (after operator) | not directly — live under `m` | inside parens → `m` `i` `(` |
| `q{reg}` | record macro | `Q` records, `q` replays | record → `Q`, replay → `q` |

Also note: **`f` `t` `F` `T` are NOT confined to the current line** in Helix —
they search across line breaks.

---

## Core Edits — Vim Idiom → Helix Sequence

Read each Helix sequence as "select…, then act." Spaces are for clarity; type
the keys in order.

### Word / text-object edits

| Vim | Helix | Notes |
| --- | --- | --- |
| `dw` | `w` `d` | `w` selects to next word start (incl. trailing space), then delete |
| `diw` | `m` `i` `w` `d` | select **i**nside **w**ord, delete |
| `daw` | `m` `a` `w` `d` | select **a**round word (incl. space), delete |
| `ciw` | `m` `i` `w` `c` | the everyday "change this word" |
| `caw` | `m` `a` `w` `c` | |
| `cw` / `ce` | `e` `c` | `e` selects to end of word (Vim's `cw` secretly acts like `ce`) |
| `yiw` | `m` `i` `w` `y` | |
| `de` | `e` `d` | |
| `db` | `b` `d` | |
| `di(` | `m` `i` `(` `d` | inside parens; `[`, `{`, `<`, `'`, `"`, `` ` `` all work |
| `da{` | `m` `a` `{` `d` | around braces |
| `ci"` | `m` `i` `"` `c` | |
| `dip` | `m` `i` `p` `d` | inside paragraph |
| `dt,` | `t` `,` `d` | "till comma" selects up to comma, then delete |
| `df)` | `f` `)` `d` | "find )" includes the `)` in selection |
| `cf;` | `f` `;` `c` | |

Textobject keys after `mi`/`ma`: `w` word, `W` WORD, `p` paragraph, `(`/`[`/`{`/`<`/`'`/`"`/`` ` `` pairs,
`m` *closest* surround pair, and (with tree-sitter) `f` function, `t` type/class,
`a` argument, `c` comment, `T` test, `x` (X)HTML element.

### Line edits

| Vim | Helix | Notes |
| --- | --- | --- |
| `dd` | `x` `d` | `x` selects the line (incl. newline), then delete |
| `cc` / `S` | `x` `c` | ⚠️ also consumes the newline (merges into prev line); to keep the line, select content only: `g` `h` then `v` `g` `l` `c` |
| `yy` | `x` `y` | yank line |
| `>>` | `>` | `>` indents the line(s) the selection touches |
| `<<` | `<` | |
| `J` | `J` | join lines — same key |
| `5dd` | `5` `x` `d` | count selects 5 lines, then delete |
| `ddp` | `x` `d` `p` | classic line-swap-down |

### To end of line

| Vim | Helix | Notes |
| --- | --- | --- |
| `D` | `v` `g` `l` `d` | enter select mode, extend to line end, delete |
| `C` | `v` `g` `l` `c` | ⚠️ `C` alone in Helix = "add cursor below" |
| `Y` (`y$`) | `v` `g` `l` `y` | |
| `x` (del char) | `d` | one char is already selected |
| `r{c}` | `r{c}` | same — but replaces every selected char |
| `~` | `~` | switches case of whole selection |

---

## Movement

| Vim | Helix | Notes |
| --- | --- | --- |
| `h j k l` | `h j k l` | same |
| `w b e` `W B E` | `w b e` `W B E` | same keys — but they **select** |
| `0` | `g` `h` | `0` is a count prefix in Helix! |
| `^` | `g` `s` | first non-whitespace |
| `$` | `g` `l` | end of line |
| `gg` | `g` `g` | top of file |
| `G` | `g` `e` | end of file (`G` alone isn't bound; `<n>G` goes to line n) |
| `42G` / `:42` | `42` `G` or `42` `g` `g` | go to line 42 |
| `f t F T` | `f t F T` | same, but **not line-bound** and they select |
| `;` (repeat find) | `Alt-.` | `;` means "collapse selection" in Helix |
| `%` (match) | `m` `m` | `%` selects the whole file in Helix |
| `{` `}` | `[p` `]p` | previous/next paragraph |
| `Ctrl-d` `Ctrl-u` | `Ctrl-d` `Ctrl-u` | half-page down/up |
| `Ctrl-f` `Ctrl-b` | `Ctrl-f` `Ctrl-b` | page down/up |
| `Ctrl-o` `Ctrl-i` | `Ctrl-o` `Ctrl-i` | jumplist back/forward |
| `zz` `zt` `zb` | `z` `z` / `z` `t` / `z` `b` | center / top / bottom (view mode) |
| `H M L` | `g` `t` / `g` `c` / `g` `b` | top/center/bottom of screen |
| `*` | `*` | search word under selection |

---

## Insert / Modes

| Vim | Helix | Notes |
| --- | --- | --- |
| `i a I A o O` | `i a I A o O` | identical |
| `v` | `v` | enters **select/extend mode**: movements now *extend* the selection (a toggle, not Vim's transient visual) |
| `V` (line visual) | `x` | select line(s); repeat `x` to grow |
| `Ctrl-v` (block) | *(no direct equiv)* | use multi-cursors: `C` adds a cursor on the next line |
| `Esc` | `Esc` | back to normal mode |
| `:` | `:` | command mode (`:w`, `:q`, `:wq`, `:w!`, `:q!` all work) |

In **select mode** (`v`), goto motions also extend — e.g. `v` `g` `l` selects to
end of line. Press `;` to collapse a selection back to a single cursor, or `,`
to drop all but the primary cursor.

---

## Undo / Redo / Registers / Macros

| Vim | Helix | Notes |
| --- | --- | --- |
| `u` | `u` | undo |
| `Ctrl-r` | `U` | **redo is capital `U`** |
| `g-` `g+` | `Alt-u` `Alt-U` | step backward/forward through edit history |
| `"ayy` (yank to reg a) | `"a` `x` `y` | `"` selects the register first, then the command |
| `"ap` | `"a` `p` | paste from register a |
| `qa … q` | `Q … Q` | record macro to selected register (default reg) |
| `@a` | `q` | replay macro |
| `p` / `P` | `p` / `P` | paste after / before selection (linewise if yanked linewise) |
| `"+y` (system clip) | `Space` `y` | yank to system clipboard; `Space` `p` pastes it |

---

## Search & Replace

Helix has **no `:%s/old/new/g`**. You select matches and change them — the
multi-cursor flow replaces ex-substitute.

| Goal | Vim | Helix |
| --- | --- | --- |
| Search | `/foo` | `/foo` `Enter` (the match becomes the selection) |
| Next / prev match | `n` / `N` | `n` / `N` |
| Replace word under cursor everywhere | `:%s/\<foo\>/bar/g` | `*` then `n`… or use the select-all flow below |
| Replace all in file | `:%s/foo/bar/g` | `%` (select file) → `s` → type `foo` `Enter` (selects every match as multi-cursors) → `c` → type `bar` → `Esc` |
| Replace in a region | `:'<,'>s/…` | select the region → `s` → regex `Enter` → `c` → new text `Esc` |

`s` = "select all regex matches *inside* the current selection." This is the
single most powerful Helix idiom and has no Vim equivalent. `S` splits the
selection on a regex; `K`/`Alt-K` keep/remove selections matching a regex.

---

## Multiple Cursors (Helix superpower, no Vim default)

| Key | Action |
| --- | --- |
| `C` | Add a cursor on the next line (copy selection down) |
| `Alt-C` | Add a cursor on the previous line |
| `s` | Select all regex matches within selection (turns 1 selection into many) |
| `S` | Split selection on regex |
| `,` | Keep only the primary selection (collapse multi-cursor) |
| `Alt-,` | Remove the primary selection |
| `;` | Collapse each selection to a single cursor |
| `Alt-;` | Flip anchor and cursor of each selection |
| `(` / `)` | Rotate which selection is primary |
| `&` | Align selections in columns |
| `_` | Trim whitespace from selections |

Typical flow: `x` (select a line block) → `s` `,` `Enter` (cursor at each
comma) → edit all at once.

---

## Surround (built in, vim-surround-like)

Surround commands live under `m` (match mode). The order is
"select text first, then `ms`."

| Vim (vim-surround) | Helix | Action |
| --- | --- | --- |
| `ysiw)` | `m` `i` `w` then `m` `s` `)` | surround word with `()` |
| `viw S"` | select text, then `m` `s` `"` | surround selection with quotes |
| `cs"'` | `m` `r` `"` `'` | replace closest `"` surround with `'` |
| `ds(` | `m` `d` `(` | delete closest `()` surround |

Counts act on outer pairs (e.g. `2mr` targets the second-closest pair).

---

## Goto Mode (`g`) — quick reference

| Key | Action |
| --- | --- |
| `g` `g` | start of file (`<n>gg` → line n) |
| `g` `e` | end of file |
| `g` `h` / `g` `l` | line start / line end |
| `g` `s` | first non-whitespace of line |
| `g` `d` | go to definition (LSP) |
| `g` `r` | go to references (LSP) |
| `g` `y` | go to type definition (LSP) |
| `g` `i` | go to implementation (LSP) |
| `g` `t` / `g` `c` / `g` `b` | top / center / bottom of screen |
| `g` `a` | last accessed (alternate) file |
| `g` `n` / `g` `p` | next / previous buffer |
| `g` `.` | last modification location |

---

## Space Mode (`Space`) — pickers & LSP (≈ Vim leader)

| Key | Action |
| --- | --- |
| `Space` `f` | file picker (workspace root) |
| `Space` `F` | file picker (current dir) |
| `Space` `b` | buffer picker |
| `Space` `j` | jumplist picker |
| `Space` `s` | document symbol picker (LSP) |
| `Space` `S` | workspace symbol picker (LSP) |
| `Space` `/` | global search (grep across workspace) |
| `Space` `'` | reopen last picker |
| `Space` `k` | hover docs (LSP) |
| `Space` `r` | rename symbol (LSP) |
| `Space` `a` | code action (LSP) |
| `Space` `d` / `Space` `D` | document / workspace diagnostics |
| `Space` `y` / `Space` `p` | yank to / paste from system clipboard |
| `Space` `c` | toggle comments |
| `Space` `?` | command palette (search all commands) |

---

## Window Mode (`Ctrl-w`) — same spirit as Vim

| Key | Action |
| --- | --- |
| `Ctrl-w` `v` | vertical split |
| `Ctrl-w` `s` | horizontal split |
| `Ctrl-w` `h/j/k/l` | move to split in direction |
| `Ctrl-w` `q` | close window |
| `Ctrl-w` `o` | close all other windows |
| `Ctrl-w` `H/J/K/L` | swap split in direction |

---

## Bracket Motions (`[` / `]`, vim-unimpaired style)

| Key | Action |
| --- | --- |
| `]d` / `[d` | next / previous diagnostic |
| `]f` / `[f` | next / previous function (tree-sitter) |
| `]a` / `[a` | next / previous argument |
| `]t` / `[t` | next / previous type/class |
| `]c` / `[c` | next / previous comment |
| `]p` / `[p` | next / previous paragraph |
| `]g` / `[g` | next / previous change (git hunk) |
| `]Space` / `[Space` | add blank line below / above |

---

## Quick Survival Crib (the absolute minimum)

- Delete char: `d` · Delete line: `xd` · Delete word: `wd`
- Change word: `miw c` · Change inside (…): `mi( c`
- Undo: `u` · **Redo: `U`** · Repeat find: `Alt-.`
- Line start: `gh` · Line end: `gl` · File top: `gg` · File end: `ge`
- Match bracket: `mm` · Select whole file: `%`
- Save/quit: `:w` / `:q` / `:wq`
- Find files: `Space f` · Grep: `Space /` · Command palette: `Space ?`
- Replace-all: `% s pattern Enter c newtext Esc`
- When confused, press `Esc`, then `;` to collapse the selection and start clean.

---

## If You Want to Soften the Transition

Helix keys are remappable in `~/.config/helix/config.toml` under `[keys.normal]`.
Common Vim-comfort remaps people add: `g` `=` for nothing, or rebinding `0`→
`goto_line_start`, `$`→`goto_line_end`, `D`→ a select-to-EOL-then-delete macro.
But the maintainers (and most converts) recommend living with the Kakoune model
for a couple of weeks before remapping — the muscle memory flips faster than you'd
expect, and the multi-cursor payoff is real.

Full keymap: <https://docs.helix-editor.com/keymap.html>
