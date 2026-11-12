export interface NpmAgentInstaller {
  packageName: string;
  entryPoint: string;
  useDefaultProxy: boolean;
}

export interface DesktopDownload {
  id: string;
  name: string;
  url: string;
}
