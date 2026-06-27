const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles, logAudit } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const { pool } = global;

// All admin routes require admin role
router.use(authenticateToken, authorizeRoles('admin'));

// ===== DASHBOARD STATS =====
router.get('/dashboard', async (req, res) => {
  try {
    const stats = await Promise.all([
      pool.query('SELECT COUNT(*) FROM students'),
      pool.query('SELECT COUNT(*) FROM teachers'),
      pool.query('SELECT COUNT(*) FROM users WHERE role = $1', ['parent']),
      pool.query('SELECT COUNT(*) FROM attendance WHERE date = CURRENT_DATE'),
      pool.query('SELECT SUM(amount) FROM fee_transactions WHERE transaction_type = $1', ['payment']),
      pool.query('SELECT COUNT(*) FROM students WHERE fee_status = $1', ['pending']),
      pool.query('SELECT COUNT(*) FROM online_tests WHERE is_active = true'),
      pool.query(`SELECT COUNT(*) FROM students WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)`)
    ]);

    const [totalStudents, totalTeachers, totalParents, todayAttendance, 
           totalFees, pendingFees, activeTests, newAdmissions] = stats;

    // Monthly admission trend
    const monthlyAdmissions = await pool.query(
      `SELECT DATE_TRUNC('month', created_at) as month, COUNT(*) as count 
       FROM students 
       WHERE created_at >= CURRENT_DATE - INTERVAL '12 months'
       GROUP BY month ORDER BY month`
    );

    res.json({
      totalStudents: parseInt(totalStudents.rows[0].count),
      totalTeachers: parseInt(totalTeachers.rows[0].count),
      totalParents: parseInt(totalParents.rows[0].count),
      todayAttendance: parseInt(todayAttendance.rows[0].count),
      totalFees: totalFees.rows[0].sum || 0,
      pendingFees: parseInt(pendingFees.rows[0].count),
      activeTests: parseInt(activeTests.rows[0].count),
      newAdmissions: parseInt(newAdmissions.rows[0].count),
      monthlyAdmissions: monthlyAdmissions.rows
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// ===== STUDENT MANAGEMENT =====
router.get('/students', async (req, res) => {
  try {
    const { class: className, section, status, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT s.*, u.full_name, u.email, u.phone, u.is_active
      FROM students s
      JOIN users u ON s.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    
    if (className) {
      params.push(className);
      query += ` AND s.class = $${params.length}`;
    }
    if (section) {
      params.push(section);
      query += ` AND s.section = $${params.length}`;
    }
    if (status) {
      params.push(status);
      query += ` AND s.fee_status = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (u.full_name ILIKE $${params.length} OR s.student_id ILIKE $${params.length})`;
    }

    // Count total
    const countResult = await pool.query(query.replace('SELECT s.*, u.full_name, u.email, u.phone, u.is_active', 'SELECT COUNT(*)'), params);
    
    query += ` ORDER BY s.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      students: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limit)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// Add student
router.post('/students', async (req, res) => {
  const { fullName, email, phone, studentId, class: className, section, rollNumber, 
          dateOfBirth, address, parentId, feeAmount, password } = req.body;

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Create user account
    const hashedPassword = await bcrypt.hash(password || 'student123', 12);
    const username = `STU${studentId}`;
    
    const userResult = await client.query(
      `INSERT INTO users (username, email, password_hash, role, full_name, phone)
       VALUES ($1, $2, $3, 'student', $4, $5) RETURNING id`,
      [username, email, hashedPassword, fullName, phone]
    );

    const userId = userResult.rows[0].id;

    // Create student record
    await client.query(
      `INSERT INTO students (user_id, student_id, class, section, roll_number, 
        date_of_birth, address, parent_id, fee_amount, fee_due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 
         CURRENT_DATE + INTERVAL '30 days')`,
      [userId, studentId, className, section, rollNumber, dateOfBirth, address, parentId, feeAmount]
    );

    await client.query('COMMIT');

    await logAudit(req.user.userId, 'CREATE_STUDENT', 'students', userId, null, req.body, req);

    res.json({ success: true, message: 'Student added successfully', userId });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to add student' });
  } finally {
    client.release();
  }
});

// Edit student
router.put('/students/:id', async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;

  try {
    const oldData = await pool.query('SELECT * FROM students WHERE id = $1', [id]);
    
    const fields = [];
    const params = [id];
    let paramCount = 1;

    Object.keys(updateData).forEach(key => {
      if (['class', 'section', 'roll_number', 'address', 'fee_status', 'is_locked'].includes(key)) {
        paramCount++;
        fields.push(`${key} = $${paramCount}`);
        params.push(updateData[key]);
      }
    });

    if (fields.length > 0) {
      params.push(id);
      paramCount++;
      await pool.query(
        `UPDATE students SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramCount}`,
        params
      );
    }

    await logAudit(req.user.userId, 'UPDATE_STUDENT', 'students', id, oldData.rows[0], updateData, req);

    res.json({ success: true, message: 'Student updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update student' });
  }
});

// Delete student
router.delete('/students/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const oldData = await pool.query('SELECT * FROM students WHERE id = $1', [id]);
    const userId = oldData.rows[0]?.user_id;

    await pool.query('DELETE FROM students WHERE id = $1', [id]);
    if (userId) {
      await pool.query('UPDATE users SET is_active = false WHERE id = $1', [userId]);
    }

    await logAudit(req.user.userId, 'DELETE_STUDENT', 'students', id, oldData.rows[0], null, req);

    res.json({ success: true, message: 'Student deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete student' });
  }
});

// Bulk add marks
router.post('/marks/bulk', async (req, res) => {
  const { class: className, section, subjectId, examType, marksData } = req.body;
  // marksData: [{ studentId, marksObtained, totalMarks }]

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    for (const mark of marksData) {
      const percentage = (mark.marksObtained / mark.totalMarks) * 100;
      await client.query(
        `INSERT INTO marks (student_id, subject_id, exam_type, marks_obtained, total_marks, percentage, entered_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET marks_obtained = $4, total_marks = $5, percentage = $6`,
        [mark.studentId, subjectId, examType, mark.marksObtained, mark.totalMarks, percentage, req.user.userId]
      );
    }

    await client.query('COMMIT');

    await logAudit(req.user.userId, 'BULK_ADD_MARKS', 'marks', null, null, req.body, req);

    res.json({ success: true, message: `Marks added for ${marksData.length} students` });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to add marks' });
  } finally {
    client.release();
  }
});

// Get all marks for a class (for bulk entry view)
router.get('/marks/class/:class', async (req, res) => {
  const { class: className } = req.params;
  const { section, subjectId, examType } = req.query;

  try {
    let query = `
      SELECT s.id as student_id, s.student_id as student_code, u.full_name, 
             s.roll_number, m.marks_obtained, m.total_marks, m.percentage, m.grade
      FROM students s
      JOIN users u ON s.user_id = u.id
      LEFT JOIN marks m ON s.id = m.student_id 
        AND m.subject_id = $1 AND m.exam_type = $2
      WHERE s.class = $3
    `;
    const params = [subjectId, examType, className];

    if (section) {
      params.push(section);
      query += ` AND s.section = $${params.length}`;
    }

    query += ' ORDER BY s.roll_number';

    const result = await pool.query(query, params);

    res.json({ students: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch marks' });
  }
});

// Fee management
router.get('/fees', async (req, res) => {
  try {
    const { status, class: className, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT s.*, u.full_name, u.email, u.phone,
             COALESCE(SUM(ft.amount) FILTER (WHERE ft.transaction_type = 'payment'), 0) as total_paid,
             COALESCE(SUM(ft.amount) FILTER (WHERE ft.transaction_type = 'fine'), 0) as total_fine
      FROM students s
      JOIN users u ON s.user_id = u.id
      LEFT JOIN fee_transactions ft ON s.id = ft.student_id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND s.fee_status = $${params.length}`;
    }
    if (className) {
      params.push(className);
      query += ` AND s.class = $${params.length}`;
    }

    query += ` GROUP BY s.id, u.full_name, u.email, u.phone`;
    
    const countResult = await pool.query(`SELECT COUNT(*) FROM (${query}) as sub`, params);
    
    query += ` ORDER BY s.fee_due_date ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      fees: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch fees' });
  }
});

// Update fee payment
router.post('/fees/payment', async (req, res) => {
  const { studentId, amount, paymentMethod, transactionId } = req.body;

  try {
    const receiptNumber = `RCP${Date.now()}${Math.random().toString(36).substr(2, 5)}`.toUpperCase();

    await pool.query(
      `INSERT INTO fee_transactions (student_id, amount, transaction_type, payment_method, transaction_id, receipt_number, created_by)
       VALUES ($1, $2, 'payment', $3, $4, $5, $6)`,
      [studentId, amount, paymentMethod, transactionId, receiptNumber, req.user.userId]
    );

    // Update student fee status
    const studentResult = await pool.query(
      `SELECT s.fee_amount, COALESCE(SUM(ft.amount) FILTER (WHERE ft.transaction_type = 'payment'), 0) as total_paid
       FROM students s
       LEFT JOIN fee_transactions ft ON s.id = ft.student_id
       WHERE s.id = $1
       GROUP BY s.id, s.fee_amount`,
      [studentId]
    );

    if (studentResult.rows.length > 0) {
      const { fee_amount, total_paid } = studentResult.rows[0];
      const newStatus = parseFloat(total_paid) >= parseFloat(fee_amount) ? 'paid' : 'pending';
      
      await pool.query(
        'UPDATE students SET fee_status = $1, fee_paid = $2 WHERE id = $3',
        [newStatus, total_paid, studentId]
      );
    }

    await logAudit(req.user.userId, 'FEE_PAYMENT', 'fee_transactions', null, null, req.body, req);

    res.json({ success: true, receiptNumber, message: 'Payment recorded successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to record payment' });
  }
});

// Notice management
router.post('/notices', async (req, res) => {
  const { title, content, noticeType, classId, section, expiresAt } = req.body;

  try {
    await pool.query(
      `INSERT INTO notices (title, content, notice_type, class_id, section, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [title, content, noticeType, classId, section, req.user.userId, expiresAt]
    );

    await logAudit(req.user.userId, 'CREATE_NOTICE', 'notices', null, null, req.body, req);

    res.json({ success: true, message: 'Notice created successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create notice' });
  }
});

// Backup database
router.get('/backup', async (req, res) => {
  try {
    const tables = ['users', 'students', 'teachers', 'attendance', 'marks', 'online_tests', 
                    'test_questions', 'study_materials', 'notices', 'fee_transactions'];
    
    const backup = {};
    
    for (const table of tables) {
      const result = await pool.query(`SELECT * FROM ${table}`);
      backup[table] = result.rows;
    }

    res.json({ backup, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

module.exports = router;
