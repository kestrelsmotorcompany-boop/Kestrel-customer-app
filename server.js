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
app.use(express.static(__dirname));

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


async function getDvsaAccessToken() {
  const response = await fetch(process.env.DVSA_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.DVSA_CLIENT_ID,
      client_secret: process.env.DVSA_CLIENT_SECRET,
      scope: process.env.DVSA_SCOPE_URL,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DVSA token error: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.access_token;
}

app.get("/api/mot/:registration", async (req, res) => {
  try {
    const registration = req.params.registration
      .replace(/\s+/g, "")
      .toUpperCase();

    const accessToken = await getDvsaAccessToken();

    const response = await fetch(
      `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(registration)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-API-Key": process.env.DVSA_API_KEY,
          Accept: "application/json",
        },
      }
    );

    const data = await response.json();
console.log("DVSA responce:", response.status, JSON.stringify(data));
    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error("DVSA MOT lookup error:", error);
    res.status(500).json({
      error: "Unable to retrieve MOT information",
    });
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
