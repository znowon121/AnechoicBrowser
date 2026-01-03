    const defaultConfig = {
      page_title: "My Custom Homepage",
      search_placeholder: "Search the web...",
      background_color: "#667eea",
      surface_color: "#ffffff",
      text_color: "#333333",
      primary_action_color: "#667eea",
      secondary_action_color: "#ff4757"
    };

    // 預設搜尋引擎改為 Bing（類似 Edge 的預設）
    let currentEngine = 'bing';
    let websites = [];
    let isLoading = false;
    let recentHistory = [];  // 最近頁面歷史（最多 10 筆）

    const searchEngines = {
      google: 'https://www.google.com/search?q=',
      bing: 'https://www.bing.com/search?q=',
      yahoo: 'https://search.yahoo.com/search?p='
    };

    const dataHandler = {
      onDataChanged(data) {
        websites = data.sort((a, b) => a.position - b.position);
        renderWebsites();
      }
    };

    async function initializeApp() {
      if (!window.dataSdk || !window.dataSdk.init) {
        console.warn("dataSdk is not available; skipping initialization.");
        return;
      }
      const initResult = await window.dataSdk.init(dataHandler);
      if (!initResult.isOk) {
        console.error("Failed to initialize data SDK");
      }
    }


    let currentPage = 0;
    const itemsPerPage = 4;

    function renderWebsites() {
      const grid = document.getElementById('websites-grid');
      const addButton = document.getElementById('add-website-btn');
      const leftBtn = document.getElementById('carousel-left');
      const rightBtn = document.getElementById('carousel-right');
      
      grid.innerHTML = '';
      
      websites.forEach(website => {
        const card = document.createElement('div');
        card.className = 'website-card';
        card.innerHTML = `
          <button class="delete-button" data-id="${website.__backendId}">×</button>
          <div class="website-icon">🌐</div>
          <div class="website-name">${website.website_name}</div>
        `;
        
        // 點擊網站卡片時，透過 preload 暴露嘅 electronAPI 呼叫主進程去載入 URL
        card.addEventListener('click', (e) => {
          if (!e.target.classList.contains('delete-button')) {
            // 使用 electronAPI.openUrl 代替 window.open
            if (window.electronAPI && window.electronAPI.openUrl) {
              window.electronAPI.openUrl(website.website_url);
            } else {
              // fallback 到 window.open（例如在純瀏覽器中測試）
              window.open(website.website_url, '_blank', 'noopener,noreferrer');
            }
          }
        });
        
        grid.appendChild(card);
      });
      
      grid.appendChild(addButton);

      // Show/hide carousel navigation
      const totalItems = websites.length + 1; // +1 for add button
      const totalPages = Math.ceil(totalItems / itemsPerPage);
      
      if (totalPages > 1) {
        leftBtn.style.display = 'flex';
        rightBtn.style.display = 'flex';
        updateCarousel();
      } else {
        leftBtn.style.display = 'none';
        rightBtn.style.display = 'none';
        grid.style.transform = 'translateX(0)';
      }
    }

    function updateCarousel() {
      const grid = document.getElementById('websites-grid');
      const leftBtn = document.getElementById('carousel-left');
      const rightBtn = document.getElementById('carousel-right');
      const totalItems = websites.length + 1;
      const totalPages = Math.ceil(totalItems / itemsPerPage);
      
      const offset = currentPage * -100;
      grid.style.transform = `translateX(${offset}%)`;
      
      leftBtn.disabled = currentPage === 0;
      rightBtn.disabled = currentPage >= totalPages - 1;
    }

    document.getElementById('carousel-left').addEventListener('click', () => {
      if (currentPage > 0) {
        currentPage--;
        updateCarousel();
      }
    });

    document.getElementById('carousel-right').addEventListener('click', () => {
      const totalItems = websites.length + 1;
      const totalPages = Math.ceil(totalItems / itemsPerPage);
      if (currentPage < totalPages - 1) {
        currentPage++;
        updateCarousel();
      }
    });

    document.querySelectorAll('.engine-button').forEach(button => {
      button.addEventListener('click', () => {
        document.querySelectorAll('.engine-button').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        currentEngine = button.dataset.engine;
      });
    });

    // 當使用者執行搜尋或輸入網址時，會呼叫這個函式
    // 邏輯：如果看似 URL（有 scheme 或包含 '.'）就直接導航到該 URL，否則按目前選擇嘅搜尋引擎生成搜尋網址
    function performSearch() {
      const query = document.getElementById('search-input').value.trim();
      if (!query) return;

      // 簡單判斷是否為 URL
      const hasScheme = /^https?:\/\//i.test(query);
      const looksLikeDomain = query.includes('.');

      let targetUrl = '';
      if (hasScheme) {
        targetUrl = query;
      } else if (looksLikeDomain) {
        // 若無 scheme，預設加上 https://
        targetUrl = 'https://' + query;
      } else {
        // 當作搜尋詞 — 用目前選中的搜尋引擎
        switch (currentEngine) {
          case 'google':
            targetUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
            break;
          case 'yahoo':
            targetUrl = `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`;
            break;
          case 'bing':
          default:
            targetUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
            break;
        }
      }

      if (window.electronAPI && window.electronAPI.openUrl) {
        window.electronAPI.openUrl(targetUrl);
      } else {
        // fallback 在一般瀏覽器中開新分頁
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
      }
    }

    document.getElementById('search-btn').addEventListener('click', performSearch);

    document.getElementById('search-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        performSearch();
      }
    });

    // 瀏覽器控制按鈕 (Back / Forward / Reload)
    const backBtn = document.getElementById('back-btn');
    const forwardBtn = document.getElementById('forward-btn');
    const reloadBtn = document.getElementById('reload-btn');
    const homeBtn = document.getElementById('home-btn');
    const addressBar = document.getElementById('address-bar');
    const addressBarSubmitBtn = document.getElementById('address-bar-submit');

    if (backBtn) {
      backBtn.addEventListener('click', () => {
        if (window.electronAPI && window.electronAPI.goBack) window.electronAPI.goBack();
      });
    }

    if (forwardBtn) {
      forwardBtn.addEventListener('click', () => {
        if (window.electronAPI && window.electronAPI.goForward) window.electronAPI.goForward();
      });
    }

    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => {
        if (window.electronAPI && window.electronAPI.reload) window.electronAPI.reload();
      });
    }

    // Home 按鈕：隱藏 BrowserView，返回首頁
    if (homeBtn) {
      homeBtn.addEventListener('click', () => {
        if (window.electronAPI && window.electronAPI.hideView) {
          window.electronAPI.hideView().then(() => {
            // 清空地址列
            addressBar.value = '';
          }).catch(err => console.error('Failed to hide BrowserView:', err));
        }
      });
    }

    // 地址列：Enter 鍵事件
    if (addressBar) {
      addressBar.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          const input = addressBar.value.trim();
          if (!input) return;

          // 判斷是否為 URL
          const hasScheme = /^https?:\/\//i.test(input);
          const looksLikeDomain = input.includes('.');

          let targetUrl = '';
          if (hasScheme) {
            targetUrl = input;
          } else if (looksLikeDomain) {
            // 無 scheme 就加上 https://
            targetUrl = 'https://' + input;
          } else {
            // 當作搜尋詞，用目前選中的搜尋引擎
            const searchUrl = searchEngines[currentEngine];
            targetUrl = searchUrl + encodeURIComponent(input);
          }

          // 用 electronAPI 導航
          if (window.electronAPI && window.electronAPI.openUrl) {
            window.electronAPI.openUrl(targetUrl);
          } else {
            window.open(targetUrl, '_blank', 'noopener,noreferrer');
          }
        }
      });
    }

    // Go 按鈕
    if (addressBarSubmitBtn) {
      addressBarSubmitBtn.addEventListener('click', () => {
        if (addressBar) {
          const event = new KeyboardEvent('keypress', { key: 'Enter' });
          addressBar.dispatchEvent(event);
        }
      });
    }

    // 監聽主進程發送來嘅 URL 更新事件 (例如：BrowserView 導航後)
    if (window.electronAPI && window.electronAPI.on) {
      window.electronAPI.on('browser:url-updated', (url) => {
        // 把 URL 寫進地址列
        if (addressBar) {
          addressBar.value = url;
        }
        
        // 把 URL 加入歷史列表
        addToHistory(url);
        
        console.log('Browser navigated to:', url);
      });
    }

    /**
     * 把 URL 加入最近頁面歷史
     * 避免連續重複，只保留最新 10 筆
     */
    function addToHistory(url) {
      // 如果最後一筆同一個 URL，就唔好重複加
      if (recentHistory.length > 0 && recentHistory[0] === url) {
        return;
      }

      recentHistory.unshift(url);

      // 只保留最新 10 筆
      if (recentHistory.length > 10) {
        recentHistory.pop();
      }

      // 更新 sidebar 顯示
      renderHistoryList();
    }

    /**
     * 渲染 sidebar 歷史列表
     */
    function renderHistoryList() {
      const historyList = document.getElementById('history-list');
      if (!historyList) return;

      historyList.innerHTML = '';

      recentHistory.forEach((url) => {
        const li = document.createElement('li');
        
        // 提取 domain 或簡短 URL
        let domain = '';
        let displayText = '';
        try {
          const urlObj = new URL(url);
          domain = urlObj.hostname;
          displayText = domain;
        } catch (e) {
          displayText = url.substring(0, 20);
        }

        // 簡單 icon（用域名首字母或 icon）
        const icon = domain.charAt(0).toUpperCase() || '🌐';

        li.innerHTML = `
          <span class="domain-icon">${icon}</span>
          <span class="domain-text">${displayText}</span>
        `;

        li.addEventListener('click', () => {
          // 點擊歷史項目，打開該 URL
          if (window.electronAPI && window.electronAPI.openUrl) {
            window.electronAPI.openUrl(url);
          }
        });

        historyList.appendChild(li);
      });
    }

    /**
     * Sidebar hover 行為
     */
    const chromeSide = document.getElementById('chrome-side');
    if (chromeSide) {
      chromeSide.addEventListener('mouseenter', () => {
        chromeSide.classList.add('expanded');
      });

      chromeSide.addEventListener('mouseleave', () => {
        chromeSide.classList.remove('expanded');
      });
    }

    document.getElementById('add-website-btn').addEventListener('click', () => {
      if (websites.length >= 999) {
        showModal('settings-modal');
        const infoTextEl = document.querySelector('#settings-modal .info-text');
        if (infoTextEl) {
          infoTextEl.textContent = 'Maximum limit of 999 websites reached. Please delete some websites first.';
        }
        return;
      }
      document.getElementById('add-website-modal').classList.add('active');
    });

    document.getElementById('cancel-btn').addEventListener('click', () => {
      document.getElementById('add-website-modal').classList.remove('active');
      document.getElementById('add-website-form').reset();
    });

    document.getElementById('add-website-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      if (isLoading) return;
      
      const name = document.getElementById('website-name').value.trim();
      const url = document.getElementById('website-url').value.trim();
      
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        alert('Please enter a valid URL starting with http:// or https://');
        return;
      }
      
      isLoading = true;
      document.getElementById('loading-indicator').classList.add('active');
      
      const newWebsite = {
        id: Date.now().toString(),
        website_name: name,
        website_url: url,
        position: websites.length
      };
      
      const result = await window.dataSdk.create(newWebsite);
      
      isLoading = false;
      document.getElementById('loading-indicator').classList.remove('active');
      
      if (result.isOk) {
        document.getElementById('add-website-modal').classList.remove('active');
        document.getElementById('add-website-form').reset();
      } else {
        alert('Failed to add website. Please try again.');
      }
    });

    document.getElementById('websites-grid').addEventListener('click', async (e) => {
      if (e.target.classList.contains('delete-button')) {
        e.stopPropagation();
        
        if (isLoading) return;
        
        const backendId = e.target.dataset.id;
        const website = websites.find(w => w.__backendId === backendId);
        
        if (website) {
          isLoading = true;
          document.getElementById('loading-indicator').classList.add('active');
          
          const result = await window.dataSdk.delete(website);
          
          isLoading = false;
          document.getElementById('loading-indicator').classList.remove('active');
          
          if (!result.isOk) {
            alert('Failed to delete website. Please try again.');
          }
        }
      }
    });

    function showModal(modalId) {
      document.getElementById(modalId).classList.add('active');
    }

    function hideModal(modalId) {
      document.getElementById(modalId).classList.remove('active');
    }

    // Top navigation handlers
    // Chatroom 按鈕：優先使用 preload.openChatroom() 開啟專用 Chatroom 視窗
    document.getElementById('chatroom-btn').addEventListener('click', () => {
      const chatUrl = (window.FLASK_URL) ? window.FLASK_URL : 'http://localhost:5000';

      // Prefer the dedicated chat BrowserWindow via preload -> main ipc
      if (window.electronAPI && window.electronAPI.openChatroom) {
        // openChatroom returns a Promise (ipcRenderer.invoke). If it fails,
        // fall back to BrowserView navigation or the in-page modal.
        window.electronAPI.openChatroom().catch(() => {
          if (window.electronAPI && window.electronAPI.openUrl) {
            window.electronAPI.openUrl(chatUrl);
          } else {
            showModal('chatroom-modal');
          }
        });
        return;
      }

      // If openChatroom is not available, fall back to BrowserView navigation
      if (window.electronAPI && window.electronAPI.openUrl) {
        window.electronAPI.openUrl(chatUrl);
      } else {
        // fallback: 在純瀏覽器環境顯示內建 modal（原本行為）
        showModal('chatroom-modal');
      }
    });

    document.getElementById('settings-btn').addEventListener('click', () => showModal('settings-modal'));
    document.getElementById('account-btn').addEventListener('click', () => showModal('account-modal'));

    document.getElementById('close-chatroom').addEventListener('click', () => hideModal('chatroom-modal'));
    document.getElementById('close-settings').addEventListener('click', () => hideModal('settings-modal'));
    document.getElementById('close-account').addEventListener('click', () => hideModal('account-modal'));

    // Toolbar dropdown toggle
    const toolbarToggle = document.getElementById('toolbar-toggle');
    const toolbarDropdown = document.getElementById('toolbar-dropdown');

    toolbarToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toolbarDropdown.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
      if (!toolbarDropdown.contains(e.target) && e.target !== toolbarToggle) {
        toolbarDropdown.classList.remove('active');
      }
    });

    // Toolbar item handlers
    document.querySelectorAll('.toolbar-item').forEach(item => {
      item.addEventListener('click', () => {
        const tool = item.dataset.tool;
        toolbarDropdown.classList.remove('active');
        
        switch(tool) {
          case 'notes':
            showModal('notes-modal');
            loadNotes();
            break;
          case 'translate':
            showModal('translate-modal');
            break;
          case 'minigames':
            showModal('minigames-modal');
            break;
          case 'calendar':
            showModal('calendar-modal');
            renderCalendar();
            break;
          case 'timer':
            showModal('timer-modal');
            break;
          case 'weather':
            showModal('weather-modal');
            break;
          case 'travel':
            showModal('travel-modal');
            break;
        }
      });
    });

    document.getElementById('close-notes').addEventListener('click', () => hideModal('notes-modal'));
    document.getElementById('close-translate').addEventListener('click', () => hideModal('translate-modal'));
    document.getElementById('close-minigames').addEventListener('click', () => hideModal('minigames-modal'));
    document.getElementById('close-calendar').addEventListener('click', () => hideModal('calendar-modal'));
    document.getElementById('close-timer').addEventListener('click', () => hideModal('timer-modal'));
    document.getElementById('close-weather').addEventListener('click', () => hideModal('weather-modal'));
    document.getElementById('close-travel').addEventListener('click', () => hideModal('travel-modal'));

    document.getElementById('google-login-btn').addEventListener('click', () => {
      const message = document.createElement('div');
      message.style.cssText = 'position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #667eea; color: white; padding: 15px 30px; border-radius: 10px; z-index: 10000; box-shadow: 0 5px 20px rgba(0,0,0,0.3);';
      message.textContent = 'Google Sign-In requires backend server integration with OAuth 2.0.';
      document.body.appendChild(message);
      setTimeout(() => message.remove(), 3000);
    });

    // Dark mode toggle
    let isDarkMode = localStorage.getItem('darkMode') === 'true';
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    
    if (isDarkMode) {
      document.body.classList.add('dark-mode');
      darkModeToggle.classList.add('active');
    }

    darkModeToggle.addEventListener('click', () => {
      isDarkMode = !isDarkMode;
      document.body.classList.toggle('dark-mode');
      darkModeToggle.classList.toggle('active');
      localStorage.setItem('darkMode', isDarkMode);
    });

    // Background upload
    document.getElementById('upload-bg-btn').addEventListener('click', () => {
      document.getElementById('bg-upload').click();
    });

    document.getElementById('bg-upload').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const imageUrl = event.target.result;
          document.body.style.backgroundImage = `url(${imageUrl})`;
          document.body.classList.add('custom-bg');
          localStorage.setItem('customBg', imageUrl);
          
          const message = document.createElement('div');
          message.style.cssText = 'position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #667eea; color: white; padding: 15px 30px; border-radius: 10px; z-index: 10000; box-shadow: 0 5px 20px rgba(0,0,0,0.3);';
          message.textContent = 'Background updated successfully!';
          document.body.appendChild(message);
          setTimeout(() => message.remove(), 2000);
        };
        reader.readAsDataURL(file);
      }
    });

    document.getElementById('reset-bg-btn').addEventListener('click', () => {
      document.body.style.backgroundImage = '';
      document.body.classList.remove('custom-bg');
      localStorage.removeItem('customBg');
      
      const message = document.createElement('div');
      message.style.cssText = 'position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #667eea; color: white; padding: 15px 30px; border-radius: 10px; z-index: 10000; box-shadow: 0 5px 20px rgba(0,0,0,0.3);';
      message.textContent = 'Background reset to default!';
      document.body.appendChild(message);
      setTimeout(() => message.remove(), 2000);
    });

    // Load saved background
    const savedBg = localStorage.getItem('customBg');
    if (savedBg) {
      document.body.style.backgroundImage = `url(${savedBg})`;
      document.body.classList.add('custom-bg');
    }

    // Background color picker
    const bgColorPicker = document.getElementById('bg-color-picker');
    const savedBgColor = localStorage.getItem('bgColor') || '#667eea';
    bgColorPicker.value = savedBgColor;

    bgColorPicker.addEventListener('change', (e) => {
      const color = e.target.value;
      document.body.style.background = `linear-gradient(135deg, ${color} 0%, #764ba2 100%)`;
      document.body.classList.remove('custom-bg');
      document.body.style.backgroundImage = '';
      localStorage.setItem('bgColor', color);
      localStorage.removeItem('customBg');
    });

    // Apply saved background color
    if (!savedBg) {
      document.body.style.background = `linear-gradient(135deg, ${savedBgColor} 0%, #764ba2 100%)`;
    }

    // VPN functionality
    let vpnConnected = false;
    const vpnToggle = document.getElementById('vpn-toggle');
    const vpnStatus = document.getElementById('vpn-status');
    const vpnLocation = document.getElementById('vpn-location');

    vpnToggle.addEventListener('click', () => {
      vpnConnected = !vpnConnected;
      
      if (vpnConnected) {
        vpnToggle.textContent = 'Disconnect';
        vpnToggle.style.background = '#ff4757';
        vpnStatus.style.display = 'flex';
        vpnStatus.classList.add('connected');
        vpnStatus.classList.remove('disconnected');
        
        const locationText = vpnLocation.selectedOptions[0].text;
        vpnStatus.querySelector('.vpn-text').textContent = `Connected to ${locationText} Server`;
        
        const message = document.createElement('div');
        message.style.cssText = 'position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #4caf50; color: white; padding: 15px 30px; border-radius: 10px; z-index: 10000; box-shadow: 0 5px 20px rgba(0,0,0,0.3);';
        message.textContent = `VPN Connected to ${locationText}!`;
        document.body.appendChild(message);
        setTimeout(() => message.remove(), 2000);
      } else {
        vpnToggle.textContent = 'Connect';
        vpnToggle.style.background = '#667eea';
        vpnStatus.style.display = 'none';
        
        const message = document.createElement('div');
        message.style.cssText = 'position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #ff4757; color: white; padding: 15px 30px; border-radius: 10px; z-index: 10000; box-shadow: 0 5px 20px rgba(0,0,0,0.3);';
        message.textContent = 'VPN Disconnected';
        document.body.appendChild(message);
        setTimeout(() => message.remove(), 2000);
      }
    });

    // Background animation
    let animationInterval = null;

    function createSnowflake() {
      const snowflake = document.createElement('div');
      snowflake.className = 'snowflake';
      snowflake.textContent = '❄';
      snowflake.style.left = Math.random() * 100 + '%';
      snowflake.style.animationDuration = (Math.random() * 3 + 2) + 's';
      snowflake.style.opacity = Math.random();
      document.body.appendChild(snowflake);
      
      setTimeout(() => snowflake.remove(), 5000);
    }

    function createRaindrop() {
      const raindrop = document.createElement('div');
      raindrop.className = 'raindrop';
      raindrop.textContent = '💧';
      raindrop.style.left = Math.random() * 100 + '%';
      raindrop.style.animationDuration = (Math.random() * 0.5 + 0.5) + 's';
      document.body.appendChild(raindrop);
      
      setTimeout(() => raindrop.remove(), 1500);
    }

    function createSakura() {
      const sakura = document.createElement('div');
      sakura.className = 'sakura';
      sakura.textContent = '🌸';
      sakura.style.left = Math.random() * 100 + '%';
      sakura.style.animationDuration = (Math.random() * 3 + 4) + 's';
      sakura.style.opacity = Math.random() * 0.8 + 0.2;
      document.body.appendChild(sakura);
      
      setTimeout(() => sakura.remove(), 7000);
    }

    function startAnimation(type) {
      stopAnimation();
      
      if (type === 'snowfall') {
        animationInterval = setInterval(createSnowflake, 200);
      } else if (type === 'rain') {
        animationInterval = setInterval(createRaindrop, 100);
      } else if (type === 'sakura') {
        animationInterval = setInterval(createSakura, 300);
      }
    }

    function stopAnimation() {
      if (animationInterval) {
        clearInterval(animationInterval);
        animationInterval = null;
      }
      document.querySelectorAll('.snowflake, .raindrop, .sakura').forEach(el => el.remove());
    }

    const bgAnimationSelect = document.getElementById('bg-animation-select');
    const savedAnimation = localStorage.getItem('bgAnimation') || 'none';
    bgAnimationSelect.value = savedAnimation;
    if (savedAnimation !== 'none') {
      startAnimation(savedAnimation);
    }

    bgAnimationSelect.addEventListener('change', (e) => {
      const animation = e.target.value;
      localStorage.setItem('bgAnimation', animation);
      
      if (animation === 'none') {
        stopAnimation();
      } else {
        startAnimation(animation);
      }
    });

    // Notes functionality
    function loadNotes() {
      const savedNotes = localStorage.getItem('userNotes') || '';
      document.getElementById('notes-textarea').value = savedNotes;
    }

    document.getElementById('save-notes').addEventListener('click', () => {
      const notes = document.getElementById('notes-textarea').value;
      localStorage.setItem('userNotes', notes);
      
      const message = document.createElement('div');
      message.style.cssText = 'position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #667eea; color: white; padding: 15px 30px; border-radius: 10px; z-index: 10000; box-shadow: 0 5px 20px rgba(0,0,0,0.3);';
      message.textContent = 'Notes saved successfully!';
      document.body.appendChild(message);
      setTimeout(() => message.remove(), 2000);
    });

    // Translate functionality
    document.getElementById('translate-upload-btn').addEventListener('click', () => {
      document.getElementById('translate-file-upload').click();
    });

    document.getElementById('translate-file-upload').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        document.getElementById('file-name').textContent = file.name;
        
        if (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          document.getElementById('translate-input').value = event.target.result;
        };
        reader.readAsText(file);
      } else {
        alert('For now, only .txt text files are supported for upload in this demo.');
      }
      }
    });

    document.getElementById('translate-btn').addEventListener('click', () => {
      const text = document.getElementById('translate-input').value.trim();
      const targetLang = document.getElementById('target-language').value;
      
      if (!text) {
        const message = document.createElement('div');
        message.style.cssText = 'position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #ff4757; color: white; padding: 15px 30px; border-radius: 10px; z-index: 10000; box-shadow: 0 5px 20px rgba(0,0,0,0.3);';
        message.textContent = 'Please enter text to translate!';
        document.body.appendChild(message);
        setTimeout(() => message.remove(), 2000);
        return;
      }

      const resultDiv = document.getElementById('translate-result');
      const translationText = document.getElementById('translation-text');
      
      resultDiv.style.display = 'block';
      translationText.textContent = 'Translating... (Demo: AI translation would appear here with backend API integration)';
      
      setTimeout(() => {
        translationText.textContent = `[Demo Translation to ${document.getElementById('target-language').selectedOptions[0].text}]\n\n"${text.substring(0, 100)}..."\n\nNote: Real AI translation requires backend API integration with services like Google Translate API, DeepL, or OpenAI.`;
      }, 1000);
    });

    // Mini games functionality
    document.querySelectorAll('.game-card').forEach(card => {
      card.addEventListener('click', () => {
        const game = card.dataset.game;
        const message = document.createElement('div');
        message.style.cssText = 'position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #667eea; color: white; padding: 15px 30px; border-radius: 10px; z-index: 10000; box-shadow: 0 5px 20px rgba(0,0,0,0.3);';
        message.textContent = `${card.querySelector('.game-name').textContent} coming soon!`;
        document.body.appendChild(message);
        setTimeout(() => message.remove(), 2000);
      });
    });

    // Timer functionality
    let timerInterval = null;
    let timerSeconds = 300; // 5 minutes default
    let timerRunning = false;

    function updateTimerDisplay() {
      const hours = Math.floor(timerSeconds / 3600);
      const minutes = Math.floor((timerSeconds % 3600) / 60);
      const seconds = timerSeconds % 60;
      
      document.getElementById('timer-display').textContent = 
        `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function setTimerFromInputs() {
      const hours = parseInt(document.getElementById('timer-hours').value) || 0;
      const minutes = parseInt(document.getElementById('timer-minutes').value) || 0;
      const seconds = parseInt(document.getElementById('timer-seconds').value) || 0;
      timerSeconds = hours * 3600 + minutes * 60 + seconds;
      updateTimerDisplay();
    }

    document.getElementById('timer-hours').addEventListener('change', setTimerFromInputs);
    document.getElementById('timer-minutes').addEventListener('change', setTimerFromInputs);
    document.getElementById('timer-seconds').addEventListener('change', setTimerFromInputs);

    document.getElementById('timer-start').addEventListener('click', () => {
      if (!timerRunning) {
        setTimerFromInputs();
        timerRunning = true;
        timerInterval = setInterval(() => {
          if (timerSeconds > 0) {
            timerSeconds--;
            updateTimerDisplay();
          } else {
            clearInterval(timerInterval);
            timerRunning = false;
            const message = document.createElement('div');
            message.style.cssText = 'position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #667eea; color: white; padding: 15px 30px; border-radius: 10px; z-index: 10000; box-shadow: 0 5px 20px rgba(0,0,0,0.3);';
            message.textContent = '⏰ Timer finished!';
            document.body.appendChild(message);
            setTimeout(() => message.remove(), 3000);
          }
        }, 1000);
      }
    });

    document.getElementById('timer-pause').addEventListener('click', () => {
      if (timerRunning) {
        clearInterval(timerInterval);
        timerRunning = false;
      }
    });

    document.getElementById('timer-reset').addEventListener('click', () => {
      clearInterval(timerInterval);
      timerRunning = false;
      setTimerFromInputs();
    });

    // Weather functionality
    document.getElementById('weather-search').addEventListener('click', () => {
      const city = document.getElementById('weather-city').value.trim();
      
      if (!city) {
        const message = document.createElement('div');
        message.style.cssText = 'position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #ff4757; color: white; padding: 15px 30px; border-radius: 10px; z-index: 10000; box-shadow: 0 5px 20px rgba(0,0,0,0.3);';
        message.textContent = 'Please enter a city name!';
        document.body.appendChild(message);
        setTimeout(() => message.remove(), 2000);
        return;
      }

      document.getElementById('weather-location').textContent = city;
      document.getElementById('weather-temp').textContent = Math.floor(Math.random() * 40 + 50) + '°F';
      const conditions = ['Sunny', 'Partly Cloudy', 'Cloudy', 'Rainy', 'Clear'];
      document.getElementById('weather-description').textContent = conditions[Math.floor(Math.random() * conditions.length)];
      document.getElementById('weather-result').style.display = 'block';
    });

    // Travel planning functionality
    document.getElementById('travel-form').addEventListener('submit', (e) => {
      e.preventDefault();
      
      const destination = document.getElementById('travel-destination').value;
      const dates = document.getElementById('travel-dates').value;
      const budget = document.getElementById('travel-budget').value;
      
      document.getElementById('travel-dest-result').textContent = `${destination} - ${dates}`;
      document.getElementById('travel-budget-result').innerHTML = `Total Budget: $${budget} USD<br>Flights: ~$${Math.floor(budget * 0.4)}<br>Accommodation: ~$${Math.floor(budget * 0.35)}<br>Food & Activities: ~$${Math.floor(budget * 0.25)}`;
      document.getElementById('travel-result').style.display = 'block';
    });

    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('active');
        }
      });
    });

    // Calendar functionality
    let currentDate = new Date();

    function renderCalendar() {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();
      
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                          'July', 'August', 'September', 'October', 'November', 'December'];
      
      document.getElementById('calendar-month').textContent = `${monthNames[month]} ${year}`;
      
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const daysInPrevMonth = new Date(year, month, 0).getDate();
      
      const calendarGrid = document.getElementById('calendar-grid');
      calendarGrid.innerHTML = '';
      
      const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      dayHeaders.forEach(day => {
        const header = document.createElement('div');
        header.className = 'calendar-day-header';
        header.textContent = day;
        calendarGrid.appendChild(header);
      });
      
      for (let i = firstDay - 1; i >= 0; i--) {
        const day = document.createElement('div');
        day.className = 'calendar-day other-month';
        day.textContent = daysInPrevMonth - i;
        calendarGrid.appendChild(day);
      }
      
      const today = new Date();
      for (let i = 1; i <= daysInMonth; i++) {
        const day = document.createElement('div');
        day.className = 'calendar-day';
        day.textContent = i;
        
        if (year === today.getFullYear() && month === today.getMonth() && i === today.getDate()) {
          day.classList.add('today');
        }
        
        calendarGrid.appendChild(day);
      }
      
      const remainingDays = 42 - (firstDay + daysInMonth);
      for (let i = 1; i <= remainingDays; i++) {
        const day = document.createElement('div');
        day.className = 'calendar-day other-month';
        day.textContent = i;
        calendarGrid.appendChild(day);
      }
    }

    document.getElementById('prev-month').addEventListener('click', () => {
      currentDate.setMonth(currentDate.getMonth() - 1);
      renderCalendar();
    });

    document.getElementById('next-month').addEventListener('click', () => {
      currentDate.setMonth(currentDate.getMonth() + 1);
      renderCalendar();
    });

    async function onConfigChange(config) {
      const pageTitle = document.getElementById('page-title');
      const searchInput = document.getElementById('search-input');
      
      pageTitle.textContent = config.page_title || defaultConfig.page_title;
      searchInput.placeholder = config.search_placeholder || defaultConfig.search_placeholder;
      
      document.body.style.background = `linear-gradient(135deg, ${config.background_color || defaultConfig.background_color} 0%, #764ba2 100%)`;
    }

    if (window.elementSdk) {
      window.elementSdk.init({
        defaultConfig,
        onConfigChange,
        mapToCapabilities: (config) => ({
          recolorables: [
            {
              get: () => config.background_color || defaultConfig.background_color,
              set: (value) => {
                window.elementSdk.config.background_color = value;
                window.elementSdk.setConfig({ background_color: value });
              }
            },
            {
              get: () => config.primary_action_color || defaultConfig.primary_action_color,
              set: (value) => {
                window.elementSdk.config.primary_action_color = value;
                window.elementSdk.setConfig({ primary_action_color: value });
              }
            }
          ],
          borderables: [],
          fontEditable: undefined,
          fontSizeable: undefined
        }),
        mapToEditPanelValues: (config) => new Map([
          ["page_title", config.page_title || defaultConfig.page_title],
          ["search_placeholder", config.search_placeholder || defaultConfig.search_placeholder]
        ])
      });
    }

    // Chat functionality
    document.getElementById('send-message').addEventListener('click', () => {
      const chatInput = document.getElementById('chat-input');
      const message = chatInput.value.trim();
      
      if (message) {
        const chatMessages = document.getElementById('chat-messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message';
        messageDiv.innerHTML = `
          <span class="chat-user">You:</span>
          <span class="chat-text">${message}</span>
          <span class="chat-time">now</span>
        `;
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        chatInput.value = '';
        
        // Simulate friend responses
        setTimeout(() => {
          const responses = [
            "That's interesting! 😊",
            "Cool! Thanks for sharing 👍",
            "I agree with that!",
            "Nice one! 🎉",
            "Good point!"
          ];
          const randomResponse = responses[Math.floor(Math.random() * responses.length)];
          const friends = ['Alex', 'Sarah', 'Emma'];
          const randomFriend = friends[Math.floor(Math.random() * friends.length)];
          
          const responseDiv = document.createElement('div');
          responseDiv.className = 'chat-message';
          responseDiv.innerHTML = `
            <span class="chat-user">${randomFriend}:</span>
            <span class="chat-text">${randomResponse}</span>
            <span class="chat-time">now</span>
          `;
          chatMessages.appendChild(responseDiv);
          chatMessages.scrollTop = chatMessages.scrollHeight;
        }, 1000 + Math.random() * 2000);
      }
    });

    document.getElementById('chat-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('send-message').click();
      }
    });

    initializeApp();
    
    // 自动测试 Toast 动画（用于验证是否工作）
    setTimeout(() => {
      window.showToast('🎉 应用已加载 - Toast 动画测试', 'success', 5000);
    }, 500);
  