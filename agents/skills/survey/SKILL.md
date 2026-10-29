---
name: survey
description: "Use before planning work that touches code or systems the operator doesn't know well, or when the operator wants to understand the shape of a change before it's planned"
---

The goal is the operator's understanding, not a plan. When the survey is done,
the operator knows which systems the change touches, why it has the size it
has, and which parts are open, before any plan or code exists. Don't write an
implementation plan or code here; the map's slices are as close to planning
as this gets.

1. Ask the operator for a brain dump of what they think needs to happen and
   what they know or suspect. If the invoking message already contains it,
   use that. If the work has a Jira ticket, read it first with
   [`ticket-context`](../task-ticket/ticket-context) and treat it as part of
   the dump. Don't correct it yet; that's the next step.
2. Check it against the code with subagents. Mark each claim confirmed, wrong
   (with evidence), or unknown. Unknown means the code can't answer it
   (intent, plans, ownership decisions); everything else, find out. Then add
   what the dump missed: the surfaces the change touches, their callers, and
   existing code built on an assumption the change breaks (callers that
   expect a raw fd, say, not an opaque client handle). Facts are your job;
   never ask the operator to look things up.
3. Give a short overview of how the systems interact today and where the
   change lands, with file references.
4. Quiz the operator on the overview, one question at a time, in the style
   of @skill:review-quiz, favoring the parts their dump left out. Explain
   anything they don't know rather than grading it. Continue until they
   could explain the change to the touched systems' maintainers without
   notes; they can stop early.
5. Post a map of at most one page as a chat message: the outcome; the
   systems, their owners, and who should see the map before planning; which
   side changes and why, including any cheaper change in another system or
   an upstream dependency; assumptions; unknowns and how to settle them;
   slices, each a reviewable PR; a rough sense of size.

Then hand off to @skill:task-ticket for the slices and @skill:plan-task for
the first slice.
