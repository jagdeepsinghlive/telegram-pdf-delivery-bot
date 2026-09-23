/**
 * PDF ORBIT — Telegram PDF Delivery Bot
 * Cloudflare Worker + Supabase
 *
 * Required Production Variables / Secrets:
 *
 * BOT_TOKEN              Secret
 * SUPABASE_URL           Variable
 * SUPABASE_KEY           Secret (Supabase Secret/service_role)
 * ADMIN_TELEGRAM_ID      Variable
 * WEBHOOK_SECRET         Secret
 * CHANNEL_ID             Variable
 * CHANNEL_INVITE_URL     Variable
 *
 * Optional:
 * TELEGRAM_API            defaults to https://api.telegram.org
 */

const TG = "https://api.telegram.org";

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // CORS / preflight
      if (request.method === "OPTIONS") {
        return corsResponse("", 204);
      }

      // Health
      if (request.method === "GET" && url.pathname === "/") {
        return json({
          ok: true,
          name: "PDF ORBIT",
          status: "online",
          api: true,
          time: new Date().toISOString()
        });
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return json({
          ok: true,
          status: "healthy",
          service: "PDF ORBIT Worker",
          time: new Date().toISOString()
        });
      }

      // Public website APIs
      if (request.method === "GET" && url.pathname === "/api/products") {
        return await apiProducts(env);
      }

      if (request.method === "GET" && url.pathname === "/api/categories") {
        return await apiCategories(env);
      }

      if (request.method === "GET" && url.pathname === "/api/settings") {
        return await apiSettings(env);
      }

      if (request.method === "GET" && url.pathname === "/api/search") {
        return await apiSearch(env, url.searchParams.get("q") || "");
      }

      if (request.method === "GET" && url.pathname.startsWith("/api/product-cover/")) {
        const productId = decodeURIComponent(
          url.pathname.substring("/api/product-cover/".length)
        );
        return await apiProductCover(request, env, productId);
      }

      if (request.method === "GET" && url.pathname.startsWith("/api/product/")) {
        const productId = decodeURIComponent(
          url.pathname.substring("/api/product/".length)
        );
        return await apiProduct(env, productId);
      }

      // Telegram webhook
      if (request.method === "POST" && url.pathname === "/") {
        const secret = env.WEBHOOK_SECRET;

        if (secret) {
          const received =
            request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";

          if (received !== secret) {
            return new Response("Unauthorized", { status: 401 });
          }
        }

        const update = await request.json();
        ctx.waitUntil(handleTelegramUpdate(update, env));

        return json({ ok: true });
      }

      return json({ ok: false, error: "Not found" }, 404);
    } catch (error) {
      console.error(error);

      return json(
        {
          ok: false,
          error: error?.message || String(error)
        },
        500
      );
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanupExpired(env));
  }
};

/* =========================================================
   RESPONSE HELPERS
========================================================= */

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Bot-Api-Secret-Token",
    "Cache-Control": "no-store"
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders()
    }
  });
}

function corsResponse(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      ...headers,
      ...corsHeaders()
    }
  });
}

function html(data, status = 200) {
  return new Response(data, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...corsHeaders()
    }
  });
}

/* =========================================================
   SUPABASE
========================================================= */

async function sb(env, table, options = {}) {
  const {
    select = "*",
    filter = [],
    order,
    limit,
    method = "GET",
    body,
    single = false
  } = options;

  let url = `${env.SUPABASE_URL}/rest/v1/${table}`;

  const params = [];

  if (select) {
    params.push(`select=${encodeURIComponent(select)}`);
  }

  for (const f of filter) {
    params.push(
      `${encodeURIComponent(f.column)}=${encodeURIComponent(
        f.operator || "eq"
      )}.${encodeURIComponent(f.value)}`
    );
  }

  if (order) {
    params.push(`order=${encodeURIComponent(order)}`);
  }

  if (limit) {
    params.push(`limit=${encodeURIComponent(limit)}`);
  }

  if (params.length) {
    url += "?" + params.join("&");
  }

  const headers = {
    apikey: env.SUPABASE_KEY,
    Authorization: `Bearer ${env.SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: single ? "return=representation" : "return=representation"
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${text}`);
  }

  if (!text) return [];

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function sbInsert(env, table, body) {
  return await sb(env, table, {
    method: "POST",
    body
  });
}

async function sbUpdate(env, table, filter, body) {
  return await sb(env, table, {
    method: "PATCH",
    filter,
    body
  });
}

async function sbDelete(env, table, filter) {
  return await sb(env, table, {
    method: "DELETE",
    filter
  });
}

/* =========================================================
   PUBLIC API
========================================================= */

async function apiProducts(env) {
  const rows = await sb(env, "products", {
    select:
      "id,product_id,title,description,price,file_name,file_size,mime_type,cover_image,category_id,status,product_type,created_at,updated_at",
    filter: [
      { column: "status", operator: "eq", value: "active" }
    ],
    order: "created_at.desc"
  });

  return json(rows);
}

async function apiCategories(env) {
  const rows = await sb(env, "categories", {
    select:
      "id,category_id,name,slug,description,image_url,status,created_at",
    filter: [
      { column: "status", operator: "eq", value: "active" }
    ],
    order: "created_at.desc"
  });

  return json(rows);
}

async function apiSettings(env) {
  const rows = await sb(env, "settings", {
    select: "key,value",
    filter: [
      { column: "key", operator: "in", value: "(website_url,contact_admin)" }
    ]
  });

  const result = {};

  for (const row of rows) {
    result[row.key] = row.value;
  }

  return json(result);
}

async function apiSearch(env, query) {
  const q = String(query || "").trim();

  if (!q) {
    return await apiProducts(env);
  }

  const safe = q.replace(/,/g, " ");

  const url =
    `${env.SUPABASE_URL}/rest/v1/products` +
    `?select=id,product_id,title,description,price,file_name,file_size,mime_type,cover_image,category_id,status,product_type,created_at,updated_at` +
    `&status=eq.active` +
    `&or=(title.ilike.*${encodeURIComponent(safe)}*,description.ilike.*${encodeURIComponent(safe)}*,product_type.ilike.*${encodeURIComponent(safe)}*)` +
    `&order=created_at.desc`;

  const response = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_KEY,
      Authorization: `Bearer ${env.SUPABASE_KEY}`
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Search failed: ${text}`);
  }

  return new Response(text || "[]", {
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders()
    }
  });
}

async function apiProduct(env, productId) {
  const rows = await sb(env, "products", {
    select:
      "id,product_id,title,description,price,file_name,file_size,mime_type,cover_image,category_id,status,product_type,created_at,updated_at",
    filter: [
      { column: "product_id", operator: "eq", value: productId },
      { column: "status", operator: "eq", value: "active" }
    ],
    limit: 1
  });

  if (!rows.length) {
    return json(
      {
        ok: false,
        error: "Product not found"
      },
      404
    );
  }

  return json(rows[0]);
}

/* =========================================================
   PRODUCT COVER IMAGE PROXY
========================================================= */

async function apiProductCover(request, env, productId) {
  const products = await sb(env, "products", {
    select: "id,product_id,cover_image,status",
    filter: [
      { column: "product_id", operator: "eq", value: productId },
      { column: "status", operator: "eq", value: "active" }
    ],
    limit: 1
  });

  if (!products.length) {
    return new Response("Product not found", {
      status: 404,
      headers: corsHeaders()
    });
  }

  const cover = products[0].cover_image;

  if (!cover) {
    return new Response("Cover not available", {
      status: 404,
      headers: corsHeaders()
    });
  }

  /*
   * If cover_image already contains a normal public URL,
   * redirect to it.
   */
  if (
    cover.startsWith("http://") ||
    cover.startsWith("https://") ||
    cover.startsWith("data:image/")
  ) {
    if (cover.startsWith("data:image/")) {
      const match = cover.match(/^data:(image\/[^;]+);base64,(.*)$/);

      if (!match) {
        return new Response("Invalid image", {
          status: 400,
          headers: corsHeaders()
        });
      }

      const bytes = Uint8Array.from(
        atob(match[2]),
        c => c.charCodeAt(0)
      );

      return new Response(bytes, {
        headers: {
          "Content-Type": match[1],
          "Cache-Control": "public, max-age=86400",
          ...corsHeaders()
        }
      });
    }

    return Response.redirect(cover, 302);
  }

  /*
   * Otherwise assume cover_image is a Telegram file_id.
   */

  try {
    const file = await telegram("getFile", {
      file_id: cover
    }, env);

    if (!file.ok || !file.result?.file_path) {
      return new Response("Telegram image unavailable", {
        status: 404,
        headers: corsHeaders()
      });
    }

    const imageUrl =
      `${TG}/file/bot${env.BOT_TOKEN}/${file.result.file_path}`;

    const imageResponse = await fetch(imageUrl);

    if (!imageResponse.ok) {
      return new Response("Unable to load Telegram image", {
        status: 502,
        headers: corsHeaders()
      });
    }

    const headers = new Headers(imageResponse.headers);

    headers.set(
      "Cache-Control",
      "public, max-age=86400, s-maxage=86400"
    );

    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(imageResponse.body, {
      status: imageResponse.status,
      headers
    });
  } catch (error) {
    return new Response("Cover image error", {
      status: 500,
      headers: corsHeaders()
    });
  }
}

/* =========================================================
   TELEGRAM API
========================================================= */

async function telegram(method, body, env) {
  const response = await fetch(
    `${TG}/bot${env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body || {})
    }
  );

  const data = await response.json();

  if (!data.ok) {
    console.error("Telegram error:", method, data);
  }

  return data;
}

async function sendMessage(chatId, text, env, extra = {}) {
  return await telegram(
    "sendMessage",
    {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...extra
    },
    env
  );
}

async function sendPhoto(chatId, photo, caption, env, extra = {}) {
  return await telegram(
    "sendPhoto",
    {
      chat_id: chatId,
      photo,
      caption,
      parse_mode: "HTML",
      ...extra
    },
    env
  );
}

async function sendDocument(chatId, document, caption, env, extra = {}) {
  return await telegram(
    "sendDocument",
    {
      chat_id: chatId,
      document,
      caption,
      parse_mode: "HTML",
      ...extra
    },
    env
  );
}

/* =========================================================
   TELEGRAM UPDATE HANDLER
========================================================= */

async function handleTelegramUpdate(update, env) {
  try {
    if (update.message) {
      await handleMessage(update.message, env);
      return;
    }

    if (update.callback_query) {
      await handleCallback(update.callback_query, env);
      return;
    }
  } catch (error) {
    console.error("Update handler error:", error);
  }
}

/* =========================================================
   MESSAGE HANDLER
========================================================= */

async function handleMessage(message, env) {
  const chatId = message.chat?.id;

  if (!chatId) return;

  const user = message.from || {};
  const text = String(message.text || "").trim();

  await upsertUser(user, env);

  if (text.startsWith("/start")) {
    const payload = text.substring(6).trim();

    await handleStart(message, payload, env);
    return;
  }

  if (text === "/cancel") {
    await clearSession(chatId, env);

    await sendMessage(
      chatId,
      "❌ Current operation cancelled.",
      env,
      mainKeyboard(chatId, env)
    );

    return;
  }

  if (text === "/admin") {
    if (await isAdmin(chatId, env)) {
      await adminPanel(chatId, env);
    } else {
      await sendMessage(chatId, "⛔ Admin access required.", env);
    }

    return;
  }

  if (text === "/newproduct") {
    if (await canAdmin(chatId, "product", env)) {
      await startNewProduct(chatId, env);
    }

    return;
  }

  if (text === "/search") {
    await startSearch(chatId, env);
    return;
  }

  const session = await getSession(chatId, env);

  if (session?.expires_at) {
    if (new Date(session.expires_at) < new Date()) {
      await clearSession(chatId, env);
      await sendMessage(
        chatId,
        "⌛ Your previous session expired. Please start again.",
        env
      );
      return;
    }
  }

  if (session) {
    const handled = await handleSessionText(message, session, env);

    if (handled) return;
  }

  if (text) {
    await handleMenuText(chatId, text, env);
  }
}

/* =========================================================
   START
========================================================= */

async function handleStart(message, payload, env) {
  const chatId = message.chat.id;

  if (!payload) {
    await clearSession(chatId, env);

    await sendMessage(
      chatId,
      `<b>🚀 Welcome to PDF ORBIT</b>

Find free books, notes, PDFs and study materials.

Choose an option below 👇`,
      env,
      mainKeyboard(chatId, env)
    );

    return;
  }

  /*
   * Referral deep link:
   * /start ref_PRODUCTID_REFERRER
   */
  if (payload.startsWith("ref_")) {
    const parts = payload.split("_");

    if (parts.length >= 3) {
      const productId = parts[1];
      const referrer = Number(parts[2]);

      if (referrer && referrer !== chatId) {
        await registerReferral(referrer, chatId, productId, env);
      }

      await openProduct(chatId, productId, env);
      return;
    }
  }

  /*
   * Normal product deep link:
   * /start PRODUCT_ID
   */
  await openProduct(chatId, payload, env);
}

/* =========================================================
   MAIN MENU
========================================================= */

function mainKeyboard(chatId, env) {
  const rows = [
    [
      { text: "📚 Latest PDFs", callback_data: "latest_products" },
      { text: "🔎 Search", callback_data: "search_products" }
    ],
    [
      { text: "📂 Categories", callback_data: "categories" },
      { text: "✨ More", callback_data: "more_menu" }
    ],
    [
      { text: "👨‍💻 Contact Admin", callback_data: "contact_admin" }
    ]
  ];

  // Show Admin Panel to the configured owner/admin ID.
  if (String(chatId) === String(env.ADMIN_TELEGRAM_ID)) {
    rows.push([
      { text: "👑 Admin Panel", callback_data: "admin_panel" }
    ]);
  }

  return {
    reply_markup: {
      inline_keyboard: rows
    }
  };
}

async function handleMenuText(chatId, text, env) {
  const lower = text.toLowerCase();

  if (
    lower.includes("latest") ||
    lower.includes("pdf")
  ) {
    await latestProducts(chatId, env);
    return;
  }

  if (lower.includes("search")) {
    await startSearch(chatId, env);
    return;
  }

  if (lower.includes("categor")) {
    await categoriesMenu(chatId, env);
    return;
  }

  await sendMessage(
    chatId,
    "Please choose an option from the menu.",
    env,
    mainKeyboard(chatId, env)
  );
}

/* =========================================================
   PRODUCTS
========================================================= */

async function latestProducts(chatId, env) {
  const products = await sb(env, "products", {
    select:
      "id,product_id,title,description,price,file_name,file_size,cover_image,category_id,product_type,status",
    filter: [
      { column: "status", operator: "eq", value: "active" }
    ],
    order: "created_at.desc",
    limit: 10
  });

  if (!products.length) {
    await sendMessage(chatId, "📂 No products available yet.", env);
    return;
  }

  await sendMessage(chatId, "<b>📚 Latest PDFs</b>", env);

  for (const product of products) {
    await sendProductCard(chatId, product, env);
  }
}

async function sendProductCard(chatId, product, env) {
  const text =
    `<b>${escapeHtml(product.title)}</b>\n\n` +
    `${escapeHtml(product.description || "No description available.")}\n\n` +
    `📌 Type: <b>${escapeHtml(product.product_type || "PDF")}</b>\n` +
    `💰 Free`;

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "📥 Get PDF",
          callback_data: `open_product:${product.product_id}`
        }
      ]
    ]
  };

  if (product.cover_image) {
    const result = await sendPhoto(
      chatId,
      product.cover_image,
      text,
      env,
      {
        reply_markup: keyboard
      }
    );

    if (result.ok) return;
  }

  await sendMessage(
    chatId,
    text,
    env,
    {
      reply_markup: keyboard
    }
  );
}

async function openProduct(chatId, productId, env) {
  const products = await sb(env, "products", {
    select:
      "id,product_id,title,description,price,file_name,file_size,cover_image,category_id,product_type,status,deleted_at",
    filter: [
      { column: "product_id", operator: "eq", value: productId },
      { column: "status", operator: "eq", value: "active" }
    ],
    limit: 1
  });

  if (!products.length) {
    await sendMessage(
      chatId,
      "❌ This product does not exist or is no longer available.",
      env
    );

    return;
  }

  const product = products[0];

  await updateUser(env, chatId, {
    current_product_id: product.id,
    last_activity_at: new Date().toISOString(),
    expires_at: new Date(
      Date.now() + 20 * 60 * 1000
    ).toISOString()
  });

  await setSession(env, chatId, {
    step: "product_open",
    product_id: product.product_id,
    title: product.title,
    description: product.description,
    price: product.price,
    telegram_file_id: null,
    file_name: product.file_name,
    file_size: product.file_size,
    mime_type: null,
    cover_image_file_id: product.cover_image,
    product_type: product.product_type,
    expires_at: new Date(
      Date.now() + 20 * 60 * 1000
    ).toISOString()
  });

  const joined = await verifyRequiredChannel(chatId, env);

  if (!joined) {
    await sendMessage(
      chatId,
      `<b>🔒 Channel verification required</b>

Please join our required Telegram channel and then tap <b>Verify Join</b>.`,
      env,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "📢 Join Channel",
                url:
                  env.CHANNEL_INVITE_URL ||
                  (await getSetting(env, "channel_join_url")) ||
                  "https://t.me/"
              }
            ],
            [
              {
                text: "✅ Verify Join",
                callback_data: `verify_channel:${product.product_id}`
              }
            ]
          ]
        }
      }
    );

    return;
  }

  await startProductTasks(chatId, product, env);
}

/* =========================================================
   CHANNEL VERIFICATION
========================================================= */

async function verifyRequiredChannel(chatId, env) {
  const channelId =
    env.CHANNEL_ID ||
    (await getSetting(env, "channel_id"));

  if (!channelId) return true;

  try {
    const result = await telegram(
      "getChatMember",
      {
        chat_id: channelId,
        user_id: chatId
      },
      env
    );

    if (!result.ok) return false;

    const status = result.result?.status;

    return [
      "creator",
      "administrator",
      "member"
    ].includes(status);
  } catch {
    return false;
  }
}

/* =========================================================
   PRODUCT TASKS
========================================================= */

async function startProductTasks(chatId, product, env) {
  const tasks = await sb(env, "product_tasks", {
    select:
      "id,product_id,task_type,title,description,task_url,channel_id,required_count,sort_order,status,required",
    filter: [
      { column: "product_id", operator: "eq", value: product.id },
      { column: "status", operator: "eq", value: "active" }
    ],
    order: "sort_order.asc"
  });

  const requiredTasks = tasks.filter(t => t.required !== false);

  if (!requiredTasks.length) {
    await startReferralOrDelivery(chatId, product, env);
    return;
  }

  await sendTask(chatId, product, requiredTasks[0], env);
}

async function sendTask(chatId, product, task, env) {
  await setSessionStep(env, chatId, "task_wait");

  const keyboard = [];

  if (task.task_url) {
    keyboard.push([
      {
        text:
          task.task_type === "channel" ||
          task.task_type === "group"
            ? "📢 Open Channel"
            : "🔗 Open Task",
        url: task.task_url
      }
    ]);
  }

  keyboard.push([
    {
      text: "✅ Verify Task",
      callback_data: `check_task:${task.id}`
    }
  ]);

  const text =
    `<b>📋 Required Task</b>\n\n` +
    `<b>${escapeHtml(task.title)}</b>\n\n` +
    `${escapeHtml(task.description || "")}\n\n` +
    `Complete the task and then press <b>Verify Task</b>.`;

  await sendMessage(
    chatId,
    text,
    env,
    {
      reply_markup: {
        inline_keyboard: keyboard
      }
    }
  );
}

async function verifyTask(chatId, taskId, env) {
  const tasks = await sb(env, "product_tasks", {
    select:
      "id,product_id,task_type,title,description,task_url,channel_id,required_count,sort_order,status,required",
    filter: [
      { column: "id", operator: "eq", value: taskId },
      { column: "status", operator: "eq", value: "active" }
    ],
    limit: 1
  });

  if (!tasks.length) {
    await sendMessage(chatId, "❌ Task not found.", env);
    return;
  }

  const task = tasks[0];

  let completed = false;

  if (
    task.task_type === "channel" ||
    task.task_type === "group"
  ) {
    const channelId = task.channel_id || task.task_url;

    if (channelId) {
      const result = await telegram(
        "getChatMember",
        {
          chat_id: channelId,
          user_id: chatId
        },
        env
      );

      if (result.ok) {
        completed = [
          "creator",
          "administrator",
          "member"
        ].includes(result.result?.status);
      }
    }
  } else if (task.task_type === "referral") {
    completed = await checkReferralTask(chatId, task, env);
  } else {
    /*
     * Website/custom-link tasks cannot be truthfully verified
     * externally. User can be marked complete only by admin.
     */
    completed = await isUserTaskCompleted(chatId, task.id, env);
  }

  if (!completed) {
    await sendMessage(
      chatId,
      "❌ Task is not verified yet. Please complete it and try again.",
      env
    );
    return;
  }

  await markUserTask(chatId, task.id, env);

  const product = await getProductByDbId(task.product_id, env);

  if (!product) {
    await sendMessage(chatId, "❌ Product unavailable.", env);
    return;
  }

  const nextTasks = await sb(env, "product_tasks", {
    select:
      "id,product_id,task_type,title,description,task_url,channel_id,required_count,sort_order,status,required",
    filter: [
      { column: "product_id", operator: "eq", value: task.product_id },
      { column: "status", operator: "eq", value: "active" }
    ],
    order: "sort_order.asc"
  });

  for (const next of nextTasks) {
    if (next.required === false) continue;

    const done = await isUserTaskCompleted(chatId, next.id, env);

    if (!done) {
      await sendTask(chatId, product, next, env);
      return;
    }
  }

  await startReferralOrDelivery(chatId, product, env);
}

/* =========================================================
   REFERRALS
========================================================= */

async function startReferralOrDelivery(chatId, product, env) {
  const referralTasks = await sb(env, "product_tasks", {
    select:
      "id,product_id,task_type,title,description,task_url,channel_id,required_count,sort_order,status,required",
    filter: [
      { column: "product_id", operator: "eq", value: product.id },
      { column: "task_type", operator: "eq", value: "referral" },
      { column: "status", operator: "eq", value: "active" }
    ],
    order: "sort_order.asc",
    limit: 1
  });

  if (referralTasks.length) {
    const task = referralTasks[0];

    const count = await referralCount(
      chatId,
      product.id,
      env
    );

    const required = Number(task.required_count || 1);

    if (count < required) {
      await setSessionStep(env, chatId, "referral_wait");

      const botUsername =
        env.BOT_USERNAME ||
        "PDForbitbot";

      const link =
        `https://t.me/${botUsername}` +
        `?start=ref_${product.product_id}_${chatId}`;

      await sendMessage(
        chatId,
        `<b>👥 Referral Required</b>

Invite <b>${required}</b> user(s) to unlock this PDF.

Current: <b>${count}/${required}</b>

Your referral link:
<code>${escapeHtml(link)}</code>`,
        env,
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "📤 Share Referral Link",
                  url:
                    `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Get this PDF from PDF Orbit")}`
                }
              ],
              [
                {
                  text: "🔄 Check Referral",
                  callback_data:
                    `check_referral:${product.product_id}`
                }
              ]
            ]
          }
        }
      );

      return;
    }
  }

  await deliverProduct(chatId, product, env);
}

async function registerReferral(
  referrer,
  referred,
  productId,
  env
) {
  const products = await sb(env, "products", {
    select: "id",
    filter: [
      { column: "product_id", operator: "eq", value: productId }
    ],
    limit: 1
  });

  if (!products.length) return;

  try {
    await sbInsert(env, "referrals", {
      referrer_telegram_user_id: referrer,
      referred_telegram_user_id: referred,
      product_id: products[0].id,
      status: "completed",
      completed_at: new Date().toISOString(),
      expires_at: new Date(
        Date.now() + 20 * 60 * 1000
      ).toISOString()
    });
  } catch (e) {
    console.error("Referral insert:", e);
  }
}

async function referralCount(referrer, productDbId, env) {
  const rows = await sb(env, "referrals", {
    select: "id",
    filter: [
      {
        column: "referrer_telegram_user_id",
        operator: "eq",
        value: referrer
      },
      {
        column: "product_id",
        operator: "eq",
        value: productDbId
      },
      {
        column: "status",
        operator: "eq",
        value: "completed"
      }
    ]
  });

  return rows.length;
}

async function checkReferralTask(chatId, task, env) {
  const user = await getUser(chatId, env);

  if (!user?.current_product_id) return false;

  const count = await referralCount(
    chatId,
    user.current_product_id,
    env
  );

  return count >= Number(task.required_count || 1);
}

/* =========================================================
   DELIVERY
========================================================= */

async function deliverProduct(chatId, product, env) {
  if (!product.telegram_file_id) {
    await sendMessage(
      chatId,
      "❌ PDF file is not available right now. Please contact admin.",
      env
    );
    return;
  }

  await sendMessage(
    chatId,
    `<b>🎉 PDF Unlocked!</b>

Sending your file now...`,
    env
  );

  const result = await sendDocument(
    chatId,
    product.telegram_file_id,
    `<b>${escapeHtml(product.title)}</b>\n\nDelivered by PDF ORBIT.`,
    env
  );

  if (!result.ok) {
    await sendMessage(
      chatId,
      "❌ Telegram could not deliver the file. Please contact admin.",
      env
    );

    return;
  }

  await recordPurchaseDelivery(chatId, product, env);

  await clearSession(chatId, env);

  await sendMessage(
    chatId,
    "✅ <b>Delivered successfully.</b>\n\nThank you for using PDF ORBIT.",
    env,
    mainKeyboard(chatId, env)
  );
}

async function recordPurchaseDelivery(chatId, product, env) {
  try {
    await sbInsert(env, "purchases", {
      telegram_user_id: chatId,
      product_id: product.id,
      amount: Number(product.price || 0),
      payment_status: "free",
      payment_id: null,
      delivered: true,
      purchased_at: new Date().toISOString()
    });
  } catch (e) {
    console.error("Purchase record:", e);
  }
}

/* =========================================================
   CALLBACKS
========================================================= */

async function handleCallback(query, env) {
  const chatId = query.message?.chat?.id;
  const data = String(query.data || "");

  if (!chatId) return;

  await telegram(
    "answerCallbackQuery",
    {
      callback_query_id: query.id
    },
    env
  );

  if (data === "latest_products") {
    await latestProducts(chatId, env);
    return;
  }

  if (data === "search_products") {
    await startSearch(chatId, env);
    return;
  }

  if (data === "categories") {
    await categoriesMenu(chatId, env);
    return;
  }

  if (data === "contact_admin") {
    await contactAdmin(chatId, env);
    return;
  }

  if (data === "more_menu") {
    const website = await getSetting(env, "website_url");
    await sendMessage(chatId, "<b>✨ More Options</b>\n\nChoose an option:", env, {
      reply_markup:{inline_keyboard:[
        [{text:"📚 Latest PDFs",callback_data:"latest_products"}],
        [{text:"📂 Categories",callback_data:"categories"}],
        ...(website ? [[{text:"🌐 Website",url:website}]] : []),
        [{text:"👨‍💻 Contact Admin",callback_data:"contact_admin"}]
      ]}
    });
    return;
  }

  if (data.startsWith("open_product:")) {
    await openProduct(
      chatId,
      data.substring("open_product:".length),
      env
    );
    return;
  }

  if (data.startsWith("verify_channel:")) {
    const productId = data.substring(
      "verify_channel:".length
    );

    const joined = await verifyRequiredChannel(chatId, env);

    if (!joined) {
      await sendMessage(
        chatId,
        "❌ You have not joined the required channel yet.",
        env
      );
      return;
    }

    const products = await sb(env, "products", {
      select:
        "id,product_id,title,description,price,file_name,file_size,cover_image,category_id,product_type,status,telegram_file_id",
      filter: [
        { column: "product_id", operator: "eq", value: productId },
        { column: "status", operator: "eq", value: "active" }
      ],
      limit: 1
    });

    if (products.length) {
      await startProductTasks(
        chatId,
        products[0],
        env
      );
    }

    return;
  }

  if (data.startsWith("check_task:")) {
    const taskId = Number(
      data.substring("check_task:".length)
    );

    await verifyTask(chatId, taskId, env);
    return;
  }

  if (data.startsWith("check_referral:")) {
    const productId = data.substring(
      "check_referral:".length
    );

    const products = await sb(env, "products", {
      select:
        "id,product_id,title,description,price,file_name,file_size,cover_image,category_id,product_type,status,telegram_file_id",
      filter: [
        { column: "product_id", operator: "eq", value: productId },
        { column: "status", operator: "eq", value: "active" }
      ],
      limit: 1
    });

    if (products.length) {
      await startReferralOrDelivery(
        chatId,
        products[0],
        env
      );
    }

    return;
  }

  /* Admin callbacks */

  if (data === "admin_panel") {
    if (await isAdmin(chatId, env)) {
      await adminPanel(chatId, env);
    }
    return;
  }

  if (data === "admin_products") {
    if (await canAdmin(chatId, "product", env)) {
      await adminProducts(chatId, env);
    }
    return;
  }

  if (data === "admin_tasks") {
    if (await canAdmin(chatId, "task", env)) {
      await adminTasks(chatId, env);
    }
    return;
  }

  if (data === "admin_users") {
    if (await canAdmin(chatId, "user", env)) {
      await adminUsers(chatId, env);
    }
    return;
  }

  if (data === "admin_categories") {
    if (await canAdmin(chatId, "product", env)) {
      await adminCategories(chatId, env);
    }
    return;
  }

  if (data === "admin_website") {
    if (await canAdmin(chatId, "product", env)) {
      await adminWebsite(chatId, env);
    }
    return;
  }

  if (data === "admin_cleanup") {
    if (await isAdmin(chatId, env)) {
      await cleanupExpired(env);

      await sendMessage(
        chatId,
        "🧹 Cleanup completed.",
        env
      );
    }
    return;
  }

  if (data === "admin_add_product") {
    if (await canAdmin(chatId, "product", env)) {
      await startNewProduct(chatId, env);
    }
    return;
  }

  if (data === "admin_list_products") {
    if (await canAdmin(chatId, "product", env)) {
      await adminProductList(chatId, env);
    }
    return;
  }

  if (data.startsWith("delete_product:")) {
    if (await canAdmin(chatId, "product", env)) {
      await deleteProduct(
        chatId,
        data.substring("delete_product:".length),
        env
      );
    }
    return;
  }

  if (data === "admin_add_category") {
    if (await canAdmin(chatId, "product", env)) {
      await startNewCategory(chatId, env);
    }
    return;
  }

  if (data.startsWith("edit_product_title:")) {
    if (await canAdmin(chatId, "product", env)) {
      const productId=data.substring("edit_product_title:".length);
      await setSession(env, chatId, {step:"edit_product_title",edit_product_id:productId,expires_at:new Date(Date.now()+20*60*1000).toISOString()});
      await sendMessage(chatId,"📝 Send the new product title.",env);
    }
    return;
  }

  if (data.startsWith("edit_product_description:")) {
    if (await canAdmin(chatId, "product", env)) {
      const productId=data.substring("edit_product_description:".length);
      await setSession(env, chatId, {step:"edit_product_description",edit_product_id:productId,expires_at:new Date(Date.now()+20*60*1000).toISOString()});
      await sendMessage(chatId,"📄 Send the new product description.",env);
    }
    return;
  }

  if (data.startsWith("edit_product:")) {
    if (await canAdmin(chatId, "product", env)) {
      await startEditProduct(chatId, data.substring("edit_product:".length), env);
    }
    return;
  }

  if (data.startsWith("delete_product:")) {
    if (await canAdmin(chatId, "product", env)) {
      await deleteProduct(chatId, data.substring("delete_product:".length), env);
    }
    return;
  }

  if (data.startsWith("edit_category:")) {
    if (await canAdmin(chatId, "product", env)) {
      await startEditCategory(chatId, Number(data.substring("edit_category:".length)), env);
    }
    return;
  }

  if (data.startsWith("delete_category:")) {
    if (await canAdmin(chatId, "product", env)) {
      await deleteCategory(chatId, Number(data.substring("delete_category:".length)), env);
    }
    return;
  }

  if (data === "admin_list_categories") {
    if (await canAdmin(chatId, "product", env)) {
      await adminCategories(chatId, env);
    }
    return;
  }
}

/* =========================================================
   SEARCH
========================================================= */

async function startSearch(chatId, env) {
  await setSession(env, chatId, {
    step: "search",
    expires_at: new Date(
      Date.now() + 20 * 60 * 1000
    ).toISOString()
  });

  await sendMessage(
    chatId,
    "🔎 <b>Search Products</b>\n\nSend the PDF/book/notes name you want to search.",
    env
  );
}

/* =========================================================
   CATEGORIES
========================================================= */

async function categoriesMenu(chatId, env) {
  const categories = await sb(env, "categories", {
    select: "id,category_id,name,slug,description,status",
    filter: [
      { column: "status", operator: "eq", value: "active" }
    ],
    order: "created_at.desc"
  });

  if (!categories.length) {
    await sendMessage(chatId, "📂 No categories available.", env);
    return;
  }

  const keyboard = categories.map(c => [
    {
      text: `📚 ${c.name}`,
      callback_data: `cat:${c.id}`
    }
  ]);

  await sendMessage(
    chatId,
    "<b>📂 Categories</b>\n\nChoose a category:",
    env,
    {
      reply_markup: {
        inline_keyboard: keyboard
      }
    }
  );
}

/* =========================================================
   ADMIN PANEL
========================================================= */

async function adminPanel(chatId, env) {
  const keyboard = [
    [
      {
        text: "📦 Products",
        callback_data: "admin_products"
      },
      {
        text: "📋 Tasks",
        callback_data: "admin_tasks"
      }
    ],
    [
      {
        text: "👥 Users",
        callback_data: "admin_users"
      },
      {
        text: "📂 Categories",
        callback_data: "admin_categories"
      }
    ],
    [
      {
        text: "🌐 Website",
        callback_data: "admin_website"
      }
    ],
    [
      {
        text: "🧹 Cleanup",
        callback_data: "admin_cleanup"
      }
    ]
  ];

  await sendMessage(
    chatId,
    "<b>⚙️ PDF ORBIT ADMIN PANEL</b>\n\nChoose an option:",
    env,
    {
      reply_markup: {
        inline_keyboard: keyboard
      }
    }
  );
}

async function adminProducts(chatId, env) {
  await sendMessage(
    chatId,
    "<b>📦 Product Management</b>",
    env,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "➕ Add Product", callback_data: "admin_add_product" },
            { text: "📋 Product List", callback_data: "admin_list_products" }
          ],
          [
            { text: "🔄 Refresh", callback_data: "admin_list_products" }
          ]
        ]
      }
    }
  );
}

/* =========================================================
   PRODUCT CREATION
========================================================= */

async function startNewProduct(chatId, env) {
  await setSession(env, chatId, {
    step: "product_upload",
    expires_at: new Date(
      Date.now() + 20 * 60 * 1000
    ).toISOString()
  });

  await sendMessage(
    chatId,
    `<b>➕ Add New Product</b>

Step 1/8

Send the PDF document now.`,
    env
  );
}

async function handleProductUpload(message, session, env) {
  const chatId = message.chat.id;

  if (!message.document) {
    await sendMessage(
      chatId,
      "❌ Please send a PDF/document file.",
      env
    );
    return true;
  }

  const doc = message.document;

  await updateSession(env, chatId, {
    step: "product_id",
    telegram_file_id: doc.file_id,
    file_name: doc.file_name || "document.pdf",
    file_size: doc.file_size || null,
    mime_type: doc.mime_type || "application/pdf"
  });

  await sendMessage(
    chatId,
    `✅ File received: <b>${escapeHtml(doc.file_name || "PDF")}</b>

Step 2/8

Send a unique Product ID.

Example:
<code>PHY001</code>`,
    env
  );

  return true;
}

async function handleProductId(message, session, env) {
  const chatId = message.chat.id;
  const productId = String(message.text || "")
    .trim()
    .replace(/\s+/g, "_");

  if (!/^[A-Za-z0-9_-]{2,80}$/.test(productId)) {
    await sendMessage(
      chatId,
      "❌ Invalid Product ID. Use letters, numbers, _ or -.",
      env
    );
    return true;
  }

  const existing = await sb(env, "products", {
    select: "id",
    filter: [
      { column: "product_id", operator: "eq", value: productId }
    ],
    limit: 1
  });

  if (existing.length) {
    await sendMessage(
      chatId,
      "❌ This Product ID already exists. Send another.",
      env
    );
    return true;
  }

  await updateSession(env, chatId, {
    step: "product_title",
    product_id: productId
  });

  await sendMessage(
    chatId,
    "Step 3/8\n\nSend the product title.",
    env
  );

  return true;
}

async function handleProductTitle(message, session, env) {
  const chatId = message.chat.id;
  const title = String(message.text || "").trim();

  if (!title) return true;

  await updateSession(env, chatId, {
    step: "product_description",
    title
  });

  await sendMessage(
    chatId,
    "Step 4/8\n\nSend the product description.",
    env
  );

  return true;
}

async function handleProductDescription(message, session, env) {
  const chatId = message.chat.id;

  await updateSession(env, chatId, {
    step: "product_category",
    description: String(message.text || "").trim()
  });

  const categories = await sb(env, "categories", {
    select: "id,name",
    filter: [
      { column: "status", operator: "eq", value: "active" }
    ],
    order: "name.asc"
  });

  const keyboard = categories.map(c => [
    {
      text: c.name,
      callback_data: `select_product_category:${c.id}`
    }
  ]);

  keyboard.push([
    {
      text: "Skip Category",
      callback_data: "select_product_category:0"
    }
  ]);

  await sendMessage(
    chatId,
    "Step 5/8\n\nChoose a category.",
    env,
    {
      reply_markup: {
        inline_keyboard: keyboard
      }
    }
  );

  return true;
}

async function handleProductType(message, session, env) {
  const chatId = message.chat.id;

  const type = String(message.text || "")
    .trim()
    .toLowerCase();

  const allowed = [
    "book",
    "notes",
    "pdf",
    "test",
    "study material",
    "other"
  ];

  if (!allowed.includes(type)) {
    await sendMessage(
      chatId,
      `Choose one:\n\n${allowed.join("\n")}`,
      env
    );
    return true;
  }

  await updateSession(env, chatId, {
    step: "product_cover",
    product_type: type
  });

  await sendMessage(
    chatId,
    "Step 7/8\n\nSend a cover image/photo.\n\nOr send <code>skip</code>.",
    env
  );

  return true;
}

async function handleProductCover(message, session, env) {
  const chatId = message.chat.id;
  const text = String(message.text || "").trim().toLowerCase();

  if (text === "skip") {
    await updateSession(env, chatId, {
      step: "product_preview",
      cover_image_file_id: null
    });

    await productPreview(chatId, env);
    return true;
  }

  if (message.photo?.length) {
    const photo =
      message.photo[message.photo.length - 1];

    await updateSession(env, chatId, {
      step: "product_preview",
      cover_image_file_id: photo.file_id
    });

    await productPreview(chatId, env);
    return true;
  }

  await sendMessage(
    chatId,
    "❌ Send a photo or type <code>skip</code>.",
    env
  );

  return true;
}

async function productPreview(chatId, env) {
  const session = await getSession(chatId, env);

  if (!session) return;

  const text =
    `<b>👀 Product Preview</b>\n\n` +
    `📌 ID: <code>${escapeHtml(session.product_id)}</code>\n` +
    `📖 Title: <b>${escapeHtml(session.title)}</b>\n` +
    `📝 Description: ${escapeHtml(session.description || "")}\n` +
    `📂 Type: ${escapeHtml(session.product_type || "pdf")}\n` +
    `💰 Price: Free\n\n` +
    `Publish this product?`;

  await sendMessage(
    chatId,
    text,
    env,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ Publish",
              callback_data: "publish_product"
            },
            {
              text: "❌ Cancel",
              callback_data: "cancel_product_creation"
            }
          ]
        ]
      }
    }
  );
}

/* =========================================================
   PRODUCT CREATION CALLBACKS
========================================================= */

async function handleProductCreationCallback(
  chatId,
  data,
  env
) {
  const session = await getSession(chatId, env);

  if (!session) return false;

  if (data.startsWith("select_product_category:")) {
    const categoryId = Number(
      data.substring(
        "select_product_category:".length
      )
    );

    await updateSession(env, chatId, {
      step: "product_type",
      category_id: categoryId || null
    });

    await sendMessage(
      chatId,
      `Step 6/8

Choose product type:

book
notes
pdf
test
study material
other`,
      env
    );

    return true;
  }

  if (data === "publish_product") {
    const result = await publishProduct(
      chatId,
      session,
      env
    );

    return result;
  }

  if (data === "cancel_product_creation") {
    await clearSession(chatId, env);

    await sendMessage(
      chatId,
      "❌ Product creation cancelled.",
      env
    );

    return true;
  }

  return false;
}

async function publishProduct(chatId, session, env) {
  try {
    const body = {
      product_id: session.product_id,
      title: session.title,
      description: session.description || "",
      price: 0,
      telegram_file_id: session.telegram_file_id,
      file_name: session.file_name,
      file_size: session.file_size,
      mime_type: session.mime_type,
      cover_image: session.cover_image_file_id || null,
      category_id: session.category_id || null,
      status: "active",
      product_type: session.product_type || "pdf"
    };

    const result = await sbInsert(
      env,
      "products",
      body
    );

    await clearSession(chatId, env);

    await sendMessage(
      chatId,
      `<b>✅ Product Published</b>

ID: <code>${escapeHtml(body.product_id)}</code>
Title: <b>${escapeHtml(body.title)}</b>

Website product URL will use this Product ID automatically.`,
      env
    );

    return true;
  } catch (error) {
    console.error(error);

    await sendMessage(
      chatId,
      `❌ Publishing failed.\n\n<code>${escapeHtml(error.message)}</code>`,
      env
    );

    return true;
  }
}

/* =========================================================
   ADMIN PRODUCT LIST / DELETE
========================================================= */

async function adminProductList(chatId, env) {
  const products = await sb(env, "products", {
    select:
      "id,product_id,title,status,product_type,created_at",
    order: "created_at.desc",
    limit: 30
  });

  if (!products.length) {
    await sendMessage(chatId, "📦 No products found. Tap ➕ Add Product to publish your first PDF.", env);
    return;
  }

  await sendMessage(chatId, `<b>📦 Products</b>\n\nTotal: <b>${products.length}</b>\nTap a product to edit or delete it.`, env);

  for (const p of products) {
    await sendMessage(
      chatId,
      `<b>${escapeHtml(p.title)}</b>

ID: <code>${escapeHtml(p.product_id)}</code>
Type: ${escapeHtml(p.product_type || "pdf")}
Status: ${escapeHtml(p.status)}`,
      env,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "✏️ Edit",
                callback_data: `edit_product:${p.product_id}`
              },
              {
                text: "🗑 Delete",
                callback_data: `delete_product:${p.product_id}`
              }
            ]
          ]
        }
      }
    );
  }
}

async function deleteProduct(chatId, productId, env) {
  const products = await sb(env, "products", {
    select: "id,title",
    filter: [
      { column: "product_id", operator: "eq", value: productId }
    ],
    limit: 1
  });

  if (!products.length) {
    await sendMessage(chatId, "❌ Product not found.", env);
    return;
  }

  /*
   * Delete database record.
   *
   * Telegram file_id itself cannot be globally deleted
   * from Telegram by deleting the DB record.
   */
  await sbDelete(env, "products", [
    {
      column: "product_id",
      operator: "eq",
      value: productId
    }
  ]);

  await sendMessage(
    chatId,
    `🗑 <b>Product deleted</b>\n\n${escapeHtml(products[0].title)}`,
    env
  );
}

/* =========================================================
   TASK ADMIN
========================================================= */

async function adminTasks(chatId, env) {
  await sendMessage(
    chatId,
    `<b>📋 Task Management</b>

Task creation can be added to a selected product from this panel.`,
    env
  );
}

/* =========================================================
   USER ADMIN
========================================================= */

async function adminUsers(chatId, env) {
  const users = await sb(env, "users", {
    select:
      "telegram_user_id,username,first_name,channel_joined,created_at,last_activity_at",
    order: "created_at.desc",
    limit: 30
  });

  let text = "<b>👥 Recent Users</b>\n\n";

  for (const u of users) {
    text +=
      `• ${escapeHtml(u.first_name || "")} ` +
      `${u.username ? "@" + escapeHtml(u.username) : ""}\n` +
      `ID: <code>${u.telegram_user_id}</code>\n\n`;
  }

  await sendMessage(chatId, text, env);
}

/* =========================================================
   CATEGORY ADMIN
========================================================= */

async function startEditProduct(chatId, productId, env) {
  const rows = await sb(env, "products", {
    select: "product_id,title,description",
    filter: [{column:"product_id",operator:"eq",value:productId}],
    limit: 1
  });
  if (!rows.length) { await sendMessage(chatId, "❌ Product not found.", env); return; }
  await sendMessage(chatId, `<b>✏️ Edit Product</b>\n\n${escapeHtml(rows[0].title)}\n\nChoose what to edit:`, env, {
    reply_markup:{inline_keyboard:[
      [{text:"📝 Title",callback_data:`edit_product_title:${productId}`}],
      [{text:"📄 Description",callback_data:`edit_product_description:${productId}`}],
      [{text:"📋 Product List",callback_data:"admin_list_products"}]
    ]}
  });
}

async function startEditCategory(chatId, categoryId, env) {
  const rows = await sb(env, "categories", {
    select: "id,name",
    filter: [{column:"id",operator:"eq",value:categoryId}],
    limit: 1
  });
  if (!rows.length) { await sendMessage(chatId, "❌ Category not found.", env); return; }
  await setSession(env, chatId, {
    step:"edit_category_name",
    edit_category_id: categoryId,
    expires_at:new Date(Date.now()+20*60*1000).toISOString()
  });
  await sendMessage(chatId, `✏️ Send the new name for <b>${escapeHtml(rows[0].name)}</b>.`, env);
}

async function deleteCategory(chatId, categoryId, env) {
  const rows = await sb(env, "categories", {
    select:"id,name",
    filter:[{column:"id",operator:"eq",value:categoryId}],
    limit:1
  });
  if (!rows.length) { await sendMessage(chatId,"❌ Category not found.",env); return; }

  const products = await sb(env,"products",{
    select:"id",
    filter:[{column:"category_id",operator:"eq",value:categoryId},{column:"status",operator:"eq",value:"active"}],
    limit:1
  });
  if (products.length) {
    await sendMessage(chatId,"⚠️ This category has products. Reassign/remove those products first.",env);
    return;
  }

  await sbDelete(env,"categories",[{column:"id",operator:"eq",value:categoryId}]);
  await sendMessage(chatId,`🗑 <b>Category deleted</b>\n\n${escapeHtml(rows[0].name)}`,env,{
    reply_markup:{inline_keyboard:[[ {text:"📂 Categories",callback_data:"admin_list_categories"} ]]}
  });
}

async function adminCategories(chatId, env) {
  const categories = await sb(env, "categories", {
    select: "id,category_id,name,slug,status",
    order: "created_at.desc"
  });

  let text = "<b>📂 Categories</b>\n\n";

  const buttons = [];
  for (const c of categories) {
    text +=
      `• <b>${escapeHtml(c.name)}</b>\n` +
      `ID: <code>${escapeHtml(c.category_id)}</code>\n` +
      `Slug: <code>${escapeHtml(c.slug)}</code>\n` +
      `Status: ${escapeHtml(c.status)}\n\n`;
    buttons.push([
      { text: `✏️ Edit ${c.name}`, callback_data: `edit_category:${c.id}` },
      { text: "🗑 Delete", callback_data: `delete_category:${c.id}` }
    ]);
  }
  buttons.push([{ text: "➕ Add Category", callback_data: "admin_add_category" }]);

  await sendMessage(
    chatId,
    text,
    env,
    {
      reply_markup: {
        inline_keyboard: buttons
      }
    }
  );
}

async function startNewCategory(chatId, env) {
  await setSession(env, chatId, {
    step: "category_name",
    expires_at: new Date(
      Date.now() + 20 * 60 * 1000
    ).toISOString()
  });

  await sendMessage(
    chatId,
    "📂 Send the new category name.",
    env
  );
}

async function createCategory(chatId, name, env) {
  const slug = slugify(name);

  const existing = await sb(env, "categories", {
    select: "id",
    filter: [
      { column: "slug", operator: "eq", value: slug }
    ],
    limit: 1
  });

  if (existing.length) {
    await sendMessage(
      chatId,
      "❌ Category already exists.",
      env
    );
    return;
  }

  const categoryId =
    "CAT_" +
    Date.now().toString(36).toUpperCase();

  await sbInsert(env, "categories", {
    category_id: categoryId,
    name,
    slug,
    description: "",
    image_url: null,
    status: "active"
  });

  await clearSession(chatId, env);

  await sendMessage(
    chatId,
    `<b>✅ Category created</b>

${escapeHtml(name)}
ID: <code>${categoryId}</code>`,
    env
  );
}

/* =========================================================
   WEBSITE SETTINGS
========================================================= */

async function adminWebsite(chatId, env) {
  const website =
    await getSetting(env, "website_url");

  const contact =
    await getSetting(env, "contact_admin");

  await sendMessage(
    chatId,
    `<b>🌐 Website Settings</b>

Website:
<code>${escapeHtml(website || "Not set")}</code>

Contact:
<code>${escapeHtml(contact || "Not set")}</code>

Use the setting editor through the admin session if required.`,
    env
  );
}

/* =========================================================
   CONTACT
========================================================= */

async function contactAdmin(chatId, env) {
  const contact =
    env.CONTACT_ADMIN ||
    (await getSetting(env, "contact_admin"));

  if (!contact) {
    await sendMessage(
      chatId,
      "👨‍💻 Admin contact is not configured yet.",
      env
    );
    return;
  }

  const url =
    contact.startsWith("http://") ||
    contact.startsWith("https://")
      ? contact
      : `https://t.me/${contact.replace("@", "")}`;

  await sendMessage(
    chatId,
    "<b>👨‍💻 Contact Admin</b>\n\nTap the button below.",
    env,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "Contact Admin",
              url
            }
          ]
        ]
      }
    }
  );
}

/* =========================================================
   SESSION TEXT HANDLER
========================================================= */

async function handleSessionText(message, session, env) {
  const chatId = message.chat.id;

  switch (session.step) {
    case "search": {
      const q = String(message.text || "").trim();

      if (!q) return true;

      await clearSession(chatId, env);

      const products = await searchProducts(q, env);

      if (!products.length) {
        await sendMessage(
          chatId,
          `🔎 No results found for <b>${escapeHtml(q)}</b>.`,
          env
        );
        return true;
      }

      await sendMessage(
        chatId,
        `<b>🔎 Search Results</b>\n\nFound ${products.length} result(s).`,
        env
      );

      for (const product of products) {
        await sendProductCard(
          chatId,
          product,
          env
        );
      }

      return true;
    }

    case "edit_product_title": {
      const title = String(message.text || "").trim();
      if (!title) { await sendMessage(chatId, "❌ Title cannot be empty.", env); return true; }
      const productId = session.edit_product_id;
      await sbUpdate(env, "products",
        [{ column: "product_id", operator: "eq", value: productId }],
        { title, updated_at: new Date().toISOString() }
      );
      await clearSession(chatId, env);
      await sendMessage(chatId, "✅ Product title updated.", env, {
        reply_markup: { inline_keyboard: [[{text:"📋 Product List",callback_data:"admin_list_products"}]] }
      });
      return true;
    }

    case "edit_product_description": {
      const description = String(message.text || "").trim();
      const productId = session.edit_product_id;
      await sbUpdate(env, "products",
        [{ column: "product_id", operator: "eq", value: productId }],
        { description, updated_at: new Date().toISOString() }
      );
      await clearSession(chatId, env);
      await sendMessage(chatId, "✅ Product description updated.", env, {
        reply_markup: { inline_keyboard: [[{text:"📋 Product List",callback_data:"admin_list_products"}]] }
      });
      return true;
    }

    case "edit_category_name": {
      const name = String(message.text || "").trim();
      if (!name) { await sendMessage(chatId, "❌ Category name cannot be empty.", env); return true; }
      const slug = slugify(name);
      const exists = await sb(env, "categories", {
        select: "id",
        filter: [{column:"slug",operator:"eq",value:slug},{column:"id",operator:"neq",value:session.edit_category_id}],
        limit: 1
      });
      if (exists.length) { await sendMessage(chatId, "❌ Another category already uses this name.", env); return true; }
      await sbUpdate(env, "categories",
        [{ column:"id", operator:"eq", value:session.edit_category_id }],
        { name, slug }
      );
      await clearSession(chatId, env);
      await sendMessage(chatId, "✅ Category updated.", env, {
        reply_markup:{inline_keyboard:[[ {text:"📂 Categories",callback_data:"admin_list_categories"} ]]}
      });
      return true;
    }

    case "product_upload":
      if (await canAdmin(chatId, "product", env)) {
        return await handleProductUpload(
          message,
          session,
          env
        );
      }
      return true;

    case "product_id":
      return await handleProductId(
        message,
        session,
        env
      );

    case "product_title":
      return await handleProductTitle(
        message,
        session,
        env
      );

    case "product_description":
      return await handleProductDescription(
        message,
        session,
        env
      );

    case "product_type":
      return await handleProductType(
        message,
        session,
        env
      );

    case "product_cover":
      return await handleProductCover(
        message,
        session,
        env
      );

    case "category_name":
      if (await canAdmin(chatId, "product", env)) {
        await createCategory(
          chatId,
          String(message.text || "").trim(),
          env
        );
      }
      return true;

    default:
      return false;
  }
}

/* =========================================================
   SEARCH DATABASE
========================================================= */

async function searchProducts(q, env) {
  const safe = q.replace(/,/g, " ");

  const url =
    `${env.SUPABASE_URL}/rest/v1/products` +
    `?select=id,product_id,title,description,price,file_name,file_size,cover_image,category_id,product_type,status,telegram_file_id` +
    `&status=eq.active` +
    `&or=(title.ilike.*${encodeURIComponent(safe)}*,description.ilike.*${encodeURIComponent(safe)}*,product_type.ilike.*${encodeURIComponent(safe)}*)` +
    `&order=created_at.desc` +
    `&limit=20`;

  const response = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_KEY,
      Authorization: `Bearer ${env.SUPABASE_KEY}`
    }
  });

  if (!response.ok) {
    return [];
  }

  return await response.json();
}

/* =========================================================
   USER DATABASE
========================================================= */

async function upsertUser(user, env) {
  const id = Number(user.id);

  if (!id) return;

  const existing = await sb(env, "users", {
    select: "id",
    filter: [
      {
        column: "telegram_user_id",
        operator: "eq",
        value: id
      }
    ],
    limit: 1
  });

  const data = {
    telegram_user_id: id,
    username: user.username || null,
    first_name: user.first_name || null,
    last_activity_at: new Date().toISOString(),
    expires_at: new Date(
      Date.now() + 20 * 60 * 1000
    ).toISOString()
  };

  if (existing.length) {
    await sbUpdate(
      env,
      "users",
      [
        {
          column: "telegram_user_id",
          operator: "eq",
          value: id
        }
      ],
      data
    );
  } else {
    await sbInsert(env, "users", data);
  }
}

async function getUser(chatId, env) {
  const rows = await sb(env, "users", {
    select: "*",
    filter: [
      {
        column: "telegram_user_id",
        operator: "eq",
        value: chatId
      }
    ],
    limit: 1
  });

  return rows[0] || null;
}

async function updateUser(env, chatId, data) {
  return await sbUpdate(
    env,
    "users",
    [
      {
        column: "telegram_user_id",
        operator: "eq",
        value: chatId
      }
    ],
    data
  );
}

/* =========================================================
   SESSION DATABASE
========================================================= */

async function getSession(chatId, env) {
  const rows = await sb(env, "bot_sessions", {
    select: "*",
    filter: [
      {
        column: "telegram_user_id",
        operator: "eq",
        value: chatId
      }
    ],
    limit: 1
  });

  return rows[0] || null;
}

async function setSession(env, chatId, data) {
  const existing = await getSession(chatId, env);

  const body = {
    telegram_user_id: chatId,
    ...data,
    updated_at: new Date().toISOString()
  };

  if (existing) {
    return await sbUpdate(
      env,
      "bot_sessions",
      [
        {
          column: "telegram_user_id",
          operator: "eq",
          value: chatId
        }
      ],
      body
    );
  }

  return await sbInsert(
    env,
    "bot_sessions",
    body
  );
}

async function updateSession(env, chatId, data) {
  return await sbUpdate(
    env,
    "bot_sessions",
    [
      {
        column: "telegram_user_id",
        operator: "eq",
        value: chatId
      }
    ],
    {
      ...data,
      updated_at: new Date().toISOString()
    }
  );
}

async function setSessionStep(env, chatId, step) {
  return await updateSession(
    env,
    chatId,
    {
      step,
      expires_at: new Date(
        Date.now() + 20 * 60 * 1000
      ).toISOString()
    }
  );
}

async function clearSession(chatId, env) {
  try {
    await sbDelete(
      env,
      "bot_sessions",
      [
        {
          column: "telegram_user_id",
          operator: "eq",
          value: chatId
        }
      ]
    );
  } catch {}
}

/* =========================================================
   USER TASKS
========================================================= */

async function isUserTaskCompleted(
  chatId,
  taskId,
  env
) {
  const rows = await sb(env, "user_tasks", {
    select: "completed,expires_at",
    filter: [
      {
        column: "telegram_user_id",
        operator: "eq",
        value: chatId
      },
      {
        column: "product_task_id",
        operator: "eq",
        value: taskId
      }
    ],
    limit: 1
  });

  if (!rows.length) return false;

  if (
    rows[0].expires_at &&
    new Date(rows[0].expires_at) < new Date()
  ) {
    return false;
  }

  return rows[0].completed === true;
}

async function markUserTask(
  chatId,
  taskId,
  env
) {
  const existing = await sb(env, "user_tasks", {
    select: "id",
    filter: [
      {
        column: "telegram_user_id",
        operator: "eq",
        value: chatId
      },
      {
        column: "product_task_id",
        operator: "eq",
        value: taskId
      }
    ],
    limit: 1
  });

  const data = {
    telegram_user_id: chatId,
    product_task_id: taskId,
    completed: true,
    completed_at: new Date().toISOString(),
    expires_at: new Date(
      Date.now() + 20 * 60 * 1000
    ).toISOString()
  };

  if (existing.length) {
    return await sbUpdate(
      env,
      "user_tasks",
      [
        {
          column: "id",
          operator: "eq",
          value: existing[0].id
        }
      ],
      data
    );
  }

  return await sbInsert(
    env,
    "user_tasks",
    data
  );
}

/* =========================================================
   ADMIN CHECKS
========================================================= */

async function isAdmin(chatId, env) {
  if (
    String(chatId) ===
    String(env.ADMIN_TELEGRAM_ID)
  ) {
    return true;
  }

  const rows = await sb(env, "admins", {
    select: "telegram_user_id,status,role",
    filter: [
      {
        column: "telegram_user_id",
        operator: "eq",
        value: chatId
      },
      {
        column: "status",
        operator: "eq",
        value: "active"
      }
    ],
    limit: 1
  });

  return rows.length > 0;
}

async function getAdmin(chatId, env) {
  if (
    String(chatId) ===
    String(env.ADMIN_TELEGRAM_ID)
  ) {
    return {
      telegram_user_id: chatId,
      role: "owner",
      status: "active"
    };
  }

  const rows = await sb(env, "admins", {
    select: "telegram_user_id,name,role,status",
    filter: [
      {
        column: "telegram_user_id",
        operator: "eq",
        value: chatId
      },
      {
        column: "status",
        operator: "eq",
        value: "active"
      }
    ],
    limit: 1
  });

  return rows[0] || null;
}

async function canAdmin(chatId, permission, env) {
  const admin = await getAdmin(chatId, env);

  if (!admin) return false;

  if (admin.role === "owner") return true;

  if (admin.role === "admin") return true;

  if (
    permission === "product" &&
    admin.role === "product_admin"
  ) {
    return true;
  }

  if (
    permission === "task" &&
    admin.role === "task_admin"
  ) {
    return true;
  }

  if (
    permission === "user" &&
    admin.role === "user_admin"
  ) {
    return true;
  }

  return false;
}

/* =========================================================
   SETTINGS
========================================================= */

async function getSetting(env, key) {
  try {
    const rows = await sb(env, "settings", {
      select: "value",
      filter: [
        {
          column: "key",
          operator: "eq",
          value: key
        }
      ],
      limit: 1
    });

    return rows[0]?.value || null;
  } catch {
    return null;
  }
}

/* =========================================================
   PRODUCT HELPERS
========================================================= */

async function getProductByDbId(id, env) {
  const rows = await sb(env, "products", {
    select:
      "id,product_id,title,description,price,file_name,file_size,cover_image,category_id,product_type,status,telegram_file_id",
    filter: [
      {
        column: "id",
        operator: "eq",
        value: id
      },
      {
        column: "status",
        operator: "eq",
        value: "active"
      }
    ],
    limit: 1
  });

  return rows[0] || null;
}

/* =========================================================
   CLEANUP
========================================================= */

async function cleanupExpired(env) {
  const now = new Date().toISOString();

  try {
    await sbDelete(env, "bot_sessions", [
      {
        column: "expires_at",
        operator: "lt",
        value: now
      }
    ]);
  } catch {}

  try {
    await sbDelete(env, "user_tasks", [
      {
        column: "expires_at",
        operator: "lt",
        value: now
      }
    ]);
  } catch {}

  try {
    await sbDelete(env, "referrals", [
      {
        column: "expires_at",
        operator: "lt",
        value: now
      }
    ]);
  } catch {}
}

/* =========================================================
   UTILITIES
========================================================= */

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 100);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}