require('dotenv').config({ path: '../.env' });
const { Client, LocalAuth } = require('whatsapp-web.js');
const { Pool } = require('pg');
const cron = require('node-cron');
const qrcode = require('qrcode');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// WhatsApp client
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'fusion-coaching-bot'
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  }
});

// Generate QR code for authentication
client.on('qr', async (qr) => {
  console.log('QR Code received. Scan with WhatsApp:');
  try {
    const qrImage = await qrcode.toString(qr, { type: 'terminal', small: true });
    console.log(qrImage);
  } catch (err) {
    console.log('QR Code URL:', qr);
  }
});

client.on('ready', () => {
  console.log('Fusion Coaching WhatsApp Bot is ready!');
  console.log('Bot will now send automated fee reminders.');
});

client.on('authenticated', () => {
  console.log('WhatsApp authenticated successfully');
});

client.on('auth_failure', (msg) => {
  console.error('WhatsApp authentication failed:', msg);
});

client.on('disconnected', (reason) => {
  console.log('WhatsApp client disconnected:', reason);
  // Reconnect after 30 seconds
  setTimeout(() => {
    client.initialize();
  }, 30000);
});

// Initialize WhatsApp client
client.initialize();

// ===== AUTOMATED FEE REMINDERS =====

// Check for overdue fees and send reminders (runs daily at 9 AM)
cron.schedule('0 9 * * *', async () => {
  console.log('Running daily fee reminder check...');
  await sendFeeReminders();
});

// Check for grace period expiry (runs every hour)
cron.schedule('0 * * * *', async () => {
  console.log('Checking grace period expirations...');
  await checkGracePeriodExpiry();
});

// Send fee reminders to students with pending/overdue fees
async function sendFeeReminders() {
  try {
    // Get students with pending or overdue fees
    const result = await pool.query(`
      SELECT s.id, s.student_id, s.fee_status, s.fee_amount, s.fee_paid, 
             s.fee_due_date, s.grace_period_days,
             u.full_name, u.phone
      FROM students s
      JOIN users u ON s.user_id = u.id
      WHERE s.fee_status IN ('pending', 'overdue', 'grace_period')
      AND u.phone IS NOT NULL
      AND u.phone != ''
    `);

    console.log(`Found ${result.rows.length} students with pending fees`);

    for (const student of result.rows) {
      const remainingAmount = parseFloat(student.fee_amount) - parseFloat(student.fee_paid);
      const dueDate = new Date(student.fee_due_date);
      const today = new Date();
      const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));

      let message = '';
      
      if (student.fee_status === 'overdue') {
        message = `*Fusion Coaching - Fee Reminder*\n\n` +
                  `Dear *${student.full_name}*,\n\n` +
                  `⚠️ *URGENT: Fee Payment Overdue*\n\n` +
                  `Your fee payment is overdue by *${daysOverdue} days*.\n\n` +
                  `📋 *Details:*\n` +
                  `• Student ID: ${student.student_id}\n` +
                  `• Total Fee: ₹${student.fee_amount}\n` +
                  `• Amount Paid: ₹${student.fee_paid}\n` +
                  `• Remaining: ₹${remainingAmount}\n` +
                  `• Due Date: ${dueDate.toLocaleDateString()}\n\n` +
                  `⚠️ Please pay immediately to avoid account lock.\n\n` +
                  `📞 Contact: +91 87005 17172\n` +
                  `🏫 Fusion Coaching, Bharat City`;
      } else if (student.fee_status === 'grace_period') {
        const graceEnd = new Date(dueDate);
        graceEnd.setDate(graceEnd.getDate() + student.grace_period_days);
        const daysLeft = Math.ceil((graceEnd - today) / (1000 * 60 * 60 * 24));
        
        message = `*Fusion Coaching - Fee Reminder*\n\n` +
                  `Dear *${student.full_name}*,\n\n` +
                  `⏰ *Fee Payment Reminder*\n\n` +
                  `You are in the grace period. *${daysLeft} days* remaining to pay.\n\n` +
                  `📋 *Details:*\n` +
                  `• Student ID: ${student.student_id}\n` +
                  `• Remaining: ₹${remainingAmount}\n` +
                  `• Grace Period Ends: ${graceEnd.toLocaleDateString()}\n\n` +
                  `💡 Pay now to avoid account restrictions.\n\n` +
                  `📞 Contact: +91 87005 17172\n` +
                  `🏫 Fusion Coaching, Bharat City`;
      } else {
        message = `*Fusion Coaching - Fee Reminder*\n\n` +
                  `Dear *${student.full_name}*,\n\n` +
                  `📌 *Fee Payment Reminder*\n\n` +
                  `Your fee of *₹${remainingAmount}* is pending.\n\n` +
                  `📋 *Details:*\n` +
                  `• Student ID: ${student.student_id}\n` +
                  `• Due Date: ${dueDate.toLocaleDateString()}\n\n` +
                  `📞 Contact: +91 87005 17172\n` +
                  `🏫 Fusion Coaching, Bharat City`;
      }

      try {
        const phoneNumber = student.phone.replace(/[^0-9]/g, '');
        const formattedPhone = phoneNumber.startsWith('91') ? phoneNumber : `91${phoneNumber}`;
        
        await client.sendMessage(`${formattedPhone}@c.us`, message);
        console.log(`Fee reminder sent to ${student.full_name} (${formattedPhone})`);
        
        // Log notification in database
        await pool.query(
          `INSERT INTO notifications (user_id, title, message, notification_type)
           SELECT user_id, 'Fee Reminder', $1, 'fee'
           FROM students WHERE id = $2`,
          [`Remaining fee: ₹${remainingAmount}`, student.id]
        );
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (sendError) {
        console.error(`Failed to send message to ${student.full_name}:`, sendError.message);
      }
    }
  } catch (error) {
    console.error('Error sending fee reminders:', error);
  }
}

// Check and handle grace period expiry
async function checkGracePeriodExpiry() {
  try {
    const result = await pool.query(`
      SELECT s.id, s.student_id, s.fee_due_date, s.grace_period_days,
             u.full_name, u.phone
      FROM students s
      JOIN users u ON s.user_id = u.id
      WHERE s.fee_status = 'grace_period'
    `);

    for (const student of result.rows) {
      const dueDate = new Date(student.fee_due_date);
      const graceEnd = new Date(dueDate);
      graceEnd.setDate(graceEnd.getDate() + student.grace_period_days);
      
      if (new Date() > graceEnd) {
        // Grace period expired - lock account
        await pool.query(`
          UPDATE students 
          SET fee_status = 'overdue', is_locked = true, 
              lock_reason = 'Fee payment overdue - grace period expired'
          WHERE id = $1
        `, [student.id]);

        // Send lock notification
        if (student.phone) {
          const phoneNumber = student.phone.replace(/[^0-9]/g, '');
          const formattedPhone = phoneNumber.startsWith('91') ? phoneNumber : `91${phoneNumber}`;
          
          const message = `*Fusion Coaching - Account Locked*\n\n` +
                         `Dear *${student.full_name}*,\n\n` +
                         `🔒 *Your account has been locked*\n\n` +
                         `Your fee payment grace period has expired.\n` +
                         `Your account will remain locked until payment is made.\n\n` +
                         `📞 Contact immediately: +91 87005 17172\n` +
                         `🏫 Fusion Coaching, Bharat City`;

          try {
            await client.sendMessage(`${formattedPhone}@c.us`, message);
          } catch (e) {
            console.error(`Failed to send lock notification to ${student.full_name}`);
          }
        }

        console.log(`Account locked for student ${student.student_id}`);
      }
    }
  } catch (error) {
    console.error('Error checking grace periods:', error);
  }
}

// Handle incoming messages
client.on('message', async (msg) => {
  try {
    const contact = await msg.getContact();
    const phone = contact.number;
    
    // Check if sender is a registered user
    const userResult = await pool.query(
      'SELECT u.id, u.full_name, u.role, s.id as student_id FROM users u LEFT JOIN students s ON u.id = s.parent_id OR u.id = s.user_id WHERE u.phone = $1',
      [phone]
    );

    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      
      // Handle common queries
      const messageText = msg.body.toLowerCase();
      
      if (messageText.includes('fee') || messageText.includes('payment')) {
        if (user.student_id) {
          const feeResult = await pool.query(
            'SELECT fee_status, fee_amount, fee_paid, fee_due_date FROM students WHERE id = $1',
            [user.student_id]
          );
          const fee = feeResult.rows[0];
          const remaining = fee.fee_amount - fee.fee_paid;
          
          await msg.reply(`*Fee Details*\nStatus: ${fee.fee_status}\nTotal: ₹${fee.fee_amount}\nPaid: ₹${fee.fee_paid}\nRemaining: ₹${remaining}\nDue: ${new Date(fee.fee_due_date).toLocaleDateString()}`);
        }
      } else if (messageText.includes('attendance')) {
        await msg.reply('Please check attendance on the portal: https://fusioncoaching.in/portals/login');
      } else if (messageText.includes('marks') || messageText.includes('result')) {
        await msg.reply('Please check marks on the portal. Login at: https://fusioncoaching.in/portals/login');
      } else if (messageText.includes('help')) {
        await msg.reply(`*Fusion Coaching Help*\n\nCommands:\n• fee - Check fee status\n• attendance - Attendance info\n• marks - Exam results\n• help - Show this menu\n\n📞 Call: +91 87005 17172`);
      }
    } else {
      // Unknown sender
      await msg.reply(`*Fusion Coaching*\n\nWelcome! For admissions and inquiries, please call:\n📞 +91 87005 17172\n\nOr visit: https://fusioncoaching.in`);
    }
  } catch (error) {
    console.error('Error handling message:', error);
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down WhatsApp bot...');
  await client.destroy();
  await pool.end();
  process.exit(0);
});

console.log('Fusion Coaching WhatsApp Bot starting...');
