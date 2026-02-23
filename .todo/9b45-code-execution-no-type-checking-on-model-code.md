---
title: 'code-execution: no type checking on model code'
created: '2026-02-23T20:02:14.748356'
status: open
---

Code is compiled via new Function (raw JS eval). callSignature docs suggest TypeScript but it's untyped JS. A quick tsc --noEmit pass before execution could catch errors before runtime.
