import { describe, expect, test } from 'vitest';

import {
  dedupeConversationMappings,
  filterConversationMappingsForSelectedAccount,
  resolveConversationAgentIdFromMappings,
  resolveImDeliveryHintsFromSessions,
} from './helpers';

const TRUE_CASE_PEER = 'o9cq809ZEC25-4jLkdw3AHTKPE9c@im.wechat';
const LOWER_PEER = TRUE_CASE_PEER.toLowerCase();

function weixinSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    updatedAt: 1_000,
    lastChannel: 'openclaw-weixin',
    lastTo: TRUE_CASE_PEER,
    lastAccountId: '91fcaf18cb3a-im-bot',
    ...overrides,
  };
}

describe('resolveImDeliveryHintsFromSessions', () => {
  test('restores the channel-native casing and account for a lowercased peer id', () => {
    const hints = resolveImDeliveryHintsFromSessions({
      sessions: [weixinSession()],
      channel: 'openclaw-weixin',
      peerId: LOWER_PEER,
    });
    expect(hints).toEqual({ to: TRUE_CASE_PEER, accountId: '91fcaf18cb3a-im-bot' });
  });

  test('ignores sessions from other channels, other peers, and malformed rows', () => {
    const hints = resolveImDeliveryHintsFromSessions({
      sessions: [
        null,
        'junk',
        weixinSession({ lastChannel: 'telegram' }),
        weixinSession({ lastTo: 'someone-else@im.wechat' }),
      ],
      channel: 'openclaw-weixin',
      peerId: LOWER_PEER,
    });
    expect(hints).toBeNull();
  });

  test('prefers the most recently updated session among matches', () => {
    const hints = resolveImDeliveryHintsFromSessions({
      sessions: [
        // Poisoned session from an earlier accountless delivery: lowercase
        // target, no usable account, older than the live conversation.
        weixinSession({ updatedAt: 500, lastTo: LOWER_PEER, lastAccountId: undefined }),
        weixinSession({ updatedAt: 2_000 }),
      ],
      channel: 'openclaw-weixin',
      peerId: LOWER_PEER,
    });
    expect(hints).toEqual({ to: TRUE_CASE_PEER, accountId: '91fcaf18cb3a-im-bot' });
  });

  test('prefers sessions owned by the preferred account over newer ones', () => {
    const hints = resolveImDeliveryHintsFromSessions({
      sessions: [
        weixinSession({ updatedAt: 9_000, lastAccountId: 'other-bot' }),
        weixinSession({ updatedAt: 1_000 }),
      ],
      channel: 'openclaw-weixin',
      peerId: LOWER_PEER,
      preferredAccountId: '91fcaf18cb3a-im-bot',
    });
    expect(hints).toEqual({ to: TRUE_CASE_PEER, accountId: '91fcaf18cb3a-im-bot' });
  });

  test('falls back to deliveryContext fields when last* fields are absent', () => {
    const hints = resolveImDeliveryHintsFromSessions({
      sessions: [
        {
          updatedAt: 1_000,
          deliveryContext: {
            channel: 'openclaw-weixin',
            to: TRUE_CASE_PEER,
            accountId: '91fcaf18cb3a-im-bot',
          },
        },
      ],
      channel: 'openclaw-weixin',
      peerId: LOWER_PEER,
    });
    expect(hints).toEqual({ to: TRUE_CASE_PEER, accountId: '91fcaf18cb3a-im-bot' });
  });

  test('matches channel aliases through the platform registry', () => {
    const hints = resolveImDeliveryHintsFromSessions({
      sessions: [
        {
          updatedAt: 1_000,
          lastChannel: 'wecom-openclaw-plugin',
          lastTo: 'UserId-ABC',
        },
      ],
      channel: 'wecom',
      peerId: 'userid-abc',
    });
    expect(hints).toEqual({ to: 'UserId-ABC' });
  });
});

describe('resolveConversationAgentIdFromMappings', () => {
  const mappings = [
    {
      imConversationId: 'f1591db9:direct:bjwangning@corp.netease.com',
      agentId: 'agent-popo',
    },
    {
      imConversationId: 'other-acc:direct:bjwangning@corp.netease.com',
      agentId: 'agent-other',
    },
    { imConversationId: `91fcaf18cb3a-im-bot:direct:${LOWER_PEER}`, agentId: 'main' },
  ];

  test('prefers the mapping owned by the preferred account', () => {
    expect(
      resolveConversationAgentIdFromMappings(
        mappings,
        'bjwangning@corp.netease.com',
        'other-acc',
      ),
    ).toBe('agent-other');
  });

  test('falls back to the most recent peer match and accepts full conversation ids', () => {
    expect(
      resolveConversationAgentIdFromMappings(mappings, 'bjwangning@corp.netease.com'),
    ).toBe('agent-popo');
    expect(
      resolveConversationAgentIdFromMappings(
        mappings,
        'f1591db9:direct:bjwangning@corp.netease.com',
      ),
    ).toBe('agent-popo');
    // Case-insensitive: delivery targets keep the channel-native casing.
    expect(resolveConversationAgentIdFromMappings(mappings, TRUE_CASE_PEER)).toBe('main');
  });

  test('returns null for unknown peers or mappings without an agent', () => {
    expect(resolveConversationAgentIdFromMappings(mappings, 'nobody@corp.netease.com')).toBe(
      null,
    );
    expect(
      resolveConversationAgentIdFromMappings(
        [{ imConversationId: 'direct:peer-1' }],
        'peer-1',
      ),
    ).toBe(null);
  });
});

describe('dedupeConversationMappings', () => {
  test('keeps the most recent mapping per peer across account prefixes', () => {
    const result = dedupeConversationMappings([
      { imConversationId: `91fcaf18cb3a-im-bot:direct:${LOWER_PEER}` },
      { imConversationId: `689a50fe5798-im-bot:direct:${LOWER_PEER}` },
      { imConversationId: `direct:${LOWER_PEER}` },
    ]);
    expect(result).toEqual([
      { imConversationId: `91fcaf18cb3a-im-bot:direct:${LOWER_PEER}` },
    ]);
  });

  test('drops heartbeat pseudo-conversations', () => {
    const result = dedupeConversationMappings([
      { imConversationId: `91fcaf18cb3a-im-bot:direct:${LOWER_PEER}:heartbeat` },
      { imConversationId: `91fcaf18cb3a-im-bot:direct:${LOWER_PEER}` },
    ]);
    expect(result).toEqual([
      { imConversationId: `91fcaf18cb3a-im-bot:direct:${LOWER_PEER}` },
    ]);
  });

  test('keeps distinct peers and peer kinds', () => {
    const result = dedupeConversationMappings([
      { imConversationId: `direct:${LOWER_PEER}` },
      { imConversationId: `group:${LOWER_PEER}` },
      { imConversationId: 'direct:someone-else@im.wechat' },
    ]);
    expect(result).toHaveLength(3);
  });

  test('keeps the same peer when mappings belong to different agents', () => {
    const result = dedupeConversationMappings([
      { imConversationId: `group:${LOWER_PEER}`, agentId: 'main' },
      { imConversationId: `group:${LOWER_PEER}`, agentId: 'agent-2' },
      { imConversationId: `group:${LOWER_PEER}`, agentId: 'agent-2' },
    ]);
    expect(result).toEqual([
      { imConversationId: `group:${LOWER_PEER}`, agentId: 'main' },
      { imConversationId: `group:${LOWER_PEER}`, agentId: 'agent-2' },
    ]);
  });
});

describe('filterConversationMappingsForSelectedAccount', () => {
  test('keeps only the selected account bound agent for account-less group mappings', () => {
    const result = filterConversationMappingsForSelectedAccount(
      [
        {
          imConversationId: 'group:oc_622a147f6d49851fb81e138022fcb485',
          agentId: 'main',
        },
        {
          imConversationId: 'group:oc_622a147f6d49851fb81e138022fcb485',
          agentId: 'agent-feishu-bot-1',
        },
        {
          imConversationId: '61823a93:direct:ou_30660c6d4aaeade046cc31c9a95d747f',
          agentId: 'agent-feishu-bot-1',
        },
      ],
      'feishu',
      '61823a93',
      { 'feishu:61823a93-ba68-4cdf-81fd-ddd70311ca7f': 'agent-feishu-bot-1' },
    );

    expect(result).toEqual([
      {
        imConversationId: 'group:oc_622a147f6d49851fb81e138022fcb485',
        agentId: 'agent-feishu-bot-1',
      },
      {
        imConversationId: '61823a93:direct:ou_30660c6d4aaeade046cc31c9a95d747f',
        agentId: 'agent-feishu-bot-1',
      },
    ]);
  });

  test('leaves mappings unchanged when no account is selected', () => {
    const mappings = [
      { imConversationId: 'group:oc_1', agentId: 'main' },
      { imConversationId: 'group:oc_1', agentId: 'agent-2' },
    ];

    expect(
      filterConversationMappingsForSelectedAccount(mappings, 'feishu', undefined, {
        'feishu:61823a93-ba68-4cdf-81fd-ddd70311ca7f': 'agent-2',
      }),
    ).toEqual(mappings);
  });

  test('treats an explicitly empty binding map as the main agent default', () => {
    const result = filterConversationMappingsForSelectedAccount(
      [
        { imConversationId: 'group:oc_1', agentId: 'main' },
        { imConversationId: 'group:oc_1', agentId: 'agent-2' },
      ],
      'feishu',
      'a826946b',
      {},
    );

    expect(result).toEqual([{ imConversationId: 'group:oc_1', agentId: 'main' }]);
  });

  test('drops account-less group mappings that do not match the selected bot binding', () => {
    const result = filterConversationMappingsForSelectedAccount(
      [
        { imConversationId: 'group:oc_1', agentId: 'main' },
        { imConversationId: 'group:oc_2', agentId: 'agent-other' },
      ],
      'feishu',
      '61823a93',
      { 'feishu:61823a93-ba68-4cdf-81fd-ddd70311ca7f': 'agent-feishu-bot-1' },
    );

    expect(result).toEqual([]);
  });
});
