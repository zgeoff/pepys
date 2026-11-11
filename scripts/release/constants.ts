// A deploy downloads the asset by this name, and checks it against the sums file of the same release.
export const HOST_ASSET_NAME = 'pepys-host-linux-x64';
export const SUMS_FILE_NAME = 'SHA256SUMS';

// Each asset of a release downloads from `<RELEASES_URL>/<tag>/<asset name>`.
export const RELEASES_URL = 'https://github.com/zgeoff/pepys/releases/download';

// The glibc of the ubuntu-22.04 runner that builds the host. The binary links the symbol versions
// of the glibc it was built against, so it may need nothing newer.
export const GLIBC_FLOOR = '2.35';
