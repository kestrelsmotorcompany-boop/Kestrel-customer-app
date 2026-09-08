const crypto = require("crypto");
const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const rootDir = __dirname;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  });
  next();
});
app.use(express.json({ limit: "32kb" }));

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireAdmin(req, res, next) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return res.status(503).send("Admin access is not configured.");

  const header = req.get("authorization") || "";
  if (!header.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="My Kestrels Admin", charset="UTF-8"');
    return res.status(401).send("Authentication required.");
  }

  let credentials;
  try {
    credentials = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    credentials = "";
  }

  const separator = credentials.indexOf(":");
  const username = separator >= 0 ? credentials.slice(0, separator) : "";
  const suppliedPassword = separator >= 0 ? credentials.slice(separator + 1) : "";

  if (username !== "admin" || !safeEqual(suppliedPassword, password)) {
    res.set("WWW-Authenticate", 'Basic realm="My Kestrels Admin", charset="UTF-8"');
    return res.status(401).send("Incorrect username or password.");
  }
  next();
}

function normaliseCustomer(body, existingId) {
  const clean = value => String(value || "").trim();
  const customer = {
    id: existingId || crypto.randomUUID(),
    name: clean(body.name),
    registration: clean(body.registration).replace(/\s+/g, "").toUpperCase(),
    make: clean(body.make),
    mileage: clean(body.mileage),
    motDue: clean(body.motDue),
    serviceDue: clean(body.serviceDue),
    warranty: clean(body.warranty) || "Not supplied"
  };
  if (!customer.name || !customer.registration || !customer.make) {
    const error = new Error("Customer name, registration and make/model are required.");
    error.status = 400;
    throw error;
  }
  return customer;
}

app.get("/admin.html", requireAdmin, (req, res) => {
  res.sendFile(path.join(rootDir, "admin.html"));
});

app.post("/api/customers", requireAdmin, async (req, res) => {
  try {
    const customer = normaliseCustomer(req.body);
    await pool.query(
      `INSERT INTO customers
       (id, name, registration, make, mileage, mot_due, service_due, warranty)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [customer.id, customer.name, customer.registration, customer.make, customer.mileage,
        customer.motDue, customer.serviceDue, customer.warranty]
    );
    res.status(201).json({ success: true, id: customer.id });
  } catch (error) {
    console.error("Create customer error:", error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : "Unable to save customer" });
  }
});

app.put("/api/customers/:id", requireAdmin, async (req, res) => {
  try {
    const customer = normaliseCustomer(req.body, req.params.id);
    const result = await pool.query(
      `UPDATE customers SET name=$1, registration=$2, make=$3, mileage=$4,
       mot_due=$5, service_due=$6, warranty=$7 WHERE id=$8 RETURNING id`,
      [customer.name, customer.registration, customer.make, customer.mileage,
        customer.motDue, customer.serviceDue, customer.warranty, customer.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Customer not found" });
    res.json({ success: true, id: customer.id });
  } catch (error) {
    console.error("Update customer error:", error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : "Unable to update customer" });
  }
});

app.get("/api/customers", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM customers ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (error) {
    console.error("Customer list error:", error.message);
    res.status(500).json({ error: "Unable to load customers" });
  }
});

app.get("/api/customers/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT registration, make, mileage, mot_due, service_due, warranty
       FROM customers WHERE id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Customer not found" });
    res.set("Cache-Control", "no-store").json(result.rows[0]);
  } catch (error) {
    console.error("Customer load error:", error.message);
    res.status(500).json({ error: "Unable to load customer" });
  }
});

app.get("/manifest.json", (req, res) => {
  const customerId = String(req.query.customer || "");
  const validCustomerId = /^[a-zA-Z0-9-]{1,80}$/.test(customerId) ? customerId : "";
  res.set("Cache-Control", "no-store").json({
    name: "My Kestrels",
    short_name: "My Kestrels",
    id: validCustomerId ? `/my-kestrels/${validCustomerId}` : "/my-kestrels",
    start_url: validCustomerId ? `/?customer=${encodeURIComponent(validCustomerId)}` : "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#f4f4f2",
    theme_color: "#111111",
    description: "Your vehicle, reminders, bookings and Kestrels support in one place.",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
    ]
  });
});

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

async function getDvsaAccessToken() {
  const response = await fetch(process.env.DVSA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.DVSA_CLIENT_ID,
      client_secret: process.env.DVSA_CLIENT_SECRET,
      scope: process.env.DVSA_SCOPE_URL
    })
  });
  if (!response.ok) throw new Error(`DVSA token error: ${response.status}`);
  return (await response.json()).access_token;
}

app.get("/api/mot/:registration", requireAdmin, async (req, res) => {
  try {
    const registration = req.params.registration.replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z0-9]{2,8}$/.test(registration)) {
      return res.status(400).json({ error: "Enter a valid registration" });
    }
    const response = await fetch(
      `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(registration)}`,
      {
        headers: {
          Authorization: `Bearer ${await getDvsaAccessToken()}`,
          "X-API-Key": process.env.DVSA_API_KEY,
          Accept: "application/json"
        }
      }
    );
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    res.set("Cache-Control", "no-store").json(data);
  } catch (error) {
    console.error("DVSA MOT lookup error:", error.message);
    res.status(500).json({ error: "Unable to retrieve MOT information" });
  }
});

app.get("/", (req, res) => res.sendFile(path.join(rootDir, "index.html")));
for (const file of ["app.js", "styles.css", "sw.js", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png"]) {
  app.get("/" + file, (req, res) => res.sendFile(path.join(rootDir, file)));
}

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.status(404).send("Page not found.");
});

setupDatabase()
  .then(() => app.listen(PORT, "0.0.0.0", () => {
    console.log(`Kestrel Customer App running on port ${PORT}`);
  }))
  .catch(error => {
    console.error("Database setup failed:", error.message);
    process.exit(1);
  });
