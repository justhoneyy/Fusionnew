const jwt = require('jsonwebtoken');
const { pool } = global;

const authenticateToken = async (req, res, next) => {
  try {
    const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user exists and is active
    const userResult = await pool.query(
      'SELECT id, role, is_active, device_token FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    // Device check for students (single device policy)
    if (user.role === 'student' && user.device_token) {
      const currentDevice = req.headers['user-agent'] || '';
      // Simple device check - in production, use a more robust method
      if (req.headers['x-device-token'] && user.device_token !== req.headers['x-device-token']) {
        return res.status(403).json({ error: 'Another device is already logged in. Please logout from other device first.' });
      }
    }

    req.user = {
      userId: user.id,
      role: user.role
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied. Insufficient permissions.' });
    }
    next();
  };
};

const checkFeeStatus = async (req, res, next) => {
  if (req.user.role !== 'student') return next();
  
  try {
    const studentResult = await pool.query(
      'SELECT fee_status, is_locked, lock_reason FROM students WHERE user_id = $1',
      [req.user.userId]
    );

    if (studentResult.rows.length > 0) {
      const student = studentResult.rows[0];
      
      if (student.is_locked) {
        return res.status(403).json({ 
          error: 'Account locked',
          reason: student.lock_reason,
          redirectTo: '/portals/student?tab=fees'
        });
      }

      if (student.fee_status === 'overdue') {
        return res.status(403).json({
          error: 'Fee payment overdue',
          message: 'Please pay your pending fees to access all features',
          redirectTo: '/portals/student?tab=fees'
        });
      }

      req.studentInfo = student;
    }
    next();
  } catch (error) {
    next(error);
  }
};

const logAudit = async (userId, action, tableName, recordId, oldData, newData, req) => {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, action, tableName, recordId, oldData ? JSON.stringify(oldData) : null, 
       newData ? JSON.stringify(newData) : null, req?.ip, req?.headers?.['user-agent']]
    );
  } catch (error) {
    console.error('Audit log error:', error);
  }
};

module.exports = { authenticateToken, authorizeRoles, checkFeeStatus, logAudit };
