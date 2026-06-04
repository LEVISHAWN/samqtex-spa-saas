import express from "express";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import db from './src/db.js';
import { createServer } from "http";
import { Server } from "socket.io";
import cron from "node-cron";
import Stripe from "stripe";
import multer from "multer";

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-for-samqtex';
const DEFAULT_ADMIN_PASSWORD = 'SamQtex+123';
const DEFAULT_ADMIN_PASSWORD_HASH = bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 10);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

// --- Multer Configuration ---
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

async function startServer() {
  // --- Bootstrap Default Admin ---
  try {
    const adminExists = await db.prepare('SELECT id FROM users WHERE username = ? AND role = ?').get('admin', 'admin');
    if (!adminExists) {
      // Ensure tenant 1 exists
      const tenant1Exists = await db.prepare('SELECT id FROM tenants WHERE id = ?').get(1);
      if (!tenant1Exists) {
        await db.execute('INSERT INTO tenants (id, name, subdomain) VALUES (1, ?, ?)', ['SamQtex Spa', 'admin']);
      }
      await db.execute(
        'INSERT INTO users (tenant_id, username, name, email, password, role, is_first_login) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [1, 'admin', 'Super Admin', 'admin@samqtex.com', DEFAULT_ADMIN_PASSWORD_HASH, 'admin', true]
      );
      console.log('Default admin user created.');
    }
    // Add image_url to services if not exists
    try {
      await db.execute('ALTER TABLE services ADD COLUMN image_url TEXT');
    } catch (e) { /* column might already exist */ }

    // Create branches table for location management
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS branches (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenant_id INT NOT NULL,
          name VARCHAR(255) NOT NULL,
          address TEXT,
          phone VARCHAR(50),
          latitude DECIMAL(10,8),
          longitude DECIMAL(11,8),
          is_active TINYINT(1) DEFAULT 1,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        )
      `);
    } catch (e) { console.error('Error creating branches table:', e); }

    // Add location/contact columns to settings table if not present
    const settingsAlters = [
      "ALTER TABLE settings ADD COLUMN latitude DECIMAL(10,8) DEFAULT NULL",
      "ALTER TABLE settings ADD COLUMN longitude DECIMAL(11,8) DEFAULT NULL",
      "ALTER TABLE settings ADD COLUMN address TEXT DEFAULT NULL",
      "ALTER TABLE settings ADD COLUMN phone VARCHAR(50) DEFAULT NULL",
    ];
    for (const sql of settingsAlters) {
      try { await db.execute(sql); } catch (e) { /* column already exists */ }
    }

    // Create subscribers table if not exists
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS subscribers (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenant_id INT NOT NULL,
          email VARCHAR(255),
          phone VARCHAR(50),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(tenant_id, email),
          UNIQUE(tenant_id, phone)
        )
      `);
    } catch (e) { console.error("Error creating subscribers table:", e); }

    // Create orders tables if not exists
    try {
      // Migration: Ensure logs.worker_id is nullable for guest orders
      try {
        await db.execute('ALTER TABLE logs MODIFY COLUMN worker_id INT NULL');
      } catch (e) { /* might already be nullable */ }

      await db.execute(`
        CREATE TABLE IF NOT EXISTS orders (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tenant_id INT NOT NULL,
            user_id INT,
            client_name VARCHAR(255),
            client_phone VARCHAR(50),
            total_amount DECIMAL(10, 2) NOT NULL,
            payment_method ENUM('Cash', 'M-Pesa', 'Stripe', 'Card') DEFAULT 'Cash',
            payment_status ENUM('unpaid', 'paid') DEFAULT 'unpaid',
            status ENUM('pending', 'completed', 'cancelled') DEFAULT 'pending',
            type ENUM('online', 'pos') DEFAULT 'online',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS order_items (
            id INT AUTO_INCREMENT PRIMARY KEY,
            order_id INT NOT NULL,
            product_id INT NOT NULL,
            quantity INT NOT NULL,
            price_at_sale DECIMAL(10, 2) NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
        )
      `);
    } catch (e) { console.error("Error creating order tables:", e); }
  } catch (error) {
    console.error('Error bootstrapping default admin:', error);
  }
  // --- End Bootstrap ---

  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*" }
  });
  const PORT = 3000;
  app.use(express.json());

  const tenantMiddleware = async (req: any, res: any, next: any) => {
    const tenantId = req.headers['x-tenant-id'] || '1';
    req.tenantId = tenantId;
    next();
  };
  app.use(tenantMiddleware);
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  const transporter = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS ? nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  }) : null;

  const sendEmail = async (options: { subject: string; text: string }) => {
    const emailBody = `${options.text}`;

    if (!transporter) {
      console.info('Email not sent: SMTP configuration missing.', emailBody);
      return;
    }

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: process.env.SMTP_TO || 'smaqtex@gmail.com',
      subject: options.subject,
      text: emailBody,
    });
  };

  const sendGuestBookingEmail = async (details: { name: string; phone: string; message: string; tenantId: string }) => {
    const emailBody = `New guest booking request:\n\nName: ${details.name}\nPhone: ${details.phone}\nMessage: ${details.message}\nTenant: ${details.tenantId}\n\nPlease follow up with the client as soon as possible.`;
    await sendEmail({
      subject: `SamQtex Spa Guest Booking Request from ${details.name}`,
      text: emailBody,
    });
  };

  const guestMiddleware = (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
      } catch (err) {
        // Continue as guest if token is invalid
      }
    }
    next();
  };

  const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

  // --- Cron Job: 60-Day Auto Delete ---
  cron.schedule('0 0 * * *', async () => {
    try {
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
      const formattedDate = sixtyDaysAgo.toISOString().slice(0, 19).replace('T', ' ');
      await db.execute('DELETE FROM logs WHERE timestamp < ?', [formattedDate]);
    } catch (error) {
      console.error("Cleanup job failed:", error);
    }
  });

  // --- Cron Job: Auto Expire Pending Bookings ---
  cron.schedule('*/5 * * * *', async () => { // Every 5 minutes
    try {
      await db.execute('UPDATE appointments SET status = "cancelled" WHERE status = "pending" AND expires_at < NOW()');
    } catch (error) {
      console.error("Booking expiry job failed:", error);
    }
  });

  // --- Socket.io ---
  io.on("connection", (socket) => {
    socket.on("join_room", (roomId) => socket.join(roomId));
    socket.on("send_message", async (data) => {
      const { tenant_id, sender_id, receiver_id, message } = data;
      try {
        await db.execute('INSERT INTO messages (tenant_id, sender_id, receiver_id, message) VALUES (?, ?, ?, ?)', [tenant_id, sender_id, receiver_id, message]);
        io.to(`chat_${receiver_id}`).emit("receive_message", data);
      } catch (error) { console.error(error); }
    });
  });

  // --- Auth & Admin ---
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { identifier, password, tenant_id, portal } = req.body;
      const user = await db.prepare('SELECT * FROM users WHERE (email = ? OR username = ? OR phone = ?) AND tenant_id = ?').get(identifier, identifier, identifier, tenant_id);
      if (!user) return res.status(401).json({ error: "Invalid credentials" });
      
      if (portal === 'admin' && user.role !== 'admin') {
        return res.status(403).json({ error: "Restricted to Administrators" });
      }
      if (portal === 'worker' && user.role === 'client') {
        return res.status(403).json({ error: "Restricted to Staff" });
      }

      if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: "Invalid credentials" });
      const token = jwt.sign({ id: user.id, role: user.role, tenant_id: user.tenant_id }, JWT_SECRET, { expiresIn: '24h' });
      const { password: _, ...userWithoutPassword } = user;

      // Log login activity
      const logDetails = `Logged In to ${portal || 'App'}`;
      const logHash = await generateLogHash(tenant_id, logDetails);
      await db.prepare('INSERT INTO logs (tenant_id, worker_id, action, details, log_hash) VALUES (?, ?, ?, ?, ?)').run(tenant_id, user.id, 'Auth', logDetails, logHash);

      res.json({ token, user: userWithoutPassword });

    } catch (error) { res.status(500).json({ error: "Login failed" }); }
  });

  app.post("/api/worker/setup-profile", async (req: any, res) => {
    try {
      const { id, newPassword, bio, skills } = req.body;
      const hash = bcrypt.hashSync(newPassword, 10);
      await db.execute('UPDATE users SET password = ?, bio = ?, skills = ?, is_first_login = FALSE WHERE id = ?', [hash, bio, JSON.stringify(skills), id]);
      
      const logDetails = `Initial Profile Setup Completed`;
      const logHash = await generateLogHash(req.tenantId, logDetails);
      await db.prepare('INSERT INTO logs (tenant_id, worker_id, action, details, log_hash) VALUES (?, ?, ?, ?, ?)').run(req.tenantId, id, 'Account', logDetails, logHash);
      
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Setup failed" }); }
  });

  app.post("/api/worker/profile", async (req: any, res) => {
    try {
      const { id, bio, skills, phone } = req.body;
      await db.execute('UPDATE users SET bio = ?, skills = ?, phone = ? WHERE id = ?', [bio, JSON.stringify(skills), phone, id]);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Failed to update profile" }); }
  });

  app.post("/api/worker/products/:id/deplete", async (req: any, res) => {
    try {
      await db.execute('UPDATE products SET manual_depleted = TRUE WHERE id = ?', [req.params.id]);
      await db.prepare('INSERT INTO logs (tenant_id, worker_id, action, details) VALUES (?, ?, ?, ?)').run(req.tenantId, req.body.worker_id, 'Inventory', `Flagged product ${req.params.id} as depleted`);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Failed to deplete product" }); }
  });

  app.get("/api/worker/history/:id", async (req: any, res) => {
    try {
      const id = req.params.id;
      const history = await db.prepare('SELECT * FROM logs WHERE worker_id = ? AND action LIKE "Completed %" ORDER BY timestamp DESC').all(id);
      res.json(history);
    } catch (error) { res.status(500).json({ error: "History failed" }); }
  });

  app.get("/api/admin/logs", async (req: any, res) => {
    try {
      const logs = await db.prepare(`
        SELECT l.*, u.name as worker_name 
        FROM logs l 
        LEFT JOIN users u ON l.worker_id = u.id 
        WHERE l.tenant_id = ? 
        ORDER BY l.timestamp DESC 
        LIMIT 100
      `).all(req.tenantId);
      res.json(logs);
    } catch (error) { res.status(500).json({ error: "Logs retrieval failed" }); }
  });

  app.post("/api/admin/staff", async (req: any, res) => {
    try {
      const { name, email, username, password, phone, role, commission_rate } = req.body;
      if (!name || !username || !password) return res.status(400).json({ error: "Missing required fields" });
      
      const hash = bcrypt.hashSync(password, 10);
      const result = await db.prepare('INSERT INTO users (tenant_id, name, email, username, phone, password, role, commission_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(req.tenantId, name, email || null, username, phone || null, hash, role || 'worker', commission_rate || 40);
      
      const logDetails = `Created new ${role}: ${name} (${username})`;
      const logHash = await generateLogHash(req.tenantId, logDetails);
      await db.prepare('INSERT INTO logs (tenant_id, worker_id, action, details, log_hash) VALUES (?, ?, ?, ?, ?)').run(req.tenantId, 1, 'User Management', logDetails, logHash);
      
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (error: any) { 
      console.error(error);
      if (error.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: "Username or Email already exists" });
      res.status(500).json({ error: "Failed to create staff" }); 
    }
  });

  // --- Worker Specific Routes ---
  app.post("/api/worker/attendance", async (req: any, res) => {
    try {
      const { worker_id, type, timestamp } = req.body; // type: 'clock_in' or 'clock_out'
      const ts = timestamp ? new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ') : null;
      
      if (type === 'clock_in') {
        await db.execute('INSERT INTO attendance (tenant_id, worker_id, clock_in) VALUES (?, ?, ?)', [req.tenantId, worker_id, ts || new Date()]);
        const logDetails = `Clocked In at ${ts || new Date().toLocaleString()}`;
        const logHash = await generateLogHash(req.tenantId, logDetails);
        await db.prepare('INSERT INTO logs (tenant_id, worker_id, action, details, log_hash) VALUES (?, ?, ?, ?, ?)').run(req.tenantId, worker_id, 'Attendance', logDetails, logHash);
      } else {
        await db.execute('UPDATE attendance SET clock_out = ? WHERE worker_id = ? AND clock_out IS NULL', [ts || new Date(), worker_id]);
        const logDetails = `Clocked Out at ${ts || new Date().toLocaleString()}`;
        const logHash = await generateLogHash(req.tenantId, logDetails);
        await db.prepare('INSERT INTO logs (tenant_id, worker_id, action, details, log_hash) VALUES (?, ?, ?, ?, ?)').run(req.tenantId, worker_id, 'Attendance', logDetails, logHash);
      }
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Attendance failed" }); }
  });

  app.get("/api/worker/stats/:id", async (req: any, res) => {
    try {
      const id = req.params.id;
      const today = new Date().toISOString().split('T')[0];
      const daily = await db.prepare('SELECT SUM(commission_earned) as total FROM logs WHERE worker_id = ? AND DATE(timestamp) = ?').get(id, today);
      const pending = await db.prepare('SELECT SUM(commission_earned) as total FROM logs WHERE worker_id = ? AND is_paid = 0').get(id);
      const monthly = await db.prepare('SELECT SUM(commission_earned) as total FROM logs WHERE worker_id = ? AND MONTH(timestamp) = MONTH(CURRENT_DATE())').get(id);
      res.json({ today: daily?.total || 0, pending: pending?.total || 0, monthly: monthly?.total || 0 });
    } catch (error) { res.status(500).json({ error: "Stats failed" }); }
  });

  app.get("/api/worker/products", async (req: any, res) => {
    try {
      // Strictly hiding cost_price (BP) from workers
      const products = await db.prepare('SELECT id, name, category, selling_price, stock, unit, min_threshold FROM products WHERE tenant_id = ?').all(req.tenantId);
      res.json(products);
    } catch (error) { res.status(500).json({ error: "Products failed" }); }
  });

  // --- ADMIN BI & DASHBOARD ---
  app.get("/api/admin/stats/revenue", async (req: any, res) => {
    try {
      const daily = await db.prepare('SELECT payment_method, SUM(price) as total FROM appointments WHERE tenant_id = ? AND payment_status = "paid" AND DATE(created_at) = CURRENT_DATE GROUP BY payment_method').all(req.tenantId);
      const weekly = await db.prepare('SELECT payment_method, SUM(price) as total FROM appointments WHERE tenant_id = ? AND payment_status = "paid" AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY payment_method').all(req.tenantId);
      const monthly = await db.prepare('SELECT payment_method, SUM(price) as total FROM appointments WHERE tenant_id = ? AND payment_status = "paid" AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY payment_method').all(req.tenantId);
      res.json({ daily, weekly, monthly });
    } catch (error) { res.status(500).json({ error: "Revenue stats failed" }); }
  });

  app.get("/api/admin/stats/services", async (req: any, res) => {
    try {
      const heatmap = await db.prepare('SELECT s.name, COUNT(a.id) as bookings FROM appointments a JOIN services s ON a.service_id = s.id WHERE a.tenant_id = ? GROUP BY s.id ORDER BY bookings DESC').all(req.tenantId);
      res.json(heatmap);
    } catch (error) { res.status(500).json({ error: "Service stats failed" }); }
  });

  app.get("/api/admin/stats/leaderboard", async (req: any, res) => {
    try {
      const leaders = await db.prepare('SELECT name, efficiency_score, (SELECT COUNT(*) FROM logs WHERE worker_id = users.id AND action LIKE "Completed %") as sessions FROM users WHERE tenant_id = ? AND role = "worker" ORDER BY efficiency_score DESC').all(req.tenantId);
      res.json(leaders);
    } catch (error) { res.status(500).json({ error: "Leaderboard failed" }); }
  });

  // --- ADMIN INVENTORY ---
  app.get("/api/admin/products", async (req: any, res) => {
    try {
      const products = await db.prepare('SELECT p.*, s.name as supplier_name FROM products p LEFT JOIN suppliers s ON p.supplier_id = s.id WHERE p.tenant_id = ?').all(req.tenantId);
      res.json(products);
    } catch (error) { res.status(500).json({ error: "Products failed" }); }
  });

  app.post("/api/admin/products", async (req: any, res) => {
    try {
      const { name, category, cost_price, selling_price, stock, unit, min_threshold, supplier_id, image_url, description } = req.body;
      if (!name || cost_price === undefined || selling_price === undefined) {
        return res.status(400).json({ error: "Missing required fields: name, cost_price, or selling_price" });
      }
      
      const result = await db.prepare('INSERT INTO products (tenant_id, name, category, cost_price, selling_price, stock, unit, min_threshold, supplier_id, image_url, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(req.tenantId, name, category, cost_price, selling_price, stock || 0, unit || 'unit', min_threshold || 5, supplier_id || null, image_url || null, description || null);
      
      const logDetails = `New product added: ${name} (Stock: ${stock || 0})`;
      const logHash = await generateLogHash(req.tenantId, logDetails);
      await db.prepare('INSERT INTO logs (tenant_id, worker_id, action, details, log_hash) VALUES (?, ?, ?, ?, ?)').run(req.tenantId, 1, 'Inventory', logDetails, logHash);
      
      res.json({ id: result.lastInsertRowid });
    } catch (error) { 
      console.error(error);
      res.status(500).json({ error: "Product creation failed" }); 
    }
  });

  app.put("/api/admin/products/:id", async (req: any, res) => {
    try {
      const { stock, cost_price, selling_price, reason, name, category, unit, min_threshold, image_url, description } = req.body;
      
      const oldProduct = await db.prepare('SELECT stock FROM products WHERE id = ?').get(req.params.id);
      
      await db.execute(`
        UPDATE products SET 
        name = ?, category = ?, stock = ?, cost_price = ?, selling_price = ?, unit = ?, min_threshold = ?, image_url = ?, description = ? 
        WHERE id = ?
      `, [name, category, stock, cost_price, selling_price, unit, min_threshold, image_url || null, description || null, req.params.id]);
      
      if (oldProduct && oldProduct.stock !== stock) {
        await db.prepare('INSERT INTO logs (tenant_id, worker_id, action, details) VALUES (?, ?, ?, ?)').run(req.tenantId, 1, 'Inventory Override', `Product ${req.params.id} (${name}) stock adjusted from ${oldProduct.stock} to ${stock}. Reason: ${reason || 'Not provided'}`);
      } else {
        await db.prepare('INSERT INTO logs (tenant_id, worker_id, action, details) VALUES (?, ?, ?, ?)').run(req.tenantId, 1, 'Inventory Update', `Product ${req.params.id} (${name}) details updated.`);
      }
      
      res.json({ success: true });
    } catch (error) { 
      console.error(error);
      res.status(500).json({ error: "Product update failed" }); 
    }
  });

  app.delete("/api/admin/products/:id", async (req: any, res) => {
    try {
      const product = await db.prepare('SELECT name FROM products WHERE id = ?').get(req.params.id);
      await db.execute('DELETE FROM products WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
      
      const logDetails = `Product deleted: ${product?.name || req.params.id}`;
      const logHash = await generateLogHash(req.tenantId, logDetails);
      await db.prepare('INSERT INTO logs (tenant_id, worker_id, action, details, log_hash) VALUES (?, ?, ?, ?, ?)').run(req.tenantId, 1, 'Inventory', logDetails, logHash);
      
      res.json({ success: true });
    } catch (error) { 
      console.error(error);
      res.status(500).json({ error: "Product deletion failed" }); 
    }
  });

  // --- ADMIN SERVICES ---
  app.get("/api/admin/services", async (req: any, res) => {
    try {
      const services = await db.prepare('SELECT * FROM services WHERE tenant_id = ?').all(req.tenantId);
      res.json(services);
    } catch (error) { res.status(500).json({ error: "Services failed" }); }
  });

  app.post("/api/admin/services", async (req: any, res) => {
    try {
      const { name, category, description, price, duration_minutes, buffer_time_minutes, requires_room, image_url } = req.body;
      if (!name || !category || price === undefined || duration_minutes === undefined) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      
      const result = await db.prepare('INSERT INTO services (tenant_id, category, name, description, price, duration_minutes, buffer_time_minutes, requires_room, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(req.tenantId, category, name, description, price, duration_minutes, buffer_time_minutes || 15, requires_room || false, image_url || null);
      
      const logDetails = `New service added: ${name}`;
      const logHash = await generateLogHash(req.tenantId, logDetails);
      await db.prepare('INSERT INTO logs (tenant_id, worker_id, action, details, log_hash) VALUES (?, ?, ?, ?, ?)').run(req.tenantId, 1, 'Service Management', logDetails, logHash);
      
      res.json({ id: result.lastInsertRowid });
    } catch (error) { 
      console.error(error);
      res.status(500).json({ error: "Service creation failed" }); 
    }
  });

  app.put("/api/admin/services/:id", async (req: any, res) => {
    try {
      const { name, category, description, price, duration_minutes, buffer_time_minutes, requires_room, image_url } = req.body;
      
      await db.execute(`
        UPDATE services SET 
        name = ?, category = ?, description = ?, price = ?, duration_minutes = ?, buffer_time_minutes = ?, requires_room = ?, image_url = ? 
        WHERE id = ?
      `, [name, category, description, price, duration_minutes, buffer_time_minutes, requires_room, image_url || null, req.params.id]);
      
      await db.prepare('INSERT INTO logs (tenant_id, worker_id, action, details) VALUES (?, ?, ?, ?)').run(req.tenantId, 1, 'Service Management', `Service ${req.params.id} (${name}) details updated.`);
      
      res.json({ success: true });
    } catch (error) { 
      console.error(error);
      res.status(500).json({ error: "Service update failed" }); 
    }
  });

  app.delete("/api/admin/services/:id", async (req: any, res) => {
    try {
      await db.execute('DELETE FROM services WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Service deletion failed" }); }
  });

  // --- ADMIN WORKFORCE ---
  app.get("/api/admin/staff", async (req: any, res) => {
    try {
      const staff = await db.prepare('SELECT id, name, email, username, phone, role, commission_rate, efficiency_score FROM users WHERE tenant_id = ? AND role IN ("worker", "admin")').all(req.tenantId);
      res.json(staff);
    } catch (error) { res.status(500).json({ error: "Staff retrieval failed" }); }
  });

  app.delete("/api/admin/staff/:id", async (req: any, res) => {
    try {
      // Don't allow deleting the main admin with ID 1 (safety)
      if (req.params.id === '1') {
        return res.status(403).json({ error: "Cannot delete the primary administrator" });
      }
      await db.execute('DELETE FROM users WHERE id = ? AND tenant_id = ? AND role IN ("worker", "admin")', [req.params.id, req.tenantId]);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Staff deletion failed" }); }
  });

  app.post("/api/admin/staff/payout/:logId", async (req: any, res) => {
    try {
      await db.execute('UPDATE logs SET is_paid = 1 WHERE id = ?', [req.params.logId]);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Payout failed" }); }
  });

  app.get("/api/admin/attendance", async (req: any, res) => {
    try {
      const attendance = await db.prepare('SELECT a.*, u.name as worker_name FROM attendance a JOIN users u ON a.worker_id = u.id WHERE a.tenant_id = ? ORDER BY a.clock_in DESC').all(req.tenantId);
      res.json(attendance);
    } catch (error) { res.status(500).json({ error: "Attendance failed" }); }
  });

  // --- ADMIN CRM ---
  app.get("/api/admin/clients", async (req: any, res) => {
    try {
      const clients = await db.prepare(`
        SELECT id, name, email, phone, created_at, 'registered' as type 
        FROM users 
        WHERE tenant_id = ? AND role = "client"
        UNION
        SELECT id, 'Subscriber' as name, email, phone, created_at, 'lead' as type
        FROM subscribers
        WHERE tenant_id = ?
        ORDER BY created_at DESC
      `).all(req.tenantId, req.tenantId);
      res.json(clients);
    } catch (error) { res.status(500).json({ error: "Clients failed" }); }
  });

  app.get("/api/admin/chat-logs", async (req: any, res) => {
    try {
      const chatLogs = await db.prepare(`
        SELECT m.*, u1.name as sender_name, u2.name as receiver_name 
        FROM messages m 
        JOIN users u1 ON m.sender_id = u1.id 
        JOIN users u2 ON m.receiver_id = u2.id 
        WHERE m.tenant_id = ? 
        ORDER BY m.timestamp DESC
      `).all(req.tenantId);
      res.json(chatLogs);
    } catch (error) { res.status(500).json({ error: "Chat logs failed" }); }
  });

  app.post("/api/admin/marketing-broadcast", async (req: any, res) => {
    try {
      const { message } = req.body;
      const clients = await db.prepare('SELECT id FROM users WHERE tenant_id = ? AND role = "client"').all(req.tenantId);
      for (const client of clients) {
        await db.execute('INSERT INTO messages (tenant_id, sender_id, receiver_id, message) VALUES (?, ?, ?, ?)', [req.tenantId, 1, client.id, message]);
      }
      res.json({ success: true, count: clients.length });
    } catch (error) { res.status(500).json({ error: "Broadcast failed" }); }
  });

  // --- BROADCAST MESSAGES FOR CLIENTS ---
  app.get("/api/broadcasts", guestMiddleware, async (req: any, res) => {
    try {
      const tenantId = req.tenantId || '1';
      let broadcasts: any[] = [];

      if (req.user && req.user.id) {
        // Authenticated client - get their broadcasts
        broadcasts = await db.prepare(
          'SELECT id, message, timestamp FROM messages WHERE tenant_id = ? AND receiver_id = ? AND sender_id = 1 ORDER BY timestamp DESC LIMIT 50'
        ).all(tenantId, req.user.id);
      } else {
        // Guest/subscriber - get latest broadcasts for all
        broadcasts = await db.prepare(
          'SELECT id, message, timestamp FROM messages WHERE tenant_id = ? AND sender_id = 1 ORDER BY timestamp DESC LIMIT 10'
        ).all(tenantId);
      }

      res.json(broadcasts);
    } catch (error) {
      console.error('Broadcasts fetch failed:', error);
      res.status(500).json({ error: "Failed to fetch broadcasts" });
    }
  });

  // --- ADMIN SECURITY & CCTV ---
  app.get("/api/admin/cctv", async (req: any, res) => {
    try {
      const feeds = await db.prepare('SELECT * FROM cctv_feeds WHERE tenant_id = ?').all(req.tenantId);
      res.json(feeds);
    } catch (error) { res.status(500).json({ error: "CCTV failed" }); }
  });

  app.post("/api/admin/cctv", async (req: any, res) => {
    try {
      const { name, feed_url } = req.body;
      await db.prepare('INSERT INTO cctv_feeds (tenant_id, name, feed_url) VALUES (?, ?, ?)').run(req.tenantId, name, feed_url);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "CCTV add failed" }); }
  });

  // --- FILE UPLOAD ---
  app.post("/api/admin/upload", upload.single('image'), (req: any, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const url = `/uploads/${req.file.filename}`;
    res.json({ url });
  });

  // --- ADMIN SETTINGS ---
  app.post("/api/admin/settings", async (req: any, res) => {
    try {
      const { salon_name, logo_url, primary_color, secondary_color, data_retention_days, latitude, longitude, address, phone } = req.body;
      await db.execute(`
        UPDATE settings SET 
        salon_name = ?, logo_url = ?, primary_color = ?, secondary_color = ?, data_retention_days = ?,
        latitude = ?, longitude = ?, address = ?, phone = ?
        WHERE tenant_id = ?
      `, [salon_name, logo_url, primary_color, secondary_color, data_retention_days,
          latitude || null, longitude || null, address || null, phone || null,
          req.tenantId]);
      res.json({ success: true });
    } catch (error) { console.error(error); res.status(500).json({ error: "Settings update failed" }); }
  });

  // --- ADMIN ROSTER ---
  app.get("/api/admin/schedules", async (req: any, res) => {
    try {
      const schedules = await db.prepare('SELECT s.*, u.name as worker_name FROM schedules s JOIN users u ON s.worker_id = u.id WHERE s.tenant_id = ?').all(req.tenantId);
      res.json(schedules);
    } catch (error) { res.status(500).json({ error: "Schedules failed" }); }
  });

  app.post("/api/admin/schedules", async (req: any, res) => {
    try {
      const { worker_id, day_of_week, start_time, end_time, is_off } = req.body;
      await db.prepare('INSERT INTO schedules (tenant_id, worker_id, day_of_week, start_time, end_time, is_off) VALUES (?, ?, ?, ?, ?, ?)').run(req.tenantId, worker_id, day_of_week, start_time, end_time, is_off);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Schedule creation failed" }); }
  });

  // --- BRANCH / LOCATION MANAGEMENT ---
  // Public: clients can see active branch locations
  app.get("/api/branches", guestMiddleware, async (req: any, res) => {
    try {
      const branches = await db.prepare('SELECT id, name, address, phone, latitude, longitude FROM branches WHERE tenant_id = ? AND is_active = 1').all(req.tenantId);
      res.json(branches);
    } catch (error) { res.status(500).json({ error: "Failed to fetch branches" }); }
  });

  // Admin: all branches including inactive
  app.get("/api/admin/branches", async (req: any, res) => {
    try {
      const branches = await db.prepare('SELECT * FROM branches WHERE tenant_id = ? ORDER BY created_at ASC').all(req.tenantId);
      res.json(branches);
    } catch (error) { res.status(500).json({ error: "Failed to fetch branches" }); }
  });

  // Admin: create new branch
  app.post("/api/admin/branches", async (req: any, res) => {
    try {
      const { name, address, phone, latitude, longitude, is_active } = req.body;
      if (!name) return res.status(400).json({ error: "Branch name is required" });
      const result = await db.prepare('INSERT INTO branches (tenant_id, name, address, phone, latitude, longitude, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)').run(req.tenantId, name, address || null, phone || null, latitude || null, longitude || null, is_active !== false ? 1 : 0);
      const logDetails = `Branch created: ${name}`;
      const logHash = await generateLogHash(req.tenantId, logDetails);
      await db.prepare('INSERT INTO logs (tenant_id, worker_id, action, details, log_hash) VALUES (?, ?, ?, ?, ?)').run(req.tenantId, 1, 'Branch Management', logDetails, logHash);
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) { console.error(error); res.status(500).json({ error: "Failed to create branch" }); }
  });

  // Admin: update branch (name, address, lat/lng, active status)
  app.put("/api/admin/branches/:id", async (req: any, res) => {
    try {
      const { name, address, phone, latitude, longitude, is_active } = req.body;
      await db.execute('UPDATE branches SET name = ?, address = ?, phone = ?, latitude = ?, longitude = ?, is_active = ? WHERE id = ? AND tenant_id = ?',
        [name, address || null, phone || null, latitude || null, longitude || null, is_active ? 1 : 0, req.params.id, req.tenantId]);
      const logDetails = `Branch updated: ${name} (ID: ${req.params.id})`;
      const logHash = await generateLogHash(req.tenantId, logDetails);
      await db.prepare('INSERT INTO logs (tenant_id, worker_id, action, details, log_hash) VALUES (?, ?, ?, ?, ?)').run(req.tenantId, 1, 'Branch Management', logDetails, logHash);
      res.json({ success: true });
    } catch (error) { console.error(error); res.status(500).json({ error: "Failed to update branch" }); }
  });

  // Admin: delete branch
  app.delete("/api/admin/branches/:id", async (req: any, res) => {
    try {
      await db.execute('DELETE FROM branches WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
      await db.prepare('INSERT INTO logs (tenant_id, worker_id, action, details) VALUES (?, ?, ?, ?)').run(req.tenantId, 1, 'Branch Management', `Branch ID ${req.params.id} deleted`);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Failed to delete branch" }); }
  });

  // --- General Routes ---
  app.get("/api/appointments/available-slots", async (req: any, res) => {
    try {
      const { date, service_id, worker_id } = req.query;
      if (!date || !service_id) return res.status(400).json({ error: "Date and Service required" });
      
      const service = await db.prepare('SELECT * FROM services WHERE id = ? AND tenant_id = ?').get(service_id, req.tenantId);
      if (!service) return res.status(404).json({ error: "Service not found" });

      const totalDuration = service.duration_minutes + service.buffer_time_minutes;
      
      let query = 'SELECT start_time, end_time FROM appointments WHERE date = ? AND status != "cancelled" AND tenant_id = ?';
      const params: any[] = [date, req.tenantId];
      if (worker_id && worker_id !== 'any') { query += ' AND worker_id = ?'; params.push(worker_id); }
      
      const bookings = await db.prepare(query).all(...params);
      const slots = [];
      let currentMinutes = 9 * 60; // 9:00 AM
      const endMinutes = 17 * 60; // 5:00 PM
      
      while (currentMinutes + totalDuration <= endMinutes) {
        let isAvailable = true;
        for (const b of bookings) {
          if (!b.start_time || !b.end_time) continue;
          const bStartParts = b.start_time.split(':');
          const bEndParts = b.end_time.split(':');
          const bStartMins = parseInt(bStartParts[0]) * 60 + parseInt(bStartParts[1]);
          const bEndMins = parseInt(bEndParts[0]) * 60 + parseInt(bEndParts[1]) + service.buffer_time_minutes;
          
          if ((currentMinutes >= bStartMins && currentMinutes < bEndMins) || 
              (currentMinutes + totalDuration > bStartMins && currentMinutes + totalDuration <= bEndMins) || 
              (currentMinutes <= bStartMins && currentMinutes + totalDuration >= bEndMins)) {
             isAvailable = false; break;
          }
        }
        if (isAvailable) {
          slots.push(`${String(Math.floor(currentMinutes / 60)).padStart(2, '0')}:${String(currentMinutes % 60).padStart(2, '0')}:00`);
        }
        currentMinutes += 30; // 30 min intervals
      }
      res.json(slots);
    } catch (error) { res.status(500).json({ error: "Slots failed" }); }
  });

  app.get("/api/appointments/client/:phone", guestMiddleware, async (req: any, res) => {
    try {
      const appointments = await db.prepare(`
        SELECT a.*, s.name as service_name 
        FROM appointments a 
        JOIN services s ON a.service_id = s.id 
        WHERE a.client_phone = ? AND a.tenant_id = ? 
        ORDER BY a.date DESC, a.start_time DESC
      `).all(req.params.phone, req.tenantId);
      res.json(appointments);
    } catch (error) { res.status(500).json({ error: "History retrieval failed" }); }
  });

  app.post("/api/ai-stylist", guestMiddleware, async (req: any, res) => {
    try {
      if (!process.env.GEMINI_API_KEY) {
        return res.status(503).json({ error: "AI service not configured" });
      }
      const { prompt } = req.body;
      const model = ai.getGenerativeModel({ model: "gemini-2.0-flash" });
      const result = await model.generateContent(`LuxeBeauty AI Stylist: ${prompt}`);
      const text = result.response.text();
      res.json({ reply: text || "Sorry, I couldn't process that request right now." });
    } catch (error: any) {
      console.error("AI endpoint error:", error);
      res.status(500).json({ error: "AI failed", details: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
  });

  app.post("/api/subscribe", guestMiddleware, async (req: any, res) => {
    try {
      const { email, phone } = req.body;
      const tenantId = req.tenantId || '1';
      await db.execute('INSERT INTO subscribers (tenant_id, email, phone) VALUES (?, ?, ?)', [tenantId, email, phone]);
      res.json({ success: true, message: "Subscribed successfully!" });
    } catch (error: any) {
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ error: "Already subscribed!" });
      }
      res.status(500).json({ error: "Subscription failed" });
    }
  });

  app.post("/api/quick-booking", guestMiddleware, async (req: any, res) => {
    try {
      const { name, phone, message } = req.body;
      if (!name || !phone) {
        return res.status(400).json({ error: 'Name and phone number are required.' });
      }

      await sendGuestBookingEmail({
        name: String(name).trim(),
        phone: String(phone).trim(),
        message: String(message || 'I would like to book an appointment. Please reach out.'),
        tenantId: req.tenantId || '1',
      });

      res.json({ success: true, message: 'Booking request sent successfully.' });
    } catch (error) {
      console.error('Quick booking email error:', error);
      res.status(500).json({ error: 'Failed to send booking request.' });
    }
  });

  // Unified booking handler — supports both the legacy web-form fields
  // (name, email, service, date, time, notes) and the Vercel-style quick
  // fields (name, phone, request). Both sets of fields are optional except
  // for `name` which is always required.
  app.post('/api/booking', async (req: any, res: any) => {
    try {
      // Support both field naming conventions
      const {
        name,
        email,
        service,
        date,
        time,
        notes,
        // Vercel-handler-style aliases
        phone,
        request: requestNotes,
      } = req.body;

      if (!name) {
        return res.status(400).json({ success: false, error: 'Name is required.' });
      }

      // Build an email body from whichever fields were submitted
      const lines: string[] = [
        `Full Name : ${name}`,
      ];
      if (phone)        lines.push(`Phone     : ${phone}`);
      if (email)        lines.push(`Email     : ${email}`);
      if (service)      lines.push(`Service   : ${service}`);
      if (date)         lines.push(`Date      : ${date}`);
      if (time)         lines.push(`Time      : ${time}`);
      const notesText = requestNotes || notes;
      if (notesText)    lines.push(`Notes     : ${notesText}`);
      lines.push(`Tenant ID : ${req.tenantId || '1'}`);

      const emailBody = `New Booking Request:\n\n${lines.join('\n')}`;

      await sendEmail({
        subject: `New Booking Request from ${name}`,
        text: emailBody,
      });

      return res.status(200).json({ success: true, message: 'Booking email sent successfully!' });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/orders", guestMiddleware, async (req: any, res) => {
    try {
      const { items, total_amount, payment_method, client_name, client_phone, type } = req.body;
      const tenantId = req.tenantId || '1';
      const userId = req.user?.id || null;

      // 1. Verify Stock
      for (const item of items) {
        const product = await db.prepare('SELECT stock, name FROM products WHERE id = ?').get(item.id);
        // Convert stock to number as DECIMAL might return string
        if (!product || Number(product.stock) < item.quantity) {
          return res.status(400).json({ error: `Insufficient stock for ${product?.name || 'product'}` });
        }
      }

      // 2. Create Order
      const orderResult = await db.prepare(`
        INSERT INTO orders (tenant_id, user_id, client_name, client_phone, total_amount, payment_method, payment_status, status, type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        tenantId, userId, client_name, client_phone, total_amount, 
        payment_method, (payment_method === 'Cash' || payment_method === 'Card') ? 'paid' : 'unpaid',
        'completed', type || 'online'
      );
      
      const orderId = orderResult.lastInsertRowid;

      // 3. Create Items & Update Stock
      for (const item of items) {
        await db.execute('INSERT INTO order_items (order_id, product_id, quantity, price_at_sale) VALUES (?, ?, ?, ?)', [orderId, item.id, item.quantity, item.selling_price]);
        await db.execute('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.id]);
      }

      // 4. Log the sale
      const logDetails = `Retail Sale: Order #${orderId} (${type || 'online'}) - ${items.length} items`;
      const logHash = await generateLogHash(tenantId, logDetails);
      await db.prepare('INSERT INTO logs (tenant_id, worker_id, action, details, log_hash) VALUES (?, ?, ?, ?, ?)')
        .run(tenantId, userId, 'Inventory', logDetails, logHash);

      res.json({ success: true, orderId });
    } catch (error) { 
      console.error(error);
      res.status(500).json({ error: "Order failed" }); 
    }
  });

  app.get("/api/orders/my", guestMiddleware, async (req: any, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    try {
      const orders = await db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
      res.json(orders);
    } catch (error) { res.status(500).json({ error: "Failed to fetch orders" }); }
  });

  app.get("/api/admin/orders", async (req: any, res) => {
    try {
      const orders = await db.prepare('SELECT * FROM orders WHERE tenant_id = ? ORDER BY created_at DESC').all(req.tenantId);
      res.json(orders);
    } catch (error) { res.status(500).json({ error: "Failed to fetch all orders" }); }
  });

  app.get("/api/services", guestMiddleware, async (req: any, res) => {
    try {
      const services = await db.prepare('SELECT * FROM services WHERE tenant_id = ?').all(req.tenantId);
      res.json(services);
    } catch (error) { res.status(500).json({ error: "Services failed" }); }
  });

  app.get("/api/workers", guestMiddleware, async (req: any, res) => {
    try {
      const workers = await db.prepare('SELECT id, name, tier FROM users WHERE tenant_id = ? AND role = "worker"').all(req.tenantId);
      res.json(workers);
    } catch (error) { res.status(500).json({ error: "Workers failed" }); }
  });

  app.get("/api/products", guestMiddleware, async (req: any, res) => {
    try {
      const products = await db.prepare('SELECT id, name, category, selling_price, stock, unit FROM products WHERE tenant_id = ?').all(req.tenantId);
      res.json(products);
    } catch (error) { res.status(500).json({ error: "Products failed" }); }
  });

  app.post("/api/appointments", guestMiddleware, async (req: any, res) => {
    try {
      const { client_name, client_phone, service_id, worker_id, date, start_time, notes, options_selected } = req.body;
      const client_id = req.user?.id || null;
      
      const service = await db.prepare('SELECT duration_minutes, buffer_time_minutes, price FROM services WHERE id = ?').get(service_id);
      if (!service) return res.status(404).json({ error: "Service not found" });
      
      let finalPrice = parseFloat(service.price);
      let assigned_worker_id = worker_id;
      
      if (worker_id && worker_id !== 'any') {
         const worker = await db.prepare('SELECT tier FROM users WHERE id = ?').get(worker_id);
         if (worker) {
           if (worker.tier === 'senior') finalPrice *= 1.20;
           if (worker.tier === 'master') finalPrice *= 1.50;
         }
      } else {
         const best = await db.prepare('SELECT id, tier FROM users WHERE tenant_id = ? AND role = "worker" ORDER BY efficiency_score DESC LIMIT 1').get(req.tenantId);
         if (best) {
           assigned_worker_id = best.id;
           if (best.tier === 'senior') finalPrice *= 1.20;
           if (best.tier === 'master') finalPrice *= 1.50;
         }
      }

      const startParts = start_time.split(':');
      const startMins = parseInt(startParts[0]) * 60 + parseInt(startParts[1]);
      const endMins = startMins + service.duration_minutes;
      const end_time = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}:00`;

      // Check stock
      const products = await db.prepare('SELECT * FROM service_products WHERE service_id = ?').all(service_id);
      for (const p of products) {
        const item = await db.prepare('SELECT stock FROM products WHERE id = ? AND tenant_id = ?').get(p.product_id, req.tenantId);
        if (!item || item.stock < p.estimated_amount) return res.status(400).json({ error: "Insufficient inventory" });
      }

      const result = await db.execute(`
        INSERT INTO appointments 
        (tenant_id, client_id, client_name, client_phone, service_id, worker_id, date, start_time, end_time, notes, options_selected, payment_status, status) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', 'confirmed')
      `, [req.tenantId, client_id || null, client_name, client_phone, service_id, assigned_worker_id || null, date, start_time, end_time, notes || null, JSON.stringify(options_selected || {})]);
      
      const insertId = (result as any)[0].insertId;
      await db.prepare('INSERT INTO logs (tenant_id, worker_id, action, details) VALUES (?, ?, ?, ?)').run(req.tenantId, assigned_worker_id || 1, 'Booking Created', `Booking ${insertId} confirmed without payment.`);

      await sendEmail({
        subject: `SamQtex Spa Appointment Booking from ${client_name}`,
        text: `New appointment booking:\n\nName: ${client_name}\nPhone: ${client_phone}\nService ID: ${service_id}\nDate: ${date}\nTime: ${start_time}\nWorker ID: ${assigned_worker_id || 'any'}\nNotes: ${notes || 'None'}\nTenant: ${req.tenantId}\nAppointment ID: ${insertId}`,
      });

      res.json({ success: true, appointmentId: insertId, final_price: finalPrice });
    } catch (error) { res.status(500).json({ error: "Failed to book" }); }
  });

  app.post("/api/payments/mpesa/callback", async (req: any, res) => {
    try {
       const { transaction_id } = req.body;
       const apt = await db.prepare('SELECT * FROM appointments WHERE transaction_id = ?').get(transaction_id);
       if (!apt) return res.status(404).json({ error: 'Not found' });

       await db.execute('UPDATE appointments SET status = "confirmed", payment_status = "paid" WHERE transaction_id = ?', [transaction_id]);
       const products = await db.prepare('SELECT * FROM service_products WHERE service_id = ?').all(apt.service_id);
       for (const p of products) await db.execute('UPDATE products SET stock = GREATEST(0, stock - ?) WHERE id = ?', [p.estimated_amount, p.product_id]);

       await db.prepare('INSERT INTO logs (tenant_id, worker_id, action, details) VALUES (?, ?, ?, ?)').run(apt.tenant_id, apt.worker_id || 1, 'Payment Confirm', `Booking ${apt.id} confirmed and stock deducted.`);
       res.json({ success: true });
    } catch(err) { res.status(500).send("Error"); }
  });

  app.get("/api/services", async (req: any, res) => {
    try {
      const services = await db.prepare('SELECT * FROM services WHERE tenant_id = ?').all(req.tenantId);
      res.json(services);
    } catch (error) { res.status(500).json({ error: "Services failed" }); }
  });

  app.get("/api/appointments/worker/:id", async (req: any, res) => {
    try {
      const appointments = await db.prepare(`
        SELECT a.*, s.name as service_name 
        FROM appointments a 
        JOIN services s ON a.service_id = s.id 
        WHERE a.worker_id = ? AND a.tenant_id = ? 
        ORDER BY a.date ASC, a.start_time ASC
      `).all(req.params.id, req.tenantId);
      res.json(appointments);
    } catch (error) { res.status(500).json({ error: "Appointments failed" }); }
  });

  const generateLogHash = async (tenantId: any, details: string) => {
    try {
      const lastLog = await db.prepare('SELECT log_hash FROM logs WHERE tenant_id = ? ORDER BY timestamp DESC LIMIT 1').get(tenantId);
      const prevHash = lastLog?.log_hash || 'genesis-hash';
      return crypto.createHash('sha256').update(prevHash + details).digest('hex');
    } catch { return 'hash-error'; }
  };

  app.post("/api/logs", async (req: any, res) => {
    try {
      const { worker_id, action, details, commission_earned, product_ids, appointment_id, payment_method } = req.body;
      const logHash = await generateLogHash(req.tenantId, details);
      
      const result = await db.prepare('INSERT INTO logs (tenant_id, worker_id, action, details, commission_earned, log_hash) VALUES (?, ?, ?, ?, ?, ?)').run(req.tenantId, worker_id, action, details, commission_earned, logHash);
      
      if (Array.isArray(product_ids) && product_ids.length > 0) {
        for (const pid of product_ids) {
          const prod = await db.prepare('SELECT consumption_per_service FROM products WHERE id = ?').get(pid);
          const amount = prod?.consumption_per_service ? Number(prod.consumption_per_service) : 1.0;
          await db.execute('UPDATE products SET stock = GREATEST(0, stock - ?) WHERE id = ?', [amount, pid]);
        }
      }

      if (appointment_id) {
        await db.execute('UPDATE appointments SET status = "completed", payment_status = "paid", payment_method = ? WHERE id = ?', [payment_method || 'Cash', appointment_id]);
      }

      res.json({ id: result.lastInsertRowid });
    } catch (error) { 
      console.error(error);
      res.status(500).json({ error: "Log failed" }); 
    }
  });

  app.post("/api/worker/ai-upsell", async (req, res) => {
    try {
      const { request } = req.body;
      const prompt = `Staff Tool: Based on this request "${request}", suggest 2 specific salon services or products to upsell for higher revenue. Be concise.`;
      const result = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: prompt
      });
      res.json({ suggestion: result.text || "No suggestions at the moment." });
    } catch (error) { res.status(500).json({ error: "AI failed" }); }
  });

  app.put("/api/appointments/:id/status", async (req, res) => {
    try {
      await db.execute('UPDATE appointments SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Status update failed" }); }
  });

  app.get("/api/settings", async (req: any, res) => {
    try {
      const settings = await db.prepare('SELECT * FROM settings WHERE tenant_id = ?').get(req.tenantId);
      res.json(settings);
    } catch (error) { res.status(500).json({ error: "Settings failed" }); }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), 'dist')));
    app.get('*all', (req, res) => res.sendFile(path.join(process.cwd(), 'dist', 'index.html')));
  }

  httpServer.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));
}

startServer();
