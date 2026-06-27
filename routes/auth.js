const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = global;
const { authenticateToken, logAudit } = require('../middleware/auth');

// Login endpoint
router.post('/login', async (req, res) => {
  const { username, password, role, deviceInfo } = req.body;

  try {
    // Check for brute force
    const userResult = await pool.query(
      'SELECT * FROM users WHERE username = $1 OR email = $1',
      [username]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userResult.rows[0];

    // Check if account is locked
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(423).json({ 
        error: 'Account temporarily locked. Please try again later.',
        lockedUntil: user.locked_until
      });
    }

    // Verify role
    if (role && user.role !== role) {
      return res.status(403).json({ error: 'Invalid role for this account' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!isValidPassword) {
      // Increment failed attempts
      const failedAttempts = (user.failed_login_attempts || 0) + 1;
      const updates = { failed_login_attempts: failedAttempts };
      
      if (failedAttempts >= 5) {
        updates.locked_until = new Date(Date.now() + 30 * 60000); // 30 min lock
      }

      await pool.query(
        'UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3',
        [updates.failed_login_attempts, updates.locked_until || null, user.id]
      );

      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Reset failed attempts on successful login
    const deviceToken = require('uuid').v4();
    await pool.query(
      `UPDATE users SET 
        failed_login_attempts = 0, 
        locked_until = NULL, 
        last_login = CURRENT_TIMESTAMP, 
        login_count = login_count + 1,
        device_info = $1,
        device_token = $2
       WHERE id = $3`,
      [JSON.stringify(deviceInfo || {}), deviceToken, user.id]
    );

    // Create session token
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Log login history
    await pool.query(
      `INSERT INTO login_history (user_id, ip_address, device_info, session_token)
       VALUES ($1, $2, $3, $4)`,
      [user.id, req.ip, JSON.stringify(deviceInfo || {}), token]
    );

    // Log audit
    await logAudit(user.id, 'LOGIN', 'users', user.id, null, null, req);

    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    // Get additional info based on role
    let additionalInfo = {};
    
    if (user.role === 'student') {
      const studentResult = await pool.query(
        'SELECT * FROM students WHERE user_id = $1',
        [user.id]
      );
      additionalInfo = studentResult.rows[0] || {};
    } else if (user.role === 'teacher') {
      const teacherResult = await pool.query(
        'SELECT * FROM teachers WHERE user_id = $1',
        [user.id]
      );
      additionalInfo = teacherResult.rows[0] || {};
    }

    res.json({
      success: true,
      token,
      deviceToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        fullName: user.full_name,
        phone: user.phone,
        profilePic: user.profile_pic
      },
      additionalInfo,
      redirectTo: `/portals/${user.role}`
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// Logout endpoint
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
    
    await pool.query(
      `UPDATE login_history SET logout_time = CURRENT_TIMESTAMP, status = 'logged_out'
       WHERE session_token = $1 AND user_id = $2`,
      [token, req.user.userId]
    );

    await pool.query(
      'UPDATE users SET device_token = NULL WHERE id = $1',
      [req.user.userId]
    );

    await logAudit(req.user.userId, 'LOGOUT', 'users', req.user.userId, null, null, req);

    res.clearCookie('token');
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Forgot password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  
  try {
    const userResult = await pool.query('SELECT id, email FROM users WHERE email = $1', [email]);
    
    if (userResult.rows.length === 0) {
      return res.json({ success: true, message: 'If email exists, reset link sent' });
    }

    const resetToken = jwt.sign(
      { userId: userResult.rows[0].id, purpose: 'password_reset' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // In production, send email with reset link
    console.log(`Password reset token for ${email}: ${resetToken}`);
    
    res.json({ success: true, message: 'Password reset link sent to your email' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// Reset password
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.purpose !== 'password_reset') {
      return res.status(400).json({ error: 'Invalid reset token' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedPassword, decoded.userId]
    );

    await logAudit(decoded.userId, 'PASSWORD_RESET', 'users', decoded.userId, null, null, req);

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(400).json({ error: 'Reset token expired' });
    }
    res.status(400).json({ error: 'Invalid reset token' });
  }
});

// Check auth status
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const userResult = await pool.query(
      'SELECT id, username, email, role, full_name, phone, profile_pic FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    res.json({ authenticated: true, user: userResult.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check auth status' });
  }
});

// Force logout from other devices
router.post('/force-logout', authenticateToken, async (req, res) => {
  try {
    await pool.query(
      `UPDATE login_history SET status = 'forced_logout', logout_time = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND status = 'active'`,
      [req.user.userId]
    );

    await pool.query('UPDATE users SET device_token = NULL WHERE id = $1', [req.user.userId]);

    res.json({ success: true, message: 'All other sessions terminated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to force logout' });
  }
});

module.exports = router;
