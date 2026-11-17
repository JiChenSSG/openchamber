/** The bundled OpenCode keeps its upstream bytes and runs under the ocf name. */
export const bundledOpenCodeCliName = (platform = process.platform) => platform === 'win32' ? 'ocf.exe' : 'ocf';
