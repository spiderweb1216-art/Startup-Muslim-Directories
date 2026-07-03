const mysql = require("mysql2/promise");
const dotenv = require("dotenv");

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "startup_muslim_directory",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4",
});

async function initDatabase() {
  const connection = await pool.getConnection();

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role VARCHAR(100) DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS business_types (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS business_categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS filter_fields (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        slug VARCHAR(255) NOT NULL UNIQUE,
        show_in_filter TINYINT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS filter_values (
        id INT AUTO_INCREMENT PRIMARY KEY,
        field_id INT NOT NULL,
        value VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (field_id) REFERENCES filter_fields(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS directories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        business_name VARCHAR(255) NOT NULL,
        business_location VARCHAR(255) NOT NULL,
        business_type_id INT NULL,
        business_category_id INT NULL,
        founder_name VARCHAR(255) NULL,
        logo_image VARCHAR(255) NULL,
        established_year INT NULL,
        rating DECIMAL(3,1) DEFAULT 0,
        review_count INT DEFAULT 0,
        description TEXT NULL,
        is_verified TINYINT DEFAULT 1,
        status VARCHAR(50) DEFAULT 'published',
        scheduled_at DATETIME NULL,
        website_url VARCHAR(500) NULL,
        contact_email VARCHAR(255) NULL,
        phone_number VARCHAR(100) NULL,
        submitter_name VARCHAR(255) NULL,
        submitter_email VARCHAR(255) NULL,
        submitter_phone VARCHAR(100) NULL,
        social_link VARCHAR(500) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (business_type_id) REFERENCES business_types(id) ON DELETE SET NULL,
        FOREIGN KEY (business_category_id) REFERENCES business_categories(id) ON DELETE SET NULL,
        INDEX idx_directories_status (status),
        INDEX idx_directories_location (business_location),
        INDEX idx_directories_type (business_type_id),
        INDEX idx_directories_category (business_category_id),
        INDEX idx_directories_year (established_year)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS directory_filter_values (
        id INT AUTO_INCREMENT PRIMARY KEY,
        directory_id INT NOT NULL,
        field_id INT NOT NULL,
        value_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (directory_id) REFERENCES directories(id) ON DELETE CASCADE,
        FOREIGN KEY (field_id) REFERENCES filter_fields(id) ON DELETE CASCADE,
        FOREIGN KEY (value_id) REFERENCES filter_values(id) ON DELETE CASCADE,
        INDEX idx_dfv_directory (directory_id),
        INDEX idx_dfv_field_value (field_id, value_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log("MySQL database connected and tables ready");
  } catch (error) {
    console.error("MySQL database setup failed:", error.message);
    throw error;
  } finally {
    connection.release();
  }
}

const ready = initDatabase();

function normalizeArgs(params, callback) {
  if (typeof params === "function") {
    return { params: [], callback: params };
  }

  return {
    params: Array.isArray(params) ? params : [],
    callback,
  };
}

const db = {
  async all(sql, params, callback) {
    const args = normalizeArgs(params, callback);

    try {
      await ready;
      const [rows] = await pool.query(sql, args.params);
      if (args.callback) args.callback(null, rows);
      return rows;
    } catch (error) {
      if (args.callback) return args.callback(error);
      throw error;
    }
  },

  async get(sql, params, callback) {
    const args = normalizeArgs(params, callback);

    try {
      await ready;
      const [rows] = await pool.query(sql, args.params);
      const row = rows && rows.length ? rows[0] : undefined;
      if (args.callback) args.callback(null, row);
      return row;
    } catch (error) {
      if (args.callback) return args.callback(error);
      throw error;
    }
  },

  async run(sql, params, callback) {
    const args = normalizeArgs(params, callback);

    try {
      await ready;
      const [result] = await pool.query(sql, args.params);

      const context = {
        lastID: result.insertId,
        changes: result.affectedRows,
      };

      if (args.callback) args.callback.call(context, null);
      return context;
    } catch (error) {
      if (args.callback) return args.callback(error);
      throw error;
    }
  },

  pool,
};

module.exports = db;