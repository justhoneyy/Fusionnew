(function() {
  'use strict';

  const API_URL = '/api/auth';
  let selectedRole = 'student';

  // Theme management
  const themeToggle = document.getElementById('themeToggle');
  const themeIcon = document.getElementById('themeIcon');

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('fusion-theme', theme);
    if (themeIcon) {
      themeIcon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }
  }

  const savedTheme = localStorage.getItem('fusion-theme') || 'light';
  setTheme(savedTheme);

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      setTheme(current === 'dark' ? 'light' : 'dark');
    });
  }

  // Role tabs
  const roleTabs = document.querySelectorAll('.role-tab');
  roleTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      roleTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      selectedRole = tab.dataset.role;
      document.getElementById('errorMessage').style.display = 'none';
    });
  });

  // Login form
  const loginForm = document.getElementById('loginForm');
  const errorMessage = document.getElementById('errorMessage');
  const submitBtn = document.getElementById('submitBtn');

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorMessage.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';

      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      const rememberMe = document.getElementById('rememberMe').checked;

      try {
        const response = await fetch(`${API_URL}/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Device-Token': localStorage.getItem('deviceToken') || ''
          },
          body: JSON.stringify({
            username,
            password,
            role: selectedRole,
            deviceInfo: {
              userAgent: navigator.userAgent,
              platform: navigator.platform,
              language: navigator.language
            }
          }),
          credentials: 'include'
        });

        const data = await response.json();

        if (response.ok && data.success) {
          // Store token
          if (rememberMe) {
            localStorage.setItem('fusion-token', data.token);
          } else {
            sessionStorage.setItem('fusion-token', data.token);
          }
          
          localStorage.setItem('deviceToken', data.deviceToken);
          localStorage.setItem('userRole', data.user.role);
          localStorage.setItem('userName', data.user.fullName);
          localStorage.setItem('userId', data.user.id);

          // Redirect to dashboard
          window.location.href = data.redirectTo || `/portals/${data.user.role}`;
        } else {
          errorMessage.textContent = data.error || 'Login failed';
          errorMessage.style.display = 'block';
        }
      } catch (error) {
        errorMessage.textContent = 'Network error. Please try again.';
        errorMessage.style.display = 'block';
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
      }
    });
  }

  // Forgot password
  const forgotPassword = document.getElementById('forgotPassword');
  const forgotModal = document.getElementById('forgotModal');
  const sendResetBtn = document.getElementById('sendResetBtn');

  if (forgotPassword) {
    forgotPassword.addEventListener('click', () => {
      forgotModal.style.display = 'flex';
    });
  }

  if (sendResetBtn) {
    sendResetBtn.addEventListener('click', async () => {
      const email = document.getElementById('resetEmail').value;
      
      if (!email) {
        alert('Please enter your email');
        return;
      }

      sendResetBtn.disabled = true;
      sendResetBtn.textContent = 'Sending...';

      try {
        const response = await fetch(`${API_URL}/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });

        const data = await response.json();
        
        if (response.ok) {
          alert('Password reset link sent to your email');
          forgotModal.style.display = 'none';
        } else {
          alert(data.error || 'Failed to send reset link');
        }
      } catch (error) {
        alert('Network error. Please try again.');
      } finally {
        sendResetBtn.disabled = false;
        sendResetBtn.textContent = 'Send Reset Link';
      }
    });
  }

  // Close modal on outside click
  if (forgotModal) {
    forgotModal.addEventListener('click', (e) => {
      if (e.target === forgotModal) {
        forgotModal.style.display = 'none';
      }
    });
  }

  // Check if already logged in
  const token = localStorage.getItem('fusion-token') || sessionStorage.getItem('fusion-token');
  if (token) {
    fetch(`${API_URL}/status`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    .then(res => res.json())
    .then(data => {
      if (data.authenticated && data.user) {
        window.location.href = `/portals/${data.user.role}`;
      }
    })
    .catch(() => {
      // Not authenticated, stay on login page
    });
  }
})();
