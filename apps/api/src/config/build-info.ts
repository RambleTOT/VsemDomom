import { existsSync, readFileSync } from 'node:fs';

export interface BuildInfo {
  commit: string;
  builtAt: string | undefined;
}

/**
 * Версия сборки: GIT_COMMIT и BUILT_AT из окружения, иначе build.json, который пишет Dockerfile.
 */
export function readBuildInfo(env: Record<string, string | undefined>): BuildInfo {
  const fromEnv = { commit: env.GIT_COMMIT?.trim() || undefined, builtAt: env.BUILT_AT?.trim() || undefined };
  const file = env.BUILD_INFO_FILE;
  let fromFile: Partial<BuildInfo> = {};
  if (file && existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { commit?: unknown; builtAt?: unknown };
      fromFile = {
        commit: typeof parsed.commit === 'string' ? parsed.commit : undefined,
        builtAt: typeof parsed.builtAt === 'string' ? parsed.builtAt : undefined,
      };
    } catch {
      fromFile = {};
    }
  }
  const commit = fromEnv.commit && fromEnv.commit !== 'dev' ? fromEnv.commit : (fromFile.commit ?? fromEnv.commit ?? 'dev');
  return { commit, builtAt: fromEnv.builtAt ?? fromFile.builtAt };
}
