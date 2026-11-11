// A deploy downloads the asset by this name, and checks it against the sums file of the same release.
export const HOST_ASSET_NAME = 'pepys-host-linux-x64';
export const SUMS_FILE_NAME = 'SHA256SUMS';

// The glibc of the ubuntu-22.04 runner that builds the host. The binary links the symbol versions
// of the glibc it was built against, so it may need nothing newer.
export const GLIBC_FLOOR = '2.35';
