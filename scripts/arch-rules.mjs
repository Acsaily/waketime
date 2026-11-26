// Shared dependency-cruiser rules for the target architecture.
//
// New rules run in observation mode ("warn") until the legacy tree is
// migrated. Task 3/4/5 promote them to "error" and remove legacy exceptions.
// `npm run arch:strict` reuses this same rule set with severities promoted to
// "error" so the final gate has an executable entry point.
//
// Both the production config (.dependency-cruiser.mjs) and the self-test
// (scripts/arch-selftest.mjs) import this module so the checker and its test
// cannot drift apart.

// Match framework packages whether dependency-cruiser resolved them to
// node_modules (repo cwd) or kept them external/unresolved (fixture cwd).
const frameworkPath =
  '(^|/)node_modules/(react|react-dom|@capacitor)/|^react$|^react-dom$|^@capacitor/';
const outerLayerPath =
  '^src/(app|application|infrastructure|features|pages|components|state|data|native|export|core)/';

export const forbiddenRules = [
  {
    name: 'no-circular',
    comment: '禁止循环依赖（含 type-only 依赖）',
    severity: 'warn',
    from: {},
    to: { circular: true },
  },
  {
    name: 'domain-no-framework',
    comment:
      '纯领域与 analytics 只允许纯依赖：不得引入 React/DOM/Capacitor、外层实现或 legacy 目录',
    severity: 'warn',
    from: { path: '^src/modules/(?:[^/]+/domain/|analytics/)' },
    to: { path: `${frameworkPath}|${outerLayerPath}` },
  },
  {
    name: 'module-no-ui-app',
    comment:
      '所有模块（含公开 index.ts 与模块内非 domain 文件）不得依赖框架、UI、装配、适配层或 legacy 实现',
    severity: 'warn',
    from: { path: '^src/modules/' },
    to: {
      path: `${frameworkPath}|${outerLayerPath}`,
    },
  },
  {
    name: 'module-public-api-only',
    comment: '跨模块只能引用对方 index.ts 公开接口（含 type-only），不得深入内部实现',
    severity: 'warn',
    from: { path: '^src/modules/([^/]+)/' },
    to: { path: '^src/modules/(?!$1/)([^/]+)/(?!index\\.ts$)' },
  },
  {
    name: 'external-module-public-api-only',
    comment:
      '模块外部消费者（app/features/application/infrastructure/shared）只能引用模块公开 index.ts',
    severity: 'warn',
    from: { path: '^src/(app|features|application|infrastructure|shared)/' },
    to: { path: '^src/modules/[^/]+/(?!index\\.ts$)' },
  },
  {
    name: 'application-public-api-only',
    comment: 'UI 与装配层只能引用 application 的公开 index.ts',
    severity: 'warn',
    from: { path: '^src/(features|app)/' },
    to: { path: '^src/application/(?!index\\.ts$)' },
  },
  {
    name: 'application-layer-boundary',
    comment:
      'application 不得反向依赖 UI、具体 adapter、React，或 legacy store/native/state/export/core；端口由 infrastructure 实现并注入',
    severity: 'warn',
    from: { path: '^src/application/' },
    to: {
      path: `${frameworkPath}|^src/(app|features|pages|components|infrastructure|data|native|state|export|core)/`,
    },
  },
  {
    name: 'features-no-platform-writes',
    comment: 'UI feature 不得直接访问持久化、原生桥、适配器或导出实现',
    severity: 'warn',
    from: { path: '^src/features/' },
    to: {
      path: '(^|/)node_modules/@capacitor/|^@capacitor/|^src/(data|native|infrastructure|export)/',
    },
  },
  {
    name: 'classification-independent',
    comment: 'classification 不得依赖 time-tracking 实现（调用方提供被引用 ID）',
    severity: 'warn',
    from: { path: '^src/modules/classification/' },
    to: { path: '^src/modules/time-tracking/' },
  },
];

export const baseOptions = {
  doNotFollow: { path: 'node_modules' },
  exclude: {
    path: '^tests/tooling/fixtures/',
  },
  tsConfig: { fileName: 'tsconfig.json' },
  tsPreCompilationDeps: true,
  combinedDependencies: false,
  enhancedResolveOptions: {
    exportsFields: ['exports'],
    conditionNames: ['import', 'require', 'node', 'default'],
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'],
  },
};
