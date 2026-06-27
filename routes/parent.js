const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { pool } = global;

router.use(authenticateToken, authorizeRoles('parent'));

// Get child details
router.get('/child', async (req, res) => {
  try {
    const children = await pool.query(
      `SELECT s.*, u.full_name, u.email, u.phone
       FROM students s
       JOIN users u ON s.user_id = u.id
       WHERE s.parent_id = $1`,
      [req.user.userId]
    );

    res.json(children.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch child details' });
  }
});

// Get child's attendance
router.get('/attendance/:studentId', async (req, res) => {
  const { studentId } = req.params;
  const { month, year } = req.query;

  try {
    // Verify this parent owns this student
    const verifyResult = await pool.query(
      'SELECT id FROM students WHERE id = $1 AND parent_id = $2',
      [studentId, req.user.userId]
    );

    if (verifyResult.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    let query = `
      SELECT a.date, a.status, a.remarks
      FROM attendance a
      WHERE a.student_id = $1
    `;
    const params = [studentId];

    if (month && year) {
      params.push(year, month);
      query += ` AND EXTRACT(YEAR FROM a.date) = $2 AND EXTRACT(MONTH FROM a.date) = $3`;
    } else {
      query += ` AND a.date >= CURRENT_DATE - INTERVAL '30 days'`;
    }

    query += ' ORDER BY a.date DESC';

    const result = await pool.query(query, params);

    // Calculate stats
    const statsResult = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'present') as present,
        COUNT(*) FILTER (WHERE status = 'absent') as absent,
        COUNT(*) as total
       FROM attendance 
       WHERE student_id = $1
       AND date >= CURRENT_DATE - INTERVAL '30 days'`,
      [studentId]
    );

    const stats = statsResult.rows[0];
    const percentage = stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0;

    res.json({
      attendance: result.rows,
      stats: {
        present: parseInt(stats.present),
        absent: parseInt(stats.absent),
        total: parseInt(stats.total),
        percentage
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

// Get child's marks
router.get('/marks/:studentId', async (req, res) => {
  const { studentId } = req.params;

  try {
    const verifyResult = await pool.query(
      'SELECT id FROM students WHERE id = $1 AND parent_id = $2',
      [studentId, req.user.userId]
    );

    if (verifyResult.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const marks = await pool.query(
      `SELECT m.*, s.subject_name
       FROM marks m
       JOIN subjects s ON m.subject_id = s.id
       WHERE m.student_id = $1
       ORDER BY m.exam_date DESC`,
      [studentId]
    );

    // Subject-wise performance
    const subjectPerformance = await pool.query(
      `SELECT s.subject_name, 
              AVG(m.percentage) as avg_percentage,
              MAX(m.percentage) as max_percentage,
              MIN(m.percentage) as min_percentage,
              COUNT(*) as total_exams
       FROM marks m
       JOIN subjects s ON m.subject_id = s.id
       WHERE m.student_id = $1
       GROUP BY s.subject_name`,
      [studentId]
    );

    // Overall stats
    const overallStats = await pool.query(
      `SELECT 
        AVG(percentage) as overall_avg,
        MAX(percentage) as highest,
        MIN(percentage) as lowest
       FROM marks 
       WHERE student_id = $1`,
      [studentId]
    );

    // Monthly improvement trend
    const monthlyTrend = await pool.query(
      `SELECT 
        DATE_TRUNC('month', exam_date) as month,
        AVG(percentage) as avg_percentage
       FROM marks 
       WHERE student_id = $1 AND exam_date >= CURRENT_DATE - INTERVAL '12 months'
       GROUP BY month
       ORDER BY month`,
      [studentId]
    );

    res.json({
      marks: marks.rows,
      subjectPerformance: subjectPerformance.rows,
      overallStats: overallStats.rows[0],
      monthlyTrend: monthlyTrend.rows
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch marks' });
  }
});

// Get child's homework status
router.get('/homework/:studentId', async (req, res) => {
  const { studentId } = req.params;

  try {
    const verifyResult = await pool.query(
      'SELECT id FROM students WHERE id = $1 AND parent_id = $2',
      [studentId, req.user.userId]
    );

    if (verifyResult.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const homework = await pool.query(
      `SELECT h.*, s.subject_name, hs.status, hs.submitted_at, hs.marks, hs.remarks
       FROM homework h
       JOIN subjects s ON h.subject_id = s.id
       LEFT JOIN homework_submissions hs ON h.id = hs.homework_id AND hs.student_id = $1
       WHERE h.class_id IN (
         SELECT id FROM classes WHERE class_name = (
           SELECT class FROM students WHERE id = $1
         )
       )
       ORDER BY h.due_date DESC
       LIMIT 50`,
      [studentId]
    );

    const stats = await pool.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE hs.status = 'submitted') as submitted,
        COUNT(*) FILTER (WHERE hs.status = 'checked') as checked,
        COUNT(*) FILTER (WHERE hs.status IS NULL AND h.due_date < CURRENT_TIMESTAMP) as overdue
       FROM homework h
       LEFT JOIN homework_submissions hs ON h.id = hs.homework_id AND hs.student_id = $1
       WHERE h.class_id IN (
         SELECT id FROM classes WHERE class_name = (
           SELECT class FROM students WHERE id = $1
         )
       )`,
      [studentId]
    );

    res.json({
      homework: homework.rows,
      stats: stats.rows[0]
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch homework' });
  }
});

// Get fee details
router.get('/fees/:studentId', async (req, res) => {
  const { studentId } = req.params;

  try {
    const verifyResult = await pool.query(
      'SELECT id FROM students WHERE id = $1 AND parent_id = $2',
      [studentId, req.user.userId]
    );

    if (verifyResult.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const feeDetails = await pool.query(
      `SELECT s.fee_status, s.fee_amount, s.fee_paid, s.fee_due_date, s.grace_period_days, s.is_locked,
              COALESCE(SUM(ft.amount) FILTER (WHERE ft.transaction_type = 'payment'), 0) as total_paid,
              COALESCE(SUM(ft.amount) FILTER (WHERE ft.transaction_type = 'fine'), 0) as total_fine,
              array_agg(json_build_object(
                'amount', ft.amount,
                'type', ft.transaction_type,
                'date', ft.paid_date,
                'receipt', ft.receipt_number,
                'method', ft.payment_method
              ) ORDER BY ft.paid_date DESC) as transactions
       FROM students s
       LEFT JOIN fee_transactions ft ON s.id = ft.student_id
       WHERE s.id = $1
       GROUP BY s.id`,
      [studentId]
    );

    res.json(feeDetails.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch fee details' });
  }
});

// Make payment
router.post('/fees/pay', async (req, res) => {
  const { studentId, amount } = req.body;

  try {
    const verifyResult = await pool.query(
      'SELECT id FROM students WHERE id = $1 AND parent_id = $2',
      [studentId, req.user.userId]
    );

    if (verifyResult.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const receiptNumber = `RCP${Date.now()}${Math.random().toString(36).substr(2, 5)}`.toUpperCase();

    await pool.query(
      `INSERT INTO fee_transactions (student_id, amount, transaction_type, receipt_number, created_by)
       VALUES ($1, $2, 'payment', $3, $4)`,
      [studentId, amount, receiptNumber, req.user.userId]
    );

    // Update student fee status
    const totalResult = await pool.query(
      `SELECT s.fee_amount, COALESCE(SUM(ft.amount) FILTER (WHERE ft.transaction_type = 'payment'), 0) as total_paid
       FROM students s
       LEFT JOIN fee_transactions ft ON s.id = ft.student_id
       WHERE s.id = $1
       GROUP BY s.id, s.fee_amount`,
      [studentId]
    );

    if (totalResult.rows.length > 0) {
      const { fee_amount, total_paid } = totalResult.rows[0];
      const newStatus = parseFloat(total_paid) >= parseFloat(fee_amount) ? 'paid' : 'pending';
      
      await pool.query(
        'UPDATE students SET fee_status = $1, fee_paid = $2, is_locked = false, lock_reason = NULL WHERE id = $3',
        [newStatus, total_paid, studentId]
      );
    }

    res.json({ success: true, receiptNumber, message: 'Payment successful' });
  } catch (error) {
    res.status(500).json({ error: 'Payment failed' });
  }
});

// Send query/message
router.post('/queries', async (req, res) => {
  const { studentId, subject, message } = req.body;

  try {
    const verifyResult = await pool.query(
      'SELECT id FROM students WHERE id = $1 AND parent_id = $2',
      [studentId, req.user.userId]
    );

    if (verifyResult.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await pool.query(
      `INSERT INTO parent_queries (parent_id, student_id, subject, message)
       VALUES ($1, $2, $3, $4)`,
      [req.user.userId, studentId, subject, message]
    );

    res.json({ success: true, message: 'Query sent successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send query' });
  }
});

// Get queries
router.get('/queries', async (req, res) => {
  try {
    const queries = await pool.query(
      `SELECT pq.*, s.student_id, u.full_name as student_name, 
              u2.full_name as replied_by_name
       FROM parent_queries pq
       JOIN students s ON pq.student_id = s.id
       JOIN users u ON s.user_id = u.id
       LEFT JOIN users u2 ON pq.replied_by = u2.id
       WHERE pq.parent_id = $1
       ORDER BY pq.created_at DESC`,
      [req.user.userId]
    );

    res.json(queries.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch queries' });
  }
});

// Get notifications
router.get('/notifications', async (req, res) => {
  try {
    const notifications = await pool.query(
      `SELECT * FROM notifications 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [req.user.userId]
    );

    res.json(notifications.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Get test results
router.get('/tests/:studentId', async (req, res) => {
  const { studentId } = req.params;

  try {
    const verifyResult = await pool.query(
      'SELECT id FROM students WHERE id = $1 AND parent_id = $2',
      [studentId, req.user.userId]
    );

    if (verifyResult.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const tests = await pool.query(
      `SELECT ts.*, ot.title as test_title, s.subject_name
       FROM test_submissions ts
       JOIN online_tests ot ON ts.test_id = ot.id
       JOIN subjects s ON ot.subject_id = s.id
       WHERE ts.student_id = $1 AND ts.status = 'submitted'
       ORDER BY ts.submitted_at DESC`,
      [studentId]
    );

    res.json(tests.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch test results' });
  }
});

module.exports = router;
