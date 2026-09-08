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
app.use(express.urlencoded({ extended: false, limit: "8kb" }));

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(req) {
  return String(req.get("cookie") || "").split(";").reduce((cookies, part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return cookies;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = value;
    return cookies;
  }, {});
}

function createAdminSession() {
  const expires = Date.now() + (8 * 60 * 60 * 1000);
  const payload = expires.toString(36);
  const signature = crypto.createHmac("sha256", process.env.ADMIN_PASSWORD).update(payload).digest("base64url");
  return payload + "." + signature;
}

function hasAdminSession(req) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return false;
  const token = parseCookies(req).my_kestrels_admin || "";
  const separator = token.indexOf(".");
  if (separator < 1) return false;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expires = parseInt(payload, 36);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  const expected = crypto.createHmac("sha256", password).update(payload).digest("base64url");
  return safeEqual(signature, expected);
}

function requireAdmin(req, res, next) {
  if (hasAdminSession(req)) return next();
  return res.status(401).json({ error: "Staff sign-in required", login: "/staff-login" });
}

function staffLoginPage(showError) {
  const error = showError ? '<p class="error">The username or password was not recognised. Please try again.</p>' : "";
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    '<meta name="theme-color" content="#111111"><title>My Kestrels Staff Login</title>',
    '<style>*{box-sizing:border-box}body{margin:0;background:#f3f3ef;color:#171717;font-family:Arial,sans-serif}header{background:#111;color:#fff;padding:26px 24px;border-bottom:5px solid #d71920}.brand{font-size:28px;font-weight:800;letter-spacing:4px}.sub{color:#d71920;font-size:12px;letter-spacing:4px;margin-top:4px}.wrap{max-width:520px;margin:48px auto;padding:20px}.card{background:#fff;border-radius:22px;padding:32px;box-shadow:0 16px 40px #0002}h1{margin:0 0 8px;font-size:32px}p{color:#555;line-height:1.5}label{display:block;font-weight:700;margin:20px 0 7px}input{width:100%;font-size:18px;padding:15px;border:1px solid #aaa;border-radius:10px}button{width:100%;margin-top:24px;padding:16px;background:#171717;color:#fff;border:0;border-radius:10px;font-size:18px;font-weight:700}.error{background:#fee;color:#9b1c1c;padding:12px;border-radius:8px}@media(max-width:560px){.wrap{margin:22px auto;padding:14px}.card{padding:24px}}</style></head><body>',
    '<header><div class="brand">KESTRELS</div><div class="sub">MOTOR COMPANY</div></header>',
    '<main class="wrap"><section class="card"><p style="color:#b3131b;font-weight:800;letter-spacing:2px">MY KESTRELS</p><h1>Staff Login</h1><p>Sign in to manage customer records and create individual app links.</p>',
    error,
    '<form method="post" action="/staff-login"><label for="username">Username</label><input id="username" name="username" autocomplete="username" autocapitalize="none" required>',
    '<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button type="submit">Sign In</button></form></section></main></body></html>'
  ].join("");
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

app.get("/staff-login", (req, res) => {
  if (hasAdminSession(req)) return res.redirect("/admin.html");
  res.set("Cache-Control", "no-store").type("html").send(staffLoginPage(req.query.error === "1"));
});

app.post("/staff-login", (req, res) => {
  const configuredPassword = process.env.ADMIN_PASSWORD;
  const username = String(req.body.username || "").trim();
  const suppliedPassword = String(req.body.password || "");
  if (!configuredPassword || username !== "admin" || !safeEqual(suppliedPassword, configuredPassword)) {
    return res.redirect("/staff-login?error=1");
  }
  res.set("Set-Cookie", "my_kestrels_admin=" + createAdminSession() + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800");
  return res.redirect("/admin.html");
});

app.get("/admin.html", (req, res) => {
  if (!hasAdminSession(req)) return res.redirect("/staff-login");
  res.set("Cache-Control", "no-store").sendFile(path.join(rootDir, "admin.html"));
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
      { src: "/icon-kestrels-traffic-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-kestrels-traffic-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-kestrels-traffic-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
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
for (const file of ["app.js", "styles.css", "sw.js", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "icon-kestrels-traffic-192.png", "icon-kestrels-traffic-512.png", "icon-kestrels-traffic-maskable-512.png", "apple-touch-icon-traffic.png"]) {
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
