---
name: debug
description: "Use when a test failure, regression, exception, hang, wrong result, or unexpected behavior needs diagnosis."
---

Diagnose an observed failure before changing code.
Trace the code from the failure and consider several hypotheses before settling
on a root cause. Note contributing factors worth fixing along the way.

If you're already writing code in this session or were asked to fix it,
reproduce the failure with a failing test, then make the minimal fix.
Otherwise stay read-only and propose the test and fix instead.

Report succinctly, using only terminology from the codebase or this session:
- the root cause, or the most likely candidate if unproven
- the evidence: code locations and the failing or proposed test
- contributing factors worth addressing
- the minimal fix, applied or recommended
