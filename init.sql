CREATE DATABASE IF NOT EXISTS samqtex;
USE samqtex;

CREATE TABLE IF NOT EXISTS tenants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    subdomain VARCHAR(255) UNIQUE,
    subscription_status ENUM('active', 'suspended', 'trial') DEFAULT 'trial',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT,
    username VARCHAR(255),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    password VARCHAR(255) NOT NULL,
    is_first_login BOOLEAN DEFAULT TRUE,
    role ENUM('admin', 'worker', 'client') NOT NULL DEFAULT 'client',
    tier ENUM('junior', 'senior', 'master') NOT NULL DEFAULT 'junior',
    bio TEXT,
    skills JSON,
    no_shows INT DEFAULT 0,
    efficiency_score DECIMAL(3, 2) DEFAULT 0.0,
    commission_rate DECIMAL(5, 2) DEFAULT 40.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, username),
    UNIQUE(tenant_id, email)
);

CREATE TABLE IF NOT EXISTS settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    salon_name VARCHAR(255) DEFAULT 'SamQtex Spa',
    logo_url TEXT,
    primary_color VARCHAR(50) DEFAULT '#D4AF37',
    secondary_color VARCHAR(50) DEFAULT '#9A4C58',
    setup_completed BOOLEAN DEFAULT FALSE,
    stripe_key_id VARCHAR(255),
    mpesa_shortcode VARCHAR(255),
    paypal_client_id VARCHAR(255),
    data_retention_days INT DEFAULT 60,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS services (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    category VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    duration_minutes INT NOT NULL,
    buffer_time_minutes INT DEFAULT 15,
    requires_room BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS service_options (
    id INT AUTO_INCREMENT PRIMARY KEY,
    service_id INT NOT NULL,
    option_name VARCHAR(255) NOT NULL,
    option_values JSON NOT NULL,
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS suppliers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    phone VARCHAR(50),
    email VARCHAR(255),
    category VARCHAR(255),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(255),
    description TEXT,
    cost_price DECIMAL(10, 2) NOT NULL, -- BP
    selling_price DECIMAL(10, 2) NOT NULL, -- SP
    stock DECIMAL(10, 2) NOT NULL DEFAULT 0,
    unit VARCHAR(50) DEFAULT 'unit', -- ml, pcs, etc
    consumption_per_service DECIMAL(10, 2) DEFAULT 1.0,
    min_threshold INT NOT NULL DEFAULT 5,
    supplier_id INT,
    image_url TEXT,
    manual_depleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    worker_id INT, -- Nullable for guest or system actions
    action VARCHAR(255) NOT NULL,
    details TEXT,
    log_hash VARCHAR(255),
    commission_earned DECIMAL(10, 2) DEFAULT 0,
    is_paid BOOLEAN DEFAULT FALSE,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (worker_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attendance (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    worker_id INT NOT NULL,
    clock_in TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    clock_out TIMESTAMP NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (worker_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS schedules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    worker_id INT NOT NULL,
    day_of_week ENUM('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'),
    start_time TIME,
    end_time TIME,
    is_off BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (worker_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS appointments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    client_id INT,
    client_name VARCHAR(255) NOT NULL,
    client_phone VARCHAR(50) NOT NULL,
    service_id INT NOT NULL,
    worker_id INT,
    date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    status ENUM('pending', 'confirmed', 'completed', 'cancelled') DEFAULT 'pending',
    notes TEXT,
    options_selected JSON,
    payment_status ENUM('unpaid', 'paid') DEFAULT 'unpaid',
    payment_method ENUM('M-Pesa', 'Cash', 'Card') DEFAULT 'Cash',
    transaction_id VARCHAR(255),
    expires_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
    FOREIGN KEY (worker_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS service_products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    service_id INT NOT NULL,
    product_id INT NOT NULL,
    estimated_amount INT DEFAULT 1,
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    sender_id INT NOT NULL,
    receiver_id INT NOT NULL,
    message TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    user_id INT, -- NULL for guests
    client_name VARCHAR(255),
    client_phone VARCHAR(50),
    total_amount DECIMAL(10, 2) NOT NULL,
    payment_method ENUM('Cash', 'M-Pesa', 'Stripe', 'Card') DEFAULT 'Cash',
    payment_status ENUM('unpaid', 'paid') DEFAULT 'unpaid',
    status ENUM('pending', 'completed', 'cancelled') DEFAULT 'pending',
    type ENUM('online', 'pos') DEFAULT 'online',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    price_at_sale DECIMAL(10, 2) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS subscribers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, email),
    UNIQUE(tenant_id, phone)
);

CREATE TABLE IF NOT EXISTS cctv_feeds (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    feed_url TEXT NOT NULL,
    status ENUM('active', 'inactive') DEFAULT 'active',
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Seed Initial Admin (Password: SamQtex+123)
INSERT INTO tenants (id, name, subdomain) VALUES (1, 'SamQtex Spa', 'admin');
INSERT INTO users (tenant_id, username, name, email, password, role, is_first_login) 
VALUES (1, 'admin', 'Super Admin', 'admin@samqtex.com', '$2b$10$q0I7tcMvNQ4gGZrMpZq6FOM4X4XYwFq5D/GKtwCnM/BDn9ufGkloS', 'admin', TRUE);
-- Note: Replace the hash above with a real Bcrypt hash if needed.
-- $2b$10$q0I7tcMvNQ4gGZrMpZq6FOM4X4XYwFq5D/GKtwCnM/BDn9ufGkloS is 'SamQtex+123'
UPDATE users SET password = '$2b$10$q0I7tcMvNQ4gGZrMpZq6FOM4X4XYwFq5D/GKtwCnM/BDn9ufGkloS' WHERE username = 'admin';
INSERT INTO settings (tenant_id) VALUES (1);
