import { describe, expect, test } from 'vitest';

import {
  AgentAvatarColor,
  AgentAvatarGlyph,
  DefaultAgentAvatar,
  DefaultAgentAvatarIcon,
  encodeAgentAvatarIcon,
  isDesignedAgentAvatarIcon,
  normalizeAgentAvatarIcon,
  parseAgentAvatarIcon,
} from './avatar';

describe('agent avatar icon encoding', () => {
  test('round-trips designed avatar selections', () => {
    const value = encodeAgentAvatarIcon({
      color: AgentAvatarColor.Blue,
      glyph: AgentAvatarGlyph.Code,
    });

    expect(parseAgentAvatarIcon(value)).toEqual({
      color: AgentAvatarColor.Blue,
      glyph: AgentAvatarGlyph.Code,
    });
  });

  test('exposes the default designed avatar icon', () => {
    expect(parseAgentAvatarIcon(DefaultAgentAvatarIcon)).toEqual(DefaultAgentAvatar);
  });

  test('leaves legacy emoji icons untouched', () => {
    expect(parseAgentAvatarIcon('🤖')).toBeNull();
    expect(isDesignedAgentAvatarIcon('🤖')).toBe(false);
  });

  test('normalizes empty and legacy icons to the default designed avatar', () => {
    expect(normalizeAgentAvatarIcon('')).toBe(DefaultAgentAvatarIcon);
    expect(normalizeAgentAvatarIcon('legacy-icon')).toBe(DefaultAgentAvatarIcon);
    expect(normalizeAgentAvatarIcon('agent-avatar:blue:missing')).toBe(DefaultAgentAvatarIcon);
  });

  test('preserves valid designed avatars when normalizing', () => {
    const value = encodeAgentAvatarIcon({
      color: AgentAvatarColor.Green,
      glyph: AgentAvatarGlyph.Research,
    });

    expect(normalizeAgentAvatarIcon(` ${value} `)).toBe(value);
  });

  test('rejects malformed designed avatar values', () => {
    expect(parseAgentAvatarIcon('agent-avatar:blue:missing')).toBeNull();
    expect(parseAgentAvatarIcon('agent-avatar:missing:code')).toBeNull();
  });
});
