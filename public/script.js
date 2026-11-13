
const $ = id => document.getElementById(id);

let products = [];
let cart = [];
let currentCategory = "all";
let language = "mr";

const translations = {
  mr: {
    search: "उत्पादने शोधा...",
    loading: "उत्पादने लोड होत आहेत...",
    empty: "सध्या उत्पादने उपलब्ध नाहीत.",
    error: "उत्पादने लोड करण्यात अडचण आली.",
    add: "कार्टमध्ये टाका",
    out: "स्टॉक उपलब्ध नाही",
    stock: "शिल्लक",
    category: "सर्व",
    added: "उत्पादन कार्टमध्ये जोडले.",
    checkout: "WhatsApp वर ऑर्डर करा",
    success: "ऑर्डर तयार झाली. WhatsApp उघडत आहे...",
    failure: "ऑर्डर करण्यात अडचण आली."
  },
  en: {
    search: "Search products...",
    loading: "Loading products...",
    empty: "No products currently available.",
    error: "Unable to load products.",
    add: "Add to Cart",
    out: "Out of stock",
    stock: "Available",
    category: "All",
    added: "Product added to cart.",
    checkout: "Order through WhatsApp",
    success: "Order created. Opening WhatsApp...",
    failure: "Unable to place order."
  }
};

function money(value) {
  return Number(value).toFixed(2);
}

async function getProducts() {
  $("productGrid").textContent = translations[language].loading;

  try {
    const response = await fetch("/api/public/products");
    if (!response.ok) throw new Error("Product request failed");

    products = await response.json();
    renderProducts();
  } catch (error) {
    $("productGrid").textContent = translations[language].error;
  }
}

function renderProducts() {
  const term = $("searchInput").value.toLowerCase().trim();

  const filtered = products.filter(p => {
    const categoryMatch =
      currentCategory === "all" ||
      (p.category || "").toLowerCase() === currentCategory.toLowerCase();

    const searchMatch =
      `${p.name} ${p.category || ""} ${p.description || ""}`
        .toLowerCase().includes(term);

    return categoryMatch && searchMatch;
  });

  const grid = $("productGrid");
  grid.replaceChildren();

  if (!filtered.length) {
    grid.textContent = translations[language].empty;
    return;
  }

  filtered.forEach(p => {
    const card = document.createElement("article");
    card.className = "product-card";

    const image = document.createElement("img");
    image.alt = p.name;
    image.loading = "lazy";
    image.src = p.image_url || "";
    image.onerror = () => {
      image.removeAttribute("src");
      image.alt = "🌱";
    };

    const name = document.createElement("h3");
    name.textContent = p.name;

    const description = document.createElement("p");
    description.textContent = p.description || "";

    const price = document.createElement("div");
    price.className = "price";
    price.textContent = `₹${money(p.price)}`;

    const stock = document.createElement("p");
    stock.className = "stock";
    stock.textContent =
      `${translations[language].stock}: ${p.stock}`;

    const button = document.createElement("button");
    button.textContent = Number(p.stock) > 0
      ? translations[language].add
      : translations[language].out;

    button.disabled = Number(p.stock) <= 0;
    button.addEventListener("click", () => addToCart(p.id));

    card.append(image, name, description, price, stock, button);
    grid.append(card);
  });
}

function addToCart(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;

  const existing = cart.find(item => item.id === id);
  const quantity = existing ? existing.quantity : 0;

  if (quantity >= Number(product.stock)) {
    alert("Available stock limit reached.");
    return;
  }

  if (existing) existing.quantity++;
  else cart.push({ id, quantity: 1 });

  renderCart();
  alert(translations[language].added);
}

function changeQuantity(id, change) {
  const item = cart.find(x => x.id === id);
  const product = products.find(x => x.id === id);
  if (!item || !product) return;

  item.quantity += change;

  if (item.quantity <= 0) {
    cart = cart.filter(x => x.id !== id);
  } else if (item.quantity > Number(product.stock)) {
    item.quantity = Number(product.stock);
    alert("Available stock limit reached.");
  }

  renderCart();
}

function renderCart() {
  $("cartCount").textContent =
    cart.reduce((sum, item) => sum + item.quantity, 0);

  const container = $("cartItems");
  container.replaceChildren();

  let total = 0;

  cart.forEach(item => {
    const product = products.find(p => p.id === item.id);
    if (!product) return;

    total += Number(product.price) * item.quantity;

    const line = document.createElement("div");
    line.className = "cart-line";

    const details = document.createElement("span");
    details.textContent =
      `${product.name} × ${item.quantity} = ₹${money(product.price * item.quantity)}`;

    const controls = document.createElement("span");

    const minus = document.createElement("button");
    minus.textContent = "−";
    minus.type = "button";
    minus.addEventListener("click", () => changeQuantity(item.id, -1));

    const plus = document.createElement("button");
    plus.textContent = "+";
    plus.type = "button";
    plus.addEventListener("click", () => changeQuantity(item.id, 1));

    controls.append(minus, plus);
    line.append(details, controls);
    container.append(line);
  });

  $("cartTotal").textContent = money(total);
}

$("cartBtn").addEventListener("click", () => {
  $("cartModal").classList.add("open");
  $("cartModal").setAttribute("aria-hidden", "false");
});

$("closeCart").addEventListener("click", closeCart);

function closeCart() {
  $("cartModal").classList.remove("open");
  $("cartModal").setAttribute("aria-hidden", "true");
}

$("cartModal").addEventListener("click", e => {
  if (e.target === $("cartModal")) closeCart();
});

$("searchInput").addEventListener("input", renderProducts);

$("categories").addEventListener("click", e => {
  const button = e.target.closest("[data-category]");
  if (!button) return;

  currentCategory = button.dataset.category;

  document.querySelectorAll(".category").forEach(b =>
    b.classList.toggle("active", b === button)
  );

  renderProducts();
});

$("languageBtn").addEventListener("click", () => {
  language = language === "mr" ? "en" : "mr";
  $("languageBtn").textContent =
    language === "mr" ? "English" : "मराठी";

  document.documentElement.lang = language;

  document.querySelectorAll("[data-en]").forEach(element => {
    element.textContent = element.dataset[language];
  });

  $("searchInput").placeholder = translations[language].search;
  $("checkoutBtn").textContent = translations[language].checkout;

  document.querySelectorAll(".category").forEach(button => {
    const key = button.dataset.category;
    const names = {
      all: { mr: "सर्व", en: "All" },
      Seeds: { mr: "बियाणे", en: "Seeds" },
      Fertilizers: { mr: "खते", en: "Fertilizers" },
      Pesticides: { mr: "कीटकनाशके", en: "Crop Care" },
      Tools: { mr: "शेती साधने", en: "Tools" }
    };

    button.textContent = names[key]?.[language] || key;
  });

  renderProducts();
  renderCart();
});

$("checkoutForm").addEventListener("submit", async e => {
  e.preventDefault();

  if (!cart.length) {
    alert("Your cart is empty.");
    return;
  }

  const button = $("checkoutBtn");
  button.disabled = true;
  button.textContent = "Please wait...";

  const order = {
    name: $("customerName").value.trim(),
    phone: $("customerPhone").value.trim(),
    notes: $("orderNotes").value.trim(),
    items: cart.map(item => ({
      product_id: item.id,
      quantity: item.quantity
    }))
  };

  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(order)
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Order failed");
    }

    $("orderMessage").textContent =
      `${translations[language].success} Order #${result.order_id}`;

    cart = [];
    renderCart();
    await getProducts();

    window.open(result.whatsapp_url, "_blank", "noopener");

    $("checkoutForm").reset();
  } catch (error) {
    $("orderMessage").textContent =
      `${translations[language].failure} ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = translations[language].checkout;
  }
});

$("year").textContent = new Date().getFullYear();

getProducts();
renderCart();

