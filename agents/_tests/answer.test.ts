/**
 * Unit tests for answer.ts's pure transcript formatter (`formatQnA`).
 *
 * The interactive widget (QnAComponent) needs a manual TUI check, but the
 * question -> transcript text logic is pure and worth pinning down: it is the
 * core fix (the full Q&A must survive into the transcript).
 *
 * IMPORTANT — this file lives in `agents/_tests/`, NOT `agents/extensions/`,
 * because pi auto-discovers every `.ts`/`.js` directly under `extensions/` and
 * tries to load it as an extension. A test file there fails to load (no factory
 * export) AND runs its tests on every pi startup. Keep tests out of that tree.
 *
 * Run with bun. `bun test` resolves bare imports relative to the test file, so
 * the pi packages (which live under the global pi install, not in this repo)
 * must be reachable via a local `node_modules`. Build a throwaway tree that
 * mirrors the repo layout (`extensions/answer.ts` + `_tests/answer.test.ts`),
 * symlink the pi packages in, and run there:
 *
 *   PI=$(npm root -g)/@earendil-works/pi-coding-agent
 *   TMP=$(mktemp -d); mkdir -p "$TMP/node_modules/@earendil-works" \
 *     "$TMP/extensions" "$TMP/_tests"
 *   ln -s "$PI" "$TMP/node_modules/@earendil-works/pi-coding-agent"
 *   for p in pi-ai pi-tui pi-agent-core; do \
 *     ln -s "$PI/node_modules/@earendil-works/$p" \
 *       "$TMP/node_modules/@earendil-works/$p"; done
 *   ln -s "$PI/node_modules/typebox" "$TMP/node_modules/typebox"
 *   cp agents/extensions/answer.ts "$TMP/extensions/"
 *   cp agents/_tests/answer.test.ts "$TMP/_tests/"
 *   (cd "$TMP" && bun test _tests/answer.test.ts)
 *
 * Only the pure `formatQnA` path is exercised; nothing here touches the TUI.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyAnswer,
  type ExtractedQuestion,
  formatQnA,
  type QnAAnswer,
  runQnAWidget,
} from "../extensions/answer.ts";

function answer(partial: Partial<QnAAnswer>): QnAAnswer {
  return { ...emptyAnswer(), ...partial };
}

// Minimal pi/ctx doubles for the non-tui routing in runQnAWidget. The TUI branch
// (ctx.mode === "tui" → ctx.ui.custom) needs a real terminal and is checked by
// hand; these only drive the remote-host paths.
// biome-ignore lint/suspicious/noExplicitAny: test doubles for pi's wide types.
const fakePi = { events: { emit() {} } } as any;

test("free-text answer: records the typed text under A:", () => {
  const questions: ExtractedQuestion[] = [
    {
      question: "What is your preferred database?",
      context: "MySQL or PG only.",
    },
  ];
  const answers: QnAAnswer[] = [answer({ customText: "PostgreSQL" })];

  const out = formatQnA(questions, answers);

  assert.match(out, /Q: What is your preferred database\?/);
  assert.match(out, /> MySQL or PG only\./); // context preserved
  assert.match(out, /A: PostgreSQL/);
  assert.doesNotMatch(out, /Options:/); // no options block for free-text
});

test("single-select: records the chosen option label and the options block", () => {
  const questions: ExtractedQuestion[] = [
    {
      question: "Pick a language",
      options: [
        { label: "TypeScript" },
        { label: "Python" },
        { label: "Rust" },
      ],
    },
  ];
  const answers: QnAAnswer[] = [answer({ selectedOptionIndices: [1] })];

  const out = formatQnA(questions, answers);

  assert.match(out, /Q: Pick a language/);
  assert.match(out, /Options:/);
  assert.match(out, /\[ \] TypeScript/);
  assert.match(out, /\[x\] Python/); // selected option marked
  assert.match(out, /\[ \] Rust/);
  assert.match(out, /A: Python/); // answer line names the picked label
});

test("multi-select: records every chosen option label, joined", () => {
  const questions: ExtractedQuestion[] = [
    {
      question: "Which targets?",
      multiSelect: true,
      options: [{ label: "macOS" }, { label: "Linux" }, { label: "Windows" }],
    },
  ];
  const answers: QnAAnswer[] = [answer({ selectedOptionIndices: [0, 2] })];

  const out = formatQnA(questions, answers);

  assert.match(out, /\[x\] macOS/);
  assert.match(out, /\[ \] Linux/);
  assert.match(out, /\[x\] Windows/);
  assert.match(out, /A: macOS, Windows/); // both picks recorded
});

test("no answer: emits the (no answer) placeholder", () => {
  const questions: ExtractedQuestion[] = [{ question: "Anything to add?" }];
  const answers: QnAAnswer[] = [emptyAnswer()];

  const out = formatQnA(questions, answers);

  assert.match(out, /Q: Anything to add\?/);
  assert.match(out, /A: \(no answer\)/);
});

test("choice question with a free-text escape records the typed value", () => {
  const questions: ExtractedQuestion[] = [
    {
      question: "Framework?",
      options: [{ label: "React" }, { label: "Vue" }],
    },
  ];
  // The widget clears option selections when the escape is used.
  const answers: QnAAnswer[] = [answer({ customText: "Svelte" })];

  const out = formatQnA(questions, answers);

  assert.match(out, /Options:/);
  assert.match(out, /\[ \] React/);
  assert.match(out, /\[ \] Vue/);
  assert.match(out, /A: \(typed\) Svelte/); // typed escape marked distinctly
});

test("multiple questions: each Q/A pair is present and ordered", () => {
  const questions: ExtractedQuestion[] = [
    { question: "Q one", options: [{ label: "A" }, { label: "B" }] },
    { question: "Q two" },
  ];
  const answers: QnAAnswer[] = [
    answer({ selectedOptionIndices: [0] }),
    answer({ customText: "free response" }),
  ];

  const out = formatQnA(questions, answers);

  const idxQ1 = out.indexOf("Q: Q one");
  const idxQ2 = out.indexOf("Q: Q two");
  assert.ok(idxQ1 >= 0 && idxQ2 >= 0, "both questions present");
  assert.ok(idxQ1 < idxQ2, "questions kept in order");
  assert.match(out, /A: A/);
  assert.match(out, /A: free response/);
});

test("non-tui host with a qna form: forwards questions and formats answers", async () => {
  const questions: ExtractedQuestion[] = [
    { question: "Pick", options: [{ label: "A" }, { label: "B" }] },
    { question: "Free?" },
  ];
  let received: ExtractedQuestion[] | undefined;
  const ctx = {
    mode: "rpc",
    ui: {
      qna: async (qs: ExtractedQuestion[]): Promise<QnAAnswer[]> => {
        received = qs;
        return [
          { selectedOptionIndices: [1], customText: "" },
          { selectedOptionIndices: [], customText: "yep" },
        ];
      },
      notify() {
        throw new Error("must not notify when a qna form is available");
      },
    },
    // biome-ignore lint/suspicious/noExplicitAny: ctx double for the test.
  } as any;

  const out = await runQnAWidget(fakePi, ctx, questions);

  assert.deepEqual(received, questions); // forwarded as-is across the bridge
  assert.ok(out);
  assert.match(out, /A: B/); // picked option label
  assert.match(out, /A: yep/); // free-text answer
});

test("non-tui host without a qna form: notifies and returns null (no throw)", async () => {
  let notified = "";
  const ctx = {
    mode: "print",
    ui: {
      notify: (message: string) => {
        notified = message;
      },
    },
    // biome-ignore lint/suspicious/noExplicitAny: ctx double for the test.
  } as any;

  const out = await runQnAWidget(fakePi, ctx, [{ question: "Anything?" }]);

  assert.equal(out, null);
  assert.match(notified, /terminal|pilot/i);
});

test("non-tui qna form cancelled (null answers): returns null", async () => {
  const ctx = {
    mode: "rpc",
    ui: { qna: async (): Promise<QnAAnswer[] | null> => null, notify() {} },
    // biome-ignore lint/suspicious/noExplicitAny: ctx double for the test.
  } as any;

  const out = await runQnAWidget(fakePi, ctx, [{ question: "Anything?" }]);

  assert.equal(out, null);
});
