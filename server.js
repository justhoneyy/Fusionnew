require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { Pool } = require('pg');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.connect()
  .then(() => console.log('✅ Database connected successfully'))
  .catch(err => console.error('❌ Database connection error:', err.message));

// Make pool available globally
global.pool = pool;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? 'https://fusioncoaching.in' : '*',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Login rate limiter (stricter)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts, please try again after 15 minutes.' }
});
app.use('/api/auth/login', loginLimiter);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/portals', express.static(path.join(__dirname, 'public/portals')));
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Import routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const studentRoutes = require('./routes/student');
const teacherRoutes = require('./routes/teacher');
const parentRoutes = require('./routes/parent');

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/parent', parentRoutes);

// Main page routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/portals/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/portals/login.html'));
});

app.get('/portals/student', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/portals/student-dashboard.html'));
});

app.get('/portals/teacher', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/portals/teacher-dashboard.html'));
});

app.get('/portals/parent', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/portals/parent-dashboard.html'));
});

app.get('/portals/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/portals/admin-dashboard.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({ error: 'Something went wrong!', message: err.message });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ===== DEFAULT USERS CREATION =====
async function createDefaultUsers() {
  const bcrypt = require('bcryptjs');
  
  try {
    // Create default admin
    const adminExists = await pool.query("SELECT id FROM users WHERE username = 'admin'");
    
    if (adminExists.rows.length === 0) {
      const adminHash = await bcrypt.hash('Admin@Fusion2024', 12);
      await pool.query(
        `INSERT INTO users (username, email, password_hash, role, full_name, phone) 
         VALUES ('admin', 'admin@fusioncoaching.in', $1, 'admin', 'Fusion Admin', '+918700517172')`,
        [adminHash]
      );
      console.log('✅ Default admin created');
    }

    // Create test student if not exists
    const studentExists = await pool.query("SELECT id FROM users WHERE username = 'student1'");
    
    if (studentExists.rows.length === 0) {
      const studentHash = await bcrypt.hash('student123', 12);
      const userResult = await pool.query(
        `INSERT INTO users (username, email, password_hash, role, full_name, phone) 
         VALUES ('student1', 'student@fusioncoaching.in', $1, 'student', 'Rahul Sharma', '+919876543210') 
         RETURNING id`,
        [studentHash]
      );
      
      const userId = userResult.rows[0].id;
      
      // Create student record
      await pool.query(
        `INSERT INTO students (user_id, student_id, admission_number, class, section, roll_number, 
          fee_amount, fee_due_date, fee_status)
         VALUES ($1, 'STU2024001', 'ADM2024001', '11', 'A', 1, 12000, CURRENT_DATE + INTERVAL '30 days', 'paid')`,
        [userId]
      );
      
      console.log('✅ Test student created: student1 / student123');
    }

    // Create test teacher if not exists
    const teacherExists = await pool.query("SELECT id FROM users WHERE username = 'teacher1'");
    
    if (teacherExists.rows.length === 0) {
      const teacherHash = await bcrypt.hash('teacher123', 12);
      const userResult = await pool.query(
        `INSERT INTO users (username, email, password_hash, role, full_name, phone) 
         VALUES ('teacher1', 'teacher@fusioncoaching.in', $1, 'teacher', 'Aakash Sir', '+919876543212') 
         RETURNING id`,
        [teacherHash]
      );
      
      await pool.query(
        `INSERT INTO teachers (user_id, teacher_id, qualification, specialization, subjects, classes, experience_years)
         VALUES ($1, 'TCH001', 'M.Sc. Physics, IIT Delhi', 'Physics', ARRAY['Physics','Chemistry'], ARRAY['11','12'], 12)`,
        [userResult.rows[0].id]
      );
      
      console.log('✅ Test teacher created: teacher1 / teacher123');
    }

    // Create test parent if not exists
    const parentExists = await pool.query("SELECT id FROM users WHERE username = 'parent1'");
    
    if (parentExists.rows.length === 0) {
      const parentHash = await bcrypt.hash('parent123', 12);
      const userResult = await pool.query(
        `INSERT INTO users (username, email, password_hash, role, full_name, phone) 
         VALUES ('parent1', 'parent@fusioncoaching.in', $1, 'parent', 'Mr. Sharma', '+919876543213') 
         RETURNING id`,
        [parentHash]
      );
      
      // Link parent to student
      const studentRecord = await pool.query("SELECT id FROM students WHERE student_id = 'STU2024001'");
      if (studentRecord.rows.length > 0) {
        await pool.query(
          'UPDATE students SET parent_id = $1 WHERE id = $2',
          [userResult.rows[0].id, studentRecord.rows[0].id]
        );
      }
      
      console.log('✅ Test parent created: parent1 / parent123');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 DEFAULT LOGIN CREDENTIALS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔑 Admin:   admin    / Admin@Fusion2024');
    console.log('👨‍🎓 Student: student1 / student123');
    console.log('👨‍🏫 Teacher: teacher1 / teacher123');
    console.log('👨‍👩‍👧 Parent:  parent1  / parent123');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  } catch (error) {
    console.error('Error creating default users:', error.message);
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Fusion Coaching server running on port ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📍 Portal Login: http://localhost:${PORT}/portals/login`);
  
  // Create default users after server starts
  setTimeout(createDefaultUsers, 1000);
});

module.exports = { app, pool };
