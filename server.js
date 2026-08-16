const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

async function setupDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT,
      registration TEXT,
      make TEXT,
      mileage TEXT,
      mot_due TEXT,
      service_due TEXT,
      warranty TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

app.post("/api/customers", async (req, res) => {
  try {
    const {
      id,
      name,
      registration,
      make,
      mileage,
      motDue,
      serviceDue,
      warranty
    } = req.body;

    await pool.query(
      `INSERT INTO customers
       (id, name, registration, make, mileage, mot_due, service_due, warranty)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       registration = EXCLUDED.registration,
       make = EXCLUDED.make,
       mileage = EXCLUDED.mileage,
       mot_due = EXCLUDED.mot_due,
       service_due = EXCLUDED.service_due,
       warranty = EXCLUDED.warranty`,
      [id, name, registration, make, mileage, motDue, serviceDue, warranty]
    );

    res.json({ success: true, id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to save customer" });
  }
});

app.get("/api/customers/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM customers WHERE id = $1",
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load customer" });
  }
});

app.get("/api/customers", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM customers ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load customers" });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

setupDatabase()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Kestrel Customer App running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Database setup failed:", error);
    process.exit(1);
  });
