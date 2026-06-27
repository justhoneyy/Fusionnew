const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles, checkFeeStatus } = require('../middleware/auth');
const { pool } = global;
const multer = require('multer');
const path = require('path');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|ppt|pptx|mp4|webm/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    if (extname) {
      return cb(null, true);
    }
    cb(new Error('File type not allowed'));
  }
});

router.use(authenticateToken, authorizeRoles('student'), checkFeeStatus);

// Get student profile
router.get('/profile', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, u.full_name, u.email, u.phone, u.profile_pic, u.last_login
       FROM students s
       JOIN users u ON s.user_id = u.id
       WHERE u.id = $1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Get attendance
router.get('/attendance', async (req, res) => {
  const { month, year } = req.query;
  
  try {
    const studentResult = await pool.query(
      'SELECT id FROM students WHERE user_id = $1',
      [req.user.userId]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const studentId = studentResult.rows[0].id;

    let query = `
      SELECT date, status FROM attendance 
      WHERE student_id = $1
    `;
    const params = [studentId];

    if (month && year) {
      params.push(year, month);
      query += ` AND EXTRACT(YEAR FROM date) = $2 AND EXTRACT(MONTH FROM date) = $3`;
    } else {
      query += ` AND date >= CURRENT_DATE - INTERVAL '30 days'`;
    }

    query += ' ORDER BY date DESC';

    const result = await pool.query(query, params);

    // Calculate attendance percentage
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

// Get marks
router.get('/marks', async (req, res) => {
  try {
    const studentResult = await pool.query(
      'SELECT id FROM students WHERE user_id = $1',
      [req.user.userId]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const studentId = studentResult.rows[0].id;

    const marks = await pool.query(
      `SELECT m.*, s.subject_name, s.subject_code
       FROM marks m
       JOIN subjects s ON m.subject_id = s.id
       WHERE m.student_id = $1
       ORDER BY m.exam_date DESC`,
      [studentId]
    );

    // Calculate overall stats
    const stats = await pool.query(
      `SELECT 
        exam_type,
        AVG(percentage) as avg_percentage,
        MAX(percentage) as max_percentage,
        MIN(percentage) as min_percentage
       FROM marks 
       WHERE student_id = $1 
       GROUP BY exam_type`,
      [studentId]
    );

    // Get rank (simplified)
    const rankResult = await pool.query(
      `SELECT student_id, AVG(percentage) as avg_pct,
              RANK() OVER (ORDER BY AVG(percentage) DESC) as rank
       FROM marks 
       WHERE subject_id IN (SELECT subject_id FROM marks WHERE student_id = $1)
       GROUP BY student_id
       ORDER BY avg_pct DESC
       LIMIT 50`,
      [studentId]
    );

    const studentRank = rankResult.rows.find(r => r.student_id === studentId);

    res.json({
      marks: marks.rows,
      stats: stats.rows,
      rank: studentRank ? parseInt(studentRank.rank) : null
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch marks' });
  }
});

// Get available tests
router.get('/tests', async (req, res) => {
  try {
    const studentResult = await pool.query(
      'SELECT id, class, section FROM students WHERE user_id = $1',
      [req.user.userId]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const student = studentResult.rows[0];

    const tests = await pool.query(
      `SELECT ot.*, s.subject_name,
              CASE WHEN ts.id IS NOT NULL THEN true ELSE false END as attempted
       FROM online_tests ot
       JOIN subjects s ON ot.subject_id = s.id
       LEFT JOIN test_submissions ts ON ot.id = ts.test_id 
         AND ts.student_id = $1
       WHERE ot.class_id IN (
         SELECT id FROM classes WHERE class_name = $2 AND (section = $3 OR section IS NULL)
       )
       AND ot.is_active = true
       AND ot.start_time <= CURRENT_TIMESTAMP
       AND (ot.end_time IS NULL OR ot.end_time >= CURRENT_TIMESTAMP)
       ORDER BY ot.start_time DESC`,
      [student.id, student.class, student.section]
    );

    res.json(tests.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tests' });
  }
});

// Start test
router.get('/tests/:id/start', async (req, res) => {
  const { id } = req.params;

  try {
    const studentResult = await pool.query(
      'SELECT id FROM students WHERE user_id = $1',
      [req.user.userId]
    );

    const studentId = studentResult.rows[0].id;

    // Check if already attempted
    const existingResult = await pool.query(
      'SELECT id FROM test_submissions WHERE test_id = $1 AND student_id = $2 AND status = $3',
      [id, studentId, 'submitted']
    );

    if (existingResult.rows.length > 0) {
      return res.status(400).json({ error: 'Test already attempted' });
    }

    // Get test details
    const testResult = await pool.query(
      'SELECT * FROM online_tests WHERE id = $1 AND is_active = true',
      [id]
    );

    if (testResult.rows.length === 0) {
      return res.status(404).json({ error: 'Test not found' });
    }

    const test = testResult.rows[0];

    // Get questions
    let questionsQuery = 'SELECT * FROM test_questions WHERE test_id = $1';
    if (test.random_questions) {
      questionsQuery += ' ORDER BY RANDOM()';
    } else {
      questionsQuery += ' ORDER BY order_number';
    }

    const questionsResult = await pool.query(questionsQuery, [id]);

    // Create submission record
    const submissionResult = await pool.query(
      `INSERT INTO test_submissions (test_id, student_id, started_at, status, device_info, ip_address)
       VALUES ($1, $2, CURRENT_TIMESTAMP, 'pending', $3, $4) RETURNING id`,
      [id, studentId, JSON.stringify({ userAgent: req.headers['user-agent'] }), req.ip]
    );

    res.json({
      test: {
        id: test.id,
        title: test.title,
        duration: test.duration_minutes,
        totalMarks: test.total_marks,
        passingMarks: test.passing_marks,
        negativeMarking: test.negative_marking,
        instructions: test.instructions,
        fullScreenRequired: test.full_screen_required
      },
      questions: questionsResult.rows.map(q => ({
        id: q.id,
        questionText: q.question_text,
        questionType: q.question_type,
        options: q.options,
        marks: q.marks,
        negativeMarks: q.negative_marks
      })),
      submissionId: submissionResult.rows[0].id
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start test' });
  }
});

// Submit test
router.post('/tests/:id/submit', async (req, res) => {
  const { id } = req.params;
  const { submissionId, answers } = req.body;

  try {
    const studentResult = await pool.query(
      'SELECT id FROM students WHERE user_id = $1',
      [req.user.userId]
    );

    const studentId = studentResult.rows[0].id;

    // Get test and questions for evaluation
    const testResult = await pool.query('SELECT * FROM online_tests WHERE id = $1', [id]);
    const test = testResult.rows[0];

    const questionsResult = await pool.query(
      'SELECT * FROM test_questions WHERE test_id = $1',
      [id]
    );

    // Auto-evaluate MCQs
    let totalObtained = 0;
    const evaluatedAnswers = answers.map(answer => {
      const question = questionsResult.rows.find(q => q.id === answer.questionId);
      
      if (question && question.question_type === 'mcq' && answer.selectedAnswer === question.correct_answer) {
        totalObtained += parseFloat(question.marks || 1);
        return { ...answer, correct: true, marksObtained: question.marks };
      } else if (question && question.question_type === 'mcq' && answer.selectedAnswer !== question.correct_answer) {
        totalObtained -= parseFloat(question.negative_marks || test.negative_marking || 0);
        return { ...answer, correct: false, marksObtained: -parseFloat(question.negative_marks || test.negative_marking || 0) };
      }
      return { ...answer, correct: null, marksObtained: 0 };
    });

    const percentage = (totalObtained / parseFloat(test.total_marks)) * 100;

    // Update submission
    await pool.query(
      `UPDATE test_submissions 
       SET answers = $1, marks_obtained = $2, total_marks = $3, percentage = $4,
           submitted_at = CURRENT_TIMESTAMP, 
           time_taken = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at)),
           status = 'submitted'
       WHERE id = $5 AND student_id = $6`,
      [JSON.stringify(evaluatedAnswers), totalObtained, test.total_marks, percentage, submissionId, studentId]
    );

    res.json({
      success: true,
      message: 'Test submitted successfully',
      marksObtained: totalObtained,
      totalMarks: test.total_marks,
      percentage: Math.round(percentage * 100) / 100,
      status: percentage >= parseFloat(test.passing_marks) ? 'Passed' : 'Failed'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit test' });
  }
});

// Get study materials
router.get('/materials', async (req, res) => {
  try {
    const studentResult = await pool.query(
      'SELECT id, class, section FROM students WHERE user_id = $1',
      [req.user.userId]
    );

    const student = studentResult.rows[0];

    const materials = await pool.query(
      `SELECT sm.*, s.subject_name
       FROM study_materials sm
       JOIN subjects s ON sm.subject_id = s.id
       WHERE sm.class_id IN (
         SELECT id FROM classes WHERE class_name = $1
       )
       ORDER BY sm.created_at DESC`,
      [student.class]
    );

    res.json(materials.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch materials' });
  }
});

// Get lecture videos
router.get('/videos', async (req, res) => {
  try {
    const studentResult = await pool.query(
      'SELECT id, class FROM students WHERE user_id = $1',
      [req.user.userId]
    );

    const student = studentResult.rows[0];

    const videos = await pool.query(
      `SELECT lv.*, s.subject_name, vp.watched_duration, vp.last_position, vp.completed
       FROM lecture_videos lv
       JOIN subjects s ON lv.subject_id = s.id
       LEFT JOIN video_progress vp ON lv.id = vp.video_id AND vp.student_id = $1
       WHERE lv.class_id IN (
         SELECT id FROM classes WHERE class_name = $2
       )
       ORDER BY lv.created_at DESC`,
      [student.id, student.class]
    );

    res.json(videos.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

// Update video progress
router.post('/videos/:id/progress', async (req, res) => {
  const { id } = req.params;
  const { watchedDuration, lastPosition, completed } = req.body;

  try {
    const studentResult = await pool.query(
      'SELECT id FROM students WHERE user_id = $1',
      [req.user.userId]
    );

    const studentId = studentResult.rows[0].id;

    await pool.query(
      `INSERT INTO video_progress (video_id, student_id, watched_duration, last_position, completed)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (video_id, student_id) 
       DO UPDATE SET watched_duration = $3, last_position = $4, completed = $5, updated_at = CURRENT_TIMESTAMP`,
      [id, studentId, watchedDuration, lastPosition, completed]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

// Doubt section
router.post('/doubts', upload.single('image'), async (req, res) => {
  const { subjectId, question } = req.body;

  try {
    const studentResult = await pool.query(
      'SELECT id FROM students WHERE user_id = $1',
      [req.user.userId]
    );

    const studentId = studentResult.rows[0].id;

    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    await pool.query(
      `INSERT INTO doubts (student_id, subject_id, question, image_url)
       VALUES ($1, $2, $3, $4)`,
      [studentId, subjectId, question, imageUrl]
    );

    res.json({ success: true, message: 'Doubt submitted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit doubt' });
  }
});

// Get doubts
router.get('/doubts', async (req, res) => {
  try {
    const studentResult = await pool.query(
      'SELECT id FROM students WHERE user_id = $1',
      [req.user.userId]
    );

    const studentId = studentResult.rows[0].id;

    const doubts = await pool.query(
      `SELECT d.*, s.subject_name, u.full_name as answered_by_name
       FROM doubts d
       JOIN subjects s ON d.subject_id = s.id
       LEFT JOIN users u ON d.answered_by = u.id
       WHERE d.student_id = $1
       ORDER BY d.created_at DESC`,
      [studentId]
    );

    res.json(doubts.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch doubts' });
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

// Mark notification as read
router.put('/notifications/:id/read', async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query(
      'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2',
      [id, req.user.userId]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

// Get homework
router.get('/homework', async (req, res) => {
  try {
    const studentResult = await pool.query(
      'SELECT id, class FROM students WHERE user_id = $1',
      [req.user.userId]
    );

    const student = studentResult.rows[0];

    const homework = await pool.query(
      `SELECT h.*, s.subject_name, hs.status as submission_status, hs.marks, hs.remarks
       FROM homework h
       JOIN subjects s ON h.subject_id = s.id
       LEFT JOIN homework_submissions hs ON h.id = hs.homework_id AND hs.student_id = $1
       WHERE h.class_id IN (
         SELECT id FROM classes WHERE class_name = $2
       )
       ORDER BY h.due_date DESC`,
      [student.id, student.class]
    );

    res.json(homework.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch homework' });
  }
});

// Submit homework
router.post('/homework/:id/submit', upload.single('file'), async (req, res) => {
  const { id } = req.params;

  try {
    const studentResult = await pool.query(
      'SELECT id FROM students WHERE user_id = $1',
      [req.user.userId]
    );

    const studentId = studentResult.rows[0].id;

    const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;

    await pool.query(
      `INSERT INTO homework_submissions (homework_id, student_id, submission_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (homework_id, student_id) 
       DO UPDATE SET submission_url = $3, submitted_at = CURRENT_TIMESTAMP`,
      [id, studentId, fileUrl]
    );

    res.json({ success: true, message: 'Homework submitted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit homework' });
  }
});

// Fee payment page (accessible even if locked)
router.get('/fee-details', async (req, res) => {
  try {
    const result = await pool.query(
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
       WHERE s.user_id = $1
       GROUP BY s.id`,
      [req.user.userId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch fee details' });
  }
});

module.exports = router;
