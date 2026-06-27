-- Fusion Coaching Database Schema
-- PostgreSQL

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (all roles)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'teacher', 'student', 'parent')),
    full_name VARCHAR(200) NOT NULL,
    phone VARCHAR(20),
    profile_pic VARCHAR(500),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    login_count INTEGER DEFAULT 0,
    device_info JSONB,
    device_token VARCHAR(500),
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP
);

-- Students table
CREATE TABLE students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    student_id VARCHAR(50) UNIQUE NOT NULL,
    admission_number VARCHAR(50) UNIQUE,
    class VARCHAR(20) NOT NULL,
    section VARCHAR(10),
    roll_number INTEGER,
    parent_id UUID REFERENCES users(id),
    date_of_birth DATE,
    address TEXT,
    admission_date DATE DEFAULT CURRENT_DATE,
    fee_status VARCHAR(20) DEFAULT 'paid' CHECK (fee_status IN ('paid', 'pending', 'overdue', 'grace_period')),
    fee_due_date DATE,
    fee_amount DECIMAL(10,2),
    fee_paid DECIMAL(10,2) DEFAULT 0,
    grace_period_days INTEGER DEFAULT 7,
    is_locked BOOLEAN DEFAULT false,
    lock_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Teachers table
CREATE TABLE teachers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    teacher_id VARCHAR(50) UNIQUE NOT NULL,
    qualification VARCHAR(200),
    specialization VARCHAR(200),
    subjects TEXT[],
    classes TEXT[],
    experience_years INTEGER,
    joining_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Classes table
CREATE TABLE classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    class_name VARCHAR(20) NOT NULL,
    section VARCHAR(10),
    teacher_id UUID REFERENCES teachers(id),
    academic_year VARCHAR(9),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Subjects table
CREATE TABLE subjects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subject_name VARCHAR(100) NOT NULL,
    subject_code VARCHAR(20) UNIQUE,
    class_id UUID REFERENCES classes(id),
    teacher_id UUID REFERENCES teachers(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Attendance table
CREATE TABLE attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    class_id UUID REFERENCES classes(id),
    date DATE NOT NULL,
    status VARCHAR(20) CHECK (status IN ('present', 'absent', 'late', 'half_day', 'holiday')),
    marked_by UUID REFERENCES users(id),
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id, date)
);

-- Marks table
CREATE TABLE marks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    subject_id UUID REFERENCES subjects(id),
    exam_type VARCHAR(50) CHECK (exam_type IN ('unit_test', 'half_yearly', 'final', 'weekly', 'monthly')),
    marks_obtained DECIMAL(5,2),
    total_marks DECIMAL(5,2),
    percentage DECIMAL(5,2),
    grade VARCHAR(5),
    remarks TEXT,
    exam_date DATE,
    entered_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Online tests table
CREATE TABLE online_tests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(200) NOT NULL,
    subject_id UUID REFERENCES subjects(id),
    class_id UUID REFERENCES classes(id),
    teacher_id UUID REFERENCES teachers(id),
    duration_minutes INTEGER,
    total_marks DECIMAL(5,2),
    passing_marks DECIMAL(5,2),
    negative_marking DECIMAL(3,2) DEFAULT 0,
    instructions TEXT,
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    random_questions BOOLEAN DEFAULT false,
    full_screen_required BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Test questions table
CREATE TABLE test_questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    test_id UUID REFERENCES online_tests(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    question_type VARCHAR(20) CHECK (question_type IN ('mcq', 'subjective', 'true_false', 'fill_blank')),
    options JSONB,
    correct_answer TEXT,
    marks DECIMAL(5,2) DEFAULT 1,
    negative_marks DECIMAL(3,2) DEFAULT 0,
    order_number INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Test submissions table
CREATE TABLE test_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    test_id UUID REFERENCES online_tests(id),
    student_id UUID REFERENCES students(id),
    answers JSONB,
    marks_obtained DECIMAL(5,2),
    total_marks DECIMAL(5,2),
    percentage DECIMAL(5,2),
    started_at TIMESTAMP,
    submitted_at TIMESTAMP,
    time_taken INTEGER,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'evaluated')),
    device_info JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Study materials table
CREATE TABLE study_materials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    file_url VARCHAR(500),
    file_type VARCHAR(50),
    file_size BIGINT,
    subject_id UUID REFERENCES subjects(id),
    class_id UUID REFERENCES classes(id),
    uploaded_by UUID REFERENCES users(id),
    watermark_text TEXT,
    is_downloadable BOOLEAN DEFAULT false,
    requires_token BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Lecture videos table
CREATE TABLE lecture_videos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    video_url VARCHAR(500),
    thumbnail_url VARCHAR(500),
    duration INTEGER,
    subject_id UUID REFERENCES subjects(id),
    class_id UUID REFERENCES classes(id),
    uploaded_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Video progress table
CREATE TABLE video_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_id UUID REFERENCES lecture_videos(id) ON DELETE CASCADE,
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    watched_duration INTEGER DEFAULT 0,
    last_position INTEGER DEFAULT 0,
    completed BOOLEAN DEFAULT false,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(video_id, student_id)
);

-- Doubts table
CREATE TABLE doubts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES students(id),
    subject_id UUID REFERENCES subjects(id),
    question TEXT NOT NULL,
    image_url VARCHAR(500),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'answered', 'closed')),
    answered_by UUID REFERENCES users(id),
    answer TEXT,
    answered_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Homework table
CREATE TABLE homework (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    subject_id UUID REFERENCES subjects(id),
    class_id UUID REFERENCES classes(id),
    teacher_id UUID REFERENCES teachers(id),
    due_date TIMESTAMP,
    attachment_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Homework submissions table
CREATE TABLE homework_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    homework_id UUID REFERENCES homework(id) ON DELETE CASCADE,
    student_id UUID REFERENCES students(id),
    submission_url VARCHAR(500),
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    marks DECIMAL(5,2),
    remarks TEXT,
    status VARCHAR(20) DEFAULT 'submitted' CHECK (status IN ('submitted', 'checked', 'late'))
);

-- Notices table
CREATE TABLE notices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    notice_type VARCHAR(50) CHECK (notice_type IN ('general', 'class', 'section', 'urgent', 'exam', 'fee')),
    class_id UUID REFERENCES classes(id),
    section VARCHAR(10),
    created_by UUID REFERENCES users(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP
);

-- Notifications table
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200),
    message TEXT,
    notification_type VARCHAR(50),
    is_read BOOLEAN DEFAULT false,
    link VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Fee transactions table
CREATE TABLE fee_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES students(id),
    amount DECIMAL(10,2) NOT NULL,
    transaction_type VARCHAR(20) CHECK (transaction_type IN ('payment', 'discount', 'fine', 'refund')),
    payment_method VARCHAR(50),
    transaction_id VARCHAR(100),
    receipt_number VARCHAR(50) UNIQUE,
    paid_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    remarks TEXT,
    created_by UUID REFERENCES users(id)
);

-- Parent queries table
CREATE TABLE parent_queries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_id UUID REFERENCES users(id),
    student_id UUID REFERENCES students(id),
    subject VARCHAR(200),
    message TEXT NOT NULL,
    reply TEXT,
    replied_by UUID REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'replied', 'closed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    replied_at TIMESTAMP
);

-- Audit logs table
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(200) NOT NULL,
    table_name VARCHAR(100),
    record_id UUID,
    old_data JSONB,
    new_data JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Login history table
CREATE TABLE login_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    logout_time TIMESTAMP,
    ip_address VARCHAR(45),
    device_info JSONB,
    session_token VARCHAR(500),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'logged_out', 'expired', 'forced_logout'))
);

-- Timetable table
CREATE TABLE timetable (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    class_id UUID REFERENCES classes(id),
    day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
    period_number INTEGER,
    subject_id UUID REFERENCES subjects(id),
    teacher_id UUID REFERENCES teachers(id),
    start_time TIME,
    end_time TIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_students_class ON students(class);
CREATE INDEX idx_students_parent ON students(parent_id);
CREATE INDEX idx_attendance_date ON attendance(date);
CREATE INDEX idx_attendance_student ON attendance(student_id);
CREATE INDEX idx_marks_student ON marks(student_id);
CREATE INDEX idx_marks_exam ON marks(exam_type);
CREATE INDEX idx_doubts_status ON doubts(status);
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_fee_student ON fee_transactions(student_id);
CREATE INDEX idx_login_history_user ON login_history(user_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_test_submissions_test ON test_submissions(test_id);
CREATE INDEX idx_test_submissions_student ON test_submissions(student_id);

-- Insert default admin user (password: Admin@Fusion2024)
INSERT INTO users (username, email, password_hash, role, full_name, phone)
VALUES ('admin', 'admin@fusioncoaching.in', '$2a$10$YourHashedPasswordHere', 'admin', 'Fusion Admin', '+918700517172');
