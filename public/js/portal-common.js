(function() {
  'use strict';

  const API_URL = '/api';
  
  // Theme management
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('fusion-theme', theme);
    const icon = document.getElementById('themeIcon');
    if (icon) {
      icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }
  }

  const savedTheme = localStorage.getItem('fusion-theme') || 'light';
  setTheme(savedTheme);

  // Get auth token
  function getToken() {
    return localStorage.getItem('fusion-token') || sessionStorage.getItem('fusion-token');
  }

  // Check authentication
  function checkAuth() {
    const token = getToken();
    if (!token) {
      window.location.href = '/portals/login.html';
      return;
    }

    // Verify token with server
    fetch(`${API_URL}/auth/status`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => {
      if (!res.ok) throw new Error('Unauthorized');
      return res.json();
    })
    .then(data => {
      if (!data.authenticated) {
        throw new Error('Unauthorized');
      }
      updateUserInfo(data.user);
    })
    .catch(() => {
      localStorage.removeItem('fusion-token');
      sessionStorage.removeItem('fusion-token');
      window.location.href = '/portals/login.html';
    });
  }

  // Update user info in sidebar
  function updateUserInfo(user) {
    const userNameEl = document.getElementById('sidebarUserName');
    const userRoleEl = document.getElementById('sidebarUserRole');
    const userAvatarEl = document.getElementById('sidebarUserAvatar');

    if (userNameEl) userNameEl.textContent = user.full_name;
    if (userRoleEl) userRoleEl.textContent = user.role;
    if (userAvatarEl) {
      userAvatarEl.textContent = user.full_name.charAt(0).toUpperCase();
    }
  }

  // Fetch wrapper with auth
  async function apiFetch(endpoint, options = {}) {
    const token = getToken();
    if (!token) throw new Error('No auth token');

    const defaultOptions = {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Device-Token': localStorage.getItem('deviceToken') || ''
      },
      credentials: 'include'
    };

    const response = await fetch(`${API_URL}${endpoint}`, {
      ...defaultOptions,
      ...options,
      headers: {
        ...defaultOptions.headers,
        ...options.headers
      }
    });

    if (response.status === 401) {
      localStorage.removeItem('fusion-token');
      sessionStorage.removeItem('fusion-token');
      window.location.href = '/portals/login.html';
      throw new Error('Unauthorized');
    }

    if (response.status === 403 && response.body) {
      const data = await response.json();
      if (data.redirectTo) {
        window.location.href = data.redirectTo;
        throw new Error('Redirect');
      }
      throw new Error(data.error || 'Forbidden');
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Toast notifications
  function showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Logout
  function logout() {
    const token = getToken();
    fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }).finally(() => {
      localStorage.removeItem('fusion-token');
      sessionStorage.removeItem('fusion-token');
      localStorage.removeItem('deviceToken');
      localStorage.removeItem('userRole');
      window.location.href = '/portals/login.html';
    });
  }

  // Sidebar navigation
  function initSidebar() {
    const navItems = document.querySelectorAll('.nav-item');
    const currentTab = localStorage.getItem('currentTab') || 'dashboard';

    navItems.forEach(item => {
      if (item.dataset.tab === currentTab) {
        item.classList.add('active');
      }

      item.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = item.dataset.tab;
        
        navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        
        localStorage.setItem('currentTab', tab);
        
        // Show corresponding content
        document.querySelectorAll('.tab-content').forEach(content => {
          content.style.display = 'none';
        });
        
        const targetContent = document.getElementById(`tab-${tab}`);
        if (targetContent) {
          targetContent.style.display = 'block';
        }
      });
    });

    // Mobile sidebar toggle
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.querySelector('.sidebar');
    
    if (menuToggle && sidebar) {
      menuToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
      });
    }

    // Close sidebar on outside click (mobile)
    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 1024 && sidebar && !sidebar.contains(e.target) && e.target !== menuToggle) {
        sidebar.classList.remove('open');
      }
    });
  }

  // Initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    initSidebar();

    // Add logout handler
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', logout);
    }

    // Theme toggle
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        setTheme(current === 'dark' ? 'light' : 'dark');
      });
    }
  });

  // Expose utilities globally
  window.FusionPortal = {
    apiFetch,
    showToast,
    logout,
    getToken,
    checkAuth
  };
})();
