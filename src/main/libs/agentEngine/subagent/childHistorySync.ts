import type { CoworkMessage } from '../../../coworkStore';
import {
  extractGatewayHistoryEntries,
  shouldSuppressHeartbeatText,
} from '../../openclawHistory';
import {
  applyLocalTimestampsToEntries,
  isSameReconciledEntry,
  type ReconciledConversationEntry,
} from '../openclawConversationReconciliation';

export type SubagentChildHistorySyncPlan = {
  changed: boolean;
  cursor: number;
  entriesToStore: ReconciledConversationEntry[];
  localEntries: Array<{
    role: 'user' | 'assistant';
    text: string;
    timestamp?: number;
    metadata?: Record<string, unknown>;
  }>;
};

export const normalizeSubagentVisibleUserText = (text: string): string => {
  const currentRequestMarker = '[Current user request]';
  const currentRequestIndex = text.lastIndexOf(currentRequestMarker);
  if (currentRequestIndex >= 0) {
    const visible = text.slice(currentRequestIndex + currentRequestMarker.length).trim();
    if (visible) return visible;
  }

  const taskMarker = '[Subagent Task]';
  const taskIndex = text.lastIndexOf(taskMarker);
  if (taskIndex >= 0) {
    const taskStart = taskIndex + taskMarker.length;
    const taskTail = text.slice(taskStart);
    const beginMatch = /\n\s*Begin\. Execute the assigned task to completion\./.exec(taskTail);
    const visible = (beginMatch ? taskTail.slice(0, beginMatch.index) : taskTail).trim();
    if (visible) return visible;
  }

  return text;
};

export const buildSubagentChildHistorySyncPlan = (
  localMessages: CoworkMessage[],
  historyMessages: unknown[],
): SubagentChildHistorySyncPlan => {
  let normalizedLocalUserContent = false;
  const localEntries = localMessages
    .filter((message) => message.type === 'user' || message.type === 'assistant')
    .map((message) => {
      const text = message.type === 'user'
        ? normalizeSubagentVisibleUserText(message.content)
        : message.content;
      if (message.type === 'user' && text !== message.content) {
        normalizedLocalUserContent = true;
      }
      return {
        role: message.type as 'user' | 'assistant',
        text,
        timestamp: message.timestamp,
        metadata: message.metadata,
      };
    })
    .filter((entry) => entry.text.trim());
  const localUsers = localEntries.filter((entry) => entry.role === 'user');
  let localUserIndex = 0;
  const mergedEntries: ReconciledConversationEntry[] = [];

  for (const entry of extractGatewayHistoryEntries(historyMessages)) {
    if (entry.role === 'user') {
      const localUser = localUsers[localUserIndex++];
      if (localUser) {
        mergedEntries.push(localUser);
        continue;
      }
      const visibleText = normalizeSubagentVisibleUserText(entry.text).trim();
      if (visibleText && !shouldSuppressHeartbeatText('user', visibleText)) {
        mergedEntries.push({
          role: 'user',
          text: visibleText,
          ...(entry.timestamp != null && { timestamp: entry.timestamp }),
        });
      }
      continue;
    }

    if (entry.role !== 'assistant') continue;
    const text = entry.text.trim();
    if (!text || shouldSuppressHeartbeatText('assistant', text)) continue;
    let metadata: Record<string, unknown> | undefined;
    if (entry.usage || entry.model) {
      metadata = {};
      if (entry.usage) {
        metadata.usage = {
          ...(entry.usage.input != null && { inputTokens: entry.usage.input }),
          ...(entry.usage.output != null && { outputTokens: entry.usage.output }),
        };
      }
      if (entry.model) {
        metadata.model = entry.model;
      }
    }
    mergedEntries.push({
      role: 'assistant',
      text,
      ...(metadata && { metadata }),
      ...(entry.timestamp != null && { timestamp: entry.timestamp }),
    });
  }

  for (; localUserIndex < localUsers.length; localUserIndex += 1) {
    mergedEntries.push(localUsers[localUserIndex]);
  }

  if (mergedEntries.length === 0) {
    return {
      changed: false,
      cursor: 0,
      entriesToStore: [],
      localEntries,
    };
  }

  const isInSync = !normalizedLocalUserContent
    && localEntries.length === mergedEntries.length
    && localEntries.every((entry, index) =>
      entry.role === mergedEntries[index].role
      && entry.text === mergedEntries[index].text
      && isSameReconciledEntry(entry, mergedEntries[index]),
    );

  return {
    changed: !isInSync,
    cursor: mergedEntries.length,
    entriesToStore: isInSync
      ? mergedEntries
      : applyLocalTimestampsToEntries(mergedEntries, localEntries),
    localEntries,
  };
};
