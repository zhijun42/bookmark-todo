import { describeBookmark, getBookmarkBars } from './bookmarks.js';
import { loadFavicon } from './favicons.js';

function folderIcon() {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(icon.namespaceURI, 'path');
  path.setAttribute('d', 'M3 6h6l2 2h10v12H3V6Z');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linejoin', 'round');
  icon.append(path);
  return icon;
}

export function initializeBookmarkBar() {
  const bar = document.querySelector('#bookmark-bar');
  const items = document.querySelector('#bookmark-bar-items');
  const overflowButton = document.querySelector('#bookmark-overflow');
  const menu = document.querySelector('#bookmark-menu');
  const errorMessage = document.querySelector('#bookmark-bar-error');
  const status = document.querySelector('#bookmark-bar-status');
  let nodes = [];
  let overflowNodes = [];
  let nodeMap = new Map();
  let signature;
  let opener;
  let views = [];
  let draggedId;
  let hoverTimer;
  let lastHoverPosition;
  let layoutFrame;

  function closeMenu(restoreFocus = false) {
    clearTimeout(hoverTimer);
    hoverTimer = undefined;
    menu.hidden = true;
    opener?.setAttribute('aria-expanded', 'false');
    if (restoreFocus && opener?.isConnected) opener.focus();
    opener = undefined;
    views = [];
  }

  function focusMenuItem(index = 0) {
    const entries = menu.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])');
    if (entries.length) entries[(index + entries.length) % entries.length].focus();
    else menu.focus();
  }

  function showMenu() {
    const view = views.at(-1);
    const fragment = document.createDocumentFragment();
    if (views.length > 1) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'bar-menu-back';
      back.setAttribute('role', 'menuitem');
      back.textContent = '‹ 返回上一级';
      back.addEventListener('click', () => {
        views.pop();
        showMenu();
        focusMenuItem();
      });
      fragment.append(back);
    }
    const heading = document.createElement('div');
    heading.className = 'bar-menu-heading';
    heading.textContent = view.title;
    heading.setAttribute('aria-hidden', 'true');
    fragment.append(heading);
    for (const node of view.nodes) fragment.append(createEntry(node, true));
    if (view.nodes.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'bar-menu-empty';
      empty.textContent = '此文件夹为空';
      fragment.append(empty);
    }
    menu.replaceChildren(fragment);
    menu.setAttribute('aria-label', view.title);
    menu.hidden = false;
    const rect = opener.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.maxHeight = `${Math.max(100, window.innerHeight - rect.bottom - 16)}px`;
  }

  function openFolder(node, button, nested, toggle = false) {
    if (nested) {
      if (views.at(-1)?.id === node.id) return;
      views.push({ id: node.id, title: node.title || '未命名文件夹', nodes: node.children ?? [] });
    } else {
      if (opener === button && !menu.hidden) {
        if (toggle) closeMenu();
        return;
      }
      closeMenu();
      opener = button;
      opener.setAttribute('aria-expanded', 'true');
      views = [{ id: node.id, title: node.title || '未命名文件夹', nodes: node.children ?? [] }];
    }
    showMenu();
  }

  function canDrop(node) {
    return draggedId && nodeMap.get(draggedId)?.url && !node.unmodifiable;
  }

  function bindFolderHover(button, node, nested) {
    let position;
    function scheduleHover(event) {
      position = { x: event.clientX, y: event.clientY };
      if (event.pointerType === 'touch' || draggedId || views.at(-1)?.id === node.id || hoverTimer) return;
      // Replacing a menu must not cascade into another folder under a stationary pointer.
      if (position.x === lastHoverPosition?.x && position.y === lastHoverPosition?.y) return;
      hoverTimer = setTimeout(() => {
        hoverTimer = undefined;
        if (!button.isConnected) return;
        openFolder(node, button, nested);
        lastHoverPosition = position;
      }, 180);
    }
    button.addEventListener('pointerenter', scheduleHover);
    button.addEventListener('pointermove', scheduleHover);
    button.addEventListener('pointerleave', () => {
      clearTimeout(hoverTimer);
      hoverTimer = undefined;
    });
  }

  function bindDropTarget(button, node, nested) {
    button.addEventListener('dragover', (event) => {
      if (!canDrop(node)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      button.classList.add('drop-target');
      if (!hoverTimer && views.at(-1)?.id !== node.id) {
        hoverTimer = setTimeout(() => {
          hoverTimer = undefined;
          openFolder(node, button, nested);
        }, 500);
      }
    });
    button.addEventListener('dragleave', (event) => {
      if (button.contains(event.relatedTarget)) return;
      button.classList.remove('drop-target');
      clearTimeout(hoverTimer);
      hoverTimer = undefined;
    });
    button.addEventListener('drop', async (event) => {
      if (!canDrop(node)) return;
      event.preventDefault();
      event.stopPropagation();
      clearTimeout(hoverTimer);
      hoverTimer = undefined;
      button.classList.remove('drop-target');
      const id = draggedId;
      draggedId = undefined;
      try {
        await chrome.bookmarks.move(id, { parentId: node.id });
        status.textContent = `已归档到 ${node.title || '未命名文件夹'}`;
        closeMenu();
      } catch (error) {
        console.error('Unable to move bookmark:', error);
        errorMessage.textContent = '移动书签失败，请重试或使用「管理书签」。';
        errorMessage.hidden = false;
      }
    });
  }

  function createEntry(node, inMenu = false) {
    const folder = typeof node.url !== 'string';
    const entry = document.createElement(folder ? 'button' : 'a');
    entry.className = `bar-entry ${folder ? 'bar-folder' : 'bar-link'}`;
    entry.dataset.nodeId = node.id;
    if (inMenu) entry.setAttribute('role', 'menuitem');
    const label = document.createElement('span');
    label.className = 'bar-label';

    if (folder) {
      entry.type = 'button';
      entry.setAttribute('aria-haspopup', 'menu');
      entry.setAttribute('aria-expanded', 'false');
      label.textContent = node.title || '未命名文件夹';
      entry.title = `${label.textContent}\n拖入书签可归档`;
      entry.append(folderIcon(), label);
      if (inMenu) {
        const arrow = document.createElement('span');
        arrow.className = 'bar-folder-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '›';
        entry.append(arrow);
      }
      entry.addEventListener('click', () => {
        errorMessage.hidden = true;
        openFolder(node, entry, inMenu, true);
        if (!menu.hidden) focusMenuItem();
      });
      bindDropTarget(entry, node, inMenu);
      bindFolderHover(entry, node, inMenu);
    } else {
      const info = describeBookmark(node);
      label.textContent = info.title;
      entry.title = `${info.title}\n${node.url}`;
      entry.rel = 'noreferrer noopener';
      entry.draggable = true;
      if (info.navigable) entry.href = node.url;
      else entry.setAttribute('aria-disabled', 'true');
      const icon = document.createElement('span');
      icon.className = 'bar-icon';
      icon.setAttribute('aria-hidden', 'true');
      const fallback = document.querySelector('#bookmark-template').content.querySelector('.favicon-fallback').cloneNode(true);
      icon.append(fallback);
      if (info.favicon) {
        const image = document.createElement('img');
        image.className = 'favicon';
        image.width = image.height = 16;
        image.alt = '';
        image.hidden = true;
        icon.append(image);
        loadFavicon(image, fallback, node.url);
      }
      entry.append(icon, label);
    }
    return entry;
  }

  function layout() {
    layoutFrame = undefined;
    if (bar.hidden) return;
    const entries = [...items.children];
    for (const entry of entries) entry.hidden = false;
    overflowButton.hidden = true;
    const gap = parseFloat(getComputedStyle(items).columnGap) || 0;
    const widths = entries.map((entry) => entry.getBoundingClientRect().width);
    const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, entries.length - 1) * gap;
    let visible = entries.length;
    if (total > items.clientWidth) {
      overflowButton.hidden = false;
      const available = items.clientWidth;
      let used = 0;
      visible = 0;
      for (const width of widths) {
        if (used + width > available) break;
        used += width + gap;
        visible++;
      }
      entries.forEach((entry, index) => { entry.hidden = index >= visible; });
    }
    overflowNodes = nodes.slice(visible);
    if (!menu.hidden && (opener?.hidden || opener === overflowButton)) closeMenu();
  }

  function scheduleLayout() {
    if (!layoutFrame) layoutFrame = requestAnimationFrame(layout);
  }

  function openOverflow() {
    closeMenu();
    opener = overflowButton;
    overflowButton.setAttribute('aria-expanded', 'true');
    views = [{ title: '更多书签', nodes: overflowNodes }];
    showMenu();
  }

  overflowButton.addEventListener('click', () => {
    if (opener === overflowButton && !menu.hidden) {
      closeMenu();
      return;
    }
    openOverflow();
    focusMenuItem();
  });
  overflowButton.addEventListener('dragover', (event) => {
    if (!draggedId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (!hoverTimer && opener !== overflowButton) hoverTimer = setTimeout(openOverflow, 500);
  });
  overflowButton.addEventListener('dragleave', () => {
    clearTimeout(hoverTimer);
    hoverTimer = undefined;
  });

  menu.addEventListener('keydown', (event) => {
    const entries = [...menu.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])')];
    const current = entries.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowLeft', 'ArrowRight', 'Escape'].includes(event.key)) event.preventDefault();
    if (event.key === 'ArrowDown') focusMenuItem(current + 1);
    if (event.key === 'ArrowUp') focusMenuItem(current - 1);
    if (event.key === 'Home') focusMenuItem();
    if (event.key === 'End') focusMenuItem(entries.length - 1);
    if (event.key === 'ArrowRight' && document.activeElement?.classList.contains('bar-folder')) document.activeElement.click();
    if (event.key === 'ArrowLeft' && views.length > 1) {
      views.pop();
      showMenu();
      focusMenuItem();
    }
    if (event.key === 'Escape') closeMenu(true);
  });
  bar.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && event.target.classList.contains('bar-folder')) {
      event.preventDefault();
      openFolder(nodeMap.get(event.target.dataset.nodeId), event.target, false);
      focusMenuItem();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!bar.contains(event.target) && !menu.contains(event.target)) {
      closeMenu();
      errorMessage.hidden = true;
    }
  });
  document.addEventListener('focusin', (event) => {
    if (!bar.contains(event.target) && !menu.contains(event.target)) closeMenu();
  });
  document.addEventListener('dragstart', (event) => {
    const link = event.target.closest?.('.bookmark-link[data-bookmark-id], .bar-link[data-node-id]');
    if (!link || !event.dataTransfer) return;
    draggedId = link.dataset.bookmarkId ?? link.dataset.nodeId;
    event.dataTransfer.setData('text/plain', nodeMap.get(draggedId)?.url ?? '');
    event.dataTransfer.effectAllowed = 'move';
  });
  document.addEventListener('dragend', () => {
    draggedId = undefined;
    clearTimeout(hoverTimer);
    hoverTimer = undefined;
    document.querySelectorAll('.drop-target').forEach((entry) => entry.classList.remove('drop-target'));
  });
  new ResizeObserver(scheduleLayout).observe(bar);
  document.fonts.ready.then(scheduleLayout);
  window.addEventListener('resize', () => {
    closeMenu();
    scheduleLayout();
  });

  return {
    update(tree) {
      const bars = getBookmarkBars(tree);
      const updatedSignature = JSON.stringify(bars);
      if (signature === updatedSignature) return;
      signature = updatedSignature;
      closeMenu();
      nodes = bars.flatMap((root) => root.children ?? []);
      nodeMap = new Map();
      const remaining = [...nodes];
      while (remaining.length) {
        const node = remaining.pop();
        nodeMap.set(node.id, node);
        remaining.push(...(node.children ?? []));
      }
      items.replaceChildren(...nodes.map((node) => createEntry(node)));
      bar.hidden = nodes.length === 0;
      errorMessage.hidden = true;
      scheduleLayout();
    },
    hide() {
      signature = undefined;
      closeMenu();
      bar.hidden = true;
    },
  };
}
