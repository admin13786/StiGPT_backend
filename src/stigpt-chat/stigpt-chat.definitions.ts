export const ROUTE_MODE_KEYS = ['policy', 'project', 'aiRead'] as const;

export type StigptRouteModeKey = (typeof ROUTE_MODE_KEYS)[number];

export interface RouteModeDefinition {
  key: StigptRouteModeKey;
  label: string;
  description: string;
  assistantName: string;
  knowledgeHints: string[];
  topK: number;
  systemPrompt: string;
}

export interface RouteSurfaceExampleDefinition {
  modelCode?: string;
  title: string;
  prompt: string;
  sortOrder: number;
  metadata?: Record<string, unknown>;
}

export interface RouteSurfaceDefinition {
  routeKey: string;
  pageTitle: string;
  assistantName: string;
  welcomeMessage: string;
  inputPlaceholder: string;
  defaultRouteMode: StigptRouteModeKey;
  routeModes: StigptRouteModeKey[];
  examples: RouteSurfaceExampleDefinition[];
}

const ROUTE_MODE_DEFINITIONS: RouteModeDefinition[] = [
  {
    key: 'policy',
    label: '政策问答',
    description: '围绕基金政策、资助规则、时间节点和条款口径进行解读。',
    assistantName: '科研之友 AI',
    knowledgeHints: ['政策', '基金', '资助', '指南', '通知', 'regulation', 'policy', 'fund'],
    topK: 6,
    systemPrompt:
      '聚焦科研基金政策、资助规则、申报条件、时间节点与口径解释。回答时优先给出政策适用性、限制条件、材料要求和执行建议。',
  },
  {
    key: 'project',
    label: '项目辅导',
    description: '聚焦项目申请书、选题、创新点、技术路线与评审风险。',
    assistantName: '项目辅导助手',
    knowledgeHints: ['项目', '申报', '申请', '模板', 'proposal', 'project', '课题'],
    topK: 5,
    systemPrompt:
      '聚焦项目申请书写作、选题设计、创新表达、技术路线、前期基础与评审视角。输出应强调问题诊断、结构建议与可落地修改项。',
  },
  {
    key: 'aiRead',
    label: 'AI阅读',
    description: '面向论文与文档阅读，提炼问题、方法、证据、局限与启发。',
    assistantName: 'AI阅读助手',
    knowledgeHints: ['论文', '文献', 'paper', 'read', '阅读', 'article', 'research'],
    topK: 6,
    systemPrompt:
      '聚焦论文和文档阅读理解。回答时优先提炼研究问题、方法路线、数据与实验、主要结论、局限性以及对后续工作的启发。',
  },
];

const ROUTE_SURFACE_DEFINITIONS: RouteSurfaceDefinition[] = [
  {
    routeKey: 'webIdx',
    pageTitle: '科研之友 AI 问答',
    assistantName: '科研之友 AI',
    welcomeMessage: '你好，我是科研之友 AI，可以围绕基金政策、项目辅导、论文阅读与知识库内容继续协助你。',
    inputPlaceholder: '请输入你想了解的政策、项目方案、论文解读或知识库问题...',
    defaultRouteMode: 'policy',
    routeModes: ['policy', 'project', 'aiRead'],
    examples: [
      {
        modelCode: 'policy-assistant',
        title: '基金政策解读',
        prompt: '国家自然科学基金项目申报时，近两年的政策重点有哪些？',
        sortOrder: 1,
        metadata: { routeMode: 'policy' },
      },
      {
        modelCode: 'policy-assistant',
        title: '申报风险诊断',
        prompt: '青年基金申请书最容易被初筛淘汰的几个问题是什么？',
        sortOrder: 2,
        metadata: { routeMode: 'project' },
      },
      {
        modelCode: 'research-copilot',
        title: '项目结构建议',
        prompt: '帮我梳理一份科研项目申请书的常见结构和评审风险。',
        sortOrder: 3,
        metadata: { routeMode: 'project' },
      },
      {
        modelCode: 'ai-reader',
        title: 'AI 阅读示例',
        prompt: '请从研究问题、方法、实验和局限性四个方面帮我读一篇论文。',
        sortOrder: 4,
        metadata: { routeMode: 'aiRead' },
      },
    ],
  },
  {
    routeKey: 'answer/policy',
    pageTitle: '政策问答',
    assistantName: '政策助手',
    welcomeMessage: '这里是政策问答入口，优先回答资助规则、指南要求和申报风险。',
    inputPlaceholder: '例如：青年基金申请的资格限制和时间节点有哪些？',
    defaultRouteMode: 'policy',
    routeModes: ['policy'],
    examples: [
      {
        modelCode: 'policy-assistant',
        title: '资格与口径',
        prompt: '申报青年基金时，年龄、职称和在站经历有哪些常见限制？',
        sortOrder: 1,
      },
      {
        modelCode: 'policy-assistant',
        title: '时间节点',
        prompt: '请按申报周期梳理青年基金从准备到提交的关键时间节点。',
        sortOrder: 2,
      },
    ],
  },
  {
    routeKey: 'answer/project',
    pageTitle: '项目辅导',
    assistantName: '项目辅导助手',
    welcomeMessage: '这里是项目辅导入口，适合梳理申请书结构、创新表达和评审风险。',
    inputPlaceholder: '例如：我的项目申请书创新点不够聚焦，应该怎么重构？',
    defaultRouteMode: 'project',
    routeModes: ['project'],
    examples: [
      {
        modelCode: 'research-copilot',
        title: '创新点重构',
        prompt: '如果评审认为创新点不聚焦，我应该如何重写项目的核心科学问题？',
        sortOrder: 1,
      },
      {
        modelCode: 'research-copilot',
        title: '技术路线诊断',
        prompt: '请帮我检查项目申请书中的技术路线是否闭环，并指出评审最可能质疑的点。',
        sortOrder: 2,
      },
    ],
  },
  {
    routeKey: 'aiRead',
    pageTitle: 'AI阅读',
    assistantName: 'AI阅读助手',
    welcomeMessage: '这里是 AI 阅读入口，适合做论文精读、方法对比和证据提炼。',
    inputPlaceholder: '例如：请从问题、方法、实验和局限性四个方面解读这篇论文。',
    defaultRouteMode: 'aiRead',
    routeModes: ['aiRead'],
    examples: [
      {
        modelCode: 'ai-reader',
        title: '论文精读',
        prompt: '请用“问题-方法-实验-局限”四栏结构总结这篇论文。',
        sortOrder: 1,
      },
      {
        modelCode: 'ai-reader',
        title: '方法对比',
        prompt: '把这篇论文和主流 baseline 的假设、优势、缺点和适用边界对比一下。',
        sortOrder: 2,
      },
    ],
  },
];

export const getRouteModeDefinitions = () => ROUTE_MODE_DEFINITIONS;

export const getRouteModeDefinition = (routeMode: StigptRouteModeKey) =>
  ROUTE_MODE_DEFINITIONS.find((definition) => definition.key === routeMode)!;

export const getRouteSurfaceDefinitions = () => ROUTE_SURFACE_DEFINITIONS;

export const getRouteSurfaceDefinition = (routeKey = 'webIdx') =>
  ROUTE_SURFACE_DEFINITIONS.find((definition) => definition.routeKey === routeKey) ||
  ROUTE_SURFACE_DEFINITIONS[0];

export const normalizeRouteKey = (routeKey?: string) =>
  getRouteSurfaceDefinition(routeKey).routeKey;
