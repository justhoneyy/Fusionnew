const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { pool } = global;
const multer = require('multer');
const path = require('path');

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
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB for videos
});

router.use(authenticateToken, authorizeRoles('teacher'));

// Get teacher profile
router.get('/profile', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, u.full_name, u.email, u.phone
       FROM teachers t
       JOIN users u ON t.user_id = u.id
       WHERE u.id = $1`,
      [req.user.userId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Get dashboard stats
router.get('/dashboard', async (req, res) => {
  try {
    const teacherResult = await pool.query(
      'SELECT id, classes FROM teachers WHERE user_id = $1',
      [req.user.userId]
    );

    const teacher = teacherResult.rows[0];
    const teacherId = teacher.id;

    const stats = await Promise.all([
      // Total students in teacher's classes
      pool.query(
        `SELECT COUNT(*) FROM students 
         WHERE class = ANY($1)`,
        [teacher.classes]
      ),
      // Today's attendance
      pool.query(
        `SELECT COUNT(*) FROM attendance 
         WHERE date = CURRENT_DATE AND class_id IN (
           SELECT id FROM classes WHERE class_name = ANY($1)
         )`,
        [teacher.classes]
      ),
      // Upcoming tests
      pool.query(
        `SELECT COUNT(*) FROM online_tests 
         WHERE teacher_id = $1 AND start_time > CURRENT_TIMESTAMP AND is_active = true`,
        [teacherId]
      ),
      // Pending doubts
      pool.query(
        `SELECT COUNT(*) FROM doubts 
         WHERE status = 'pending' AND subject_id IN (
           SELECT id FROM subjects WHERE teacher_id = $1
         )`,
        [teacherId]
      )
    ]);

    const [totalStudents, todayAttendance, upcomingTests, pendingDoubts] = stats;

    res.json({
      totalStudents: parseInt(totalStudents.rows[0].count),
      todayAttendance: parseInt(todayAttendance.rows[0].count),
      upcomingTests: parseInt(upcomingTests.rows[0].count),
      pendingDoubts: parseInt(pendingDoubts.rows[0].count)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

// Get students for teacher's classes
router.get('/students', async (req, res) => {
  try {
    const teacherResult = await pool.query(
      'SELECT classes FROM teachers WHERE user_id = $1',
      [req.user.userId]
    );

    const classes = teacherResult.rows[0].classes;

    const students = await pool.query(
      `SELECT s.*, u.full_name, u.email, u.phone
       FROM students s
       JOIN users u ON s.user_id = u.id
       WHERE s.class = ANY($1)
       ORDER BY s.class, s.roll_number`,
      [classes]
    );

    res.json(students.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// Mark attendance
router.post('/attendance', async (req, res) => {
  const { date, classId, attendanceData } = req.body;
  // attendanceData: [{ studentId, status }]

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const record of attendanceData) {
      await client.query(
        `INSERT INTO attendance (student_id, class_id, date, status, marked_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (student_id, date) 
         DO UPDATE SET status = $4, marked_by = $5`,
        [record.studentId, classId, date, record.status, req.user.userId]
      );
    }

    await client.query('COMMIT');

    res.json({ success: true, message: `Attendance marked for ${attendanceData.length} students` });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to mark attendance' });
  } finally {
    client.release();
  }
});

// Get attendance report
router.get('/attendance/:classId', async (req, res) => {
  const { classId } = req.params;
  const { date } = req.query;

  try {
    const attendance = await pool.query(
      `SELECT a.*, s.student_id, u.full_name, s.roll_number
       FROM attendance a
       JOIN students s ON a.student_id = s.id
       JOIN users u ON s.user_id = u.id
       WHERE a.class_id = $1 AND a.date = $2
       ORDER BY s.roll_number`,
      [classId, date || new Date().toISOString().split('T')[0]]
    );

    res.json(attendance.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

// Upload study material
router.post('/materials', upload.single('file'), async (req, res) => {
  const { title, description, subjectId, classId, isDownloadable } = req.body;

  try {
    const fileUrl = `/uploads/${req.file.filename}`;
    const watermarkText = `Fusion Coaching - ${req.user.userId}`;

    await pool.query(
      `INSERT INTO study_materials (title, description, file_url, file_type, file_size, 
        subject_id, class_id, uploaded_by, watermark_text, is_downloadable)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [title, description, fileUrl, req.file.mimetype, req.file.size, 
       subjectId, classId, req.user.userId, watermarkText, isDownloadable === 'true']
    );

    res.json({ success: true, message: 'Material uploaded successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to upload material' });
  }
});

// Upload lecture video
router.post('/videos', upload.single('video'), async (req, res) => {
  const { title, description, subjectId, classId, duration } = req.body;

  try {
    const videoUrl = `/uploads/${req.file.filename}`;

    await pool.query(
      `INSERT INTO lecture_videos (title, description, video_url, duration, subject_id, class_id, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [title, description, videoUrl, duration, subjectId, classId, req.user.userId]
    );

    res.json({ success: true, message: 'Video uploaded successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to upload video' });
  }
});

// Create test
router.post('/tests', async (req, res) => {
  const { title, subjectId, classId, durationMinutes, totalMarks, passingMarks, 
          negativeMarking, instructions, startTime, endTime, randomQuestions, 
          fullScreenRequired, questions } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const teacherResult = await pool.query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.userId]
    );

    const teacherId = teacherResult.rows[0].id;

    const testResult = await client.query(
      `INSERT INTO online_tests (title, subject_id, class_id, teacher_id, duration_minutes, 
        total_marks, passing_marks, negative_marking, instructions, start_time, end_time,
        random_questions, full_screen_required)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [title, subjectId, classId, teacherId, durationMinutes, totalMarks, passingMarks,
       negativeMarking, instructions, startTime, endTime, randomQuestions, fullScreenRequired]
    );

    const testId = testResult.rows[0].id;

    // Add questions
    if (questions && questions.length > 0) {
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        await client.query(
          `INSERT INTO test_questions (test_id, question_text, question_type, options, 
            correct_answer, marks, negative_marks, order_number)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [testId, q.questionText, q.questionType, JSON.stringify(q.options), 
           q.correctAnswer, q.marks, q.negativeMarks || negativeMarking, i + 1]
        );
      }
    }

    await client.query('COMMIT');

    res.json({ success: true, testId, message: 'Test created successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to create test' });
  } finally {
    client.release();
  }
});

// Get test submissions for evaluation
router.get('/tests/:id/submissions', async (req, res) => {
  const { id } = req.params;

  try {
    const submissions = await pool.query(
      `SELECT ts.*, s.student_id, u.full_name
       FROM test_submissions ts
       JOIN students s ON ts.student_id = s.id
       JOIN users u ON s.user_id = u.id
       WHERE ts.test_id = $1
       ORDER BY ts.submitted_at DESC`,
      [id]
    );

    res.json(submissions.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

// Evaluate subjective answers
router.put('/submissions/:id/evaluate', async (req, res) => {
  const { id } = req.params;
  const { marksObtained, remarks } = req.body;

  try {
    await pool.query(
      `UPDATE test_submissions 
       SET marks_obtained = COALESCE(marks_obtained, 0) + $1, 
           status = 'evaluated'
       WHERE id = $2`,
      [marksObtained, id]
    );

    res.json({ success: true, message: 'Submission evaluated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to evaluate submission' });
  }
});

// Create notice
router.post('/notices', async (req, res) => {
  const { title, content, noticeType, classId, section } = req.body;

  try {
    await pool.query(
      `INSERT INTO notices (title, content, notice_type, class_id, section, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [title, content, noticeType, classId, section, req.user.userId]
    );

    res.json({ success: true, message: 'Notice created successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create notice' });
  }
});

// Create homework
router.post('/homework', async (req, res) => {
  const { title, description, subjectId, classId, dueDate } = req.body;

  try {
    const teacherResult = await pool.query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.userId]
    );

    await pool.query(
      `INSERT INTO homework (title, description, subject_id, class_id, teacher_id, due_date)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [title, description, subjectId, classId, teacherResult.rows[0].id, dueDate]
    );

    // Notify students
    const studentsResult = await pool.query(
      'SELECT user_id FROM students WHERE class = (SELECT class_name FROM classes WHERE id = $1)',
      [classId]
    );

    for (const student of studentsResult.rows) {
      await pool.query(
        `INSERT INTO notifications (user_id, title, message, notification_type)
         VALUES ($1, 'New Homework', $2, 'homework')`,
        [student.user_id, `${title} - Due: ${new Date(dueDate).toLocaleDateString()}`]
      );
    }

    res.json({ success: true, message: 'Homework created successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create homework' });
  }
});

// Check homework submissions
router.get('/homework/:id/submissions', async (req, res) => {
  const { id } = req.params;

  try {
    const submissions = await pool.query(
      `SELECT hs.*, s.student_id, u.full_name
       FROM homework_submissions hs
       JOIN students s ON hs.student_id = s.id
       JOIN users u ON s.user_id = u.id
       WHERE hs.homework_id = $1
       ORDER BY hs.submitted_at DESC`,
      [id]
    );

    res.json(submissions.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

// Evaluate homework
router.put('/homework-submissions/:id/evaluate', async (req, res) => {
  const { id } = req.params;
  const { marks, remarks } = req.body;

  try {
    await pool.query(
      `UPDATE homework_submissions SET marks = $1, remarks = $2, status = 'checked' WHERE id = $3`,
      [marks, remarks, id]
    );

    res.json({ success: true, message: 'Homework evaluated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to evaluate homework' });
  }
});

// Enter marks
router.post('/marks', async (req, res) => {
  const { studentId, subjectId, examType, marksObtained, totalMarks, grade, remarks, examDate } = req.body;

  try {
    const percentage = (marksObtained / totalMarks) * 100;

    await pool.query(
      `INSERT INTO marks (student_id, subject_id, exam_type, marks_obtained, total_marks, 
        percentage, grade, remarks, exam_date, entered_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [studentId, subjectId, examType, marksObtained, totalMarks, percentage, 
       grade, remarks, examDate, req.user.userId]
    );

    // Notify student and parent
    const studentResult = await pool.query(
      'SELECT s.user_id, s.parent_id FROM students s WHERE s.id = $1',
      [studentId]
    );

    if (studentResult.rows.length > 0) {
      const { user_id, parent_id } = studentResult.rows[0];
      
      await pool.query(
        `INSERT INTO notifications (user_id, title, message, notification_type)
         VALUES ($1, 'Marks Updated', $2, 'marks')`,
        [user_id, `${examType}: ${marksObtained}/${totalMarks}`]
      );

      if (parent_id) {
        await pool.query(
          `INSERT INTO notifications (user_id, title, message, notification_type)
           VALUES ($1, 'Child Marks Updated', $2, 'marks')`,
          [parent_id, `Your child scored ${marksObtained}/${totalMarks} in ${examType}`]
        );
      }
    }

    res.json({ success: true, message: 'Marks entered successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to enter marks' });
  }
});

// Get student performance
router.get('/performance/:studentId', async (req, res) => {
  const { studentId } = req.params;

  try {
    const performance = await pool.query(
      `SELECT m.*, s.subject_name
       FROM marks m
       JOIN subjects s ON m.subject_id = s.id
       WHERE m.student_id = $1
       ORDER BY m.exam_date DESC`,
      [studentId]
    );

    const attendance = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'present') as present,
        COUNT(*) FILTER (WHERE status = 'absent') as absent,
        COUNT(*) as total
       FROM attendance 
       WHERE student_id = $1`,
      [studentId]
    );

    res.json({
      marks: performance.rows,
      attendance: attendance.rows[0]
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch performance' });
  }
});

// Reply to doubt
router.post('/doubts/:id/reply', async (req, res) => {
  const { id } = req.params;
  const { answer } = req.body;

  try {
    await pool.query(
      `UPDATE doubts 
       SET answer = $1, answered_by = $2, answered_at = CURRENT_TIMESTAMP, status = 'answered'
       WHERE id = $3`,
      [answer, req.user.userId, id]
    );

    // Notify student
    const doubtResult = await pool.query(
      `SELECT d.student_id, s.user_id 
       FROM doubts d
       JOIN students s ON d.student_id = s.id
       WHERE d.id = $1`,
      [id]
    );

    if (doubtResult.rows.length > 0) {
      await pool.query(
        `INSERT INTO notifications (user_id, title, message, notification_type)
         VALUES ($1, 'Doubt Answered', 'Your doubt has been answered', 'doubt')`,
        [doubtResult.rows[0].user_id]
      );
    }

    res.json({ success: true, message: 'Reply posted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reply to doubt' });
  }
});

module.exports = router;
