---
name: diff-review
description: Use when the operator wants to see, review, or comment on a jj diff (a change, a stack, a range), or asks for the diff in Lavish.
---

Show the diff with `lavish-kit diff [range]` (`lavish-kit --help` lists the
range options). Run it in the foreground and take the page path from its
output. The command returns right away, and the page's worker keeps the diff
up to date until the Lavish session ends, so there's no `--watch` option or
background job. A patch piped to `lavish-kit diff -` is a snapshot.

lavish-kit prints whether feedback is delivered automatically or needs
polling. Follow that line and @skill:lavish for the session and polling rules.
When the review is done, end it with `lavish-axi end "<page>"`.
