import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { posix, win32 } from "node:path";
import type { DetectionContext } from "./types.js";

function getEnv(context: DetectionContext, name: string): string | undefined {
  if (context.platform !== "win32") return context.env[name];
  const key = Object.keys(context.env).find((key) => key.toUpperCase() === name);
  return key === undefined ? undefined : context.env[key];
}

async function isExecutable(file: string, windows: boolean): Promise<boolean> {
  try {
    if (!(await stat(file)).isFile()) return false;
    await access(file, windows ? constants.F_OK : constants.X_OK);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP"].includes(code ?? "")) return false;
    throw error;
  }
}

/** Search PATH in order without running the executable or loading shell profiles. */
export async function findExecutable(command: string, context: DetectionContext): Promise<string | null> {
  const windows = context.platform === "win32";
  const paths = windows ? win32 : posix;
  const extensions = windows
    ? (getEnv(context, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .filter((extension) => /^\.[a-z0-9]+$/i.test(extension))
    : [""];
  const directories = (getEnv(context, "PATH") ?? "").split(paths.delimiter);

  for (const rawDirectory of directories) {
    // Empty PATH entries do not implicitly opt into scanning the current directory.
    const directory = windows ? rawDirectory.replace(/^"(.*)"$/, "$1") : rawDirectory;
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = paths.resolve(context.cwd, directory, `${command}${extension}`);
      if (await isExecutable(candidate, windows)) return candidate;
    }
  }
  return null;
}
