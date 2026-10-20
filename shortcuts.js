import { loadFavicon } from './favicons.js';

const defaults = [
  { id: 'reddit', title: 'reddit', url: 'https://www.reddit.com/' },
  { id: 'waitbutwhy', title: 'wait but why', url: 'https://waitbutwhy.com/' },
  { id: 'fs', title: 'FS', url: 'https://fs.blog/' },
  { id: 'twitter', title: 'Twitter punk6529', url: 'https://x.com/punk6529' },
  { id: 'xiaohongshu', title: '小红书', url: 'https://www.xiaohongshu.com/user/profile/5f7b5e63000000000101d422?tab=liked' },
  { id: 'hackernews', title: 'Hacker News', url: 'https://news.ycombinator.com/' },
  { id: 'discord', title: 'Discord', url: 'https://discord.com/channels/1229655852118442065/1231290232960450661' },
  { id: 'timferriss', title: 'Tim Ferriss', url: 'https://mail.google.com/mail/u/0/#category/forums' },
];

function normalizeURL(value) {
  const input = value.trim();
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`);
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname) {
    throw new Error('请输入有效的 HTTP 或 HTTPS 网址。');
  }
  return url.href;
}

export function initializeShortcuts() {
  const list = document.querySelector('#shortcut-list');
  const template = document.querySelector('#shortcut-template');
  const dialog = document.querySelector('#shortcut-dialog');
  const titleInput = document.querySelector('#shortcut-title');
  const urlInput = document.querySelector('#shortcut-url');
  const errorMessage = document.querySelector('#shortcut-error');
  const deleteButton = document.querySelector('#delete-shortcut');
  const saveButton = document.querySelector('#save-shortcut');
  let shortcuts = defaults;
  let editingId;

  function openEditor(shortcut) {
    editingId = shortcut?.id;
    document.querySelector('#shortcut-dialog-title').textContent = shortcut ? '编辑快捷方式' : '添加快捷方式';
    titleInput.value = shortcut?.title ?? '';
    urlInput.value = shortcut?.url ?? '';
    errorMessage.hidden = true;
    deleteButton.hidden = !shortcut;
    dialog.showModal();
  }

  function render() {
    const fragment = document.createDocumentFragment();
    for (const shortcut of shortcuts) {
      const item = template.content.cloneNode(true);
      const link = item.querySelector('.shortcut-link');
      link.href = shortcut.url;
      link.title = `${shortcut.title}\n${shortcut.url}`;
      item.querySelector('.shortcut-label').textContent = shortcut.title;
      loadFavicon(item.querySelector('.favicon'), item.querySelector('.favicon-fallback'), shortcut.url);
      const editButton = item.querySelector('.edit-shortcut');
      editButton.setAttribute('aria-label', `编辑 ${shortcut.title}`);
      editButton.addEventListener('click', () => openEditor(shortcut));
      fragment.append(item);
    }
    const addItem = document.createElement('li');
    addItem.className = 'shortcut-item';
    const addButton = document.createElement('button');
    addButton.id = 'add-shortcut';
    addButton.className = 'shortcut-link';
    addButton.type = 'button';
    const icon = document.createElement('span');
    icon.className = 'shortcut-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '+';
    icon.style.fontSize = '30px';
    const label = document.createElement('span');
    label.className = 'shortcut-label';
    label.textContent = '添加快捷方式';
    addButton.append(icon, label);
    addButton.addEventListener('click', () => openEditor());
    addItem.append(addButton);
    fragment.append(addItem);
    list.replaceChildren(fragment);
  }

  async function persist(updated) {
    saveButton.disabled = true;
    deleteButton.disabled = true;
    try {
      await chrome.storage.local.set({ shortcuts: updated });
      shortcuts = updated;
      render();
      dialog.close();
    } catch (error) {
      console.error('Unable to save shortcuts:', error);
      errorMessage.textContent = '暂时无法保存快捷方式，请重试。';
      errorMessage.hidden = false;
    } finally {
      saveButton.disabled = false;
      deleteButton.disabled = false;
    }
  }

  document.querySelector('#shortcut-form').addEventListener('submit', (event) => {
    event.preventDefault();
    let url;
    try {
      url = normalizeURL(urlInput.value);
    } catch {
      errorMessage.textContent = '请输入有效的 HTTP 或 HTTPS 网址。';
      errorMessage.hidden = false;
      urlInput.focus();
      return;
    }
    const shortcut = { id: editingId ?? crypto.randomUUID(), title: titleInput.value.trim() || new URL(url).hostname, url };
    persist(editingId ? shortcuts.map((entry) => entry.id === editingId ? shortcut : entry) : [...shortcuts, shortcut]);
  });
  deleteButton.addEventListener('click', () => persist(shortcuts.filter(({ id }) => id !== editingId)));
  document.querySelector('#cancel-shortcut').addEventListener('click', () => dialog.close());

  function restore(value) {
    if (!Array.isArray(value)) return defaults;
    return value.filter((entry) => {
      try {
        return typeof entry.id === 'string' && typeof entry.title === 'string' && normalizeURL(entry.url) === entry.url;
      } catch {
        return false;
      }
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.shortcuts) {
      shortcuts = restore(changes.shortcuts.newValue);
      render();
    }
  });
  render();
  chrome.storage.local.get('shortcuts').then(({ shortcuts: saved }) => {
    shortcuts = restore(saved);
    render();
  }).catch((error) => {
    console.error('Unable to load saved shortcuts:', error);
  });
}
