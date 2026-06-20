document.addEventListener('DOMContentLoaded', async () => {
    const app = document.getElementById('app');

    const dimOverlay = document.createElement('div');
    dimOverlay.id = 'dim-overlay';
    document.body.appendChild(dimOverlay);

    dimOverlay.addEventListener('click', () => {
        document.body.classList.remove('selection-mode');
        if (!isVideoScrollMode) activeVideoIndex = -1;
        updateVideoSelection();
    });

    let customGhost = null;
    let draggedElement = null;
    let isDragging = false;
    let startX = 0, startY = 0;
    let currentX = 0, currentY = 0;
    let autoScrollAnimationId = null;
    let lastArrowKeyPress = 0;
    let isVideoScrollMode = false;
    let activeVideoIndex = -1;
    let isShortsView = false;

    function getFirstVisibleVideoIndex() {
        const videoElements = Array.from(videoBoard.querySelectorAll('.vidBox'));
        if (videoElements.length === 0) return 0;

        const threshold = channelsBar.getBoundingClientRect().bottom;

        for (let i = 0; i < videoElements.length; i++) {
            const rect = videoElements[i].getBoundingClientRect();
            if (rect.top >= threshold - 10 || rect.bottom > threshold + 40) {
                return i;
            }
        }
        return 0;
    }

    function updateVideoSelection() {
        const videoElements = Array.from(videoBoard.querySelectorAll('.vidBox'));
        if (videoElements.length === 0) return;

        const isHighlightMode = isVideoScrollMode || document.body.classList.contains('selection-mode');

        if (!isHighlightMode) {
            videoElements.forEach(el => el.classList.remove('active'));
            return;
        }

        if (activeVideoIndex >= videoElements.length) {
            activeVideoIndex = videoElements.length - 1;
        } else if (activeVideoIndex < 0) {
            activeVideoIndex = 0;
        }

        videoElements.forEach((el, index) => {
            if (index === activeVideoIndex) {
                el.classList.add('active');
                el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } else {
                el.classList.remove('active');
            }
        });
    }

    function handleAutoScroll() {
        if (!isDragging || !draggedElement) return;

        const isChannel = draggedElement.classList.contains('channel-icon');
        const container = isChannel ? channelsBar : sidebar;

        const rect = container.getBoundingClientRect();
        const scrollZone = 60;
        let didScroll = false;

        if (isChannel) {
            if (currentX < rect.left + scrollZone) {
                container.scrollLeft -= 8;
                didScroll = true;
            } else if (currentX > rect.right - scrollZone) {
                container.scrollLeft += 8;
                didScroll = true;
            }
        } else {
            const sidebarRect = sidebar.getBoundingClientRect();
            if (currentY < sidebarRect.top + scrollZone) {
                sidebar.scrollTop -= 8;
                didScroll = true;
            } else if (currentY > sidebarRect.bottom - scrollZone) {
                sidebar.scrollTop += 8;
                didScroll = true;
            }
        }

        if (didScroll) {
            updateDragPosition(isChannel, container);
        }

        autoScrollAnimationId = requestAnimationFrame(handleAutoScroll);
    }

    function updateDragPosition(isChannel, container) {
        const afterElement = getDragAfterElement(container, isChannel ? currentX : currentY, isChannel);
        const currentNext = draggedElement.nextElementSibling;

        if (afterElement !== currentNext) {
            const selector = isChannel ? '.channel-icon' : '.tag-item';
            const children = [...container.querySelectorAll(selector)];
            const firstRects = children.map(child => child.getBoundingClientRect());

            if (afterElement == null) {
                container.appendChild(draggedElement);
            } else {
                container.insertBefore(draggedElement, afterElement);
            }

            const lastRects = children.map(child => child.getBoundingClientRect());
            children.forEach((child, i) => {
                const dx = isChannel ? (firstRects[i].left - lastRects[i].left) : 0;
                const dy = isChannel ? 0 : (firstRects[i].top - lastRects[i].top);
                if ((dx !== 0 || dy !== 0) && child !== draggedElement) {
                    child.style.transform = `translate(${dx}px, ${dy}px)`;
                    child.style.transition = 'none';
                    child.getBoundingClientRect(); // Force reflow
                    child.style.transform = '';
                    child.style.transition = 'transform 0.2s ease-out';
                }
            });
        }
    }

    document.addEventListener('mousemove', (e) => {
        if (!draggedElement) return;

        currentX = e.clientX;
        currentY = e.clientY;

        if (!isDragging) {
            if (Math.abs(e.clientX - startX) > 5 || Math.abs(e.clientY - startY) > 5) {
                const isChannel = draggedElement.classList.contains('channel-icon');
                if (isChannel && activeTag === null) {
                    return;
                }
                isDragging = true;
                draggedElement.classList.add('dragging');
                document.body.classList.add('is-dragging');

                customGhost = draggedElement.cloneNode(true);
                customGhost.classList.remove('dragging');
                customGhost.classList.add('custom-ghost');
                document.body.appendChild(customGhost);

                if (!autoScrollAnimationId) {
                    autoScrollAnimationId = requestAnimationFrame(handleAutoScroll);
                }
            } else {
                return;
            }
        }

        customGhost.style.left = (e.clientX - draggedElement.offsetWidth / 2) + 'px';
        customGhost.style.top = (e.clientY - draggedElement.offsetHeight / 2) + 'px';

        const isChannel = draggedElement.classList.contains('channel-icon');
        const container = isChannel ? channelsBar : sidebar;

        updateDragPosition(isChannel, container);
    });

    document.addEventListener('mouseup', () => {
        if (draggedElement) {
            if (autoScrollAnimationId) {
                cancelAnimationFrame(autoScrollAnimationId);
                autoScrollAnimationId = null;
            }
            document.body.classList.remove('is-dragging');
            const isChannel = draggedElement.classList.contains('channel-icon');
            if (isDragging) {
                draggedElement.classList.remove('dragging');
                if (customGhost) {
                    customGhost.remove();
                    customGhost = null;
                }
                if (isChannel) {
                    const draggedHandle = draggedElement.dataset.handle;
                    const nextEl = draggedElement.nextElementSibling;
                    const nextHandle = nextEl ? nextEl.dataset.handle : null;
                    const prevEl = draggedElement.previousElementSibling;
                    const prevHandle = prevEl ? prevEl.dataset.handle : null;

                    let fullArray = [...(dbData.tags[activeTag] || [])];
                    // Remove the dragged handle
                    fullArray = fullArray.filter(h => h !== draggedHandle);

                    if (nextHandle) {
                        const insertIndex = fullArray.indexOf(nextHandle);
                        if (insertIndex !== -1) {
                            fullArray.splice(insertIndex, 0, draggedHandle);
                        } else {
                            fullArray.push(draggedHandle);
                        }
                    } else if (prevHandle) {
                        const insertIndex = fullArray.indexOf(prevHandle);
                        if (insertIndex !== -1) {
                            fullArray.splice(insertIndex + 1, 0, draggedHandle);
                        } else {
                            fullArray.push(draggedHandle);
                        }
                    } else {
                        fullArray.push(draggedHandle);
                    }

                    dbData.tags[activeTag] = fullArray;

                    fetch('/reorderTag', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tag: activeTag, handles: fullArray })
                    }).catch(err => console.error('Error saving order', err));
                } else {
                    const newTags = [...sidebar.querySelectorAll('.tag-item[data-tag]')].map(el => el.dataset.tag);
                    const newTagsObj = {};
                    newTags.forEach(t => { if (dbData.tags[t]) newTagsObj[t] = dbData.tags[t]; });
                    dbData.tags = newTagsObj;
                    fetch('/reorderTagsList', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tags: newTags })
                    }).catch(err => console.error('Error saving order', err));
                }
            } else {
                if (isChannel) {
                    activeChannel = draggedElement.dataset.handle;
                    renderChannelsBar();
                    renderTopBarLeft();
                } else {
                    activeTag = draggedElement.dataset.tag;
                    activeChannel = null;
                    renderSidebar();
                    renderChannelsBar();
                    renderTopBarLeft();
                    window.scrollTo(0, 0);
                    channelsBar.scrollLeft = 0;
                }
            }
            draggedElement = null;
            isDragging = false;
        }
    });

    const toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    document.body.appendChild(toastContainer);

    let isAborting = false;
    let activeProcessToast = null;

    async function abortUpdate() {
        if (isAborting) return;
        isAborting = true;
        if (activeProcessToast) {
            activeProcessToast.remove();
            activeProcessToast = null;
        }
        showToast('Aborting update...', '#dc3545', false, false);
        try {
            await fetch('/abortUpdate');
        } catch (err) {
            console.error('Failed to abort:', err);
        }
    }

    function showToast(message, color = '#007bff', showClose = false, persistent = false) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.style.backgroundColor = color;

        const toastMessage = document.createElement('span');
        toastMessage.className = 'toast-message';
        toastMessage.textContent = message;
        toast.appendChild(toastMessage);

        if (showClose) {
            const toastCloseBtn = document.createElement('span');
            toastCloseBtn.className = 'toast-close';
            toastCloseBtn.title = 'Abort Update';
            toastCloseBtn.innerHTML = '&times;';
            toastCloseBtn.addEventListener('click', () => {
                abortUpdate();
            });
            toast.appendChild(toastCloseBtn);
        }

        toastContainer.appendChild(toast);

        let timeoutId;
        if (!persistent) {
            timeoutId = setTimeout(() => {
                toast.remove();
            }, 3000);
        }

        return {
            update: (msg) => { toastMessage.textContent = msg; },
            remove: () => {
                clearTimeout(timeoutId);
                toast.remove();
            }
        };
    }

    const progressSource = new EventSource('/updateProgress');
    progressSource.onmessage = (event) => {
        if (!isAborting) {
            if (activeProcessToast) {
                activeProcessToast.update(event.data);
            } else {
                showToast(event.data, '#007bff', true, false);
            }
        }
    };

    let isCurrentlyUpdating = false;
    function setUpdatingState(isUpdating) {
        isCurrentlyUpdating = isUpdating;
        if (!isUpdating) {
            isAborting = false;
        }
        updateButtonStates();
    }

    function updateButtonStates() {
        const isRecentsOrNull = !activeChannel || activeChannel === '<recents>';
        const isDbEmpty = !dbData || !dbData.subs || Object.keys(dbData.subs).length === 0;

        if (isDbEmpty) {
            if (typeof updateChannelBtn !== 'undefined') updateChannelBtn.disabled = true;
            if (typeof updateBtn !== 'undefined') updateBtn.disabled = true;
            if (typeof addTagBtn !== 'undefined') addTagBtn.disabled = true;
            if (typeof eyeBtn !== 'undefined') eyeBtn.disabled = true;
            if (typeof retrieveBtn !== 'undefined') retrieveBtn.disabled = isCurrentlyUpdating;
        } else {
            if (typeof updateChannelBtn !== 'undefined') updateChannelBtn.disabled = isCurrentlyUpdating || isRecentsOrNull;
            if (typeof updateBtn !== 'undefined') updateBtn.disabled = isCurrentlyUpdating;
            if (typeof retrieveBtn !== 'undefined') retrieveBtn.disabled = isCurrentlyUpdating;
            if (typeof addTagBtn !== 'undefined') addTagBtn.disabled = isRecentsOrNull;
            if (typeof eyeBtn !== 'undefined') eyeBtn.disabled = !activeChannel;
        }

        if (isRecentsOrNull || isDbEmpty) {
            const wrapper = document.getElementById('add-tag-input-wrapper');
            if (wrapper) wrapper.style.display = 'none';
        }
        if (!activeChannel || isDbEmpty) {
            document.body.classList.remove('selection-mode');
            if (!isVideoScrollMode) activeVideoIndex = -1;
        }
    }

    window.addEventListener('beforeunload', () => {
        if (isCurrentlyUpdating) {
            navigator.sendBeacon('/abortUpdate');
        }
    });

    // Create layout
    const topBar = document.createElement('div');
    topBar.id = 'top-bar';

    const topBarLeft = document.createElement('div');
    topBarLeft.id = 'top-bar-left';

    const topBarRight = document.createElement('div');
    topBarRight.id = 'top-bar-right';

    const searchContainer = document.createElement('div');
    searchContainer.id = 'search-container';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.id = 'search-input';
    searchInput.placeholder = 'search list...';

    const searchDropdown = document.createElement('div');
    searchDropdown.id = 'search-dropdown';

    let searchSelectedIndex = -1;

    searchInput.addEventListener('input', () => {
        const query = searchInput.value.replace(/\s+/g, '').toLowerCase();
        searchDropdown.innerHTML = '';
        searchSelectedIndex = -1;
        if (!query) {
            searchDropdown.style.display = 'none';
            return;
        }

        const matches = Object.entries(dbData.subs || {}).filter(([handle, data]) => {
            const normalizedName = (data.name || '').replace(/\s+/g, '').toLowerCase();
            const normalizedHandle = handle.replace(/\s+/g, '').toLowerCase();
            return normalizedName.includes(query) || normalizedHandle.includes(query);
        }).slice(0, 10);

        if (matches.length > 0) {
            searchDropdown.style.display = 'block';
            matches.forEach(([handle, data]) => {
                const item = document.createElement('div');
                item.className = 'search-dropdown-item search-match';

                const img = document.createElement('img');
                img.src = data.profilePic || 'https://via.placeholder.com/50';
                img.referrerPolicy = 'no-referrer';

                const nameSpan = document.createElement('span');
                nameSpan.textContent = data.name || handle.replace('@', '');

                item.appendChild(img);
                item.appendChild(nameSpan);

                item.addEventListener('click', () => {
                    activeChannel = handle;
                    searchInput.value = '';
                    searchDropdown.style.display = 'none';
                    searchInput.blur();

                    let hasTag = false;
                    if (activeTag === null) {
                        hasTag = true;
                    } else if (dbData.tags && dbData.tags[activeTag] && dbData.tags[activeTag].includes(handle)) {
                        hasTag = true;
                    }

                    if (!hasTag && dbData.tags) {
                        for (const tag of Object.keys(dbData.tags)) {
                            if (dbData.tags[tag].includes(handle)) {
                                activeTag = tag;
                                renderSidebar();
                                break;
                            }
                        }
                    }

                    renderChannelsBar();
                    renderTopBarLeft();

                    // Scroll the newly active channel into view
                    const activeIcon = channelsBar.querySelector('.channel-icon.active');
                    if (activeIcon) {
                        activeIcon.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                    }
                });

                searchDropdown.appendChild(item);
            });
        } else {
            searchDropdown.style.display = 'block';
            const noResults = document.createElement('div');
            noResults.className = 'search-dropdown-item no-results-item';
            noResults.textContent = 'no results...';
            searchDropdown.appendChild(noResults);
        }
    });

    searchInput.addEventListener('keydown', (e) => {
        const items = Array.from(searchDropdown.querySelectorAll('.search-match'));

        if (e.key === 'Escape') {
            searchInput.value = '';
            searchDropdown.style.display = 'none';
            searchInput.blur();
            searchSelectedIndex = -1;
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (items.length > 0) {
                searchSelectedIndex = (searchSelectedIndex + 1) % items.length;
                items.forEach((item, index) => item.classList.toggle('selected', index === searchSelectedIndex));
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (items.length > 0) {
                searchSelectedIndex = searchSelectedIndex <= 0 ? items.length - 1 : searchSelectedIndex - 1;
                items.forEach((item, index) => item.classList.toggle('selected', index === searchSelectedIndex));
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (items.length > 0) {
                const idx = searchSelectedIndex === -1 ? 0 : searchSelectedIndex;
                items[idx].click();
            }
        }
    });

    document.addEventListener('click', (e) => {
        if (!searchContainer.contains(e.target)) {
            searchDropdown.style.display = 'none';
            searchInput.value = '';
        }
    });

    searchContainer.appendChild(searchInput);
    searchContainer.appendChild(searchDropdown);

    document.addEventListener('keydown', (e) => {
        const isInput = document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA';

        if (e.key === 'Escape' && (document.body.classList.contains('selection-mode') || isVideoScrollMode)) {
            document.body.classList.remove('selection-mode');
            document.body.classList.remove('video-scroll-mode');
            isVideoScrollMode = false;
            activeVideoIndex = -1;
            updateVideoSelection();
        } else if (!isInput) {
            const noModifiers = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
            if (e.key === '/') {
                e.preventDefault();
                searchInput.focus();
            } else if (e.key.toLowerCase() === 'a' && noModifiers) {
                if (isCurrentlyUpdating) {
                    e.preventDefault();
                    abortUpdate();
                }
            } else if (e.key.toLowerCase() === 'c' && noModifiers) {
                e.preventDefault();
                if (!updateChannelBtn.disabled) updateChannelBtn.click();
            } else if (e.key.toLowerCase() === 'v' && noModifiers) {
                e.preventDefault();
                if (!updateBtn.disabled) updateBtn.click();
            } else if (e.key.toLowerCase() === 'w' && noModifiers) {
                e.preventDefault();
                if (!eyeBtn.disabled) eyeBtn.click();
            } else if (e.key.toLowerCase() === 't' && noModifiers) {
                e.preventDefault();
                if (!addTagBtn.disabled) addTagBtn.click();
            } else if (e.key.toLowerCase() === 's' && noModifiers) {
                e.preventDefault();
                sidebar.style.display = sidebar.style.display === 'block' ? 'none' : 'block';
            } else if (e.key.toLowerCase() === 'z' && noModifiers) {
                e.preventDefault();
                isShortsView = !isShortsView;
                document.body.classList.toggle('shorts-view', isShortsView);
                updateChannelBtn.textContent = isShortsView ? 'update shorts' : 'update vids';
                renderVideos();
            } else if (e.key.toLowerCase() === 'x' && noModifiers) {
                e.preventDefault();
                if (activeChannel && activeChannel !== '<recents>') {
                    const channelData = dbData.subs[activeChannel];
                    const cutoffProp = isShortsView ? 'timecutoffShorts' : 'timecutoff';
                    if (!channelData || !channelData[cutoffProp]) return;
                }
                isCutoffEnabled = !isCutoffEnabled;
                if (activeChannel) {
                    renderVideos();
                }
            } else if (e.key.toLowerCase() === 'f' && sidebar.style.display === 'block' && noModifiers) {
                e.preventDefault();
                if (activeTag !== null) {
                    if (checkedTags.has(activeTag)) {
                        checkedTags.delete(activeTag);
                    } else {
                        checkedTags.add(activeTag);
                    }
                    const activeTagItem = sidebar.querySelector('.tag-item.active');
                    if (activeTagItem) {
                        const checkbox = activeTagItem.querySelector('.tag-filter-checkbox');
                        if (checkbox) checkbox.checked = checkedTags.has(activeTag);
                    }
                    renderChannelsBar();
                    renderTopBarLeft();
                }
            } else if (e.key.toLowerCase() === 'e' && noModifiers) {
                e.preventDefault();
                isVideoScrollMode = !isVideoScrollMode;
                if (isVideoScrollMode) {
                    activeVideoIndex = getFirstVisibleVideoIndex();
                    document.body.classList.add('video-scroll-mode');
                } else {
                    document.body.classList.remove('video-scroll-mode');
                    if (!document.body.classList.contains('selection-mode')) {
                        activeVideoIndex = -1;
                    }
                }
                updateVideoSelection();
            } else if (e.key.toLowerCase() === 'r' && sidebar.style.display === 'block' && noModifiers) {
                e.preventDefault();
                const activeTagItem = sidebar.querySelector('.tag-item.active');
                if (activeTagItem && activeTag !== '<untagged>') {
                    if (!activeTagItem.querySelector('.tag-rename-input')) {
                        const renameBtn = activeTagItem.querySelector('.tag-rename-btn');
                        if (renameBtn) renameBtn.click();
                    }
                }
            } else if (e.key === 'Enter') {
                if (document.body.classList.contains('selection-mode') && activeVideoIndex >= 0) {
                    e.preventDefault();
                    const videoElements = Array.from(videoBoard.querySelectorAll('.vidBox'));
                    if (videoElements[activeVideoIndex]) {
                        videoElements[activeVideoIndex].click();
                    }
                } else if (isVideoScrollMode && activeVideoIndex >= 0) {
                    e.preventDefault();
                    const videoElements = Array.from(videoBoard.querySelectorAll('.vidBox'));
                    if (videoElements[activeVideoIndex]) {
                        const newTab = window.open(videoElements[activeVideoIndex].href, '_blank');
                        if (newTab) {
                            newTab.blur();
                            window.focus();
                        }
                    }
                }
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                if (isVideoScrollMode || document.body.classList.contains('selection-mode') || sidebar.style.display === 'block') {
                    e.preventDefault();
                    const now = Date.now();
                    if (now - lastArrowKeyPress < 150) return;
                    lastArrowKeyPress = now;

                    if (isVideoScrollMode || document.body.classList.contains('selection-mode')) {
                        const videoElements = Array.from(videoBoard.querySelectorAll('.vidBox'));
                        if (videoElements.length > 0) {
                            let gridColumns = isShortsView ? 5 : 4;
                            if (window.innerWidth <= 600) {
                                gridColumns = isShortsView ? 2 : 1;
                            } else if (window.innerWidth <= 900) {
                                gridColumns = isShortsView ? 3 : 2;
                            }

                            if (e.key === 'ArrowDown') {
                                activeVideoIndex = Math.min(activeVideoIndex + gridColumns, videoElements.length - 1);
                            } else {
                                activeVideoIndex = Math.max(activeVideoIndex - gridColumns, 0);
                            }
                            updateVideoSelection();
                        }
                    } else {
                        const tags = [null, ...Object.keys(dbData.tags || {})];
                        if (tags.length > 0) {
                            let currentIndex = tags.indexOf(activeTag);
                            if (e.key === 'ArrowDown') {
                                currentIndex = (currentIndex + 1) % tags.length;
                            } else {
                                currentIndex = (currentIndex - 1 + tags.length) % tags.length;
                            }
                            activeTag = tags[currentIndex];
                            activeChannel = null;
                            renderSidebar();

                            const activeTagItem = sidebar.querySelector('.tag-item.active');
                            if (activeTagItem) {
                                activeTagItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                            }
                            
                            renderChannelsBar();
                            renderTopBarLeft();
                            window.scrollTo(0, 0);
                            channelsBar.scrollLeft = 0;
                        }
                    }
                }
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const now = Date.now();
                if (now - lastArrowKeyPress < 150) return;
                lastArrowKeyPress = now;

                if (isVideoScrollMode || document.body.classList.contains('selection-mode')) {
                    const videoElements = Array.from(videoBoard.querySelectorAll('.vidBox'));
                    if (videoElements.length > 0) {
                        if (e.key === 'ArrowRight') {
                            activeVideoIndex = Math.min(activeVideoIndex + 1, videoElements.length - 1);
                        } else {
                            activeVideoIndex = Math.max(activeVideoIndex - 1, 0);
                        }
                        updateVideoSelection();
                    }
                } else {
                    let handles = [];
                    if (activeTag === null) {
                        handles = Object.keys(dbData.subs || {});
                    } else {
                        handles = (dbData.tags && dbData.tags[activeTag]) ? dbData.tags[activeTag] : [];
                    }
                    if (checkedTags.size > 0) {
                        handles = handles.filter(handle => {
                            for (const t of checkedTags) {
                                if (!dbData.tags[t] || !dbData.tags[t].includes(handle)) {
                                    return false;
                                }
                            }
                            return true;
                        });
                    }
                    const filteredChannels = handles
                        .map(handle => [handle, dbData.subs && dbData.subs[handle]])
                        .filter(([_, data]) => data);

                    if (filteredChannels.length > 0) {
                        let handlesList = ['<recents>', ...filteredChannels.map(([h]) => h)];
                        let currentIndex = handlesList.indexOf(activeChannel);
                        if (currentIndex === -1) currentIndex = 1;

                        if (e.key === 'ArrowRight') {
                            currentIndex = (currentIndex + 1) % handlesList.length;
                        } else {
                            currentIndex = (currentIndex - 1 + handlesList.length) % handlesList.length;
                        }

                        activeChannel = handlesList[currentIndex];
                        renderChannelsBar();
                        renderTopBarLeft();

                        const activeIcon = channelsBar.querySelector('.channel-icon.active');
                        if (activeIcon) {
                            activeIcon.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                        }
                    }
                }
            }
        }
    });

    const addTagContainer = document.createElement('div');
    addTagContainer.id = 'add-tag-container';

    const addTagBtn = document.createElement('button');
    addTagBtn.textContent = 'add tag';

    const addTagInputWrapper = document.createElement('div');
    addTagInputWrapper.id = 'add-tag-input-wrapper';
    addTagInputWrapper.style.display = 'none';

    const addTagInput = document.createElement('input');
    addTagInput.type = 'text';
    addTagInput.id = 'add-tag-input';

    const addTagTickBtn = document.createElement('button');
    addTagTickBtn.innerHTML = '&#10003;';
    addTagTickBtn.id = 'add-tag-tick-btn';

    addTagInputWrapper.appendChild(addTagInput);
    addTagInputWrapper.appendChild(addTagTickBtn);

    addTagBtn.addEventListener('click', () => {
        if (!activeChannel || activeChannel === '<recents>') {
            return;
        }
        if (addTagInputWrapper.style.display === 'none') {
            addTagInput.value = '';
            addTagInputWrapper.style.display = 'flex';
            addTagInput.focus();
        } else {
            addTagInputWrapper.style.display = 'none';
            addTagInput.value = '';
        }
    });

    async function submitAddTag() {
        const tag = addTagInput.value.trim();
        if (tag && activeChannel && activeChannel !== '<recents>') {
            try {
                await fetch(`/addTag?handle=${encodeURIComponent(activeChannel)}&tag=${encodeURIComponent(tag)}`);
                addTagInputWrapper.style.display = 'none';
                addTagInput.value = '';
                await refreshData();
            } catch (err) {
                console.error('Failed to add tag:', err);
            }
        }
    }

    addTagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            submitAddTag();
        } else if (e.key === 'Escape') {
            addTagInputWrapper.style.display = 'none';
            addTagInput.value = '';
            addTagBtn.focus();
        }
    });

    addTagTickBtn.addEventListener('click', () => {
        submitAddTag();
    });

    document.addEventListener('click', (e) => {
        if (!addTagContainer.contains(e.target)) {
            addTagInputWrapper.style.display = 'none';
            addTagInput.value = '';
        }
    });

    addTagContainer.appendChild(addTagBtn);
    addTagContainer.appendChild(addTagInputWrapper);

    const retrieveBtn = document.createElement('button');
    retrieveBtn.textContent = 'retrieve subs';
    retrieveBtn.addEventListener('click', async () => {
        setUpdatingState(true);
        activeProcessToast = showToast('Retrieving subscriptions...', '#007bff', false, true);
        try {
            const response = await fetch('/retrieve');
            const text = await response.text();
            await refreshData();
            showToast('Retrieve complete!', '#28a745', false);
        } catch (err) {
            console.error('Failed to retrieve:', err);
            showToast('Retrieve failed!', '#dc3545', false);
        } finally {
            setUpdatingState(false);
            if (activeProcessToast) {
                activeProcessToast.remove();
                activeProcessToast = null;
            }
        }
    });

    const updateChannelBtn = document.createElement('button');
    updateChannelBtn.textContent = 'update vids';
    updateChannelBtn.addEventListener('click', async () => {
        if (!activeChannel || activeChannel === '<recents>') {
            return;
        }
        setUpdatingState(true);
        const endpoint = isShortsView ? '/updateChannelShorts' : '/updateChannel';
        const typeStr = isShortsView ? 'shorts' : 'vids';
        activeProcessToast = showToast(`Updating channel ${typeStr}...`, '#007bff', false, true);
        try {
            const response = await fetch(`${endpoint}?handle=${encodeURIComponent(activeChannel)}`);
            const text = await response.text();
            await refreshData();
            if (text.includes('already in progress')) {
                showToast('Update already running elsewhere...', '#ffc107', false);
            } else {
                showToast('Update complete!', '#28a745', false);
            }
        } catch (err) {
            console.error('Failed to update channel:', err);
            showToast('Update failed!', '#dc3545');
        } finally {
            setUpdatingState(false);
            if (activeProcessToast) {
                activeProcessToast.remove();
                activeProcessToast = null;
            }
        }
    });

    const updateBtn = document.createElement('button');
    updateBtn.textContent = 'update list';
    updateBtn.addEventListener('click', async () => {
        if (isCurrentlyUpdating) return;
        setUpdatingState(true);
        const target = activeTag === null ? 'all' : activeTag;
        const endpoint = isShortsView ? '/updateShorts' : '/updateVids';
        const typeStr = isShortsView ? 'shorts' : 'vids';
        activeProcessToast = showToast(`Updating ${target} ${typeStr}...`, '#007bff', true, true);
        try {
            const response = await fetch(`${endpoint}?tag=${encodeURIComponent(target)}`);
            const text = await response.text();
            await refreshData();
            if (text.includes('aborted')) {
                showToast('Update aborted!', '#dc3545', false);
            } else if (text.includes('already in progress')) {
                showToast('Update already running elsewhere...', '#ffc107', false);
            } else {
                showToast('Update complete!', '#28a745', false);
            }
        } catch (err) {
            console.error('Failed to update:', err);
            showToast('Update failed!', '#dc3545', false);
        } finally {
            setUpdatingState(false);
            if (activeProcessToast) {
                activeProcessToast.remove();
                activeProcessToast = null;
            }
        }
    });

    const eyeBtn = document.createElement('button');
    eyeBtn.innerHTML = '&#128065;';
    eyeBtn.title = 'Set watched cutoff time';
    eyeBtn.id = 'eye-btn';
    eyeBtn.addEventListener('click', () => {
        if (!activeChannel) {
            return;
        }
        if (document.body.classList.contains('selection-mode')) {
            document.body.classList.remove('selection-mode');
            if (!isVideoScrollMode) activeVideoIndex = -1;
        } else {
            document.body.classList.add('selection-mode');
            activeVideoIndex = getFirstVisibleVideoIndex();
        }
        updateVideoSelection();
    });

    const notificationBtn = document.createElement('button');
    notificationBtn.id = 'notification-btn';
    notificationBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display: block;">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        </svg>
    `;
    notificationBtn.title = 'Untagged Channels';

    const notificationBadge = document.createElement('span');
    notificationBadge.id = 'notification-badge';
    notificationBtn.appendChild(notificationBadge);

    notificationBtn.addEventListener('click', () => {
        if (dbData.tags['<untagged>'] && dbData.tags['<untagged>'].length > 0) {
            activeTag = '<untagged>';
            activeChannel = null;
            renderSidebar();
            renderChannelsBar();
            renderTopBarLeft();
            window.scrollTo(0, 0);
            channelsBar.scrollLeft = 0;
        }
    });

    // Define the exact order of buttons and widgets on the right side
    topBarRight.appendChild(searchContainer);
    topBarRight.appendChild(eyeBtn);
    topBarRight.appendChild(addTagContainer);
    topBarRight.appendChild(updateChannelBtn);
    topBarRight.appendChild(updateBtn);
    topBarRight.appendChild(retrieveBtn);
    topBarRight.appendChild(notificationBtn);

    topBar.appendChild(topBarLeft);
    topBar.appendChild(topBarRight);

    const channelsBar = document.createElement('div');
    channelsBar.id = 'channels-bar';

    channelsBar.addEventListener('wheel', (event) => {
        // Prevent the default vertical scroll and scroll horizontally instead
        event.preventDefault();
        channelsBar.scrollLeft += event.deltaY / 3;
    });

    function getDragAfterElement(container, coord, isHorizontal) {
        const selector = isHorizontal ? '.channel-icon[data-handle]:not(.dragging)' : '.tag-item[data-tag]:not(.dragging)';
        const draggableElements = [...container.querySelectorAll(selector)];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = isHorizontal
                ? coord - box.left - box.width / 2
                : coord - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    const videoBoard = document.createElement('div');
    videoBoard.id = 'video-board';

    const contentArea = document.createElement('div');
    contentArea.id = 'content-area';

    const sidebar = document.createElement('div');
    sidebar.id = 'sidebar';

    const mainArea = document.createElement('div');
    mainArea.id = 'main-area';

    const infoBar = document.createElement('div');
    infoBar.id = 'info-bar';

    mainArea.appendChild(channelsBar);
    mainArea.appendChild(infoBar);
    mainArea.appendChild(videoBoard);

    contentArea.appendChild(sidebar);
    contentArea.appendChild(mainArea);

    app.appendChild(topBar);
    app.appendChild(contentArea);

    let dbData = {};
    let activeTag = '__startup__';
    let activeChannel = null;
    let prevActiveChannel = undefined;
    let checkedTags = new Set();
    let isCutoffEnabled = true;
    let isLoadingMore = false;
    let overscrollAmount = 0;

    async function attemptLoadMore() {
        if (activeChannel && activeChannel !== '<recents>' && !isLoadingMore && !isCurrentlyUpdating) {
            const channelData = dbData.subs[activeChannel];
            const cutoffProp = isShortsView ? 'timecutoffShorts' : 'timecutoff';
            const vidsProp = isShortsView ? 'shorts' : 'vids';
            const nextTokenProp = isShortsView ? 'nextShortsPageToken' : 'nextPageToken';
            const loadEndpoint = isShortsView ? '/loadMoreShorts' : '/loadMoreVids';

            if (channelData && channelData[nextTokenProp]) {
                if (isCutoffEnabled && channelData[cutoffProp] && channelData[vidsProp] && channelData[vidsProp].length > 0) {
                    const lastVid = channelData[vidsProp][channelData[vidsProp].length - 1];
                    if (new Date(lastVid.timeUploaded) <= new Date(channelData[cutoffProp])) {
                        return;
                    }
                }

                isLoadingMore = true;
                setUpdatingState(true);
                
                const loadingBar = document.createElement('div');
                loadingBar.id = 'loading-bar';
                loadingBar.textContent = 'Loading...';
                document.body.appendChild(loadingBar);
                
                try {
                    const response = await fetch(`${loadEndpoint}?handle=${encodeURIComponent(activeChannel)}`);
                    const data = await response.json();
                    
                    const newItems = isShortsView ? data.newShorts : data.newVids;

                    if (data && newItems && newItems.length > 0) {
                        dbData.subs[activeChannel][vidsProp].push(...newItems);
                        dbData.subs[activeChannel][nextTokenProp] = data.newNextPageToken;

                        let vidsToAdd = newItems;
                        if (isCutoffEnabled && channelData[cutoffProp]) {
                            const cutoffDate = new Date(channelData[cutoffProp]);
                            vidsToAdd = vidsToAdd.filter(v => new Date(v.timeUploaded) > cutoffDate);
                        }

                        vidsToAdd.forEach(vid => {
                            const card = createVidBox(vid);
                            videoBoard.appendChild(card);
                        });
                    } else {
                        dbData.subs[activeChannel][nextTokenProp] = null;
                    }
                } catch (e) {
                    console.error('Failed to load more videos:', e);
                } finally {
                    const bar = document.getElementById('loading-bar');
                    if (bar) bar.remove();
                    setUpdatingState(false);
                    isLoadingMore = false;
                }
            }
        }
    }

    function handleOverscroll(deltaY) {
        if (mainArea.scrollTop + mainArea.clientHeight >= mainArea.scrollHeight - 5) {
            if (deltaY > 0) {
                overscrollAmount += deltaY;
                if (overscrollAmount > 400) {
                    overscrollAmount = 0;
                    attemptLoadMore();
                }
            } else if (deltaY < 0) {
                overscrollAmount = 0;
            }
        } else {
            overscrollAmount = 0;
        }
    }

    mainArea.addEventListener('wheel', (e) => {
        handleOverscroll(e.deltaY);
    });

    let touchStartY = 0;
    mainArea.addEventListener('touchstart', (e) => {
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    mainArea.addEventListener('touchmove', (e) => {
        const currentY = e.touches[0].clientY;
        const deltaY = touchStartY - currentY;
        handleOverscroll(deltaY);
        touchStartY = currentY;
    }, { passive: true });

    mainArea.addEventListener('scroll', () => {
        if (mainArea.scrollTop + mainArea.clientHeight < mainArea.scrollHeight - 5) {
            overscrollAmount = 0;
        }
    });

    function updateNotificationBtn() {
        const untagged = dbData.tags['<untagged>'] || [];
        if (untagged.length > 0) {
            notificationBtn.classList.add('has-untagged');
            notificationBadge.textContent = untagged.length;
        } else {
            notificationBtn.classList.remove('has-untagged');
            // If we are viewing untagged and it becomes empty, redirect to first available or all subs (null)
            if (activeTag === '<untagged>') {
                const tags = Object.keys(dbData.tags || {}).filter(t => t !== '<untagged>');
                activeTag = tags.length > 0 ? tags[0] : null;
                activeChannel = null;
                channelsBar.scrollLeft = 0;
            }
        }
    }

    async function refreshData() {
        if (isDragging) {
            if (autoScrollAnimationId) {
                cancelAnimationFrame(autoScrollAnimationId);
                autoScrollAnimationId = null;
            }
            document.body.classList.remove('is-dragging');
            draggedElement.classList.remove('dragging');
            if (customGhost) {
                customGhost.remove();
                customGhost = null;
            }
            draggedElement = null;
            isDragging = false;
        }
        const response = await fetch('/dbread');
        if (!response.ok) throw new Error('Failed to fetch DB');
        dbData = await response.json();

        if (activeTag === '__startup__') {
            const tagsList = Object.keys(dbData.tags || {});
            if (tagsList.length > 0) {
                activeTag = tagsList[0];
            } else {
                activeTag = null;
            }
        }

        // Clean up checked tags if they were deleted
        for (const t of checkedTags) {
            if (!dbData.tags || !dbData.tags[t]) {
                checkedTags.delete(t);
            }
        }

        const savedScroll = mainArea.scrollTop;
        const channelBefore = activeChannel;

        updateNotificationBtn();
        renderSidebar();
        renderChannelsBar();
        renderTopBarLeft();

        if (activeChannel === channelBefore) {
            mainArea.scrollTop = savedScroll;
        }
    }

    try {
        await refreshData();
        // Auto-update activetag on visit
        if (activeTag !== null) updateBtn.click();
    } catch (err) {
        console.error(err);
        app.innerHTML = '<p class="error-message">Error loading data or db.json is missing.</p>';
    }

    function renderSidebar() {
        sidebar.innerHTML = '';

        const allSubsItem = document.createElement('div');
        allSubsItem.className = 'tag-item';
        if (activeTag === null) {
            allSubsItem.classList.add('active');
        }

        const allSubsText = document.createElement('span');
        allSubsText.className = 'tag-item-text';
        allSubsText.textContent = 'All Subs';
        allSubsText.title = 'All Subs';
        allSubsItem.appendChild(allSubsText);

        allSubsItem.addEventListener('click', () => {
            activeTag = null;
            activeChannel = null;
            renderSidebar();
            renderChannelsBar();
            renderTopBarLeft();
            window.scrollTo(0, 0);
            channelsBar.scrollLeft = 0;
        });
        sidebar.appendChild(allSubsItem);

        const separator = document.createElement('hr');
        separator.style.borderColor = '#333';
        separator.style.margin = '5px 0';
        sidebar.appendChild(separator);

        const tags = Object.keys(dbData.tags || {});

        tags.forEach(tag => {
            const tagItem = document.createElement('div');
            tagItem.className = 'tag-item';
            tagItem.dataset.tag = tag;
            if (tag === activeTag) {
                tagItem.classList.add('active');
            }

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'tag-filter-checkbox';
            checkbox.checked = checkedTags.has(tag);
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    checkedTags.add(tag);
                } else {
                    checkedTags.delete(tag);
                }
                renderChannelsBar();
                renderTopBarLeft();
                checkbox.blur();
            });
            checkbox.addEventListener('mousedown', (e) => e.stopPropagation()); // prevent drag
            tagItem.appendChild(checkbox);

            const tagText = document.createElement('span');
            tagText.className = 'tag-item-text';
            tagText.textContent = tag;
            tagText.title = tag;

            tagItem.appendChild(tagText);

            let renameBtn = null;
            if (tag !== '<untagged>') {
                renameBtn = document.createElement('button');
                renameBtn.className = 'tag-rename-btn';
                renameBtn.innerHTML = '&#9998;';
                renameBtn.title = 'Rename Tag';
                renameBtn.onclick = (e) => {
                    e.stopPropagation();
                    enableTagRename(tagItem, tagText, renameBtn, tag);
                };
                tagItem.appendChild(renameBtn);
            }

            tagItem.addEventListener('mousedown', (e) => {
                if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
                if (e.button !== 0) return;
                e.preventDefault();
                draggedElement = tagItem;
                isDragging = false;
                startX = e.clientX;
                startY = e.clientY;
            });

            sidebar.appendChild(tagItem);
        });
    }

    function enableTagRename(tagItem, tagText, renameBtn, tag) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tag-rename-input';
        input.value = tag;

        tagItem.insertBefore(input, tagText);
        tagText.style.display = 'none';

        renameBtn.innerHTML = '&#10003;';
        renameBtn.title = 'Confirm Rename';

        let isSaving = false;

        const saveRename = async () => {
            if (isSaving) return;
            const newTag = input.value.trim();
            if (!newTag || newTag === tag) {
                cancelRename();
                return;
            }

            isSaving = true;
            try {
                const response = await fetch('/renameTag', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ oldTag: tag, newTag: newTag })
                });

                if (response.ok) {
                    if (activeTag === tag) {
                        activeTag = newTag;
                    }
                    if (checkedTags.has(tag)) {
                        checkedTags.delete(tag);
                        checkedTags.add(newTag);
                    }
                    await refreshData();
                } else {
                    const text = await response.text();
                    alert('Failed to rename tag: ' + text);
                    cancelRename();
                }
            } catch (err) {
                console.error('Error renaming tag:', err);
                cancelRename();
            }
        };

        const cancelRename = () => {
            input.remove();
            tagText.style.display = '';
            renameBtn.innerHTML = '&#9998;';
            renameBtn.title = 'Rename Tag';
            renameBtn.onclick = (e) => {
                e.stopPropagation();
                enableTagRename(tagItem, tagText, renameBtn, tag);
            };
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveRename();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelRename();
            }
            e.stopPropagation();
        });

        renameBtn.onclick = (e) => {
            e.stopPropagation();
            saveRename();
        };

        input.focus();
        input.select();
    }

    function renderChannelsBar() {
        channelsBar.innerHTML = '';

        let handles = [];
        if (activeTag === null) {
            handles = Object.keys(dbData.subs || {});
        } else {
            handles = (dbData.tags && dbData.tags[activeTag]) ? dbData.tags[activeTag] : [];
        }

        if (checkedTags.size > 0) {
            handles = handles.filter(handle => {
                for (const t of checkedTags) {
                    if (!dbData.tags[t] || !dbData.tags[t].includes(handle)) {
                        return false;
                    }
                }
                return true;
            });
        }

        const filteredChannels = handles
            .map(handle => [handle, dbData.subs && dbData.subs[handle]])
            .filter(([_, data]) => data);

        if (filteredChannels.length === 0) {
            activeChannel = null;
            updateButtonStates();
            infoBar.innerHTML = '';
            infoBar.style.display = 'none';
            
            let msg = `No "${activeTag === null ? 'All Subs' : activeTag}" channels found in the database. <br>Try clicking the <strong>update</strong> button above to fetch data.`;
            const isDbEmpty = !dbData || !dbData.subs || Object.keys(dbData.subs).length === 0;
            if (isDbEmpty) {
                msg = `Please click <strong>retrieve subs</strong> to fetch your subscriptions.`;
            }
            if (checkedTags.size > 0) {
                msg = `No channels found matching the selected tag filters.`;
            }
            videoBoard.innerHTML = `<p class="empty-message">${msg}</p>`;
            return;
        }

        // Check if activeChannel is still in the filtered list
        const isActiveChannelValid = activeChannel === '<recents>' || filteredChannels.some(([handle]) => handle === activeChannel);

        // Set initial active channel if none selected or if invalid
        if (!activeChannel || !isActiveChannelValid) {
            activeChannel = '<recents>';
            renderTopBarLeft();
        }

        const recentsDiv = document.createElement('div');
        recentsDiv.className = 'channel-icon';
        if (activeChannel === '<recents>') {
            recentsDiv.classList.add('active');
        }
        recentsDiv.title = 'Recents';

        const recentsImg = document.createElement('div');
        recentsImg.style.width = '44px';
        recentsImg.style.height = '44px';
        recentsImg.style.borderRadius = '50%';
        recentsImg.style.backgroundColor = '#444';
        recentsImg.style.display = 'flex';
        recentsImg.style.alignItems = 'center';
        recentsImg.style.justifyContent = 'center';
        recentsImg.style.fontSize = '24px';
        recentsImg.style.fontWeight = 'bold';
        recentsImg.style.color = '#fff';
        recentsImg.textContent = 'A';

        const recentsName = document.createElement('span');
        recentsName.textContent = 'Recents';

        recentsDiv.appendChild(recentsImg);
        recentsDiv.appendChild(recentsName);

        recentsDiv.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            activeChannel = '<recents>';
            renderChannelsBar();
            renderTopBarLeft();
        });

        recentsDiv.addEventListener('auxclick', (e) => {
            if (e.button === 1) { // Middle click
                e.preventDefault();
            }
        });

        channelsBar.appendChild(recentsDiv);

        filteredChannels.forEach(([handle, data]) => {
            const iconDiv = document.createElement('div');
            iconDiv.className = 'channel-icon';
            if (handle === activeChannel) {
                iconDiv.classList.add('active');
            }

            const channelDisplayName = data.name || handle.replace('@', '');
            iconDiv.title = channelDisplayName;

            const img = document.createElement('img');
            img.src = data.profilePic || 'https://via.placeholder.com/50';
            img.alt = handle;
            img.referrerPolicy = 'no-referrer';

            const name = document.createElement('span');
            name.textContent = channelDisplayName;

            iconDiv.appendChild(img);
            iconDiv.appendChild(name);

            iconDiv.dataset.handle = handle;

            iconDiv.addEventListener('mousedown', (e) => {
                if (e.button === 1) {
                    e.preventDefault();
                    return;
                }
                if (e.button !== 0) return;
                e.preventDefault();
                draggedElement = iconDiv;
                isDragging = false;
                startX = e.clientX;
                startY = e.clientY;
            });

            iconDiv.addEventListener('auxclick', (e) => {
                if (e.button === 1) { // Middle click
                    e.preventDefault();
                    const formattedHandle = handle.startsWith('@') ? handle : '@' + handle;
                    window.open(`https://www.youtube.com/${formattedHandle}/videos`, '_blank');
                }
            });

            channelsBar.appendChild(iconDiv);
        });

        renderVideos();
    }

    function renderTopBarLeft() {
        topBarLeft.innerHTML = '';

        const toggleSidebarBtn = document.createElement('button');
        toggleSidebarBtn.innerHTML = '&#9776;';
        toggleSidebarBtn.id = 'toggle-sidebar-btn';
        toggleSidebarBtn.addEventListener('click', () => {
            sidebar.style.display = sidebar.style.display === 'block' ? 'none' : 'block';
        });
        topBarLeft.appendChild(toggleSidebarBtn);

        const activeTagDisplay = document.createElement('div');
        activeTagDisplay.id = 'active-tag-display';

        let handles = [];
        if (activeTag === null) {
            handles = Object.keys(dbData.subs || {});
        } else {
            handles = (dbData.tags && dbData.tags[activeTag]) ? dbData.tags[activeTag] : [];
        }

        if (checkedTags.size > 0) {
            handles = handles.filter(handle => {
                for (const t of checkedTags) {
                    if (!dbData.tags[t] || !dbData.tags[t].includes(handle)) {
                        return false;
                    }
                }
                return true;
            });
        }

        const validHandlesCount = handles.filter(h => dbData.subs && dbData.subs[h]).length;
        activeTagDisplay.textContent = `${activeTag === null ? 'All Subs' : activeTag} (${validHandlesCount})`;
        topBarLeft.appendChild(activeTagDisplay);

        if (checkedTags.size > 0) {
            const checkedTagsWrapper = document.createElement('div');
            checkedTagsWrapper.className = 'checked-tags-wrapper';

            const checkedTagsContainer = document.createElement('div');
            checkedTagsContainer.className = 'checked-tags-container';
            checkedTags.forEach(t => {
                const span = document.createElement('span');
                span.className = 'checked-tag-display';
                span.textContent = t;
                checkedTagsContainer.appendChild(span);
            });

            checkedTagsContainer.addEventListener('wheel', (event) => {
                event.preventDefault();
                checkedTagsContainer.scrollLeft += event.deltaY / 2;
            });

            const clearBtn = document.createElement('span');
            clearBtn.className = 'channel-tag-close';
            clearBtn.textContent = '×';
            clearBtn.title = 'Clear all filters';
            clearBtn.style.fontSize = '18px';
            clearBtn.addEventListener('click', () => {
                checkedTags.clear();
                const checkboxes = sidebar.querySelectorAll('.tag-filter-checkbox');
                checkboxes.forEach(cb => cb.checked = false);
                renderTopBarLeft();
                renderChannelsBar();
            });

            checkedTagsWrapper.appendChild(checkedTagsContainer);
            checkedTagsWrapper.appendChild(clearBtn);
            topBarLeft.appendChild(checkedTagsWrapper);
        }

        updateButtonStates();
    }

    function createVidBox(vid) {
        const card = document.createElement('a');
        card.className = isShortsView ? 'vidBox shortBox' : 'vidBox';
        card.href = vid.link;
        card.target = '_blank';

        card.addEventListener('click', async (e) => {
            if (document.body.classList.contains('selection-mode')) {
                e.preventDefault();
                document.body.classList.remove('selection-mode');
                if (!isVideoScrollMode) activeVideoIndex = -1;
                updateVideoSelection();
                const targetHandle = activeChannel === '<recents>' ? vid.handle : activeChannel;
                const typeParam = isShortsView ? 'shorts' : 'vids';
                try {
                    await fetch(`/setCutoff?handle=${encodeURIComponent(targetHandle)}&time=${encodeURIComponent(vid.timeUploaded)}&type=${typeParam}`);
                    await refreshData();
                } catch (err) {
                    console.error('Failed to set cutoff:', err);
                }
            }
        });

        // Thumbnail container for duration overlay
        const thumbContainer = document.createElement('div');
        thumbContainer.className = 'thumb-container';

        const img = document.createElement('img');
        img.src = vid.thumbnail;
        img.alt = vid.title;
        img.referrerPolicy = 'no-referrer';

        const duration = document.createElement('div');
        duration.textContent = vid.duration || '0:00';
        duration.className = 'video-duration';

        thumbContainer.appendChild(img);
        thumbContainer.appendChild(duration);

        if (vid.liveStatus === 'live' || vid.liveStatus === 'upcoming') {
            duration.style.display = 'none'; // Hide the 0:00 duration

            const liveBadge = document.createElement('div');
            liveBadge.textContent = vid.liveStatus === 'live' ? 'LIVE' : 'PREMIERE';
            liveBadge.className = 'video-live-badge';

            thumbContainer.appendChild(liveBadge);
        }

        const info = document.createElement('div');
        info.className = 'video-info';

        const title = document.createElement('h3');
        title.className = 'video-title';
        title.textContent = vid.title;
        title.title = vid.title;

        const channelName = document.createElement('div');
        channelName.textContent = vid.channelname;
        channelName.className = 'video-channel-name';

        const meta = document.createElement('div');
        meta.className = 'video-meta';
        const date = new Date(vid.timeUploaded).toLocaleDateString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric'
        });

        const formatter = new Intl.NumberFormat('en', { notation: 'compact' });
        const viewsFormatted = formatter.format(vid.views || 0);

        const timeAgo = getTimeAgo(vid.timeUploaded);
        meta.textContent = timeAgo ? `${viewsFormatted} views • ${timeAgo} • ${date}` : `${viewsFormatted} views • ${date}`;

        info.appendChild(title);
        info.appendChild(channelName);
        info.appendChild(meta);

        card.appendChild(thumbContainer);
        card.appendChild(info);
        
        return card;
    }

    function renderVideos() {
        const tagsContainer = document.createElement('div');
        tagsContainer.id = 'tags-container';

        const controlsContainer = document.createElement('div');
        controlsContainer.style.display = 'flex';
        controlsContainer.style.gap = '10px';

        const shortsToggleBtn = document.createElement('span');
        shortsToggleBtn.id = 'shorts-toggle-btn';
        shortsToggleBtn.textContent = 'Shorts';
        if (!isShortsView) shortsToggleBtn.classList.add('shorts-disabled');
        shortsToggleBtn.addEventListener('click', () => {
            isShortsView = !isShortsView;
            document.body.classList.toggle('shorts-view', isShortsView);
            updateChannelBtn.textContent = isShortsView ? 'update shorts' : 'update vids';
            renderVideos();
        });

        const cutoffDiv = document.createElement('span');
        cutoffDiv.id = 'cutoff-display';

        controlsContainer.appendChild(shortsToggleBtn);
        controlsContainer.appendChild(cutoffDiv);

        if (prevActiveChannel !== activeChannel) {
            mainArea.scrollTop = 0;
        }
        prevActiveChannel = activeChannel;

        videoBoard.innerHTML = '';
        infoBar.innerHTML = '';
        if (!activeChannel) {
            infoBar.style.display = 'none';
            return;
        }
        infoBar.style.display = 'flex';

        let videos = [];
        const cutoffProp = isShortsView ? 'timecutoffShorts' : 'timecutoff';
        const vidsProp = isShortsView ? 'shorts' : 'vids';

        if (activeChannel === '<recents>') {
            let handles = [];
            if (activeTag === null) {
                handles = Object.keys(dbData.subs || {});
            } else {
                handles = (dbData.tags && dbData.tags[activeTag]) ? dbData.tags[activeTag] : [];
            }

            if (checkedTags.size > 0) {
                handles = handles.filter(handle => {
                    for (const t of checkedTags) {
                        if (!dbData.tags[t] || !dbData.tags[t].includes(handle)) {
                            return false;
                        }
                    }
                    return true;
                });
            }

            handles.forEach(handle => {
                const channelData = dbData.subs && dbData.subs[handle];
                if (channelData && channelData[vidsProp]) {
                    let channelVids = channelData[vidsProp];
                    if (isCutoffEnabled && channelData[cutoffProp]) {
                        const cutoffDate = new Date(channelData[cutoffProp]);
                        channelVids = channelVids.filter(v => new Date(v.timeUploaded) > cutoffDate);
                    }
                    channelVids = channelVids.map(v => ({ ...v, handle }));
                    videos = videos.concat(channelVids);
                }
            });

            videos.sort((a, b) => new Date(b.timeUploaded) - new Date(a.timeUploaded));
            videos = videos.slice(0, 100);

            cutoffDiv.textContent = `Cutoff`;
            cutoffDiv.title = 'Toggle cutoff filtering (x)';
            if (!isCutoffEnabled) {
                cutoffDiv.classList.add('cutoff-disabled');
            }
            cutoffDiv.addEventListener('click', () => {
                isCutoffEnabled = !isCutoffEnabled;
                renderVideos();
            });

            infoBar.appendChild(tagsContainer);
            infoBar.appendChild(controlsContainer);
        } else {
            if (!dbData.subs || !dbData.subs[activeChannel]) return;
            const channelData = dbData.subs[activeChannel];
            let rawVideos = channelData[vidsProp] || [];

            if (channelData[cutoffProp] && isCutoffEnabled) {
                const cutoffDate = new Date(channelData[cutoffProp]);
                videos = rawVideos.filter(v => new Date(v.timeUploaded) > cutoffDate);
            } else {
                videos = rawVideos;
            }

            const activeTags = [];
            for (const [tag, handles] of Object.entries(dbData.tags || {})) {
                if (handles.includes(activeChannel)) {
                    activeTags.push(tag);
                }
            }

            if (activeTags.length > 0) {
                activeTags.forEach(tag => {
                    const tagBtn = document.createElement('div');
                    tagBtn.className = 'channel-tag-btn';

                    const tagText = document.createElement('span');
                    tagText.textContent = tag;
                    tagText.className = 'tag-text';
                    tagText.addEventListener('click', () => {
                        activeTag = tag;
                        activeChannel = null;
                        renderSidebar();
                        renderChannelsBar();
                        renderTopBarLeft();
                        window.scrollTo(0, 0);
                        channelsBar.scrollLeft = 0;
                    });

                    const tagClose = document.createElement('span');
                    tagClose.textContent = '×';
                    tagClose.className = 'channel-tag-close';
                    tagClose.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (tag === '<untagged>') {
                            showToast('Cannot remove the <untagged> tag manually!', '#dc3545');
                            return;
                        }
                        showConfirmDialog(`Are you sure you want to remove the tag "${tag}"?`, async () => {
                            try {
                                await fetch(`/removeTag?handle=${encodeURIComponent(activeChannel)}&tag=${encodeURIComponent(tag)}`);
                                await refreshData();
                            } catch (err) {
                                console.error('Failed to remove tag:', err);
                            }
                        });
                    });

                    tagBtn.appendChild(tagText);
                    tagBtn.appendChild(tagClose);
                    tagsContainer.appendChild(tagBtn);
                });

                tagsContainer.addEventListener('wheel', (event) => {
                    event.preventDefault();
                    tagsContainer.scrollLeft += event.deltaY / 2;
                });
            }

            infoBar.appendChild(tagsContainer);

            if (channelData[cutoffProp]) {
                const d = new Date(channelData[cutoffProp]);
                const formatted = `${String(d.getDate()).padStart(2, '0')}:${String(d.getMonth() + 1).padStart(2, '0')}:${String(d.getFullYear()).slice(-2)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                cutoffDiv.textContent = `Cutoff: ${formatted}`;
                cutoffDiv.title = 'Toggle cutoff filtering (x)';
                if (!isCutoffEnabled) {
                    cutoffDiv.classList.add('cutoff-disabled');
                }
                cutoffDiv.addEventListener('click', () => {
                    isCutoffEnabled = !isCutoffEnabled;
                    renderVideos();
                });
            } else {
                cutoffDiv.textContent = 'Cutoff: ---';
                cutoffDiv.title = 'No cutoff set';
                cutoffDiv.classList.add('cutoff-disabled');
            }
            infoBar.appendChild(controlsContainer);
        }

        if (videos.length === 0) {
            const emptyMsg = document.createElement('p');
            emptyMsg.className = 'empty-message';
            emptyMsg.style.gridColumn = '1 / -1';
            emptyMsg.textContent = activeChannel === '<recents>' ? 'No recent videos found for the selected tag.' : 'No videos found for this channel.';
            videoBoard.appendChild(emptyMsg);
            return;
        }

        videos.forEach(vid => {
            const card = createVidBox(vid);
            videoBoard.appendChild(card);
        });

        if (isVideoScrollMode || document.body.classList.contains('selection-mode')) {
            activeVideoIndex = 0;
            updateVideoSelection();
        }
    }

    function showConfirmDialog(message, onConfirm) {
        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';

        const box = document.createElement('div');
        box.className = 'confirm-box';

        const text = document.createElement('p');
        text.textContent = message;
        text.className = 'confirm-text';

        const btnContainer = document.createElement('div');
        btnContainer.className = 'confirm-btn-container';

        const yesBtn = document.createElement('button');
        yesBtn.textContent = 'Yes';
        yesBtn.className = 'confirm-yes-btn';

        const noBtn = document.createElement('button');
        noBtn.textContent = 'No';
        noBtn.className = 'confirm-no-btn';

        btnContainer.appendChild(yesBtn);
        btnContainer.appendChild(noBtn);
        box.appendChild(text);
        box.appendChild(btnContainer);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const cleanup = () => {
            document.body.removeChild(overlay);
            document.removeEventListener('keydown', keydownHandler);
        };

        const keydownHandler = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                cleanup();
                onConfirm();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cleanup();
            }
        };

        yesBtn.addEventListener('click', () => {
            cleanup();
            onConfirm();
        });

        noBtn.addEventListener('click', () => {
            cleanup();
        });

        document.addEventListener('keydown', keydownHandler);
        yesBtn.focus();
    }

    // Algorithm to calculate the time passed since upload
    function getTimeAgo(dateString) {
        if (!dateString) return '';
        const seconds = Math.max(0, Math.floor((new Date() - new Date(dateString)) / 1000));

        let interval = seconds / 31536000;
        if (interval >= 1) return Math.floor(interval) + (Math.floor(interval) === 1 ? " year" : " years");
        interval = seconds / 2592000;
        if (interval >= 1) return Math.floor(interval) + (Math.floor(interval) === 1 ? " month" : " months");
        interval = seconds / 86400;
        if (interval >= 1) return Math.floor(interval) + (Math.floor(interval) === 1 ? " day" : " days");
        interval = seconds / 3600;
        if (interval >= 1) return Math.floor(interval) + (Math.floor(interval) === 1 ? " hour" : " hours");
        interval = seconds / 60;
        if (interval >= 1) return Math.floor(interval) + (Math.floor(interval) === 1 ? " minute" : " minutes");
        return "just now";
    }
});
