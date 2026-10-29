---
name: survey
description: "Use before planning work that touches code or systems the operator doesn't know well, or when the operator wants to understand the shape of a change before it's planned"
---

The goal is the operator's understanding, not a plan. When the survey is done,
the operator knows which systems the change touches, why it has the size it
has, and which parts are open, before any plan or code exists. Don't plan or
write code here.

1. Ask the operator for a brain dump of what they think needs to happen and
   what they know or suspect. Don't interrupt or correct while they dictate.
2. Check it against the code with subagents. Mark each claim confirmed, wrong
   (with evidence), or unknown. Then add what the dump missed: the surfaces
   the change touches, their callers, and existing code built on an
   assumption the change breaks (callers that expect a raw fd, say, not an
   opaque client handle). Facts are your job; never ask the operator to look
   things up.
3. Give a short overview of how the systems interact today and where the
   change lands, with file references.
4. Quiz the operator on the overview, one question at a time, in the style
   of @skill:review-quiz, favoring the parts their dump left out. Explain
   anything they don't know rather than grading it.
5. Write a map of at most one page: the outcome; the systems and their
   owners; which side changes and why, including any cheaper change in
   another system or an upstream dependency; assumptions; unknowns and how
   to settle them; slices, each a reviewable PR; a rough sense of size.
6. Name who should see the map before planning, usually the maintainers of
   the touched systems.

The survey is done when the operator says they could explain the change to
those maintainers without notes. Then hand off to @skill:task-ticket for the
slices and @skill:plan-task for the first slice.
