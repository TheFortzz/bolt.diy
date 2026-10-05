type FormatterPlugin = Record<string, unknown>;

const pluginLoaders: Record<string, () => Promise<{ default?: FormatterPlugin } & FormatterPlugin>> = {
  babel: () => import('prettier/plugins/babel'),
  estree: () => import('prettier/plugins/estree'),
  html: () => import('prettier/plugins/html'),
  postcss: () => import('prettier/plugins/postcss'),
  markdown: () => import('prettier/plugins/markdown'),
};

const formatterConfig: Record<string, { parser: string; plugins: string[] }> = {
  '.js': { parser: 'babel', plugins: ['babel', 'estree'] },
  '.mjs': { parser: 'babel', plugins: ['babel', 'estree'] },
  '.html': { parser: 'html', plugins: ['html', 'babel', 'estree', 'postcss'] },
  '.css': { parser: 'css', plugins: ['postcss'] },
  '.json': { parser: 'json', plugins: ['babel', 'estree'] },
  '.md': { parser: 'markdown', plugins: ['markdown'] },
};

/** Format generated source before it reaches the live editor or preview. */
export async function formatWorkspaceSource(path: string, source: string) {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
  const config = formatterConfig[extension];

  if (!config || source.trim().length === 0) {
    return source;
  }

  const [prettier, ...plugins] = await Promise.all([
    import('prettier/standalone'),
    ...config.plugins.map(async (name) => {
      const module = await pluginLoaders[name]();
      return module.default || module;
    }),
  ]);

  return prettier.format(source, {
    parser: config.parser,
    plugins,
    printWidth: 100,
    tabWidth: 2,
    useTabs: false,
    singleQuote: true,
    semi: true,
    trailingComma: 'all',
    embeddedLanguageFormatting: 'auto',
  });
}
