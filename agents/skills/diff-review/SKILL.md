---
name: diff-review
description: Use when the operator wants to see, review, or comment on a jj diff (a change, a stack, a range), or asks for the diff in Lavish.
---

If the operator asks to review in Zed, run `zed-review open [revset]` from
your herdr terminal instead: it opens the diff in Zed, and their comments
arrive in this terminal as one pasted message. Address them like Lavish
comments.

Otherwise show the diff with `lavish-view diff -r '<revset>' --watch` as a
tracked background job. Follow @skill:lavish for the session and polling rules.
When the review is done, end the Lavish session and stop the watch job.
