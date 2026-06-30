import { LogReporterAction, reportYdAnalyzer } from '../../services/logReporter';
import { resolveLocalizedText } from '../../services/skill';
import type { Model } from '../../store/slices/modelSlice';
import type { InstalledKit, MarketplaceKit } from '../../types/kit';
import type { Skill } from '../../types/skill';

type PromptAnalyticsValue = string | number | boolean | null | undefined;

export const PromptAnalyticsSurface = {
  Home: 'home',
  Conversation: 'conversation',
} as const;

export type PromptAnalyticsSurface =
  typeof PromptAnalyticsSurface[keyof typeof PromptAnalyticsSurface];

export const PromptAnalyticsConversationState = {
  NewTask: 'new_task',
  ContinueSession: 'continue_session',
} as const;

export type PromptAnalyticsConversationState =
  typeof PromptAnalyticsConversationState[keyof typeof PromptAnalyticsConversationState];

export const getPromptAnalyticsSurface = (sessionId?: string): PromptAnalyticsSurface =>
  sessionId ? PromptAnalyticsSurface.Conversation : PromptAnalyticsSurface.Home;

export const getPromptAnalyticsConversationState = (sessionId?: string): PromptAnalyticsConversationState =>
  sessionId ? PromptAnalyticsConversationState.ContinueSession : PromptAnalyticsConversationState.NewTask;

const joinValues = (values: string[]): string | undefined => {
  const normalized = values
    .map(value => value.trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized.join(',') : undefined;
};

const bucketCount = (count: number): string => {
  if (count <= 0) return '0';
  if (count <= 3) return '1_3';
  if (count <= 10) return '4_10';
  if (count <= 30) return '11_30';
  return '30_plus';
};

const bucketPromptLength = (length: number): string => {
  if (length <= 0) return '0';
  if (length <= 20) return '1_20';
  if (length <= 100) return '21_100';
  if (length <= 500) return '101_500';
  if (length <= 2000) return '501_2000';
  return '2000_plus';
};

const bucketPromptLineCount = (count: number): string => {
  if (count <= 0) return '0';
  if (count === 1) return '1';
  if (count <= 5) return '2_5';
  if (count <= 20) return '6_20';
  return '20_plus';
};

const bucketAgeMs = (createdAt?: number): string | undefined => {
  if (!createdAt) return undefined;
  const ageMs = Math.max(0, Date.now() - createdAt);
  const dayMs = 24 * 60 * 60 * 1000;
  if (ageMs < dayMs) return 'same_day';
  if (ageMs < 3 * dayMs) return '1_3_days';
  if (ageMs < 7 * dayMs) return '3_7_days';
  return '7_days_plus';
};

const bucketBytes = (bytes: number): string => {
  if (bytes <= 0) return 'unknown';
  if (bytes < 1024 * 1024) return '0_1mb';
  if (bytes < 10 * 1024 * 1024) return '1_10mb';
  if (bytes < 50 * 1024 * 1024) return '10_50mb';
  return '50mb_plus';
};

const getExtension = (nameOrPath: string): string => {
  const fileName = nameOrPath.split(/[/\\]/).pop() || nameOrPath;
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
};

const getFileTypeGroup = (nameOrPath: string, isImage?: boolean): string => {
  if (isImage) return 'image';
  const ext = getExtension(nameOrPath);
  if (!ext) return 'other';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tiff', 'tif', 'ico', 'avif'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'tsv'].includes(ext)) return 'office';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'go', 'rs', 'cpp', 'c', 'h', 'css', 'html', 'json', 'md', 'yaml', 'yml', 'xml', 'sql', 'sh'].includes(ext)) return 'code';
  return 'other';
};

const getPromptLanguageType = (prompt: string): string => {
  const zhMatches = prompt.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const latinMatches = prompt.match(/[A-Za-z]/g)?.length ?? 0;
  if (zhMatches === 0 && latinMatches === 0) return 'unknown';
  if (zhMatches > 0 && latinMatches > 0) return 'mixed';
  return zhMatches > 0 ? 'zh' : 'en';
};

const PromptIntentRules = [
  {
    intentType: 'debug',
    intentSubtype: 'bug_fix',
    keywords: ['报错', '错误', 'bug', 'debug', 'error', 'exception', 'traceback', '修复', 'fix', '崩溃', 'crash', '失败', 'failed'],
  },
  {
    intentType: 'coding',
    intentSubtype: 'code_review',
    keywords: ['代码审查', 'code review', 'review code', '审查代码', '检查代码', '代码检查'],
  },
  {
    intentType: 'coding',
    intentSubtype: 'code_generation',
    keywords: ['写代码', '生成代码', '实现功能', '开发功能', 'code', 'function', 'api', 'component', 'implement'],
  },
  {
    intentType: 'coding',
    intentSubtype: 'refactor',
    keywords: ['重构', '优化代码', 'refactor', '代码优化'],
  },
  {
    intentType: 'coding',
    intentSubtype: 'coding_general',
    keywords: ['代码', '函数', '接口', '组件', '开发', '前端', '后端', '脚本', 'script'],
  },
  {
    intentType: 'presentation',
    intentSubtype: 'slide_deck',
    keywords: ['幻灯片', 'ppt', 'presentation', 'slide', 'deck', '演示文稿', '汇报材料'],
  },
  {
    intentType: 'website',
    intentSubtype: 'website_building',
    keywords: ['网页', '网站', '页面', 'html', 'css', 'website', 'web page', 'landing page', '官网', '落地页'],
  },
  {
    intentType: 'data',
    intentSubtype: 'spreadsheet',
    keywords: ['表格', 'excel', 'spreadsheet', 'csv', 'xlsx', '数据表'],
  },
  {
    intentType: 'data',
    intentSubtype: 'data_analysis',
    keywords: ['数据分析', '统计分析', '图表', '可视化', 'data analysis', 'chart', 'dashboard', '数据', '统计'],
  },
  {
    intentType: 'search',
    intentSubtype: 'research',
    keywords: ['搜索', '查找', '查询', '资料', '新闻', '调研', 'search', 'find', 'lookup', 'research'],
  },
  {
    intentType: 'image',
    intentSubtype: 'image_generation',
    keywords: ['生成图片', '生成一张', '生成一个', '做一张', '画图', '绘图', '出图', '生成海报', '生成 logo', '设计 logo', 'image generation', 'generate image', 'draw', 'poster'],
  },
  {
    intentType: 'image',
    intentSubtype: 'image_understanding',
    keywords: ['分析图片', '识别图片', '图片识别', '图片转文字', '看图', 'ocr', 'image understanding', 'describe image'],
  },
  {
    intentType: 'image',
    intentSubtype: 'image_editing',
    keywords: ['编辑图片', '修改图片', '图片编辑', '抠图', '换背景', 'image editing', 'edit image'],
  },
  {
    intentType: 'image',
    intentSubtype: 'image_general',
    keywords: ['图片', '图像', '海报', 'logo', 'image', 'picture'],
  },
  {
    intentType: 'writing',
    intentSubtype: 'translation',
    keywords: ['翻译', 'translate', 'translation'],
  },
  {
    intentType: 'writing',
    intentSubtype: 'summary',
    keywords: ['总结', '摘要', '概括', 'summary', 'summarize'],
  },
  {
    intentType: 'writing',
    intentSubtype: 'polishing',
    keywords: ['润色', '改写', '优化文案', 'polish', 'rewrite'],
  },
  {
    intentType: 'writing',
    intentSubtype: 'resume',
    keywords: ['简历', 'resume', 'cv'],
  },
  {
    intentType: 'writing',
    intentSubtype: 'meeting_notes',
    keywords: ['会议纪要', '会议总结', 'meeting notes', 'meeting summary'],
  },
  {
    intentType: 'writing',
    intentSubtype: 'email',
    keywords: ['邮件', 'email'],
  },
  {
    intentType: 'writing',
    intentSubtype: 'copywriting',
    keywords: ['文案', '小红书', '公众号', '视频脚本', '脚本', 'copywriting', 'social post'],
  },
  {
    intentType: 'writing',
    intentSubtype: 'document_writing',
    keywords: ['写一篇', '写个', '写一个', '起草', '撰写', 'write', 'draft'],
  },
  {
    intentType: 'analysis',
    intentSubtype: 'business_analysis',
    keywords: ['竞品分析', '行业分析', '市场分析', '商业分析', '财报', 'business analysis', 'market analysis'],
  },
  {
    intentType: 'analysis',
    intentSubtype: 'explanation',
    keywords: ['为什么', '怎么', '如何', '解释', '原理', 'why', 'how', 'explain', 'compare'],
  },
] as const;

const getPromptIntentMatchedKeywords = (prompt: string): string[] => {
  const normalized = prompt.toLowerCase();
  const matchedKeywords = PromptIntentRules.flatMap(rule => (
    rule.keywords.filter(keyword => normalized.includes(keyword.toLowerCase()))
  ));
  return [...new Set(matchedKeywords)];
};

const inferPromptIntentType = (prompt: string): string => {
  const normalized = prompt.toLowerCase();
  const matchedRule = PromptIntentRules.find(rule => (
    rule.keywords.some(keyword => normalized.includes(keyword.toLowerCase()))
  ));
  if (matchedRule) return matchedRule.intentType;
  return prompt.trim().length > 0 ? 'other' : 'empty';
};

const inferPromptIntentSubtype = (prompt: string): string => {
  const normalized = prompt.toLowerCase();
  const matchedRule = PromptIntentRules.find(rule => (
    rule.keywords.some(keyword => normalized.includes(keyword.toLowerCase()))
  ));
  if (matchedRule) return matchedRule.intentSubtype;
  return prompt.trim().length > 0 ? 'other' : 'empty';
};

export const getPromptTextAnalyticsParams = (
  prompt: string,
): Record<string, PromptAnalyticsValue> => {
  const trimmed = prompt.trim();
  const promptLineCount = trimmed.length > 0 ? trimmed.split('\n').length : 0;
  return {
    promptLengthBucket: bucketPromptLength(trimmed.length),
    promptLineCountBucket: bucketPromptLineCount(promptLineCount),
    inputLanguageType: getPromptLanguageType(trimmed),
    promptIntentType: inferPromptIntentType(trimmed),
    promptIntentSubtype: inferPromptIntentSubtype(trimmed),
    promptIntentMatchedKeywords: joinValues(getPromptIntentMatchedKeywords(trimmed)),
    hasQuestionMark: /[?？]/.test(trimmed),
    hasCodeFence: /```/.test(trimmed),
    hasInlineCode: /`[^`\n]+`/.test(trimmed),
    hasUrl: /https?:\/\/|www\./i.test(trimmed),
    hasPathLikeText: /(^|\s)(~\/|\.{1,2}\/|[A-Za-z]:\\|\/[\w.-]+\/|[\w.-]+\\[\w.-]+)/.test(trimmed),
    hasCommandLikeText: /(^|\n)\s*(npm|pnpm|yarn|node|python|pip|git|curl|docker|kubectl|npx|brew)\s+/.test(trimmed),
    hasAtMediaMention: /@(图片|视频|音频)\d+/.test(trimmed),
  };
};

export interface PromptAnalyticsAttachment {
  path: string;
  name: string;
  isImage?: boolean;
  size?: number;
}

export const getAttachmentAnalyticsParams = (
  attachments: PromptAnalyticsAttachment[],
): Record<string, PromptAnalyticsValue> => {
  const groups = Array.from(new Set(attachments.map(attachment => (
    getFileTypeGroup(attachment.name || attachment.path, attachment.isImage)
  ))));
  const totalKnownSize = attachments.reduce((sum, attachment) => sum + (attachment.size ?? 0), 0);
  return {
    attachmentCount: attachments.length,
    imageAttachmentCount: attachments.filter(attachment => (
      attachment.isImage || getFileTypeGroup(attachment.name || attachment.path, attachment.isImage) === 'image'
    )).length,
    fileTypeGroups: joinValues(groups),
    totalAttachmentSizeBucket: totalKnownSize > 0 ? bucketBytes(totalKnownSize) : undefined,
  };
};

export const getSkillAnalyticsParams = (
  activeSkillIds: string[],
  skills: Skill[],
): Record<string, PromptAnalyticsValue> => {
  const activeSkills = activeSkillIds
    .map(id => skills.find(skill => skill.id === id))
    .filter((skill): skill is Skill => Boolean(skill));
  return {
    activeSkillCount: activeSkills.length,
    activeSkillIds: joinValues(activeSkills.map(skill => skill.id)),
    activeSkillNames: joinValues(activeSkills.map(skill => skill.name)),
  };
};

export const getKitAnalyticsParams = (
  activeKitIds: string[],
  marketplaceKits: MarketplaceKit[],
  installedKits: Record<string, InstalledKit>,
): Record<string, PromptAnalyticsValue> => {
  const kitNames = activeKitIds.map((kitId) => {
    const marketplaceKit = marketplaceKits.find(kit => kit.id === kitId);
    if (marketplaceKit) return resolveLocalizedText(marketplaceKit.name);
    return installedKits[kitId]?.id ?? kitId;
  });
  return {
    activeKitCount: activeKitIds.length,
    activeKitIds: joinValues(activeKitIds),
    activeKitNames: joinValues(kitNames),
  };
};

export const getModelAnalyticsParams = (
  model?: Model | null,
): Record<string, PromptAnalyticsValue> => ({
  modelId: model?.id,
  modelName: model?.name,
  modelSource: model ? (model.isServerModel ? 'package' : 'custom') : undefined,
  providerKey: model?.providerKey,
  provider: model?.provider,
  isServerModel: model?.isServerModel === true,
});

export interface PromptSubmitAnalyticsOptions {
  surface: PromptAnalyticsSurface;
  conversationState: PromptAnalyticsConversationState;
  submitMethod: 'button' | 'keyboard' | 'voice';
  promptLength: number;
  promptLineCount: number;
  hasPrompt: boolean;
  isPlanMode: boolean;
  hasWorkingDirectory: boolean;
  agentId: string;
  isMainAgent: boolean;
  agentSource?: string;
  agentSkillCount?: number;
  sessionMessageCount?: number;
  sessionCreatedAt?: number;
  params?: Record<string, PromptAnalyticsValue>;
}

export const reportPromptSubmit = (options: PromptSubmitAnalyticsOptions): void => {
  void reportYdAnalyzer({
    action: LogReporterAction.PromptSubmit,
    surface: options.surface,
    conversationState: options.conversationState,
    submitMethod: options.submitMethod,
    promptLength: options.promptLength,
    promptLineCount: options.promptLineCount,
    hasPrompt: options.hasPrompt,
    isPlanMode: options.isPlanMode,
    hasWorkingDirectory: options.hasWorkingDirectory,
    agentId: options.agentId,
    isMainAgent: options.isMainAgent,
    agentSource: options.agentSource,
    agentSkillCount: options.agentSkillCount,
    hasSession: options.conversationState === PromptAnalyticsConversationState.ContinueSession,
    sessionMessageCountBucket: options.sessionMessageCount === undefined
      ? undefined
      : bucketCount(options.sessionMessageCount),
    sessionAgeBucket: bucketAgeMs(options.sessionCreatedAt),
    ...options.params,
  });
};

export interface PromptControlAnalyticsOptions {
  controlType: string;
  surface: PromptAnalyticsSurface;
  conversationState: PromptAnalyticsConversationState;
  params?: Record<string, PromptAnalyticsValue>;
}

export const reportPromptControlAction = (options: PromptControlAnalyticsOptions): void => {
  void reportYdAnalyzer({
    action: LogReporterAction.PromptControlAction,
    controlType: options.controlType,
    surface: options.surface,
    conversationState: options.conversationState,
    ...options.params,
  });
};

export interface PromptTemplateAnalyticsOptions {
  templateActionType: string;
  templateId: string;
  templateName: string;
  templateIndex?: number;
  mappedSkillId?: string;
  mappedSkillName?: string;
  promptId?: string;
  promptName?: string;
  promptIndex?: number;
  promptLength?: number;
  hasAutoEnabledSkill?: boolean;
  params?: Record<string, PromptAnalyticsValue>;
}

export const reportPromptTemplateAction = (options: PromptTemplateAnalyticsOptions): void => {
  void reportYdAnalyzer({
    action: LogReporterAction.PromptTemplateAction,
    surface: PromptAnalyticsSurface.Home,
    conversationState: PromptAnalyticsConversationState.NewTask,
    templateActionType: options.templateActionType,
    templateId: options.templateId,
    templateName: options.templateName,
    templateIndex: options.templateIndex,
    mappedSkillId: options.mappedSkillId,
    mappedSkillName: options.mappedSkillName,
    promptId: options.promptId,
    promptName: options.promptName,
    promptIndex: options.promptIndex,
    promptLength: options.promptLength,
    hasAutoEnabledSkill: options.hasAutoEnabledSkill,
    ...options.params,
  });
};
