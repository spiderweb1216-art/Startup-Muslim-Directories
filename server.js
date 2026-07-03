const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
const session = require("express-session");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const csvParser = require("csv-parser");
const { Readable } = require("stream");

dotenv.config();

const db = require("./db/database");
const app = express();
app.get("/db-check", async (req, res) => {
  try {
    db.all("SELECT * FROM business_types ORDER BY name ASC", [], (err, rows) => {
      if (err) {
        console.error("DB CHECK ERROR:", err);
        return res.send("DB CHECK ERROR: " + err.message);
      }

      res.json({
        status: "Database connected",
        business_types_count: rows.length,
        business_types: rows,
      });
    });
  } catch (error) {
    console.error("DB CHECK CATCH ERROR:", error);
    res.send("DB CHECK CATCH ERROR: " + error.message);
  }
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 },
  })
);

function requireAdmin(req, res, next) {
  if (!req.session.admin) return res.redirect("/admin/login");

  db.all("SELECT * FROM filter_fields ORDER BY id ASC", [], (err, fields) => {
    res.locals.sidebarFields = fields || [];
    next();
  });
}

function createSlug(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createDefaultAdmin() {
  db.get("SELECT COUNT(*) AS total FROM users", [], async (err, row) => {
    if (err) {
      console.error("Users table check failed:", err.message);
      return;
    }

    if (row.total === 0) {
      const defaultName = "Admin";
      const defaultEmail = process.env.ADMIN_EMAIL || "admin@startupmuslim.com";
      const defaultPassword = process.env.ADMIN_PASSWORD || "Admin@12345";
      const passwordHash = await bcrypt.hash(defaultPassword, 10);

      db.run(
        "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
        [defaultName, defaultEmail, passwordHash, "super_admin"],
        function (insertErr) {
          if (insertErr) {
            console.error("Default admin creation failed:", insertErr.message);
          } else {
            console.log("Default admin user created");
          }
        }
      );
    }
  });
}

createDefaultAdmin();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "public/uploads/logos");
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + "-" + file.originalname.replace(/\s+/g, "-");
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: function (req, file, cb) {
    if (
      file.mimetype === "text/csv" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.originalname.toLowerCase().endsWith(".csv")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"));
    }
  },
});

function parseCsvBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const rows = [];

    const cleanText = buffer.toString("utf8").replace(/^\uFEFF/, "");

    Readable.from(cleanText)
      .pipe(csvParser())
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

function normalizeKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, "")
    .replace(/[\s\-]+/g, "_");
}

function getCsvValue(row, names) {
  const keys = Object.keys(row || {});

  for (const name of names) {
    const wanted = normalizeKey(name);
    const foundKey = keys.find((key) => normalizeKey(key) === wanted);

    if (foundKey) {
      return String(row[foundKey] || "").trim();
    }
  }

  return "";
}

function toNumber(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;

  const number = Number(value);

  if (Number.isNaN(number)) return fallback;

  return number;
}

function toVerified(value) {
  const clean = String(value || "").trim().toLowerCase();

  if (!clean) return 1;

  if (["yes", "true", "1", "verified", "publish", "published"].includes(clean)) {
    return 1;
  }

  if (["no", "false", "0", "unverified"].includes(clean)) {
    return 0;
  }

  return 1;
}

function cleanStatus(value) {
  const clean = String(value || "").trim().toLowerCase();

  if (["draft", "scheduled", "published"].includes(clean)) {
    return clean;
  }

  return "published";
}

async function getOrCreateByName(connection, table, name) {
  const cleanName = String(name || "").trim();

  if (!cleanName) return null;

  const [existingRows] = await connection.query(
    `SELECT id FROM ${table} WHERE name = ? LIMIT 1`,
    [cleanName]
  );

  if (existingRows.length > 0) {
    return existingRows[0].id;
  }

  try {
    const [insertResult] = await connection.query(
      `INSERT INTO ${table} (name) VALUES (?)`,
      [cleanName]
    );

    return insertResult.insertId;
  } catch (error) {
    const [rowsAfterError] = await connection.query(
      `SELECT id FROM ${table} WHERE name = ? LIMIT 1`,
      [cleanName]
    );

    return rowsAfterError.length > 0 ? rowsAfterError[0].id : null;
  }
}

async function getOrCreateFilterValue(connection, fieldId, value) {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) return null;

  const [existingRows] = await connection.query(
    `
    SELECT id
    FROM filter_values
    WHERE field_id = ?
    AND value = ?
    LIMIT 1
    `,
    [fieldId, cleanValue]
  );

  if (existingRows.length > 0) {
    return existingRows[0].id;
  }

  const [insertResult] = await connection.query(
    `
    INSERT INTO filter_values
    (field_id, value)
    VALUES (?, ?)
    `,
    [fieldId, cleanValue]
  );

  return insertResult.insertId;
}

app.get("/", (req, res) => {
  res.redirect("/directories");
});

/* Public Directory Page */

app.get("/directories", (req, res) => {
  const hasHomeFilter =
    req.query.business_type_id ||
    req.query.business_category_id ||
    req.query.location ||
    req.query.established_year ||
    req.query.date_from ||
    req.query.date_to ||
    Object.keys(req.query).some((key) => key.startsWith("filter_"));

  if (hasHomeFilter) {
    const params = new URLSearchParams(req.query);
    params.delete("page");
    return res.redirect(`/businesses?${params.toString()}`);
  }

  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = 10;
  const offset = (page - 1) * limit;

  db.all("SELECT * FROM business_types ORDER BY name ASC", [], (typeErr, types) => {
    if (typeErr) return res.send("Error loading business types");

    db.all("SELECT * FROM business_categories ORDER BY name ASC", [], (catErr, categories) => {
      if (catErr) return res.send("Error loading business categories");

      db.all(
        "SELECT * FROM filter_fields WHERE show_in_filter = 1 ORDER BY name ASC",
        [],
        (fieldErr, filterFields) => {
          if (fieldErr) return res.send("Error loading filter fields");

          db.all("SELECT * FROM filter_values ORDER BY value ASC", [], (valueErr, values) => {
            if (valueErr) return res.send("Error loading filter values");

            const filtersForPage = filterFields.map((field) => {
              return {
                ...field,
                values: values.filter((item) => item.field_id === field.id),
              };
            });

            let where = [];
            let params = [];

            if (req.query.business_type_id) {
              where.push("directories.business_type_id = ?");
              params.push(req.query.business_type_id);
            }

            if (req.query.business_category_id) {
              where.push("directories.business_category_id = ?");
              params.push(req.query.business_category_id);
            }

            if (req.query.location) {
              where.push("directories.business_location LIKE ?");
              params.push(`%${req.query.location}%`);
            }
if (req.query.established_year) {
  where.push("directories.established_year >= ?");
  params.push(req.query.established_year);
}
            if (req.query.date_from) {
              where.push("DATE(directories.created_at) >= DATE(?)");
              params.push(req.query.date_from);
            }

            if (req.query.date_to) {
              where.push("DATE(directories.created_at) <= DATE(?)");
              params.push(req.query.date_to);
            }

            filtersForPage.forEach((field) => {
              const selectedValue = req.query[`filter_${field.id}`];

              if (selectedValue) {
                where.push(`
                  EXISTS (
                    SELECT 1
                    FROM directory_filter_values dfv
                    WHERE dfv.directory_id = directories.id
                    AND dfv.field_id = ?
                    AND dfv.value_id = ?
                  )
                `);

                params.push(field.id, selectedValue);
              }
            });

            const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

            const countSql = `
              SELECT COUNT(*) AS total
              FROM directories
              ${whereSql}
            `;

            const dataSql = `
              SELECT
                directories.*,
                business_types.name AS business_type,
                business_categories.name AS business_category
              FROM directories
              LEFT JOIN business_types ON directories.business_type_id = business_types.id
              LEFT JOIN business_categories ON directories.business_category_id = business_categories.id
              ${whereSql}
              ORDER BY directories.id DESC
              LIMIT ? OFFSET ?
            `;

            db.get(countSql, params, (countErr, countRow) => {
              if (countErr) return res.send("Error counting directories");

              db.all(dataSql, [...params, limit, offset], (dirErr, directories) => {
                if (dirErr) return res.send("Error loading directories");

               const totalDirectories = countRow ? countRow.total : 0;
                
                const totalPages = Math.ceil(totalDirectories / limit);

                db.all(
                  `
                  SELECT DISTINCT business_location 
                  FROM directories 
                  WHERE business_location IS NOT NULL 
                  AND TRIM(business_location) != ''
                  ORDER BY business_location ASC
                  `,
                  [],
                  (locErr, locationRows) => {
                    db.get("SELECT COUNT(*) AS total FROM directories", [], (businessCountErr, businessCountRow) => {
                      db.get("SELECT COUNT(*) AS total FROM business_categories", [], (categoryCountErr, categoryCountRow) => {
                        db.get("SELECT COUNT(*) AS total FROM business_types", [], (typeCountErr, typeCountRow) => {
                          res.render("directory", {
                            directories,
                            types,
                            categories,
                            filterFields: filtersForPage,
                            locations: locationRows || [],
                            query: req.query,
                            page,
                            totalPages,
                            totalDirectories,
                            stats: {
                              businesses: businessCountRow ? businessCountRow.total : 0,
                              categories: categoryCountRow ? categoryCountRow.total : 0,
                              types: typeCountRow ? typeCountRow.total : 0,
                              locations: locationRows ? locationRows.length : 0
                            }
                          });
                        });
                      });
                    });
                  }
                );
              });
            });
          });
        }
      );
    });
  });
});
app.get("/businesses", (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = 20;
  const offset = (page - 1) * limit;

  db.all("SELECT * FROM business_types ORDER BY name ASC", [], (typeErr, types) => {
    if (typeErr) return res.send("Error loading business types");

    db.all("SELECT * FROM business_categories ORDER BY name ASC", [], (catErr, categories) => {
      if (catErr) return res.send("Error loading business categories");

      db.all(
        "SELECT * FROM filter_fields WHERE show_in_filter = 1 ORDER BY name ASC",
        [],
        (fieldErr, filterFields) => {
          if (fieldErr) return res.send("Error loading filter fields");

          db.all("SELECT * FROM filter_values ORDER BY value ASC", [], (valueErr, values) => {
            if (valueErr) return res.send("Error loading filter values");

            const filtersForPage = filterFields.map((field) => {
              return {
                ...field,
                values: values.filter((item) => item.field_id === field.id),
              };
            });

            let where = [];
            let params = [];

            if (req.query.business_type_id) {
              where.push("directories.business_type_id = ?");
              params.push(req.query.business_type_id);
            }

            if (req.query.business_category_id) {
              where.push("directories.business_category_id = ?");
              params.push(req.query.business_category_id);
            }

            if (req.query.location) {
              where.push("directories.business_location LIKE ?");
              params.push(`%${req.query.location}%`);
            }
if (req.query.established_year) {
  where.push("directories.established_year >= ?");
  params.push(req.query.established_year);
}
            if (req.query.date_from) {
              where.push("DATE(directories.created_at) >= DATE(?)");
              params.push(req.query.date_from);
            }

            if (req.query.date_to) {
              where.push("DATE(directories.created_at) <= DATE(?)");
              params.push(req.query.date_to);
            }

            filtersForPage.forEach((field) => {
              const selectedValue = req.query[`filter_${field.id}`];

              if (selectedValue) {
                where.push(`
                  EXISTS (
                    SELECT 1
                    FROM directory_filter_values dfv
                    WHERE dfv.directory_id = directories.id
                    AND dfv.field_id = ?
                    AND dfv.value_id = ?
                  )
                `);

                params.push(field.id, selectedValue);
              }
            });

            const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

            const countSql = `
              SELECT COUNT(*) AS total
              FROM directories
              ${whereSql}
            `;

            const dataSql = `
              SELECT
                directories.*,
                business_types.name AS business_type,
                business_categories.name AS business_category
              FROM directories
              LEFT JOIN business_types ON directories.business_type_id = business_types.id
              LEFT JOIN business_categories ON directories.business_category_id = business_categories.id
              ${whereSql}
              ORDER BY directories.id DESC
              LIMIT ? OFFSET ?
            `;

            db.get(countSql, params, (countErr, countRow) => {
              if (countErr) return res.send("Error counting businesses");

              db.all(dataSql, [...params, limit, offset], (dirErr, directories) => {
                if (dirErr) return res.send("Error loading businesses");

                const totalDirectories = countRow ? countRow.total : 0;
                const totalPages = Math.ceil(totalDirectories / limit);

                db.all(
                  `
                  SELECT DISTINCT business_location 
                  FROM directories 
                  WHERE business_location IS NOT NULL 
                  AND TRIM(business_location) != ''
                  ORDER BY business_location ASC
                  `,
                  [],
                  (locErr, locationRows) => {
                    res.render("businesses", {
                      directories,
                      types,
                      categories,
                      filterFields: filtersForPage,
                      locations: locationRows || [],
                      query: req.query,
                      page,
                      totalPages,
                      totalDirectories,
                    });
                  }
                );
              });
            });
          });
        }
      );
    });
  });
});
app.get("/login", (req, res) => {
  res.redirect("/admin/login");
});
/* Login */
app.get("/login", (req, res) => {
  res.redirect("/admin/login");
});
app.get("/admin/login", (req, res) => {
  res.render("admin/login", { error: null });
});

app.post("/admin/login", (req, res) => {
  const { email, password } = req.body;

  db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
    if (err || !user) {
      return res.render("admin/login", {
        error: "Invalid email or password",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.render("admin/login", {
        error: "Invalid email or password",
      });
    }

    req.session.admin = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      loggedIn: true,
    };

    res.redirect("/admin/dashboard");
  });
});

app.get("/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/admin/login");
  });
});

/* Dashboard */

app.get("/admin/dashboard", requireAdmin, (req, res) => {
  db.get("SELECT COUNT(*) AS total FROM directories", [], (err, directoryCount) => {
    db.get("SELECT COUNT(*) AS total FROM business_types", [], (err2, typeCount) => {
      db.get("SELECT COUNT(*) AS total FROM business_categories", [], (err3, categoryCount) => {
        res.render("admin/dashboard", {
          admin: req.session.admin,
          directoryCount: directoryCount ? directoryCount.total : 0,
          typeCount: typeCount ? typeCount.total : 0,
          categoryCount: categoryCount ? categoryCount.total : 0,
          filterFields: res.locals.sidebarFields || [],
        });
      });
    });
  });
});

/* Business Types */

app.get("/admin/business-types", requireAdmin, (req, res) => {
  db.all("SELECT * FROM business_types ORDER BY id DESC", [], (err, types) => {
    if (err) return res.send("Error loading business types");
    res.render("admin/business-types", { types });
  });
});

app.post("/admin/business-types/add", requireAdmin, (req, res) => {
  const { name } = req.body;

  db.run("INSERT INTO business_types (name) VALUES (?)", [name], function (err) {
    if (err) return res.send("Business type already exists");
    res.redirect("/admin/business-types");
  });
});

app.get("/admin/business-types/delete/:id", requireAdmin, (req, res) => {
  db.run("DELETE FROM business_types WHERE id = ?", [req.params.id], function () {
    res.redirect("/admin/business-types");
  });
});

/* Business Categories */

app.get("/admin/business-categories", requireAdmin, (req, res) => {
  db.all("SELECT * FROM business_categories ORDER BY id DESC", [], (err, categories) => {
    if (err) return res.send("Error loading business categories");
    res.render("admin/business-categories", { categories });
  });
});

app.post("/admin/business-categories/add", requireAdmin, (req, res) => {
  const { name } = req.body;

  db.run("INSERT INTO business_categories (name) VALUES (?)", [name], function (err) {
    if (err) return res.send("Business category already exists");
    res.redirect("/admin/business-categories");
  });
});

app.get("/admin/business-categories/delete/:id", requireAdmin, (req, res) => {
  db.run("DELETE FROM business_categories WHERE id = ?", [req.params.id], function () {
    res.redirect("/admin/business-categories");
  });
});

/* Dynamic Filter Fields */

app.get("/admin/filter-fields", requireAdmin, (req, res) => {
  db.all("SELECT * FROM filter_fields ORDER BY id DESC", [], (err, fields) => {
    if (err) return res.send("Error loading filter fields");
    res.render("admin/filter-fields", { fields });
  });
});

app.post("/admin/filter-fields/add", requireAdmin, (req, res) => {
  const { name, show_in_filter } = req.body;
  const slug = createSlug(name);

  db.run(
    "INSERT INTO filter_fields (name, slug, show_in_filter) VALUES (?, ?, ?)",
    [name, slug, show_in_filter ? 1 : 0],
    function (err) {
      if (err) return res.send("Filter field already exists");
      res.redirect("/admin/filter-fields");
    }
  );
});

app.get("/admin/filter-fields/delete/:id", requireAdmin, (req, res) => {
  const fieldId = req.params.id;

  db.run("DELETE FROM directory_filter_values WHERE field_id = ?", [fieldId], () => {
    db.run("DELETE FROM filter_values WHERE field_id = ?", [fieldId], () => {
      db.run("DELETE FROM filter_fields WHERE id = ?", [fieldId], () => {
        res.redirect("/admin/filter-fields");
      });
    });
  });
});

app.get("/admin/filter-fields/:id/values", requireAdmin, (req, res) => {
  const fieldId = req.params.id;

  db.get("SELECT * FROM filter_fields WHERE id = ?", [fieldId], (err, field) => {
    if (!field) return res.send("Filter field not found");

    db.all(
      "SELECT * FROM filter_values WHERE field_id = ? ORDER BY id DESC",
      [fieldId],
      (err2, values) => {
        if (err2) return res.send("Error loading values");

        res.render("admin/filter-values", {
          field,
          values,
        });
      }
    );
  });
});

app.post("/admin/filter-fields/:id/filter-status", requireAdmin, (req, res) => {
  const fieldId = req.params.id;
  const showInFilter = req.body.show_in_filter ? 1 : 0;

  db.run(
    "UPDATE filter_fields SET show_in_filter = ? WHERE id = ?",
    [showInFilter, fieldId],
    function (err) {
      if (err) return res.send("Error updating filter status");
      res.redirect(`/admin/filter-fields/${fieldId}/values`);
    }
  );
});

app.post("/admin/filter-fields/:id/values/add", requireAdmin, (req, res) => {
  const fieldId = req.params.id;
  const { value } = req.body;

  db.run(
    "INSERT INTO filter_values (field_id, value) VALUES (?, ?)",
    [fieldId, value],
    function (err) {
      if (err) return res.send("Error saving value");
      res.redirect(`/admin/filter-fields/${fieldId}/values`);
    }
  );
});

app.get("/admin/filter-values/delete/:id", requireAdmin, (req, res) => {
  const valueId = req.params.id;

  db.get("SELECT field_id FROM filter_values WHERE id = ?", [valueId], (err, row) => {
    if (!row) return res.redirect("/admin/filter-fields");

    db.run("DELETE FROM directory_filter_values WHERE value_id = ?", [valueId], () => {
      db.run("DELETE FROM filter_values WHERE id = ?", [valueId], () => {
        res.redirect(`/admin/filter-fields/${row.field_id}/values`);
      });
    });
  });
});

/* Add Directory */

app.get("/admin/directories/add", requireAdmin, (req, res) => {
  db.all("SELECT * FROM business_types ORDER BY name ASC", [], (err, types) => {
    if (err) return res.send("Error loading business types");

    db.all("SELECT * FROM business_categories ORDER BY name ASC", [], (err2, categories) => {
      if (err2) return res.send("Error loading business categories");

      db.all("SELECT * FROM filter_fields ORDER BY name ASC", [], (err3, fields) => {
        if (err3) return res.send("Error loading filter fields");

        db.all("SELECT * FROM filter_values ORDER BY value ASC", [], (err4, values) => {
          if (err4) return res.send("Error loading filter values");

          const filterFields = fields.map((field) => {
            return {
              ...field,
              values: values.filter((item) => item.field_id === field.id),
            };
          });

          db.all(
  `
  SELECT DISTINCT business_location 
  FROM directories 
  WHERE business_location IS NOT NULL 
  AND TRIM(business_location) != ''
  ORDER BY business_location ASC
  `,
  [],
  (locErr, locationRows) => {
    res.render("admin/add-directory", {
      types,
      categories,
      filterFields,
      locations: locationRows || [],
    });
  }
);
        });
      });
    });
  });
});

app.post("/admin/directories/add", requireAdmin, upload.single("logo_image"), (req, res) => {
  const {
    business_name,
    business_location,
    business_type_id,
    business_category_id,
    founder_name,
    established_year,
    rating,
    review_count,
    description,
    is_verified,
    save_action,
    scheduled_at,
  } = req.body;

  let status = "published";
  let finalScheduledAt = null;

  if (save_action === "draft") {
    status = "draft";
  }

  if (save_action === "schedule") {
    if (!scheduled_at) {
      return res.send("Please select schedule date and time.");
    }

    status = "scheduled";
    finalScheduledAt = scheduled_at.replace("T", " ");
  }

  const logo_image = req.file ? req.file.filename : null;

  db.run(
    `
    INSERT INTO directories
    (business_name, business_location, business_type_id, business_category_id, founder_name, logo_image, established_year, rating, review_count, description, is_verified, status, scheduled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      business_name,
      business_location,
      business_type_id || null,
      business_category_id || null,
      founder_name,
      logo_image,
      established_year || null,
      rating || 0,
      review_count || 0,
      description || null,
      is_verified ? 1 : 0,
      status,
      finalScheduledAt,
    ],
    function (err) {
      if (err) {
        console.error(err.message);
        return res.send("Error saving directory: " + err.message);
      }

      const directoryId = this.lastID;
      const filters = req.body.filters || {};
      const selectedFilters = Object.entries(filters).filter(([fieldId, valueId]) => valueId);

      if (selectedFilters.length === 0) {
        return res.redirect("/admin/directories");
      }

      let completed = 0;

      selectedFilters.forEach(([fieldId, valueId]) => {
        db.run(
          `
          INSERT INTO directory_filter_values
          (directory_id, field_id, value_id)
          VALUES (?, ?, ?)
          `,
          [directoryId, fieldId, valueId],
          function () {
            completed++;

            if (completed === selectedFilters.length) {
              res.redirect("/admin/directories");
            }
          }
        );
      });
    }
  );
});
/* Import Businesses CSV */

app.get("/admin/directories/import", requireAdmin, (req, res) => {
  res.render("admin/import-businesses", {
    result: null,
    error: null,
  });
});

app.post(
  "/admin/directories/import",
  requireAdmin,
  csvUpload.single("csv_file"),
  async (req, res) => {
    if (!req.file) {
      return res.render("admin/import-businesses", {
        result: null,
        error: "Please upload a CSV file.",
      });
    }

    let rows = [];

    try {
      rows = await parseCsvBuffer(req.file.buffer);
    } catch (error) {
      return res.render("admin/import-businesses", {
        result: null,
        error: "CSV file could not be read. Please check the file format.",
      });
    }

    if (!rows.length) {
      return res.render("admin/import-businesses", {
        result: null,
        error: "CSV file is empty.",
      });
    }

    const connection = await db.pool.getConnection();

    const result = {
      totalRows: rows.length,
      inserted: 0,
      skipped: 0,
      errors: [],
      createdTypes: 0,
      createdCategories: 0,
    };

    try {
      await connection.beginTransaction();

      const [filterFields] = await connection.query(
        "SELECT * FROM filter_fields ORDER BY id ASC"
      );

      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        const rowNumber = index + 2;

        const businessName = getCsvValue(row, [
          "business_name",
          "business name",
          "name",
          "company_name",
          "company name",
        ]);

        const businessLocation = getCsvValue(row, [
          "business_location",
          "business location",
          "location",
          "city",
          "country",
        ]);

        const businessTypeName = getCsvValue(row, [
          "business_type",
          "business type",
          "type",
        ]);

        const businessCategoryName = getCsvValue(row, [
          "business_category",
          "business category",
          "category",
        ]);

        if (!businessName) {
          result.skipped++;
          result.errors.push(`Row ${rowNumber}: Business name is missing.`);
          continue;
        }

        if (!businessLocation) {
          result.skipped++;
          result.errors.push(`Row ${rowNumber}: Business location is missing.`);
          continue;
        }

        const [duplicateRows] = await connection.query(
          `
          SELECT id
          FROM directories
          WHERE business_name = ?
          AND business_location = ?
          LIMIT 1
          `,
          [businessName, businessLocation]
        );

        if (duplicateRows.length > 0) {
          result.skipped++;
          result.errors.push(
            `Row ${rowNumber}: Skipped duplicate business "${businessName}" in "${businessLocation}".`
          );
          continue;
        }

        let businessTypeId = null;
        let businessCategoryId = null;

        if (businessTypeName) {
          const [beforeTypeRows] = await connection.query(
            "SELECT id FROM business_types WHERE name = ? LIMIT 1",
            [businessTypeName]
          );

          businessTypeId = await getOrCreateByName(
            connection,
            "business_types",
            businessTypeName
          );

          if (beforeTypeRows.length === 0 && businessTypeId) {
            result.createdTypes++;
          }
        }

        if (businessCategoryName) {
          const [beforeCategoryRows] = await connection.query(
            "SELECT id FROM business_categories WHERE name = ? LIMIT 1",
            [businessCategoryName]
          );

          businessCategoryId = await getOrCreateByName(
            connection,
            "business_categories",
            businessCategoryName
          );

          if (beforeCategoryRows.length === 0 && businessCategoryId) {
            result.createdCategories++;
          }
        }

        const founderName = getCsvValue(row, [
          "founder_name",
          "founder name",
          "founder",
        ]);

        const establishedYear = toNumber(
          getCsvValue(row, ["established_year", "established year", "year"]),
          null
        );

        const rating = toNumber(getCsvValue(row, ["rating"]), 0);
        const reviewCount = toNumber(
          getCsvValue(row, ["review_count", "review count", "reviews"]),
          0
        );

        const description = getCsvValue(row, [
          "description",
          "business_description",
          "business description",
          "about",
        ]);

        const websiteUrl = getCsvValue(row, [
          "website_url",
          "website url",
          "website",
          "url",
        ]);

        const contactEmail = getCsvValue(row, [
          "contact_email",
          "contact email",
          "email",
          "business_email",
          "business email",
        ]);

        const phoneNumber = getCsvValue(row, [
          "phone_number",
          "phone number",
          "phone",
          "whatsapp",
        ]);

        const socialLink = getCsvValue(row, [
          "social_link",
          "social link",
          "linkedin",
          "instagram",
          "facebook",
        ]);

        const logoImage = getCsvValue(row, [
          "logo_image",
          "logo image",
          "logo",
          "logo_filename",
        ]);

        const isVerified = toVerified(
          getCsvValue(row, ["is_verified", "is verified", "verified"])
        );

        const status = cleanStatus(getCsvValue(row, ["status"]));

        const [insertResult] = await connection.query(
          `
          INSERT INTO directories
          (
            business_name,
            business_location,
            business_type_id,
            business_category_id,
            founder_name,
            logo_image,
            established_year,
            rating,
            review_count,
            description,
            is_verified,
            status,
            scheduled_at,
            website_url,
            contact_email,
            phone_number,
            submitter_name,
            submitter_email,
            submitter_phone,
            social_link
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            businessName,
            businessLocation,
            businessTypeId,
            businessCategoryId,
            founderName || null,
            logoImage || null,
            establishedYear,
            rating,
            reviewCount,
            description || null,
            isVerified,
            status,
            null,
            websiteUrl || null,
            contactEmail || null,
            phoneNumber || null,
            null,
            null,
            null,
            socialLink || null,
          ]
        );

        const directoryId = insertResult.insertId;

        for (const field of filterFields) {
          const fieldValue = getCsvValue(row, [
            field.slug,
            field.name,
            `filter_${field.slug}`,
            `filter_${field.id}`,
          ]);

          if (!fieldValue) continue;

          const valueId = await getOrCreateFilterValue(
            connection,
            field.id,
            fieldValue
          );

          if (valueId) {
            await connection.query(
              `
              INSERT INTO directory_filter_values
              (directory_id, field_id, value_id)
              VALUES (?, ?, ?)
              `,
              [directoryId, field.id, valueId]
            );
          }
        }

        result.inserted++;
      }

      await connection.commit();

      res.render("admin/import-businesses", {
        result,
        error: null,
      });
    } catch (error) {
      await connection.rollback();

      console.error("CSV Import Error:", error);

      res.render("admin/import-businesses", {
        result: null,
        error: "Import failed: " + error.message,
      });
    } finally {
      connection.release();
    }
  }
);
/* All Directories Admin */

app.get("/admin/directories", requireAdmin, (req, res) => {
  db.all("SELECT * FROM filter_fields ORDER BY id ASC", [], (fieldErr, filterFields) => {
    if (fieldErr) return res.send("Error loading filter fields");

    db.all(
      `
      SELECT
        directories.*,
        business_types.name AS business_type,
        business_categories.name AS business_category
      FROM directories
      LEFT JOIN business_types ON directories.business_type_id = business_types.id
      LEFT JOIN business_categories ON directories.business_category_id = business_categories.id
      ORDER BY directories.id DESC
      `,
      [],
      (dirErr, directories) => {
        if (dirErr) return res.send("Error loading directories");

        db.all(
          `
          SELECT
            directory_filter_values.directory_id,
            directory_filter_values.field_id,
            filter_values.value
          FROM directory_filter_values
          LEFT JOIN filter_values ON directory_filter_values.value_id = filter_values.id
          `,
          [],
          (valueErr, rows) => {
            if (valueErr) return res.send("Error loading directory field values");

            const filterMap = {};

            rows.forEach((row) => {
              filterMap[`${row.directory_id}_${row.field_id}`] = row.value;
            });

            res.render("admin/directories", {
              directories,
              filterFields: filterFields || [],
              filterMap,
            });
          }
        );
      }
    );
  });
});
/* Edit / Delete Directory */

app.get("/admin/directories/edit/:id", requireAdmin, (req, res) => {
  const directoryId = req.params.id;

  db.get("SELECT * FROM directories WHERE id = ?", [directoryId], (err, directory) => {
    if (err || !directory) return res.send("Directory not found");

    db.all("SELECT * FROM business_types ORDER BY name ASC", [], (err2, types) => {
      db.all("SELECT * FROM business_categories ORDER BY name ASC", [], (err3, categories) => {
        db.all("SELECT * FROM filter_fields ORDER BY name ASC", [], (err4, fields) => {
          db.all("SELECT * FROM filter_values ORDER BY value ASC", [], (err5, values) => {
            db.all(
              "SELECT * FROM directory_filter_values WHERE directory_id = ?",
              [directoryId],
              (err6, selectedRows) => {
                const selectedMap = {};

                selectedRows.forEach((row) => {
                  selectedMap[row.field_id] = row.value_id;
                });

                const filterFields = fields.map((field) => {
                  return {
                    ...field,
                    values: values.filter((item) => item.field_id === field.id),
                  };
                });

                res.render("admin/edit-directory", {
                  directory,
                  types,
                  categories,
                  filterFields,
                  selectedMap,
                });
              }
            );
          });
        });
      });
    });
  });
});

app.post("/admin/directories/edit/:id", requireAdmin, upload.single("logo_image"), (req, res) => {
  const directoryId = req.params.id;

  const {
    business_name,
    business_location,
    business_type_id,
    business_category_id,
    founder_name,
    established_year,
    rating,
    review_count,
    description,
    is_verified,
    save_action,
    scheduled_at,
    old_logo,
  } = req.body;

  let status = "published";
  let finalScheduledAt = null;

  if (save_action === "draft") {
    status = "draft";
  }

  if (save_action === "schedule") {
    if (!scheduled_at) {
      return res.send("Please select schedule date and time.");
    }

    status = "scheduled";
    finalScheduledAt = scheduled_at.replace("T", " ");
  }

  const logo_image = req.file ? req.file.filename : old_logo || null;

  db.run(
    `
    UPDATE directories
    SET business_name = ?,
        business_location = ?,
        business_type_id = ?,
        business_category_id = ?,
        founder_name = ?,
        logo_image = ?,
        established_year = ?,
        rating = ?,
        review_count = ?,
        description = ?,
        is_verified = ?,
        status = ?,
        scheduled_at = ?
    WHERE id = ?
    `,
    [
      business_name,
      business_location,
      business_type_id || null,
      business_category_id || null,
      founder_name,
      logo_image,
      established_year || null,
      rating || 0,
      review_count || 0,
      description || null,
      is_verified ? 1 : 0,
      status,
      finalScheduledAt,
      directoryId,
    ],
    function (err) {
      if (err) {
        return res.send("Error updating directory: " + err.message);
      }

      db.run("DELETE FROM directory_filter_values WHERE directory_id = ?", [directoryId], () => {
        const filters = req.body.filters || {};
        const selectedFilters = Object.entries(filters).filter(([fieldId, valueId]) => valueId);

        if (selectedFilters.length === 0) {
          return res.redirect("/admin/directories");
        }

        let completed = 0;

        selectedFilters.forEach(([fieldId, valueId]) => {
          db.run(
            `
            INSERT INTO directory_filter_values
            (directory_id, field_id, value_id)
            VALUES (?, ?, ?)
            `,
            [directoryId, fieldId, valueId],
            function () {
              completed++;

              if (completed === selectedFilters.length) {
                res.redirect("/admin/directories");
              }
            }
          );
        });
      });
    }
  );
});

app.get("/admin/directories/delete/:id", requireAdmin, (req, res) => {
  const directoryId = req.params.id;

  db.get("SELECT logo_image FROM directories WHERE id = ?", [directoryId], (err, row) => {
    db.run("DELETE FROM directory_filter_values WHERE directory_id = ?", [directoryId], () => {
      db.run("DELETE FROM directories WHERE id = ?", [directoryId], () => {
        if (row && row.logo_image) {
          const filePath = path.join(__dirname, "public/uploads/logos", row.logo_image);
          fs.unlink(filePath, () => {});
        }

        res.redirect("/admin/directories");
      });
    });
  });
});
/* Users Management */

app.get("/admin/users", requireAdmin, (req, res) => {
  db.all(
    "SELECT id, name, email, role, created_at FROM users ORDER BY id DESC",
    [],
    (err, users) => {
      if (err) return res.send("Error loading users");

      res.render("admin/users", {
        users,
        currentUser: req.session.admin,
      });
    }
  );
});

app.post("/admin/users/add", requireAdmin, async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    return res.send("Name, email, and password are required");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  db.run(
    `
    INSERT INTO users (name, email, password_hash, role)
    VALUES (?, ?, ?, ?)
    `,
    [name, email, passwordHash, role || "admin"],
    function (err) {
      if (err) {
        return res.send("User already exists or error saving user");
      }

      res.redirect("/admin/users");
    }
  );
});

app.get("/admin/users/delete/:id", requireAdmin, (req, res) => {
  const userId = Number(req.params.id);

  if (req.session.admin.id === userId) {
    return res.send("You cannot delete your own account while logged in.");
  }

  db.run("DELETE FROM users WHERE id = ?", [userId], function (err) {
    if (err) return res.send("Error deleting user");

    res.redirect("/admin/users");
  });
});

/* Account Settings */

app.get("/admin/account", requireAdmin, (req, res) => {
  db.get(
    "SELECT id, name, email, role, created_at FROM users WHERE id = ?",
    [req.session.admin.id],
    (err, user) => {
      if (err || !user) {
        return res.redirect("/admin/logout");
      }

      res.render("admin/account", {
        user,
        error: null,
        success: null,
      });
    }
  );
});

app.post("/admin/account/update", requireAdmin, async (req, res) => {
  const { name, email, current_password, new_password, confirm_password } = req.body;

  db.get("SELECT * FROM users WHERE id = ?", [req.session.admin.id], async (err, user) => {
    if (err || !user) {
      return res.redirect("/admin/logout");
    }

    if (new_password || confirm_password) {
      if (!current_password) {
        return res.render("admin/account", {
          user,
          error: "Current password is required to change password.",
          success: null,
        });
      }

      const isMatch = await bcrypt.compare(current_password, user.password_hash);

      if (!isMatch) {
        return res.render("admin/account", {
          user,
          error: "Current password is incorrect.",
          success: null,
        });
      }

      if (new_password !== confirm_password) {
        return res.render("admin/account", {
          user,
          error: "New password and confirm password do not match.",
          success: null,
        });
      }

      const passwordHash = await bcrypt.hash(new_password, 10);

      db.run(
        "UPDATE users SET name = ?, email = ?, password_hash = ? WHERE id = ?",
        [name, email, passwordHash, user.id],
        function (updateErr) {
          if (updateErr) {
            return res.render("admin/account", {
              user,
              error: "Email already exists or update failed.",
              success: null,
            });
          }

          req.session.admin.name = name;
          req.session.admin.email = email;

          res.render("admin/account", {
            user: { ...user, name, email },
            error: null,
            success: "Account updated successfully.",
          });
        }
      );
    } else {
      db.run(
        "UPDATE users SET name = ?, email = ? WHERE id = ?",
        [name, email, user.id],
        function (updateErr) {
          if (updateErr) {
            return res.render("admin/account", {
              user,
              error: "Email already exists or update failed.",
              success: null,
            });
          }

          req.session.admin.name = name;
          req.session.admin.email = email;

          res.render("admin/account", {
            user: { ...user, name, email },
            error: null,
            success: "Account updated successfully.",
          });
        }
      );
    }
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});