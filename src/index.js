
const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });

const encoder = new TextEncoder();

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

async function hash(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(value)
  );

  return Array.from(new Uint8Array(digest),
    b => b.toString(16).padStart(2, "0")).join("");
}

// Password hashing: PBKDF2-SHA256
async function passwordHash(password, salt = randomToken()) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt: encoder.encode(salt),
    iterations: 310000,
    hash: "SHA-256"
  }, key, 256);

  const result = Array.from(
    new Uint8Array(bits),
    b => b.toString(16).padStart(2, "0")
  ).join("");

  return `${salt}:${result}`;
}

async function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false;

  const [salt, expected] = stored.split(":");

  if (!salt || !expected) return false;

  const actual = (await passwordHash(password, salt)).split(":")[1];

  return actual === expected;
}

function getCookie(request, name) {
  const cookies = request.headers.get("Cookie") || "";

  const item = cookies.split(";")
    .map(x => x.trim())
    .find(x => x.startsWith(name + "="));

  return item ? item.slice(name.length + 1) : null;
}

function secureCookie(token, maxAge) {
  return `session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

async function getAdmin(request, env) {
  const token = getCookie(request, "session");

  if (!token) return null;

  const tokenHash = await hash(token);

  return await env.DB.prepare(`
    SELECT admins.id, admins.username
    FROM sessions
    JOIN admins ON admins.id = sessions.admin_id
    WHERE sessions.token_hash = ?
      AND sessions.expires_at > datetime('now')
  `).bind(tokenHash).first();
}

function checkOrigin(request) {
  const origin = request.headers.get("Origin");

  return !!origin && origin === new URL(request.url).origin;
}

async function body(request) {
  return await request.json();
}

async function requireAdmin(request, env) {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    if (!checkOrigin(request)) {
      return {
        error: json({ error: "Invalid request origin" }, 403)
      };
    }
  }

  const admin = await getAdmin(request, env);

  if (!admin) {
    return {
      error: json({ error: "Unauthorized" }, 401)
    };
  }

  return { admin };
}

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Public product catalogue
  if (path === "/api/public/products" && method === "GET") {
    const result = await env.DB.prepare(`
      SELECT id, name, category, description, price, stock, image_url
      FROM products
      WHERE active = 1
      ORDER BY id DESC
    `).all();

    return json(result.results);
  }

  // One-time administrator setup
  if (path === "/api/setup" && method === "POST") {
    if (!env.SETUP_TOKEN) {
      return json({ error: "Setup is disabled" }, 403);
    }

    try {
      if (!checkOrigin(request)) {
        return json({ error: "Invalid request origin" }, 403);
      }

      const data = await body(request);

      if (
        data.setupToken !== env.SETUP_TOKEN ||
        typeof data.username !== "string" ||
        typeof data.password !== "string" ||
        data.username.trim().length < 3 ||
        data.password.length < 12 ||
        data.password.length > 128
      ) {
        return json({ error: "Invalid setup details" }, 400);
      }

      const username = data.username.trim();

      // Atomic conditional insert prevents concurrent first-time setup.
      const stored = await passwordHash(data.password);

      const result = await env.DB.prepare(`
        INSERT INTO admins (username, password_hash)
        SELECT ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM admins)
      `).bind(username, stored).run();

      if (!result.meta.changes) {
        return json({ error: "Admin already exists" }, 403);
      }

      return json({
        success: true,
        message: "Admin created"
      }, 201);

    } catch (error) {
      console.error("SETUP ERROR:", error?.stack || error);

      return json({
        error: "Admin setup failed"
      }, 500);
    }
  }

  // Admin login
  if (path === "/api/admin/login" && method === "POST") {
    if (!checkOrigin(request)) {
      return json({ error: "Invalid origin" }, 403);
    }

    const data = await body(request);

    if (
      typeof data.username !== "string" ||
      typeof data.password !== "string"
    ) {
      return json({ error: "Invalid credentials" }, 400);
    }

    const admin = await env.DB.prepare(
      "SELECT * FROM admins WHERE username = ?"
    ).bind(data.username.trim()).first();

    if (
      !admin ||
      !(await verifyPassword(data.password, admin.password_hash))
    ) {
      return json({
        error: "Incorrect username or password"
      }, 401);
    }

    const token = randomToken();
    const tokenHash = await hash(token);

    await env.DB.prepare(`
      INSERT INTO sessions (token_hash, admin_id, expires_at)
      VALUES (?, ?, datetime('now', '+8 hours'))
    `).bind(tokenHash, admin.id).run();

    return json({
      success: true,
      username: admin.username
    }, 200, {
      "Set-Cookie": secureCookie(token, 28800)
    });
  }

  // Logout
  if (path === "/api/admin/logout" && method === "POST") {
    const auth = await requireAdmin(request, env);

    if (auth.error) return auth.error;

    const token = getCookie(request, "session");

    await env.DB.prepare(
      "DELETE FROM sessions WHERE token_hash = ?"
    ).bind(await hash(token)).run();

    return json({ success: true }, 200, {
      "Set-Cookie": secureCookie("", 0)
    });
  }

  // Current admin session
  if (path === "/api/admin/me" && method === "GET") {
    const admin = await getAdmin(request, env);

    return admin
      ? json({
          authenticated: true,
          username: admin.username
        })
      : json({
          authenticated: false
        }, 401);
  }

  // All other admin routes require authentication
  if (path.startsWith("/api/admin/")) {
    const auth = await requireAdmin(request, env);

    if (auth.error) return auth.error;

    // Products
    if (path === "/api/admin/products") {
      if (method === "GET") {
        const result = await env.DB.prepare(
          "SELECT * FROM products ORDER BY id DESC"
        ).all();

        return json(result.results);
      }

      if (method === "POST") {
        const d = await body(request);

        if (
          typeof d.name !== "string" ||
          !d.name.trim() ||
          !Number.isFinite(Number(d.price)) ||
          Number(d.price) < 0 ||
          !Number.isInteger(Number(d.stock)) ||
          Number(d.stock) < 0
        ) {
          return json({
            error: "Invalid product details"
          }, 400);
        }

        const result = await env.DB.prepare(`
          INSERT INTO products
          (name, category, description, price, stock, image_url)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          d.name.trim(),
          d.category || "",
          d.description || "",
          Number(d.price),
          Number(d.stock),
          d.image_url || ""
        ).run();

        return json({
          success: true,
          id: result.meta.last_row_id
        }, 201);
      }
    }

    const productMatch = path.match(
      /^\/api\/admin\/products\/(\d+)$/
    );

    if (productMatch) {
      const id = Number(productMatch[1]);

      if (method === "PUT") {
        const d = await body(request);

        if (
          typeof d.name !== "string" ||
          !d.name.trim() ||
          !Number.isFinite(Number(d.price)) ||
          Number(d.price) < 0 ||
          !Number.isInteger(Number(d.stock)) ||
          Number(d.stock) < 0
        ) {
          return json({
            error: "Invalid product details"
          }, 400);
        }

        await env.DB.prepare(`
          UPDATE products SET
            name = ?,
            category = ?,
            description = ?,
            price = ?,
            stock = ?,
            image_url = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(
          d.name.trim(),
          d.category || "",
          d.description || "",
          Number(d.price),
          Number(d.stock),
          d.image_url || "",
          id
        ).run();

        return json({ success: true });
      }

      if (method === "DELETE") {
        await env.DB.prepare(
          "UPDATE products SET active = 0 WHERE id = ?"
        ).bind(id).run();

        return json({ success: true });
      }
    }

    // Customers
    if (path === "/api/admin/customers" && method === "GET") {
      const result = await env.DB.prepare(`
        SELECT c.*,
          COUNT(o.id) AS order_count,
          COALESCE(SUM(
            CASE WHEN o.status != 'cancelled'
            THEN o.total_amount ELSE 0 END
          ), 0) AS total_spent
        FROM customers c
        LEFT JOIN orders o ON o.customer_id = c.id
        GROUP BY c.id
        ORDER BY c.id DESC
      `).all();

      return json(result.results);
    }

    // Orders
    if (path === "/api/admin/orders" && method === "GET") {
      const result = await env.DB.prepare(`
        SELECT o.*,
          c.name AS customer_name,
          c.phone,
          c.address
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        ORDER BY o.id DESC
      `).all();

      return json(result.results);
    }

    const orderMatch = path.match(
      /^\/api\/admin\/orders\/(\d+)$/
    );

    if (orderMatch && method === "PATCH") {
      const d = await body(request);

      const allowed = [
        "pending",
        "confirmed",
        "processing",
        "completed",
        "cancelled"
      ];

      if (!allowed.includes(d.status)) {
        return json({ error: "Invalid status" }, 400);
      }

      await env.DB.prepare(
        "UPDATE orders SET status = ? WHERE id = ?"
      ).bind(d.status, Number(orderMatch[1])).run();

      return json({ success: true });
    }

    // Sales reports
    if (path === "/api/admin/reports" && method === "GET") {
      const summary = await env.DB.prepare(`
        SELECT
          COUNT(*) AS total_orders,
          COALESCE(SUM(
            CASE WHEN status != 'cancelled'
            THEN total_amount ELSE 0 END
          ), 0) AS total_sales,
          COALESCE(SUM(
            CASE WHEN status = 'completed'
            THEN total_amount ELSE 0 END
          ), 0) AS completed_sales,
          COUNT(DISTINCT customer_id) AS customers
        FROM orders
      `).first();

      const daily = await env.DB.prepare(`
        SELECT
          DATE(created_at) AS day,
          COUNT(*) AS orders,
          SUM(
            CASE WHEN status != 'cancelled'
            THEN total_amount ELSE 0 END
          ) AS sales
        FROM orders
        WHERE created_at >= datetime('now', '-30 days')
        GROUP BY DATE(created_at)
        ORDER BY day DESC
      `).all();

      const products = await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM products WHERE active = 1"
      ).first();

      return json({
        ...summary,
        total_products: products.total,
        daily: daily.results
      });
    }

    return json({ error: "Not found" }, 404);
  }

  // Public WhatsApp order creation
  if (path === "/api/orders" && method === "POST") {
    if (!checkOrigin(request)) {
      return json({ error: "Invalid origin" }, 403);
    }

    const d = await body(request);

    if (
      typeof d.name !== "string" ||
      d.name.trim().length < 2 ||
      typeof d.phone !== "string" ||
      !/^[0-9+()\-\s]{8,20}$/.test(d.phone) ||
      !Array.isArray(d.items) ||
      d.items.length < 1 ||
      d.items.length > 30
    ) {
      return json({
        error: "Invalid order details"
      }, 400);
    }

    const phone = d.phone.replace(/\D/g, "");
    const items = [];
    let total = 0;

    for (const item of d.items) {
      const quantity = Number(item.quantity);

      const product = await env.DB.prepare(`
        SELECT id, name, price, stock
        FROM products
        WHERE id = ? AND active = 1
      `).bind(Number(item.product_id)).first();

      if (
        !product ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 100 ||
        quantity > product.stock
      ) {
        return json({
          error: "Product unavailable or invalid quantity"
        }, 400);
      }

      items.push({
        id: product.id,
        name: product.name,
        price: product.price,
        quantity
      });

      total += product.price * quantity;
    }

    await env.DB.prepare(`
      INSERT INTO customers (name, phone)
      VALUES (?, ?)
      ON CONFLICT(phone) DO UPDATE SET name = excluded.name
    `).bind(d.name.trim(), phone).run();

    const customer = await env.DB.prepare(
      "SELECT id FROM customers WHERE phone = ?"
    ).bind(phone).first();

    const order = await env.DB.prepare(`
      INSERT INTO orders (customer_id, total_amount, notes)
      VALUES (?, ?, ?)
    `).bind(
      customer.id,
      total,
      String(d.notes || "").slice(0, 500)
    ).run();

    const orderId = order.meta.last_row_id;

    for (const item of items) {
      await env.DB.prepare(`
        INSERT INTO order_items
        (order_id, product_id, product_name, quantity, price)
        VALUES (?, ?, ?, ?, ?)
      `).bind(
        orderId,
        item.id,
        item.name,
        item.quantity,
        item.price
      ).run();
    }

    const message = [
      "नमस्कार, श्री ओम कृषी केंद्र!",
      `Order #${orderId}`,
      `ग्राहक: ${d.name}`,
      `मोबाईल: ${phone}`,
      ...items.map(i =>
        `${i.name} x ${i.quantity} = ₹${i.price * i.quantity}`
      ),
      `एकूण: ₹${total.toFixed(2)}`
    ].join("\n");

    return json({
      success: true,
      order_id: orderId,
      total,
      whatsapp_url:
        "https://wa.me/917768887401?text=" +
        encodeURIComponent(message)
    }, 201);
  }

  // Static website assets
  if (!env.ASSETS) {
    console.error("ASSETS binding is missing");

    return new Response(
      "Website assets binding is not configured.",
      { status: 503 }
    );
  }

  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      console.error(
        "APPLICATION ERROR:",
        error?.stack || error
      );

      return json({
        error: "Internal server error"
      }, 500);
    }
  }
};
