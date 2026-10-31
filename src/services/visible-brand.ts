// Bind translations to the retained compile-time site profile.
export const VISIBLE_APP_NAME =
  typeof __SITE_PROFILE__ === 'undefined'
    ? '吾爱云'
    : __SITE_PROFILE__.clientName

export const replaceVisibleBrand = (text: string) =>
  text
    .replaceAll('Clash Verge Rev', VISIBLE_APP_NAME)
    .replaceAll('Clash-Verge', VISIBLE_APP_NAME)
    .replaceAll('Clash Verge', VISIBLE_APP_NAME)
    .replaceAll('Verge', VISIBLE_APP_NAME)
