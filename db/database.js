const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, "startup_muslim.db");

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("SQLite connection failed:", err.message);
  } else {
    console.log("SQLite database connected");
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS business_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS business_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS filter_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      show_in_filter INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS filter_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      field_id INTEGER NOT NULL,
      value TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (field_id) REFERENCES filter_fields(id)
    )
  `);

   db.run(`
    CREATE TABLE IF NOT EXISTS directories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_name TEXT NOT NULL,
      business_location TEXT NOT NULL,
      business_type_id INTEGER,
      business_category_id INTEGER,
      founder_name TEXT,
      logo_image TEXT,
      established_year INTEGER,
      rating REAL DEFAULT 0,
      review_count INTEGER DEFAULT 0,
      description TEXT,
      is_verified INTEGER DEFAULT 1,
      status TEXT DEFAULT 'published',
      scheduled_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (business_type_id) REFERENCES business_types(id),
      FOREIGN KEY (business_category_id) REFERENCES business_categories(id)
    )
  `);

  db.run(`ALTER TABLE directories ADD COLUMN status TEXT DEFAULT 'published'`, () => {});
  db.run(`ALTER TABLE directories ADD COLUMN scheduled_at TEXT`, () => {});
  db.run(`ALTER TABLE directories ADD COLUMN established_year INTEGER`, () => {});
  db.run(`ALTER TABLE directories ADD COLUMN rating REAL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE directories ADD COLUMN review_count INTEGER DEFAULT 0`, () => {});
  db.run(`ALTER TABLE directories ADD COLUMN description TEXT`, () => {});
  db.run(`ALTER TABLE directories ADD COLUMN is_verified INTEGER DEFAULT 1`, () => {});
  db.run(`
    CREATE TABLE IF NOT EXISTS directory_filter_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      directory_id INTEGER NOT NULL,
      field_id INTEGER NOT NULL,
      value_id INTEGER NOT NULL,
      FOREIGN KEY (directory_id) REFERENCES directories(id),
      FOREIGN KEY (field_id) REFERENCES filter_fields(id),
      FOREIGN KEY (value_id) REFERENCES filter_values(id)
    )
  `);
});

module.exports = db;