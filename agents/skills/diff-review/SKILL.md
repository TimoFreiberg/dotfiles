---
name: diff-review
description: Use when the operator wants to see, review, or comment on a jj diff (a change, a stack, a range), or asks for the diff in Lavish.
---

Show the diff with `lavish-view diff [range] --watch` as a tracked background
job; `lavish-view --help` lists the range options. The job keeps running, so
read its first output line from the running job instead of waiting for it to
finish. Follow @skill:lavish for the session and polling rules. When the
review is done, end the Lavish session and stop the watch job.
