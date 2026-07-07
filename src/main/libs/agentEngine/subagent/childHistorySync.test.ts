import { describe, expect, test } from 'vitest';

import type { CoworkMessage } from '../../../coworkStore';
import {
  buildSubagentChildHistorySyncPlan,
  normalizeSubagentVisibleUserText,
} from './childHistorySync';

describe('subagent child history sync', () => {
  test('normalizes outbound subagent prompts to the visible user request', () => {
    const rawOutboundPrompt = `[LobsterAI system instructions]
hidden setup

[Context bridge from previous LobsterAI conversation]
previous context

[Current user request]
rewrite the intro`;

    expect(normalizeSubagentVisibleUserText(rawOutboundPrompt)).toBe('rewrite the intro');
  });

  test('preserves visible local user text instead of raw outbound prompt', () => {
    const rawOutboundPrompt = `[LobsterAI system instructions]
hidden setup

[Current user request]
rewrite the intro`;
    const localMessages: CoworkMessage[] = [
      { id: 'msg-1', type: 'user', content: rawOutboundPrompt, timestamp: 1, metadata: {} },
      { id: 'msg-2', type: 'assistant', content: 'new intro', timestamp: 2, metadata: {} },
    ] as CoworkMessage[];

    const plan = buildSubagentChildHistorySyncPlan(localMessages, [
      { role: 'user', content: rawOutboundPrompt, timestamp: 10 },
      { role: 'assistant', content: 'new intro', timestamp: 20 },
    ]);

    expect(plan.changed).toBe(true);
    expect(plan.cursor).toBe(2);
    expect(plan.entriesToStore).toEqual([
      { role: 'user', text: 'rewrite the intro', timestamp: 1, metadata: {} },
      { role: 'assistant', text: 'new intro', timestamp: 20 },
    ]);
  });
});
