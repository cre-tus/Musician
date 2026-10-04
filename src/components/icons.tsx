// Minimal inline SVG icon set (stroke = currentColor). No emoji icons.
import React from 'react';
import guitarPictogramDark from '../../build/icon-dark.png';
import { useLang } from '../lib/lang';

type P = { size?: number };

function svgProps(size = 16) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
}

export const ChatIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M21 12a8 8 0 0 1-8 8H4l2.3-2.9A8 8 0 1 1 21 12Z" />
  </svg>
);
export const FolderIcon = ({ size, className, open = false }: P & { className?: string; open?: boolean }) => (
  <svg {...svgProps(size)} className={className}>
    {open ? (
      <path d="M2.8 8a2 2 0 0 1 2-2h4.1l2 2h8.3a2 2 0 0 1 1.9 2.6l-2.1 7.1a2 2 0 0 1-1.9 1.4H4.5a2 2 0 0 1-1.9-2.5L4 10H2.8V8Z" fill="currentColor" fillOpacity=".13" />
    ) : (
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    )}
  </svg>
);
export const FileIcon = ({ size, className }: P & { className?: string }) => (
  <svg {...svgProps(size)} className={className}>
    <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5Z" />
    <path d="M14 2v5h5" />
  </svg>
);
export const ExternalLinkIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M13 5h6v6M19 5l-9 9" />
    <path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
  </svg>
);
const FILE_KIND: Record<string, { label: string; color: string; image?: boolean; react?: boolean }> = {
  ts: { label: 'TS', color: '#4f9de8' },
  tsx: { label: '', color: '#4f9de8', react: true },
  mts: { label: 'TS', color: '#4f9de8' },
  cts: { label: 'TS', color: '#4f9de8' },
  js: { label: 'JS', color: '#e7bd4b' },
  jsx: { label: '', color: '#e7bd4b', react: true },
  mjs: { label: 'JS', color: '#e7bd4b' },
  cjs: { label: 'JS', color: '#e7bd4b' },
  vue: { label: 'V', color: '#62b985' },
  svelte: { label: 'S', color: '#ed7955' },
  astro: { label: 'A', color: '#e77c65' },
  py: { label: 'PY', color: '#68a9d8' },
  ipynb: { label: 'NB', color: '#e68b4b' },
  c: { label: 'C', color: '#78a8dc' },
  h: { label: 'H', color: '#78a8dc' },
  cc: { label: 'C++', color: '#dc777e' },
  cxx: { label: 'C++', color: '#dc777e' },
  cpp: { label: 'C++', color: '#dc777e' },
  hpp: { label: 'H++', color: '#dc777e' },
  hxx: { label: 'H++', color: '#dc777e' },
  swift: { label: 'SW', color: '#ed8058' },
  kt: { label: 'KT', color: '#ad8ce2' },
  kts: { label: 'KT', color: '#ad8ce2' },
  dart: { label: 'D', color: '#64b7cc' },
  lua: { label: 'LUA', color: '#7189c7' },
  ex: { label: 'EX', color: '#9a73c9' },
  exs: { label: 'EX', color: '#9a73c9' },
  erl: { label: 'ERL', color: '#bd5b68' },
  hrl: { label: 'ERL', color: '#bd5b68' },
  hs: { label: 'HS', color: '#a88bd7' },
  lhs: { label: 'HS', color: '#a88bd7' },
  scala: { label: 'SC', color: '#df5f61' },
  sc: { label: 'SC', color: '#df5f61' },
  groovy: { label: 'GR', color: '#81a46f' },
  pl: { label: 'PL', color: '#6688c7' },
  pm: { label: 'PL', color: '#6688c7' },
  r: { label: 'R', color: '#6c9bd2' },
  jl: { label: 'JL', color: '#9d79ba' },
  clj: { label: 'CLJ', color: '#80a95c' },
  cljs: { label: 'CLJ', color: '#80a95c' },
  cljc: { label: 'CLJ', color: '#80a95c' },
  edn: { label: 'EDN', color: '#80a95c' },
  json: { label: '{}', color: '#e4b44d' },
  jsonc: { label: '{}', color: '#e4b44d' },
  json5: { label: '{}', color: '#e4b44d' },
  md: { label: 'M', color: '#77aaff' },
  mdx: { label: 'M', color: '#77aaff' },
  css: { label: '#', color: '#bd8de8' },
  scss: { label: '#', color: '#bd8de8' },
  less: { label: '#', color: '#bd8de8' },
  html: { label: '<>', color: '#ed7955' },
  htm: { label: '<>', color: '#ed7955' },
  rs: { label: 'RS', color: '#e19a71' },
  go: { label: 'GO', color: '#57c5d1' },
  java: { label: 'JV', color: '#e57959' },
  cs: { label: 'C#', color: '#9a83dc' },
  php: { label: 'PHP', color: '#898ecb' },
  rb: { label: 'RB', color: '#d87583' },
  yml: { label: '≡', color: '#aeb8c5' },
  yaml: { label: '≡', color: '#aeb8c5' },
  toml: { label: '≡', color: '#aeb8c5' },
  xml: { label: '<>', color: '#ed7955' },
  ini: { label: '≡', color: '#aeb8c5' },
  conf: { label: '≡', color: '#aeb8c5' },
  cfg: { label: '≡', color: '#aeb8c5' },
  properties: { label: '≡', color: '#aeb8c5' },
  gradle: { label: 'G', color: '#73a765' },
  sln: { label: 'SLN', color: '#9a83dc' },
  csproj: { label: 'C#', color: '#9a83dc' },
  env: { label: 'ENV', color: '#abb6c4' },
  sh: { label: '>_', color: '#78bf87' },
  bash: { label: '>_', color: '#78bf87' },
  ps1: { label: '>_', color: '#78bf87' },
  bat: { label: '>_', color: '#78bf87' },
  cmd: { label: '>_', color: '#78bf87' },
  png: { label: '', color: '#b28be7', image: true },
  jpg: { label: '', color: '#b28be7', image: true },
  jpeg: { label: '', color: '#b28be7', image: true },
  webp: { label: '', color: '#b28be7', image: true },
  gif: { label: '', color: '#b28be7', image: true },
  bmp: { label: '', color: '#b28be7', image: true },
  avif: { label: '', color: '#b28be7', image: true },
  ico: { label: '', color: '#b28be7', image: true },
  tif: { label: '', color: '#b28be7', image: true },
  tiff: { label: '', color: '#b28be7', image: true },
  heic: { label: '', color: '#b28be7', image: true },
  heif: { label: '', color: '#b28be7', image: true },
  raw: { label: '', color: '#b28be7', image: true },
  cr2: { label: '', color: '#b28be7', image: true },
  dng: { label: '', color: '#b28be7', image: true },
  svg: { label: '', color: '#ec9566', image: true },
  pdf: { label: 'PDF', color: '#e36b70' },
  doc: { label: 'W', color: '#6495d6' },
  docx: { label: 'W', color: '#6495d6' },
  xls: { label: 'X', color: '#65b487' },
  xlsx: { label: 'X', color: '#65b487' },
  ppt: { label: 'P', color: '#e58a65' },
  pptx: { label: 'P', color: '#e58a65' },
  mp3: { label: '♫', color: '#bd8de8' },
  wav: { label: '♫', color: '#bd8de8' },
  flac: { label: '♫', color: '#bd8de8' },
  aac: { label: '♫', color: '#bd8de8' },
  m4a: { label: '♫', color: '#bd8de8' },
  ogg: { label: '♫', color: '#bd8de8' },
  opus: { label: '♫', color: '#bd8de8' },
  mid: { label: '♫', color: '#bd8de8' },
  midi: { label: '♫', color: '#bd8de8' },
  mp4: { label: '▶', color: '#bd8de8' },
  mov: { label: '▶', color: '#bd8de8' },
  mkv: { label: '▶', color: '#bd8de8' },
  webm: { label: '▶', color: '#bd8de8' },
  avi: { label: '▶', color: '#bd8de8' },
  m4v: { label: '▶', color: '#bd8de8' },
  mpeg: { label: '▶', color: '#bd8de8' },
  mpg: { label: '▶', color: '#bd8de8' },
  zip: { label: 'ZIP', color: '#c39b63' },
  rar: { label: 'RAR', color: '#c39b63' },
  '7z': { label: '7Z', color: '#c39b63' },
  gz: { label: 'ZIP', color: '#c39b63' },
  bz2: { label: 'ZIP', color: '#c39b63' },
  xz: { label: 'ZIP', color: '#c39b63' },
  tar: { label: 'ZIP', color: '#c39b63' },
  tgz: { label: 'ZIP', color: '#c39b63' },
  'tar.gz': { label: 'ZIP', color: '#c39b63' },
  woff: { label: 'A', color: '#b394dc' },
  woff2: { label: 'A', color: '#b394dc' },
  ttf: { label: 'A', color: '#b394dc' },
  otf: { label: 'A', color: '#b394dc' },
  wasm: { label: 'W', color: '#8578d1' },
  map: { label: 'MAP', color: '#9299a4' },
  d: { label: 'D', color: '#9299a4' },
  sql: { label: 'DB', color: '#59b9ad' },
  db: { label: 'DB', color: '#59b9ad' },
  sqlite: { label: 'DB', color: '#59b9ad' },
  sqlite3: { label: 'DB', color: '#59b9ad' },
  pem: { label: 'KEY', color: '#e0bb69' },
  key: { label: 'KEY', color: '#e0bb69' },
  crt: { label: 'CERT', color: '#e0bb69' },
  cer: { label: 'CERT', color: '#e0bb69' },
  p12: { label: 'CERT', color: '#e0bb69' },
  pfx: { label: 'CERT', color: '#e0bb69' },
  prisma: { label: 'PR', color: '#8d9afa' },
  graphql: { label: 'GQL', color: '#df6eaa' },
  gql: { label: 'GQL', color: '#df6eaa' },
  proto: { label: 'PB', color: '#65a9df' },
  tf: { label: 'TF', color: '#9879dc' },
  hcl: { label: 'TF', color: '#9879dc' },
  lockb: { label: 'LCK', color: '#aab2bc' },
  txt: { label: 'TXT', color: '#9da5af' },
  log: { label: 'LOG', color: '#9da5af' },
  lock: { label: 'LCK', color: '#aab2bc' },
  gitignore: { label: 'G', color: '#ed7955' },
  gitattributes: { label: 'G', color: '#ed7955' },
  editorconfig: { label: '≡', color: '#aeb8c5' },
  dockerignore: { label: 'DK', color: '#63a9e8' },
};

const SPECIAL_FILE_KIND: Record<string, { label: string; color: string }> = {
  'bun.lock': { label: 'BUN', color: '#e6c17a' },
  'bun.lockb': { label: 'BUN', color: '#e6c17a' },
  'bunfig.toml': { label: 'BUN', color: '#e6c17a' },
  'pnpm-workspace.yaml': { label: 'PN', color: '#e89a55' },
  '.npmrc': { label: 'N', color: '#d86b70' },
  '.nvmrc': { label: 'N', color: '#82bd67' },
  '.yarnrc': { label: 'Y', color: '#62a9bb' },
  '.yarnrc.yml': { label: 'Y', color: '#62a9bb' },
  'biome.json': { label: 'B', color: '#64b9ae' },
  'biome.jsonc': { label: 'B', color: '#64b9ae' },
  'deno.json': { label: 'D', color: '#c1c8d0' },
  'deno.jsonc': { label: 'D', color: '#c1c8d0' },
  'vercel.json': { label: 'V', color: '#e7e7e7' },
  'netlify.toml': { label: 'N', color: '#67c5b6' },
  'vite.config': { label: 'V', color: '#a78bfa' },
  'vitest.config': { label: 'V', color: '#a78bfa' },
  'webpack.config': { label: 'W', color: '#7ca9d6' },
  'rollup.config': { label: 'R', color: '#ed7777' },
  'next.config': { label: 'N', color: '#e7e7e7' },
  'nuxt.config': { label: 'N', color: '#62b985' },
  'astro.config': { label: 'A', color: '#ed7955' },
  'tailwind.config': { label: 'TW', color: '#55bfd0' },
  'postcss.config': { label: 'P', color: '#dd6a83' },
  'eslint.config': { label: 'E', color: '#9a83dc' },
  '.eslintrc': { label: 'E', color: '#9a83dc' },
  '.prettierrc': { label: 'P', color: '#d08bb5' },
  '.babelrc': { label: 'B', color: '#e7bd4b' },
  'tsconfig': { label: 'TS', color: '#4f9de8' },
  'jsconfig': { label: 'JS', color: '#e7bd4b' },
  'cargo.toml': { label: 'RS', color: '#e19a71' },
  'cargo.lock': { label: 'RS', color: '#e19a71' },
  'pyproject.toml': { label: 'PY', color: '#68a9d8' },
  'requirements.txt': { label: 'PY', color: '#68a9d8' },
  'requirements-dev.txt': { label: 'PY', color: '#68a9d8' },
  'poetry.lock': { label: 'PY', color: '#68a9d8' },
  'uv.lock': { label: 'UV', color: '#d5bd77' },
  'composer.json': { label: 'PHP', color: '#898ecb' },
  'composer.lock': { label: 'PHP', color: '#898ecb' },
  'gemfile': { label: 'RB', color: '#d87583' },
  'gemfile.lock': { label: 'RB', color: '#d87583' },
  'go.mod': { label: 'GO', color: '#57c5d1' },
  'go.sum': { label: 'GO', color: '#57c5d1' },
  'go.work': { label: 'GO', color: '#57c5d1' },
  'go.work.sum': { label: 'GO', color: '#57c5d1' },
  'makefile': { label: 'M', color: '#9299a4' },
  'justfile': { label: 'J', color: '#9299a4' },
  'license': { label: '©', color: '#d0aa68' },
  'changelog': { label: 'CL', color: '#81b8f4' },
  'contributing': { label: 'C', color: '#81b8f4' },
  '.gitmodules': { label: 'G', color: '#ed7955' },
  'package-lock.json': { label: 'N', color: '#82bd67' },
};

const FILE_KIND_NAME: Record<string, string> = {
  'bun.lock': 'Bun 잠금 파일', 'bun.lockb': 'Bun 잠금 파일', 'bunfig.toml': 'Bun 설정',
  'pnpm-workspace.yaml': 'pnpm 워크스페이스 설정', '.npmrc': 'npm 설정', '.nvmrc': 'Node.js 버전 설정',
  '.yarnrc': 'Yarn 설정', '.yarnrc.yml': 'Yarn 설정', 'biome.json': 'Biome 설정', 'biome.jsonc': 'Biome 설정',
  'deno.json': 'Deno 설정', 'deno.jsonc': 'Deno 설정', 'vercel.json': 'Vercel 배포 설정',
  'netlify.toml': 'Netlify 배포 설정', 'vite.config': 'Vite 설정', 'vitest.config': 'Vitest 설정',
  'webpack.config': 'Webpack 설정', 'rollup.config': 'Rollup 설정', 'next.config': 'Next.js 설정',
  'nuxt.config': 'Nuxt 설정', 'astro.config': 'Astro 설정', 'tailwind.config': 'Tailwind CSS 설정',
  'postcss.config': 'PostCSS 설정', 'eslint.config': 'ESLint 설정', '.eslintrc': 'ESLint 설정',
  '.prettierrc': 'Prettier 설정', '.babelrc': 'Babel 설정', 'tsconfig': 'TypeScript 설정',
  'jsconfig': 'JavaScript 프로젝트 설정', 'cargo.toml': 'Rust 패키지 설정', 'cargo.lock': 'Rust 잠금 파일',
  'pyproject.toml': 'Python 프로젝트 설정', 'requirements.txt': 'Python 의존성 목록',
  'requirements-dev.txt': 'Python 개발 의존성 목록', 'poetry.lock': 'Poetry 잠금 파일',
  'uv.lock': 'uv 잠금 파일', 'composer.json': 'Composer 패키지 설정', 'composer.lock': 'Composer 잠금 파일',
  'gemfile': 'Ruby 의존성 목록', 'gemfile.lock': 'Ruby 잠금 파일', 'go.mod': 'Go 모듈 설정',
  'go.sum': 'Go 의존성 체크섬', 'go.work': 'Go 워크스페이스 설정', 'go.work.sum': 'Go 워크스페이스 체크섬',
  'makefile': 'Make 빌드 스크립트', 'justfile': 'Just 작업 스크립트', 'license': '라이선스 문서',
  'changelog': '변경 기록', 'contributing': '기여 안내', '.gitmodules': 'Git 서브모듈 설정',
  ts: 'TypeScript', tsx: 'TypeScript React', mts: 'TypeScript 모듈', cts: 'TypeScript CommonJS',
  js: 'JavaScript', jsx: 'JavaScript React', mjs: 'JavaScript 모듈', cjs: 'JavaScript CommonJS',
  vue: 'Vue 컴포넌트', svelte: 'Svelte 컴포넌트', astro: 'Astro 컴포넌트', py: 'Python',
  json: 'JSON 데이터', jsonc: 'JSON 설정', json5: 'JSON5 데이터', md: 'Markdown 문서', mdx: 'MDX 문서',
  css: 'CSS 스타일시트', scss: 'SCSS 스타일시트', less: 'Less 스타일시트', html: 'HTML 문서', htm: 'HTML 문서',
  rs: 'Rust', go: 'Go', java: 'Java', cs: 'C#', cpp: 'C++', c: 'C', swift: 'Swift', kt: 'Kotlin',
  yaml: 'YAML 설정', yml: 'YAML 설정', toml: 'TOML 설정', xml: 'XML 문서', ini: 'INI 설정',
  sh: '셸 스크립트', bash: 'Bash 스크립트', ps1: 'PowerShell 스크립트', bat: 'Windows 배치 파일',
  png: 'PNG 이미지', jpg: 'JPEG 이미지', jpeg: 'JPEG 이미지', webp: 'WebP 이미지', gif: 'GIF 이미지', svg: 'SVG 벡터 이미지',
  pdf: 'PDF 문서', doc: 'Word 문서', docx: 'Word 문서', xls: 'Excel 스프레드시트', xlsx: 'Excel 스프레드시트',
  ppt: 'PowerPoint 프레젠테이션', pptx: 'PowerPoint 프레젠테이션', mp3: '오디오 파일', wav: '오디오 파일',
  mp4: '비디오 파일', mov: '비디오 파일', zip: 'ZIP 압축 파일', rar: 'RAR 압축 파일', '7z': '7-Zip 압축 파일',
  sql: 'SQL 데이터베이스 스크립트', prisma: 'Prisma 스키마', graphql: 'GraphQL 스키마', gql: 'GraphQL 스키마',
  'tar.gz': 'TAR.GZ 압축 파일', tgz: 'TAR.GZ 압축 파일', heic: 'HEIC 이미지', heif: 'HEIF 이미지', raw: 'RAW 이미지',
  cr2: 'Canon RAW 이미지', dng: 'DNG RAW 이미지', opus: 'Opus 오디오 파일', mid: 'MIDI 오디오 파일', midi: 'MIDI 오디오 파일',
  avi: 'AVI 비디오 파일', m4v: 'M4V 비디오 파일', mpeg: 'MPEG 비디오 파일', mpg: 'MPEG 비디오 파일',
  db: '데이터베이스 파일', sqlite: 'SQLite 데이터베이스', sqlite3: 'SQLite 데이터베이스', pem: '인증서 또는 키 파일',
  key: '키 파일', crt: '인증서 파일', cer: '인증서 파일', p12: '인증서 파일', pfx: '인증서 파일',
};

const FILE_KIND_NAME_EN: Record<string, string> = {
  'bun.lock': 'Bun lockfile', 'bun.lockb': 'Bun lockfile', 'bunfig.toml': 'Bun config',
  'pnpm-workspace.yaml': 'pnpm workspace config', '.npmrc': 'npm config', '.nvmrc': 'Node.js version config',
  '.yarnrc': 'Yarn config', '.yarnrc.yml': 'Yarn config', 'biome.json': 'Biome config', 'biome.jsonc': 'Biome config',
  'deno.json': 'Deno config', 'deno.jsonc': 'Deno config', 'vercel.json': 'Vercel deploy config',
  'netlify.toml': 'Netlify deploy config', 'vite.config': 'Vite config', 'vitest.config': 'Vitest config',
  'webpack.config': 'Webpack config', 'rollup.config': 'Rollup config', 'next.config': 'Next.js config',
  'nuxt.config': 'Nuxt config', 'astro.config': 'Astro config', 'tailwind.config': 'Tailwind CSS config',
  'postcss.config': 'PostCSS config', 'eslint.config': 'ESLint config', '.eslintrc': 'ESLint config',
  '.prettierrc': 'Prettier config', '.babelrc': 'Babel config', 'tsconfig': 'TypeScript config',
  'jsconfig': 'JavaScript project config', 'cargo.toml': 'Rust package config', 'cargo.lock': 'Rust lockfile',
  'pyproject.toml': 'Python project config', 'requirements.txt': 'Python dependencies',
  'requirements-dev.txt': 'Python dev dependencies', 'poetry.lock': 'Poetry lockfile',
  'uv.lock': 'uv lockfile', 'composer.json': 'Composer package config', 'composer.lock': 'Composer lockfile',
  'gemfile': 'Ruby dependencies', 'gemfile.lock': 'Ruby lockfile', 'go.mod': 'Go module config',
  'go.sum': 'Go dependency checksums', 'go.work': 'Go workspace config', 'go.work.sum': 'Go workspace checksums',
  'makefile': 'Make build script', 'justfile': 'Just task script', 'license': 'License document',
  'changelog': 'Changelog', 'contributing': 'Contributing guide', '.gitmodules': 'Git submodule config',
  ts: 'TypeScript', tsx: 'TypeScript React', mts: 'TypeScript module', cts: 'TypeScript CommonJS',
  js: 'JavaScript', jsx: 'JavaScript React', mjs: 'JavaScript module', cjs: 'JavaScript CommonJS',
  vue: 'Vue component', svelte: 'Svelte component', astro: 'Astro component', py: 'Python',
  json: 'JSON data', jsonc: 'JSON config', json5: 'JSON5 data', md: 'Markdown document', mdx: 'MDX document',
  css: 'CSS stylesheet', scss: 'SCSS stylesheet', less: 'Less stylesheet', html: 'HTML document', htm: 'HTML document',
  rs: 'Rust', go: 'Go', java: 'Java', cs: 'C#', cpp: 'C++', c: 'C', swift: 'Swift', kt: 'Kotlin',
  yaml: 'YAML config', yml: 'YAML config', toml: 'TOML config', xml: 'XML document', ini: 'INI config',
  sh: 'Shell script', bash: 'Bash script', ps1: 'PowerShell script', bat: 'Windows batch file',
  png: 'PNG image', jpg: 'JPEG image', jpeg: 'JPEG image', webp: 'WebP image', gif: 'GIF image', svg: 'SVG vector image',
  pdf: 'PDF document', doc: 'Word document', docx: 'Word document', xls: 'Excel spreadsheet', xlsx: 'Excel spreadsheet',
  ppt: 'PowerPoint presentation', pptx: 'PowerPoint presentation', mp3: 'Audio file', wav: 'Audio file',
  mp4: 'Video file', mov: 'Video file', zip: 'ZIP archive', rar: 'RAR archive', '7z': '7-Zip archive',
  sql: 'SQL database script', prisma: 'Prisma schema', graphql: 'GraphQL schema', gql: 'GraphQL schema',
  'tar.gz': 'TAR.GZ archive', tgz: 'TAR.GZ archive', heic: 'HEIC image', heif: 'HEIF image', raw: 'RAW image',
  cr2: 'Canon RAW image', dng: 'DNG RAW image', opus: 'Opus audio file', mid: 'MIDI audio file', midi: 'MIDI audio file',
  avi: 'AVI video file', m4v: 'M4V video file', mpeg: 'MPEG video file', mpg: 'MPEG video file',
  db: 'Database file', sqlite: 'SQLite database', sqlite3: 'SQLite database', pem: 'Certificate or key file',
  key: 'Key file', crt: 'Certificate file', cer: 'Certificate file', p12: 'Certificate file', pfx: 'Certificate file',
};

export const getFileTypeDescription = (name: string, lang?: string) => {
  const en = lang === 'en';
  const kindName = en ? FILE_KIND_NAME_EN : FILE_KIND_NAME;
  const base = name.split(/[\\/]/).pop()?.toLowerCase() || '';
  const ext = base.startsWith('.') && !base.slice(1).includes('.') ? base.slice(1) : base.split('.').pop() || '';
  const compoundExt = base.endsWith('.tar.gz') ? 'tar.gz' : ext;
  const specialName = Object.keys(SPECIAL_FILE_KIND).find((key) => base === key || base.startsWith(`${key}.`));
  const configStem = base.replace(/\.(jsonc?|mjs|cjs|js|ts|mts|cts|yaml|yml)$/, '');
  const typeName = base === 'dockerfile' || base.startsWith('dockerfile.')
    ? (en ? 'Docker config' : 'Docker 설정')
    : base === 'package.json' ? (en ? 'Node.js package config' : 'Node.js 패키지 설정')
      : base === 'package-lock.json' || base === 'pnpm-lock.yaml' || base === 'yarn.lock' || base === 'bun.lock' || base === 'bun.lockb' ? (en ? 'Package lockfile' : '패키지 잠금 파일')
        : base === '.env' || base.startsWith('.env.') ? (en ? 'Environment file' : '환경 변수 파일')
          : base === 'readme' || base.startsWith('readme.') ? (en ? 'README document' : 'README 문서')
          : kindName[specialName || ''] || kindName[configStem] || kindName[compoundExt] || kindName[ext] || (ext ? `${ext.toUpperCase()} ${en ? 'file' : '파일'}` : (en ? 'Generic file' : '일반 파일'));
  return typeName;
};

export const FileTypeIcon = ({ name, size = 15 }: { name: string; size?: number }) => {
  const lang = useLang();
  const base = name.split(/[\\/]/).pop()?.toLowerCase() || '';
  const ext = base.startsWith('.') && !base.slice(1).includes('.') ? base.slice(1) : base.split('.').pop() || '';
  const compoundExt = base.endsWith('.tar.gz') ? 'tar.gz' : ext;
  const specialName = Object.keys(SPECIAL_FILE_KIND).find((key) => base === key || base.startsWith(`${key}.`));
  const configStem = base.replace(/\.(jsonc?|mjs|cjs|js|ts|mts|cts|yaml|yml)$/, '');
  const spec: { label: string; color: string; image?: boolean; react?: boolean } = base === 'dockerfile' || base.startsWith('dockerfile.')
    ? { label: 'DK', color: '#63a9e8' }
    : base === 'package.json' || base === 'package-lock.json'
      ? { label: 'N', color: '#82bd67' }
      : base === 'pnpm-lock.yaml'
        ? { label: 'PN', color: '#e89a55' }
        : base === 'yarn.lock' || base === '.yarnrc' || base === '.yarnrc.yml'
          ? { label: 'Y', color: '#62a9bb' }
          : base === 'bun.lock' || base === 'bun.lockb'
            ? { label: 'BUN', color: '#e6c17a' }
      : base === '.env' || base.startsWith('.env.')
        ? { label: 'ENV', color: '#abb6c4' }
      : base === 'readme' || base.startsWith('readme.')
        ? { label: 'R', color: '#81b8f4' }
        : (specialName && SPECIAL_FILE_KIND[specialName]) || SPECIAL_FILE_KIND[configStem] || FILE_KIND[compoundExt] || FILE_KIND[ext] || { label: '', color: '#9299a4' };
  const typeName = getFileTypeDescription(name, lang);
  return (
    <svg width={size} height={size} viewBox="0 0 20 22" fill="none" className="tree-file-icon" aria-hidden="true">
      <title>{`${typeName} · ${base}`}</title>
      <path d="M4 1.6h7.7L17 6.9v12.6c0 .9-.7 1.6-1.6 1.6H5.6c-.9 0-1.6-.7-1.6-1.6V3.2c0-.9.7-1.6 1.6-1.6Z" fill={spec.color} fillOpacity=".2" stroke={spec.color} strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M11.5 1.9v5h5" fill={spec.color} fillOpacity=".16" stroke={spec.color} strokeWidth="1.2" strokeLinejoin="round" />
      {spec.react ? (
        <g fill="none" stroke={spec.color} strokeWidth=".9">
          <ellipse cx="10.4" cy="14.2" rx="4.7" ry="1.9" />
          <ellipse cx="10.4" cy="14.2" rx="4.7" ry="1.9" transform="rotate(60 10.4 14.2)" />
          <ellipse cx="10.4" cy="14.2" rx="4.7" ry="1.9" transform="rotate(120 10.4 14.2)" />
          <circle cx="10.4" cy="14.2" r=".75" fill={spec.color} stroke="none" />
        </g>
      ) : spec.image ? (
        <>
          <path d="M6.3 16.8 9.1 13l1.9 2.3 1.3-1.5 2.1 3H6.3Z" fill={spec.color} />
          <circle cx="8" cy="10.5" r="1" fill={spec.color} />
        </>
      ) : spec.label ? (
        <text x="10.4" y="15.5" textAnchor="middle" fill={spec.color} stroke="none" fontFamily="system-ui, sans-serif" fontSize={spec.label.length > 2 ? 6.1 : 7.8} fontWeight="800" letterSpacing="-.25">{spec.label}</text>
      ) : (
        <path d="M7 12h6M7 15h6M7 18h4" stroke={spec.color} strokeWidth="1" strokeLinecap="round" />
      )}
    </svg>
  );
};
export const ExplorerIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M4 4.5h6l1.6 2H20v12.2a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 18.7V4.5Z" />
    <path d="M4.5 9h15M8 12.5h8M8 16h5" />
  </svg>
);
export const NewFileIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5Z" />
    <path d="M14 2v5h5M12 11v6M9 14h6" />
  </svg>
);
export const NewFolderIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    <path d="M12 10v6M9 13h6" />
  </svg>
);
export const SlidersIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M4 6h8M18 6h2M4 12h2M12 12h8M4 18h10M20 18h0" />
    <circle cx="15" cy="6" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="17" cy="18" r="2" />
  </svg>
);
export const PlusIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const XIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const CopyIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);
export const CheckIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M4 12.5 9.5 18 20 6.5" />
  </svg>
);
export const ChevronRightIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);
export const ChevronDownIcon = ({ size, className }: P & { className?: string }) => (
  <svg {...svgProps(size)} className={className}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
export const SendIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
  </svg>
);
export const SaveIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
    <path d="M17 21v-8H7v8M7 3v5h8" />
  </svg>
);
export const TrashIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
);
export const TerminalIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m7 9 3 3-3 3M12 15h5" />
  </svg>
);
export const AlertIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M12 3 2 20h20L12 3Z" />
    <path d="M12 10v4M12 17.5v.5" />
  </svg>
);
export const DiffIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M12 4v16" />
  </svg>
);
export const PanelIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </svg>
);
export const SearchIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);
export const ClockIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
export const StarIcon = ({ size, filled = false }: P & { filled?: boolean }) => (
  <svg {...svgProps(size)} fill={filled ? 'currentColor' : 'none'}>
    <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />
  </svg>
);
export const ArchiveIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M4 4h16l1 5H3l1-5Z" />
    <path d="M5 9v10h14V9M9 13h6" />
  </svg>
);
export const UnarchiveIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M4 7h16l1 4H3l1-4Z" />
    <path d="M5 11v8h14v-8M12 15V4m-4 4 4-4 4 4" />
  </svg>
);
export const ExportIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M12 3v11M8 10l4 4 4-4" />
    <path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
  </svg>
);
export const RefreshIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M20 12a8 8 0 1 1-2.3-5.6" />
    <path d="M20 3v4h-4" />
  </svg>
);
export const CollapseIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="m6 9 6 6 6-6" />
    <path d="M4 20h16" />
  </svg>
);
export const BackIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
);
export const ForwardIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const GlobeIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z" />
  </svg>
);
export const HomeIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M9 22V12h6v10" />
  </svg>
);
export const StopIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
  </svg>
);
export const PinIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="m15 4 5 5-3 1-3 4-1 4-2-2-4 4-.8-.8 4-4-2-2 4-1 4-3L15 4Z" />
    <path d="m7 17-3 3" />
  </svg>
);
export const PencilIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z" />
  </svg>
);
export const SidebarIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9.5 4v16" />
  </svg>
);
export const MicIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);
export const ClipIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);
export const WrapLinesIcon = ({ size }: P) => (
  <svg {...svgProps(size)}>
    <path d="M4 6h16M4 10h12a3 3 0 0 1 0 6H8" />
    <path d="m11 13-3 3 3 3" />
    <path d="M4 20h3" />
  </svg>
);
export const GuitarIcon = ({ size = 24 }: P) => (
  <img className="guitar-pictogram" src={guitarPictogramDark} width={size} height={size} alt="" aria-hidden="true" />
);
