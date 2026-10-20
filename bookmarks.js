export function getBookmarkBars(tree) {
  const topLevelFolders = tree.flatMap((root) => root.children ?? []);
  const bookmarkBars = topLevelFolders.filter((node) => node.folderType === 'bookmarks-bar');

  // Older Chrome releases do not expose folderType; folder titles depend on the browser language.
  return bookmarkBars.length > 0
    ? bookmarkBars
    : topLevelFolders.filter((node) => node.id === '1' && !node.folderType);
}

export function collectInbox(tree) {
  return getBookmarkBars(tree)
    .flatMap((bar) => (bar.children ?? []).filter((node) => typeof node.url === 'string'))
    .sort((left, right) => (right.dateAdded ?? 0) - (left.dateAdded ?? 0));
}

export function describeBookmark(bookmark) {
  const title = bookmark.title.trim() || bookmark.url;

  try {
    const url = new URL(bookmark.url);
    const executable = ['javascript:', 'data:', 'vbscript:'].includes(url.protocol);
    return {
      title,
      domain: executable ? '脚本书签 · 请从书签栏运行' : url.hostname.replace(/^www\./, '') || url.protocol.slice(0, -1),
      navigable: !executable,
      favicon: ['http:', 'https:'].includes(url.protocol),
    };
  } catch {
    return { title, domain: '无效网址 · 请在书签管理器中检查', navigable: false, favicon: false };
  }
}
