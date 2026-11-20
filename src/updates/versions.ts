import semver from "semver";

export function compareWindowsVersions(left: string, right: string): number {
  const parts = (value: string) => {
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(value)) throw new Error(`无法识别 Windows 应用包版本：${value}`);
    const result = value.split(".").map(Number);
    if (result.some(part => !Number.isInteger(part) || part > 65535)) throw new Error(`无效的 Windows 应用包版本：${value}`);
    return result;
  };
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < 4; index++) {
    if (a[index] !== b[index]) return a[index]! > b[index]! ? 1 : -1;
  }
  return 0;
}

export function checkUpdateVersions(name: string, current: string, latest: string, format: "semver" | "windows" = "semver") {
  let comparison: number;
  if (format === "windows") comparison = compareWindowsVersions(current, latest);
  else {
    if (!semver.valid(current) || !semver.valid(latest)) throw new Error("无法识别本地或服务端版本，未执行更新。");
    comparison = semver.compare(current, latest);
  }
  console.log(`${name} 当前版本：${current}`);
  console.log(`${name} 服务端版本：${latest}`);
  const message = comparison === 0 ? "版本一致，已是最新版，跳过更新。"
    : comparison > 0 ? "当前版本高于服务端版本，跳过更新，避免降级。"
      : `发现新版本：${current} → ${latest}。`;
  console.log(message);
  return { needsUpdate: comparison < 0, message };
}
