// Interrupt-and-continue: while a turn runs, the user can fire a new
// question that cancels the running turn, runs immediately, and then
// resumes the interrupted work (stacked when interrupts nest). The last
// resume turn also asks for a final answer covering all the work.
export const INTERRUPT_PARTIAL_TAIL = 2000;

export function emptyInterruptChain() {
  return { pending: null, turnPrompt: null, stack: [] };
}

export function normalizeInterruptChain(chain) {
  if (!chain || typeof chain !== 'object') return emptyInterruptChain();
  const stack = Array.isArray(chain.stack)
    ? chain.stack
        .filter((entry) => entry && typeof entry.prompt === 'string' && entry.prompt.trim())
        .map((entry) => ({
          prompt: entry.prompt,
          partial: typeof entry.partial === 'string' ? entry.partial : '',
        }))
    : [];
  return {
    pending: typeof chain.pending === 'string' && chain.pending.trim() ? chain.pending : null,
    turnPrompt: typeof chain.turnPrompt === 'string' ? chain.turnPrompt : null,
    stack,
  };
}

// Arm a handoff: returns the unchanged chain when there is nothing to send
// or a previous handoff is still waiting for its run to end.
export function armInterruptChain(chain, text, turnPrompt) {
  const current = normalizeInterruptChain(chain);
  const question = typeof text === 'string' ? text.trim() : '';
  if (!question || current.pending) return current;
  return {
    pending: question,
    turnPrompt: typeof turnPrompt === 'string' ? turnPrompt : '',
    stack: current.stack,
  };
}

export function tailInterruptPartial(partial) {
  if (typeof partial !== 'string' || !partial) return '';
  return partial.length > INTERRUPT_PARTIAL_TAIL ? partial.slice(-INTERRUPT_PARTIAL_TAIL) : partial;
}

// Decide the next send when a run ends. The interrupted turn's prompt is
// pushed for resume only when the turn did NOT complete (a turn that
// finished on its own needs no resume).
export function popInterruptChain(chain, completedSuccessfully, partial) {
  const current = normalizeInterruptChain(chain);
  if (current.pending) {
    const stack =
      completedSuccessfully || !current.turnPrompt || !current.turnPrompt.trim()
        ? current.stack
        : [...current.stack, { prompt: current.turnPrompt, partial: tailInterruptPartial(partial) }];
    return {
      send: current.pending,
      sendKind: 'question',
      sendEntry: null,
      isFinal: false,
      dropped: false,
      chain: { pending: null, turnPrompt: null, stack },
    };
  }
  if (current.stack.length === 0) {
    return { send: null, sendKind: null, sendEntry: null, isFinal: false, dropped: false, chain: current };
  }
  if (!completedSuccessfully) {
    return { send: null, sendKind: null, sendEntry: null, isFinal: false, dropped: true, chain: emptyInterruptChain() };
  }
  const sendEntry = current.stack[current.stack.length - 1];
  return {
    send: null,
    sendKind: 'resume',
    sendEntry,
    isFinal: current.stack.length === 1,
    dropped: false,
    chain: { pending: null, turnPrompt: null, stack: current.stack.slice(0, -1) },
  };
}

const RESUME_PROMPT = {
  ko: {
    head: '[인터럽트된 작업 이어하기] 아래 원래 요청에 대한 작업이 중간에 끊겼다. 지금까지의 진행을 이어서 계속하라.\n',
    partialHead: '\n--- 중단 시점까지의 진행 ---\n',
    originalHead: '\n--- 원래 요청 ---\n',
    cont: '\n이 턴에서는 이어서 작업만 계속하라.',
    fin: '\n모든 작업(원래 요청 + 중간 추가 질문들)이 끝난 뒤에는 마지막에 전체 작업에 대한 최종 답변을 정리해서 줘라.',
  },
  en: {
    head: '[Resume interrupted work] The work on the original request below was cut off midway. Continue from the progress so far.\n',
    partialHead: '\n--- Progress up to the interruption ---\n',
    originalHead: '\n--- Original request ---\n',
    cont: '\nThis turn: just keep working.',
    fin: '\nOnce all the work (original request + follow-up questions) is done, finish with a final answer covering everything.',
  },
};

export function buildResumePrompt(original, partial, lang = 'ko', isFinal = true) {
  const t = RESUME_PROMPT[lang === 'en' ? 'en' : 'ko'];
  const tail = tailInterruptPartial(partial);
  return (
    t.head +
    (tail ? `${t.partialHead}${tail}` : '') +
    `${t.originalHead}${String(original == null ? '' : original)}` +
    (isFinal ? t.fin : t.cont)
  );
}

// Inactive session: nothing auto-sends, so flatten the chain into plain
// queue strings (first-to-run first) to preserve every piece of work.
export function flattenInterruptChain(chain, lang = 'ko') {
  const current = normalizeInterruptChain(chain);
  const items = [];
  if (current.pending) items.push(current.pending);
  for (let i = current.stack.length - 1; i >= 0; i--) {
    const entry = current.stack[i];
    items.push(buildResumePrompt(entry.prompt, entry.partial, lang, i === 0));
  }
  return items;
}
