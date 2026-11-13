---
name: diff-review
description: Use when the operator wants to see, review, or comment on a jj diff (a change, a stack, a range), or asks for the diff in Lavish.
---

Show the diff with `lavish-kit diff [range]`; `lavish-kit --help` lists the
range options. Run it in the foreground and read the page path from its
output. The command returns, and the page's worker watches the diff until
the Lavish session ends. There is no `--watch` option or watch job to manage.
A patch piped to `lavish-kit diff -` is a snapshot.

Inside herdr, feedback arrives automatically; do not poll. Outside herdr,
the agent polls. Follow @skill:lavish for the session and polling rules.
When the review is done, end it with `lavish-axi end "<page>"`.
