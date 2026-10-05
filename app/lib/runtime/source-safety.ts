const webglEnginePattern = /\b(?:THREE\.(?:WebGLRenderer|Scene|PerspectiveCamera)|WebGLRenderingContext|WebGL2RenderingContext|\.getContext\s*\(\s*['"]webgl2?['"])/i;
const threeModuleImportPattern = /from\s*['"][^'"]*three(?:\.module)?\.js(?:[?#][^'"]*)?['"]/i;
const canvasEnginePattern = /\.getContext\s*\(\s*['"]2d['"]\s*\)/i;

function isWebGLSource(source: string) {
  return webglEnginePattern.test(source) || threeModuleImportPattern.test(source);
}

/** True only when an approved blueprint explicitly changes the rendering engine. */
export function isApprovedEngineMigration(
  engine: 'canvas2d' | 'webgl' | undefined,
  previousSource: string,
  nextSource: string,
) {
  if (engine === 'webgl') {
    return !isWebGLSource(previousSource) && isWebGLSource(nextSource);
  }

  if (engine === 'canvas2d') {
    return isWebGLSource(previousSource) && canvasEnginePattern.test(nextSource);
  }

  return false;
}
