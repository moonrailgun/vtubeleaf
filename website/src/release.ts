// Resolved once from GitHub during the build; shared by the static HTML and hydration.
declare const __RELEASE__: {
  version: string;
  url: string;
  windows: string;
  mac: string;
  macZip: string;
};

export const release = __RELEASE__;
