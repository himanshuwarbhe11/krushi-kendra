
const $ = id => document.getElementById(id);

let products = [];
let editingId = null;

async function api(path, options = {}) {
  const response = await fetch("/api/" + path, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function notify(message) {
  $("message").textContent = message;
}

function showDashboard() {
  $("login").hidden = true;
  $("register").hidden = true;
  $("dashboard").hidden = false;
}

function showLogin() {
  $("login").hidden = false;
  $("register").hidden = true;
  $("dashboard").hidden = true;
}

function showRegister() {
  $("login").hidden = true;
  $("register").hidden = false;
  $("dashboard").hidden = true;
}

async function checkLogin() {
  try {
    await api("admin/me");
    showDashboard();
    await loadProducts();
  } catch {
    showLogin();
  }
}

// LOGIN
$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("loginError").textContent = "";

  try {
    await api("admin/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("username").value.trim(),
        password: $("password").value
      })
    });

    $("password").value = "";

    showDashboard();
    await loadProducts();

  } catch (error) {
    $("loginError").textContent = error.message;
  }
});

// SHOW REGISTRATION
$("showRegister").addEventListener("click", () => {
  $("registerForm").reset();
  $("registerMessage").textContent = "";
  showRegister();
});

// BACK TO LOGIN
$("backToLogin").addEventListener("click", () => {
  showLogin();
});

// CREATE ADMIN
$("registerForm").addEventListener("submit", async e => {
  e.preventDefault();

  const username = $("newUsername").value.trim();
  const password = $("newPassword").value;
  const confirmPassword = $("confirmPassword").value;
  const setupToken = $("setupToken").value;

  $("registerMessage").textContent = "";

  if (username.length < 3) {
    $("registerMessage").textContent =
      "Username must contain at least 3 characters.";
    return;
  }

  if (password.length < 12 || password.length > 128) {
    $("registerMessage").textContent =
      "Password must be between 12 and 128 characters.";
    return;
  }

  if (password !== confirmPassword) {
    $("registerMessage").textContent =
      "Passwords do not match.";
    return;
  }

  try {
    const result = await api("setup", {
      method: "POST",
      body: JSON.stringify({
        setupToken,
        username,
        password
      })
    });

    $("registerMessage").textContent =
      result.message || "Admin account created successfully.";

    $("registerForm").reset();

  } catch (error) {
    $("registerMessage").textContent = error.message;
  }
});

// LOGOUT
$("logout").addEventListener("click", async () => {
  try {
    await api("admin/logout", {
      method: "POST",
      body: "{}"
    });
  } finally {
    showLogin();
  }
});

// DASHBOARD TABS
document.querySelectorAll("[data-tab]").forEach(button => {
  button.addEventListener("click", async () => {
    document.querySelectorAll(".panel").forEach(p => {
      p.hidden = true;
    });

    $(button.dataset.tab).hidden = false;

    const tab = button.dataset.tab;

    try {
      if (tab === "products") await loadProducts();
      if (tab === "customers") await loadCustomers();
      if (tab === "orders") await loadOrders();
      if (tab === "reports") await loadReports();
    } catch (error) {
      notify(error.message);
    }
  });
});

// PRODUCTS
async function loadProducts() {
  products = await api("admin/products");

  $("productList").innerHTML = products.map(p => `
    <div class="item">
      <h4>${escapeHTML(p.name)}</h4>
      <p>₹${Number(p.price).toFixed(2)}
      · Stock: ${p.stock}
      · ${p.active ? "Active" : "Inactive"}</p>

      <button data-edit="${p.id}">Edit</button>

      <button data-delete="${p.id}" class="secondary">
        Delete
      </button>
    </div>
  `).join("") || "No products found.";

  $("productList").querySelectorAll("[data-edit]").forEach(b => {
    b.addEventListener("click", () =>
      editProduct(Number(b.dataset.edit))
    );
  });

  $("productList").querySelectorAll("[data-delete]").forEach(b => {
    b.addEventListener("click", () =>
      deleteProduct(Number(b.dataset.delete))
    );
  });
}

function editProduct(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;

  editingId = id;

  $("productName").value = p.name;
  $("category").value = p.category || "";
  $("description").value = p.description || "";
  $("price").value = p.price;
  $("stock").value = p.stock;
  $("imageUrl").value = p.image_url || "";

  $("saveProduct").textContent = "Update Product";
  $("cancelEdit").hidden = false;

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetProductForm() {
  editingId = null;
  $("productForm").reset();

  $("saveProduct").textContent = "Add Product";
  $("cancelEdit").hidden = true;
}

$("cancelEdit").addEventListener("click", resetProductForm);

$("productForm").addEventListener("submit", async e => {
  e.preventDefault();

  const product = {
    name: $("productName").value.trim(),
    category: $("category").value.trim(),
    description: $("description").value.trim(),
    price: Number($("price").value),
    stock: Number($("stock").value),
    image_url: $("imageUrl").value.trim()
  };

  try {
    await api(
      editingId
        ? `admin/products/${editingId}`
        : "admin/products",
      {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify(product)
      }
    );

    resetProductForm();
    await loadProducts();

    notify("Product saved successfully.");

  } catch (error) {
    notify(error.message);
  }
});

async function deleteProduct(id) {
  if (!confirm("Deactivate this product?")) return;

  try {
    await api(`admin/products/${id}`, {
      method: "DELETE"
    });

    await loadProducts();
    notify("Product deactivated.");

  } catch (error) {
    notify(error.message);
  }
}

// CUSTOMERS
async function loadCustomers() {
  const data = await api("admin/customers");

  $("customerList").innerHTML = data.map(c => `
    <div class="item">
      <h4>${escapeHTML(c.name)}</h4>
      <p>${escapeHTML(c.phone)}</p>
      <p>${escapeHTML(c.address || "")}</p>
      <p>Orders: ${c.order_count}
      · Total: ₹${c.total_spent}</p>
    </div>
  `).join("") || "No customers found.";
}

// ORDERS
async function loadOrders() {
  const data = await api("admin/orders");

  $("orderList").innerHTML = data.map(o => `
    <div class="item">
      <h4>Order #${o.id} - ${escapeHTML(o.customer_name)}</h4>

      <p>${escapeHTML(o.phone)}
      · ₹${Number(o.total_amount).toFixed(2)}</p>

      <p>${escapeHTML(o.created_at)}</p>

      <select data-status="${o.id}">
        ${["pending","confirmed","processing","completed","cancelled"]
          .map(s => `
            <option value="${s}"
              ${s === o.status ? "selected" : ""}>
              ${s}
            </option>
          `).join("")}
      </select>

      <button data-update="${o.id}">
        Update Status
      </button>
    </div>
  `).join("") || "No orders found.";

  $("orderList").querySelectorAll("[data-update]").forEach(button => {
    button.addEventListener("click", async () => {
      const id = button.dataset.update;

      const status = $("orderList")
        .querySelector(`[data-status="${id}"]`).value;

      try {
        await api(`admin/orders/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status })
        });

        notify("Order updated.");

      } catch (error) {
        notify(error.message);
      }
    });
  });
}

// REPORTS
async function loadReports() {
  const r = await api("admin/reports");

  $("reportSummary").innerHTML = `
    <div class="item">Products: ${r.total_products}</div>
    <div class="item">Customers: ${r.customers}</div>
    <div class="item">Orders: ${r.total_orders}</div>
    <div class="item">
      Total sales: ₹${Number(r.total_sales).toFixed(2)}
    </div>
    <div class="item">
      Completed sales: ₹${Number(r.completed_sales).toFixed(2)}
    </div>
  `;

  $("dailyReport").innerHTML = r.daily.map(d => `
    <div class="item">
      ${escapeHTML(d.day)}
      · Orders: ${d.orders}
      · Sales: ₹${Number(d.sales).toFixed(2)}
    </div>
  `).join("") || "No sales recorded.";
}

// HTML SECURITY
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

// INITIALIZE
checkLogin();
