/**
 * Tele PDF — Telegram PDF Delivery Bot
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
import { handlePlatform } from "./platform.js";

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // CORS / preflight
      if (request.method === "OPTIONS") {
        return corsResponse("", 204);
      }

      // Worker is backend/API only. The public website and /admin UI are hosted separately by the owner.

      // New scalable v2 platform/admin API. The custom website and /admin UI remain external.
      const platformResponse = await handlePlatform(request, env, url);
      if (platformResponse) return platformResponse;

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

      if (request.method === "GET" && url.pathname === "/api/posts") {
        return await apiPosts(env);
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
      "id,product_id,title,description,price,file_name,file_size,mime_type,cover_image,category_id,status,product_type,created_at,updated_at,slug,seo_title,seo_description,content_html,faq_json,external_url,media_type,noindex",
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

async function apiPosts(env) {
  return json(await sb(env,"posts",{select:"post_id,title,slug,excerpt,thumbnail_url,category_id,created_at,updated_at",filter:[{column:"status",operator:"eq",value:"active"}],order:"created_at.desc",limit:100}));
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

  if (text === "/newpost") {
    if (await canAdmin(chatId, "product", env)) await startNewPost(chatId, env);
    return;
  }

  if (text === "/admins") {
    if (await isOwner(chatId, env)) await adminAdmins(chatId, env);
    return;
  }

  if (text === "/links") {
    if (await canAdmin(chatId, "product", env)) await adminSiteLinks(chatId, env);
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
      `<b>🚀 Welcome to Tele PDF</b>

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
      { text: "🔎 Search PDF", callback_data: "search_products" }
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
      "id,product_id,title,description,price,file_name,file_size,mime_type,cover_image,category_id,product_type,status,deleted_at,telegram_file_id",
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
    telegram_file_id: product.telegram_file_id || null,
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
        "telepdfsbot";

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
                    `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Get this PDF from Tele PDF")}`
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
    const referralRows = await sbInsert(env, "referrals", {
      referrer_telegram_user_id: referrer,
      referred_telegram_user_id: referred,
      product_id: products[0].id,
      status: "completed",
      completed_at: new Date().toISOString(),
      expires_at: new Date(
        Date.now() + 20 * 60 * 1000
      ).toISOString()
    });
    const referralId = Array.isArray(referralRows) ? referralRows[0]?.id : null;
    try {
      await fetch(env.SUPABASE_URL + "/rest/v1/rpc/credit_referral_coin", {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_KEY,
          Authorization: "Bearer " + env.SUPABASE_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          p_referrer: referrer,
          p_referred: referred,
          p_referral_id: referralId
        })
      });
    } catch (coinError) {
      console.error("Referral coin credit:", coinError);
    }
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
  if (product.external_url || product.media_type === "link") {
    await sendMessage(chatId, "<b>🔗 " + escapeHtml(product.title) + "</b>\n\n" + escapeHtml(product.description || ""), env, { reply_markup:{inline_keyboard:[[ {text:"🌐 Open Link",url:product.external_url} ]] } });
    await clearSession(chatId, env);
    return;
  }
  if (!product.telegram_file_id && product.product_id) {
    const rows = await sb(env,"products",{select:"telegram_file_id,external_url,media_type",filter:[{column:"product_id",operator:"eq",value:product.product_id},{column:"status",operator:"eq",value:"active"}],limit:1});
    product.telegram_file_id=rows[0] && rows[0].telegram_file_id || null;
    product.external_url=rows[0] && rows[0].external_url || product.external_url;
    product.media_type=rows[0] && rows[0].media_type || product.media_type;
  }
  if (!product.telegram_file_id) { await sendMessage(chatId,"❌ Media is not available right now. Please contact admin.",env); return; }
  await sendMessage(chatId,"<b>🎉 Unlocked!</b>\n\nSending your media now...",env);
  const result = product.media_type === "video"
    ? await telegram("sendVideo",{chat_id:chatId,video:product.telegram_file_id,caption:"<b>"+escapeHtml(product.title)+"</b>\n\nDelivered by Tele PDF.",parse_mode:"HTML"},env)
    : await sendDocument(chatId,product.telegram_file_id,"<b>"+escapeHtml(product.title)+"</b>\n\nDelivered by Tele PDF.",env);
  if (!result.ok) { await sendMessage(chatId,"❌ Telegram could not deliver this media.",env); return; }
  await recordPurchaseDelivery(chatId, product, env);
  await clearSession(chatId, env);
  await sendMessage(chatId,"✅ <b>Delivered successfully.</b>",env,mainKeyboard(chatId,env));
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

  if (data === "main_menu") {
    await clearSession(chatId, env);
    await sendMessage(chatId, "🏠 <b>Main Menu</b>\n\nChoose an option:", env, mainKeyboard(chatId, env));
    return;
  }

  if (data === "back_admin") {
    await clearSession(chatId, env);
    await adminPanel(chatId, env);
    return;
  }

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
        [{text:"🔎 Search PDF",callback_data:"search_products"}],
        [{text:"📚 Latest PDFs",callback_data:"latest_products"}],
        [{text:"📂 Categories",callback_data:"categories"}],
        ...(website ? [[{text:"🌐 Website",url:website}]] : []),
        [{text:"👨‍💻 Contact Admin",callback_data:"contact_admin"}],
        [{text:"🔙 Main Menu",callback_data:"main_menu"}]
      ]}
    });
    return;
  }

  if (data.startsWith("cat:")) {
    await showCategoryProducts(chatId, Number(data.substring("cat:".length)), env);
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

  if (await handleProductCreationCallback(chatId, data, env)) return;

  if (data === "admin_posts") { if (await canAdmin(chatId,"product",env)) await adminPosts(chatId,env); return; }
  if (data === "admin_add_post") { if (await canAdmin(chatId,"product",env)) await startNewPost(chatId,env); return; }
  if (data === "admin_admins") { if (await isOwner(chatId,env)) await adminAdmins(chatId,env); return; }
  if (data === "admin_add_admin") { if (await isOwner(chatId,env)) await startAddAdmin(chatId,env); return; }
  if (data === "admin_links") { if (await canAdmin(chatId,"product",env)) await adminSiteLinks(chatId,env); return; }
  if (data === "admin_add_link") { if (await canAdmin(chatId,"product",env)) await startAddSiteLink(chatId,env); return; }
  if (data.startsWith("delete_admin:")) { if (!isOwner(chatId,env)) return; await sbDelete(env,"admins",[{column:"id",operator:"eq",value:Number(data.substring(13))}]); await adminAdmins(chatId,env); return; }
  if (data.startsWith("delete_link:")) { if (!(await canAdmin(chatId,"product",env))) return; await sbDelete(env,"site_links",[{column:"id",operator:"eq",value:Number(data.substring(12))}]); await adminSiteLinks(chatId,env); return; }
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

  if (data === "admin_task_products") {
    if (await canAdmin(chatId, "task", env)) await adminTaskProducts(chatId, env);
    return;
  }

  if (data.startsWith("admin_task_list:")) {
    if (await canAdmin(chatId, "task", env)) await adminTaskList(chatId, Number(data.substring(16)), env);
    return;
  }

  if (data.startsWith("admin_add_task:")) {
    if (await canAdmin(chatId, "task", env)) await startNewTask(chatId, Number(data.substring(15)), env);
    return;
  }

  if (data.startsWith("delete_task:")) {
    if (await canAdmin(chatId, "task", env)) await deleteTask(chatId, Number(data.substring(12)), env);
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

  if (data.startsWith("edit_setting:")) {
    if (await canAdmin(chatId, "product", env)) await startEditSetting(chatId, data.substring(13), env);
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
      await deleteProduct(chatId, data.substring("delete_product:".length), env);
    }
    return;
  }

  if (data.startsWith("product_info:")) {
    if (await canAdmin(chatId, "product", env)) await adminProductInfo(chatId, data.substring(13), env);
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

function isOwner(chatId, env) { return String(chatId) === String(env.ADMIN_TELEGRAM_ID); }

async function startNewPost(chatId, env) {
  await setSession(env,chatId,{step:"post_title",expires_at:new Date(Date.now()+20*60*1000).toISOString()});
  await sendMessage(chatId,"<b>📝 Add New Post</b>\n\nStep 1 — Send title.",env);
}

async function adminPosts(chatId, env) {
  const posts=await sb(env,"posts",{select:"id,post_id,title,slug,status",order:"created_at.desc",limit:50});
  let text="<b>📝 Posts</b>\n\n"+(posts.length?posts.map(function(p){return "• <b>"+escapeHtml(p.title)+"</b> — <code>"+escapeHtml(p.slug)+"</code>";}).join("\n"):"No posts yet.");
  await sendMessage(chatId,text,env,{reply_markup:{inline_keyboard:[[ {text:"➕ Add Post",callback_data:"admin_add_post"} ],[ {text:"🔙 Admin Panel",callback_data:"back_admin"} ]]}});
}

async function startAddAdmin(chatId, env) { await setSession(env,chatId,{step:"admin_user_id",expires_at:new Date(Date.now()+20*60*1000).toISOString()}); await sendMessage(chatId,"Send Telegram numeric user ID.",env); }

async function adminAdmins(chatId, env) {
  const rows=await sb(env,"admins",{select:"id,telegram_user_id,name,role,status",order:"created_at.desc",limit:50});
  const buttons=rows.map(function(a){return [{text:"🗑 "+String(a.name||a.telegram_user_id).substring(0,25),callback_data:"delete_admin:"+a.id}];});
  buttons.push([{text:"➕ Add Admin",callback_data:"admin_add_admin"}],[{text:"🔙 Admin Panel",callback_data:"back_admin"}]);
  const text="<b>👑 Administrators</b>\n\n"+rows.map(function(a){return "• <b>"+escapeHtml(a.name||"Admin")+"</b> — <code>"+a.telegram_user_id+"</code> — "+escapeHtml(a.role||"admin");}).join("\n");
  await sendMessage(chatId,text,env,{reply_markup:{inline_keyboard:buttons}});
}

async function startAddSiteLink(chatId, env) { await setSession(env,chatId,{step:"link_title",expires_at:new Date(Date.now()+20*60*1000).toISOString()}); await sendMessage(chatId,"Send link title.",env); }

async function adminSiteLinks(chatId, env) {
  const rows=await sb(env,"site_links",{select:"id,title,url,link_type,status",order:"sort_order.asc",limit:100});
  const buttons=rows.map(function(a){return [{text:"🗑 "+String(a.title).substring(0,25),callback_data:"delete_link:"+a.id}];});
  buttons.push([{text:"➕ Add Link",callback_data:"admin_add_link"}],[{text:"🔙 Admin Panel",callback_data:"back_admin"}]);
  const text="<b>🔗 Site Links</b>\n\n"+rows.map(function(a){return "• <b>"+escapeHtml(a.title)+"</b> — "+escapeHtml(a.url);}).join("\n");
  await sendMessage(chatId,text,env,{reply_markup:{inline_keyboard:buttons}});
}

async function publishPost(chatId, session, env) {
  const slug=slugify(session.post_title);
  const exists=await sb(env,"posts",{select:"id",filter:[{column:"slug",operator:"eq",value:slug}],limit:1});
  if(exists.length){await sendMessage(chatId,"❌ Post slug already exists.",env);return true;}
  const body={post_id:"POST_"+Date.now().toString(36).toUpperCase(),title:session.post_title,slug:slug,category_id:session.post_category_id||null,content_html:session.post_content_html||"",excerpt:String(session.post_content_html||"").replace(/<[^>]*>/g,"").slice(0,180),thumbnail_url:session.post_thumbnail_url||null,thumbnail_file_id:session.post_thumbnail_file_id||null,faq_json:session.post_faq_json||[],seo_title:session.post_seo_title||session.post_title,seo_description:session.post_seo_description||"",status:"active",noindex:false,updated_at:new Date().toISOString()};
  await sbInsert(env,"posts",body); await clearSession(chatId,env);
  const origin=await siteOrigin(null,env); await sendMessage(chatId,"<b>✅ Post published</b>\n\n<code>"+escapeHtml(origin+"/post/"+slug)+"</code>",env,{reply_markup:{inline_keyboard:[[ {text:"📝 Posts",callback_data:"admin_posts"} ]]}});
  return true;
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
   USER CATEGORY BROWSING
========================================================= */

async function showCategoryProducts(chatId, categoryId, env) {
  const cats = await sb(env, "categories", {
    select: "id,name,description,status",
    filter: [
      { column: "id", operator: "eq", value: categoryId },
      { column: "status", operator: "eq", value: "active" }
    ],
    limit: 1
  });

  if (!cats.length) {
    await sendMessage(chatId, "❌ Category not found.", env);
    return;
  }

  const products = await sb(env, "products", {
    select: "id,product_id,title,description,product_type,status,price",
    filter: [
      { column: "category_id", operator: "eq", value: categoryId },
      { column: "status", operator: "eq", value: "active" }
    ],
    order: "created_at.desc",
    limit: 30
  });

  if (!products.length) {
    await sendMessage(chatId,
      "📂 <b>" + escapeHtml(cats[0].name) + "</b>\n\nNo PDFs in this category yet.",
      env,
      { reply_markup: { inline_keyboard: [[{text:"🔙 Categories",callback_data:"categories"}]] } }
    );
    return;
  }

  const buttons = products.map(p => [
    { text: "📄 " + String(p.title || "PDF").substring(0, 45), callback_data: "open_product:" + p.product_id }
  ]);
  buttons.push([{text:"🔙 Categories",callback_data:"categories"}]);

  await sendMessage(chatId,
    "📂 <b>" + escapeHtml(cats[0].name) + "</b>\n\n" +
    escapeHtml(cats[0].description || "") +
    "\n\n📚 PDFs: <b>" + products.length + "</b>",
    env,
    { reply_markup: { inline_keyboard: buttons } }
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
      },
      {
        text: "🔗 Site Links",
        callback_data: "admin_links"
      }
    ],
    [
      { text: "📝 Posts", callback_data: "admin_posts" },
      { text: "👑 Admins", callback_data: "admin_admins" }
    ],
    [
      {
        text: "🧹 Cleanup",
        callback_data: "admin_cleanup"
      }
    ],
    [
      {
        text: "🔙 Main Menu",
        callback_data: "main_menu"
      }
    ]
  ];

  await sendMessage(
    chatId,
    "<b>⚙️ Tele PDF ADMIN PANEL</b>\n\nChoose an option:",
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
          ],
          [{ text: "🔙 Admin Panel", callback_data: "back_admin" }]
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
  const urlText = String(message.text || "").trim();
  if (message.document) {
    const d = message.document;
    await updateSession(env, chatId, { step:"product_id", telegram_file_id:d.file_id, file_name:d.file_name || "document", file_size:d.file_size || null, mime_type:d.mime_type || "application/octet-stream", media_type:"file" });
  } else if (message.video) {
    const v = message.video;
    await updateSession(env, chatId, { step:"product_id", telegram_file_id:v.file_id, file_name:v.file_name || "video.mp4", file_size:v.file_size || null, mime_type:v.mime_type || "video/mp4", media_type:"video" });
  } else if (/^https?:\/\//i.test(urlText)) {
    await updateSession(env, chatId, { step:"product_id", telegram_file_id:null, file_name:null, file_size:null, mime_type:"text/uri-list", media_type:"link", external_url:urlText });
  } else {
    await sendMessage(chatId, "❌ Send a PDF/document, video, or valid http(s) link.", env);
    return true;
  }
  await sendMessage(chatId, "✅ Media received.\n\nStep 2 — Send a unique Product ID.", env);
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
    "video",
    "link",
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
  const raw = String(message.text || "").trim();
  let cover = null;
  if (message.photo && message.photo.length) cover = message.photo[message.photo.length - 1].file_id;
  else if (/^https?:\/\//i.test(raw)) cover = raw;
  else if (raw.toLowerCase() !== "skip") {
    await sendMessage(chatId, "❌ Send a photo, image URL, or skip.", env);
    return true;
  }
  await updateSession(env, chatId, { step:"product_content", cover_image_file_id:cover });
  await sendMessage(chatId, "Step 8 — Send product content. HTML is supported. Type skip.", env);
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
      product_type: session.product_type || "pdf",
      slug: slugify(session.title),
      content_html: session.content_html || null,
      faq_json: session.faq_json || [],
      external_url: session.external_url || null,
      media_type: session.media_type || "file",
      noindex: false,
      updated_at: new Date().toISOString()
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
Status: ${escapeHtml(p.status)}\nPrice: <b>FREE</b>`,
      env,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "ℹ️ Info", callback_data: `product_info:${p.product_id}` },
              { text: "✏️ Edit", callback_data: `edit_product:${p.product_id}` },
              { text: "🗑 Delete", callback_data: `delete_product:${p.product_id}` }
            ]
          ]
        }
      }
    );
  }
}

async function adminProductInfo(chatId, productId, env) {
  const rows = await sb(env, "products", { select: "id,product_id,title,description,status,category_id,product_type,created_at", filter: [{ column: "product_id", operator: "eq", value: productId }], limit: 1 });
  if (!rows.length) return sendMessage(chatId, "❌ Product not found.", env);
  const p = rows[0];
  const cat = p.category_id ? await sb(env, "categories", { select: "slug", filter: [{ column: "id", operator: "eq", value: p.category_id }], limit: 1 }) : [];
  const url = `${await siteOrigin(null, env)}/p/${slugify(cat[0]?.slug || "library")}/${slugify(p.title)}/${encodeURIComponent(p.product_id)}`;
  await sendMessage(chatId, `<b>ℹ️ Product Info</b>\n\n<b>${escapeHtml(p.title)}</b>\nID: <code>${escapeHtml(p.product_id)}</code>\nStatus: ${escapeHtml(p.status)}\n\n🔗 <code>${escapeHtml(url)}</code>`, env, { reply_markup: { inline_keyboard: [[{ text: "✏️ Edit", callback_data: `edit_product:${p.product_id}` }], [{ text: "🔙 Product List", callback_data: "admin_list_products" }]] } });
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
  await sendMessage(chatId, "<b>📋 Task Management</b>\n\nAdd, view, and remove required tasks for any product.", env, {
    reply_markup: { inline_keyboard: [
      [{ text: "➕ Add / Manage Tasks", callback_data: "admin_task_products" }],
      [{ text: "🔙 Admin Panel", callback_data: "back_admin" }]
    ] }
  });
}

async function adminTaskProducts(chatId, env) {
  const products = await sb(env, "products", { select: "id,product_id,title,status", order: "created_at.desc", limit: 50 });
  const rows = products.map(p => [{ text: `📄 ${String(p.title || p.product_id).substring(0, 42)}`, callback_data: `admin_task_list:${p.id}` }]);
  rows.push([{ text: "🔙 Task Management", callback_data: "admin_tasks" }]);
  await sendMessage(chatId, "<b>📄 Select a product</b>\n\nChoose a product to manage its tasks:", env, { reply_markup: { inline_keyboard: rows } });
}

async function adminTaskList(chatId, productDbId, env) {
  const products = await sb(env, "products", { select: "id,title,product_id", filter: [{ column: "id", operator: "eq", value: productDbId }], limit: 1 });
  if (!products.length) return sendMessage(chatId, "❌ Product not found.", env);
  const tasks = await sb(env, "product_tasks", { select: "id,task_type,title,task_url,required_count,required,status", filter: [{ column: "product_id", operator: "eq", value: productDbId }], order: "sort_order.asc", limit: 50 });
  let text = `<b>📋 Tasks: ${escapeHtml(products[0].title)}</b>\n\n`;
  if (!tasks.length) text += "No tasks added yet.\n";
  const rows = [];
  for (const t of tasks) {
    text += `• ${escapeHtml(t.title)} — ${escapeHtml(t.task_type)}\n`;
    rows.push([{ text: `🗑 ${String(t.title).substring(0, 35)}`, callback_data: `delete_task:${t.id}` }]);
  }
  rows.unshift([{ text: "➕ Add Task", callback_data: `admin_add_task:${productDbId}` }]);
  rows.push([{ text: "🔙 Products", callback_data: "admin_task_products" }]);
  await sendMessage(chatId, text, env, { reply_markup: { inline_keyboard: rows } });
}

async function startNewTask(chatId, productDbId, env) {
  await setSession(env, chatId, { step: "task_type", task_product_id: productDbId, expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString() });
  await sendMessage(chatId, "<b>➕ Add Task — Step 1/4</b>\n\nSend type: <code>channel</code>, <code>group</code>, <code>referral</code>, <code>website</code>, or <code>custom</code>.\n\nUse /cancel to stop.", env, { reply_markup: { inline_keyboard: [[{ text: "🔙 Cancel", callback_data: `admin_task_list:${productDbId}` }]] } });
}

async function deleteTask(chatId, taskId, env) {
  const rows = await sb(env, "product_tasks", { select: "id,title,product_id", filter: [{ column: "id", operator: "eq", value: taskId }], limit: 1 });
  if (!rows.length) return sendMessage(chatId, "❌ Task not found.", env);
  await sbDelete(env, "product_tasks", [{ column: "id", operator: "eq", value: taskId }]);
  await sendMessage(chatId, `🗑 <b>Task deleted</b>\n\n${escapeHtml(rows[0].title)}`, env, { reply_markup: { inline_keyboard: [[{ text: "📋 Back to Tasks", callback_data: `admin_task_list:${rows[0].product_id}` }]] } });
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

Use the buttons below to update the public storefront.`,
    env,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "✏️ Site Name", callback_data: "edit_setting:site_name" }],
          [{ text: "✏️ Site Description", callback_data: "edit_setting:site_description" }],
          [{ text: "✏️ Website URL", callback_data: "edit_setting:website_url" }],
          [{ text: "👤 User Panel URL", callback_data: "edit_setting:user_panel_url" }],
          [{ text: "👑 Admin Panel URL", callback_data: "edit_setting:admin_panel_url" }],
          [{ text: "📱 Telegram Username", callback_data: "edit_setting:telegram_username" }],
          [{ text: "▶️ YouTube URL", callback_data: "edit_setting:youtube_url" }],
          [{ text: "📸 Instagram URL", callback_data: "edit_setting:instagram_url" }],
          [{ text: "✏️ Contact Admin", callback_data: "edit_setting:contact_admin" }],
          [{ text: "🔙 Admin Panel", callback_data: "back_admin" }]
        ]
      }
    }
  );
}

async function startEditSetting(chatId, key, env) {
  const allowed = ["site_name", "site_description", "website_url", "user_panel_url", "admin_panel_url", "telegram_username", "youtube_url", "instagram_url", "contact_admin"];
  if (!allowed.includes(key)) return;
  await setSession(env, chatId, {
    step: "setting_value",
    setting_key: key,
    expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString()
  });
  await sendMessage(chatId, `✏️ Send the new value for <code>${key}</code>.`, env, {
    reply_markup: { inline_keyboard: [[{ text: "🔙 Website Settings", callback_data: "admin_website" }]] }
  });
}

async function saveSetting(key, value, env) {
  const existing = await sb(env, "settings", {
    select: "id",
    filter: [{ column: "key", operator: "eq", value: key }],
    limit: 1
  });
  if (existing.length) {
    return await sbUpdate(env, "settings", [{ column: "key", operator: "eq", value: key }], {
      value,
      updated_at: new Date().toISOString()
    });
  }
  return await sbInsert(env, "settings", { key, value });
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

    case "setting_value": {
      const value = String(message.text || "").trim();
      if (!value) { await sendMessage(chatId, "❌ Value cannot be empty.", env); return true; }
      await saveSetting(session.setting_key, value, env);
      await clearSession(chatId, env);
      await sendMessage(chatId, "✅ Website setting updated.", env, { reply_markup: { inline_keyboard: [[{ text: "🌐 Website Settings", callback_data: "admin_website" }]] } });
      return true;
    }

    case "task_type": {
      const type = String(message.text || "").trim().toLowerCase();
      if (!["channel", "group", "referral", "website", "custom"].includes(type)) { await sendMessage(chatId, "❌ Use channel, group, referral, website, or custom.", env); return true; }
      await updateSession(env, chatId, { step: "task_title", task_type: type });
      await sendMessage(chatId, "<b>Step 2/4</b>\n\nSend the task title.", env); return true;
    }

    case "task_title": {
      const title = String(message.text || "").trim();
      if (!title) { await sendMessage(chatId, "❌ Title cannot be empty.", env); return true; }
      await updateSession(env, chatId, { step: "task_url", task_title: title });
      await sendMessage(chatId, "<b>Step 3/4</b>\n\nSend task URL or type <code>skip</code>.", env); return true;
    }

    case "task_url": {
      const raw = String(message.text || "").trim();
      await updateSession(env, chatId, { step: "task_count", task_url: raw.toLowerCase() === "skip" ? null : raw });
      await sendMessage(chatId, "<b>Step 4/4</b>\n\nSend referral required count (number) or type <code>1</code>.", env); return true;
    }

    case "task_count": {
      const count = Math.max(1, Number(message.text || 1) || 1);
      const body = { product_id: session.task_product_id, task_type: session.task_type, title: session.task_title, description: "", task_url: session.task_url || null, channel_id: session.task_type === "channel" || session.task_type === "group" ? session.task_url : null, required_count: count, sort_order: 0, status: "active", required: true };
      await sbInsert(env, "product_tasks", body);
      await clearSession(chatId, env);
      await sendMessage(chatId, "✅ Task added successfully.", env, { reply_markup: { inline_keyboard: [[{ text: "📋 View Tasks", callback_data: `admin_task_list:${session.task_product_id}` }]] } }); return true;
    }

    case "product_content": {
      const raw = String(message.text || "").trim();
      await updateSession(env, chatId, { step:"product_faq", content_html: raw.toLowerCase() === "skip" ? null : raw });
      await sendMessage(chatId, "FAQ JSON or Q | A lines, or skip.", env);
      return true;
    }

    case "product_faq": {
      const raw = String(message.text || "").trim();
      let faq = [];
      if (raw && raw.toLowerCase() !== "skip") {
        try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) faq = parsed; }
        catch { faq = raw.split("\n").map(function(line){ const p=line.split("|"); return {q:(p[0]||"").trim(),a:(p.slice(1).join("|")||"").trim()}; }).filter(function(x){return x.q && x.a;}); }
      }
      await updateSession(env, chatId, { step:"product_preview", faq_json:faq });
      await productPreview(chatId, env);
      return true;
    }
    case "post_title": {
      const title=String(message.text||"").trim(); if(!title){await sendMessage(chatId,"❌ Title required.",env);return true;}
      await updateSession(env,chatId,{step:"post_category",post_title:title});
      const cats=await sb(env,"categories",{select:"id,name",filter:[{column:"status",operator:"eq",value:"active"}],order:"name.asc"});
      const kb=cats.map(function(x){return [{text:x.name,callback_data:"select_post_category:"+x.id}];}); kb.push([{text:"Skip Category",callback_data:"select_post_category:0"}]);
      await sendMessage(chatId,"Step 2 — Choose category.",env,{reply_markup:{inline_keyboard:kb}}); return true;
    }

    case "post_content": {
      const raw=String(message.text||"").trim(); await updateSession(env,chatId,{step:"post_thumbnail",post_content_html:raw.toLowerCase()==="skip"?"":raw});
      await sendMessage(chatId,"Step 4 — Send thumbnail photo or image URL, or skip.",env); return true;
    }

    case "post_thumbnail": {
      const raw=String(message.text||"").trim(); let patch={step:"post_faq",post_thumbnail_url:null,post_thumbnail_file_id:null};
      if(message.photo&&message.photo.length) patch.post_thumbnail_file_id=message.photo[message.photo.length-1].file_id;
      else if(/^https?:\/\//i.test(raw)) patch.post_thumbnail_url=raw;
      else if(raw.toLowerCase()!=="skip"){await sendMessage(chatId,"❌ Send photo, image URL or skip.",env);return true;}
      await updateSession(env,chatId,patch); await sendMessage(chatId,"Step 5 — FAQ JSON or Q | A lines, or skip.",env); return true;
    }

    case "post_faq": {
      const raw=String(message.text||"").trim(); let faq=[];
      if(raw&&raw.toLowerCase()!=="skip"){try{const x=JSON.parse(raw);if(Array.isArray(x))faq=x;}catch{faq=raw.split("\n").map(function(line){const p=line.split("|");return{q:(p[0]||"").trim(),a:(p.slice(1).join("|")||"").trim()};}).filter(function(x){return x.q&&x.a;});}}
      await updateSession(env,chatId,{step:"post_seo_title",post_faq_json:faq}); await sendMessage(chatId,"Step 6 — SEO title or skip.",env); return true;
    }

    case "post_seo_title": { const raw=String(message.text||"").trim(); await updateSession(env,chatId,{step:"post_seo_description",post_seo_title:raw.toLowerCase()==="skip"?"":raw}); await sendMessage(chatId,"Step 7 — SEO description or skip.",env); return true; }
    case "post_seo_description": {
      const raw=String(message.text||"").trim(); await updateSession(env,chatId,{step:"post_preview",post_seo_description:raw.toLowerCase()==="skip"?"":raw});
      const s=await getSession(chatId,env); await sendMessage(chatId,"<b>👀 Post Preview</b>\n\n<b>"+escapeHtml(s.post_title)+"</b>\nContent: "+(s.post_content_html?"Added":"Skipped")+"\nFAQ: "+((s.post_faq_json||[]).length?"Added":"Skipped")+"\n\nPublish?",env,{reply_markup:{inline_keyboard:[[ {text:"✅ Publish",callback_data:"publish_post"},{text:"❌ Cancel",callback_data:"cancel_post"} ]]}}); return true;
    }

    case "admin_user_id": { const id=Number(message.text||0); if(!id){await sendMessage(chatId,"❌ Numeric Telegram ID required.",env);return true;} await updateSession(env,chatId,{step:"admin_name",new_admin_user_id:id}); await sendMessage(chatId,"Send admin name.",env); return true; }
    case "admin_name": { const name=String(message.text||"").trim(); await updateSession(env,chatId,{step:"admin_role",new_admin_name:name}); await sendMessage(chatId,"Role: admin, product_admin, task_admin, or user_admin.",env); return true; }
    case "admin_role": { const role=String(message.text||"admin").trim().toLowerCase(); if(!["admin","product_admin","task_admin","user_admin"].includes(role)){await sendMessage(chatId,"❌ Invalid role.",env);return true;} await sbInsert(env,"admins",{telegram_user_id:session.new_admin_user_id,name:session.new_admin_name,role,status:"active"}); await clearSession(chatId,env); await adminAdmins(chatId,env); return true; }

    case "link_title": { const title=String(message.text||"").trim(); await updateSession(env,chatId,{step:"link_url",new_link_title:title}); await sendMessage(chatId,"Send full URL.",env); return true; }
    case "link_url": { const url=String(message.text||"").trim(); if(!/^https?:\/\//i.test(url)){await sendMessage(chatId,"❌ Valid http(s) URL required.",env);return true;} await updateSession(env,chatId,{step:"link_type",new_link_url:url}); await sendMessage(chatId,"Type: telegram, website, youtube, instagram or custom.",env); return true; }
    case "link_type": { const type=String(message.text||"custom").trim().toLowerCase(); if(!["telegram","website","youtube","instagram","custom"].includes(type)){await sendMessage(chatId,"❌ Invalid type.",env);return true;} await sbInsert(env,"site_links",{title:session.new_link_title,url:session.new_link_url,link_type:type,placement:"footer",sort_order:0,status:"active"}); await clearSession(chatId,env); await adminSiteLinks(chatId,env); return true; }
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

/* =========================================================
   WEB ADMIN PANEL
========================================================= */

async function adminPanelPage(request, env) {
  const token = await adminCookie(request, env);
  if (!token) {
    return html(ADMIN_LOGIN_HTML);
  }
  return html(ADMIN_PANEL_HTML);
}

async function adminLogin(request, env) {
  try {
    const body = await request.json();
    const password = String(body?.password || "");
    const expected = String(env.ADMIN_PANEL_PASSWORD || "");
    if (!expected || password !== expected) return json({ ok: false, error: "Invalid password" }, 401);
    const token = await makeAdminToken(env, Date.now());
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": "po_admin=" + token + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400",
        ...corsHeaders()
      }
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || "Login failed" }, 400);
  }
}

async function adminApi(request, env, url) {
  if (!(await adminCookie(request, env))) return json({ ok: false, error: "Unauthorized" }, 401);
  const path = url.pathname.substring("/api/admin/".length);
  if (request.method === "GET" && path === "data") return await adminData(env);
  if (request.method === "POST" && path === "save") return await adminSave(request, env);
  if (request.method === "POST" && path === "delete") return await adminDelete(request, env);
  if (request.method === "POST" && path === "logout") return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", "Set-Cookie": "po_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0", ...corsHeaders() } });
  return json({ ok: false, error: "Admin endpoint not found" }, 404);
}

async function adminData(env) {
  const [products, posts, categories, links, admins, settings] = await Promise.all([
    sb(env,"products",{select:"*",order:"created_at.desc",limit:500}),
    sb(env,"posts",{select:"*",order:"created_at.desc",limit:500}),
    sb(env,"categories",{select:"*",order:"created_at.desc",limit:200}),
    sb(env,"site_links",{select:"*",order:"sort_order.asc",limit:200}),
    sb(env,"admins",{select:"*",order:"created_at.desc",limit:200}),
    sb(env,"settings",{select:"key,value",order:"key.asc",limit:200})
  ]);
  return json({ok:true,products,posts,categories,links,admins,settings});
}

function adminAllowedTable(table) {
  return ["products","posts","categories","site_links","admins","settings"].includes(table);
}

async function adminSave(request, env) {
  const body = await request.json();
  const table = String(body?.table || "");
  const id = body?.id;
  const data = body?.data && typeof body.data === "object" ? {...body.data} : {};
  if (!adminAllowedTable(table)) return json({ok:false,error:"Table not allowed"},400);
  delete data.id;
  if (table === "settings") {
    const key = String(data.key || "");
    if (!key) return json({ok:false,error:"Setting key required"},400);
    const existing = await sb(env,"settings",{select:"id",filter:[{column:"key",operator:"eq",value:key}],limit:1});
    if (existing.length) await sbUpdate(env,"settings",[{column:"id",operator:"eq",value:existing[0].id}],{value:String(data.value ?? "")});
    else await sbInsert(env,"settings",{key,value:String(data.value ?? "")});
    return json({ok:true});
  }
  if (id) await sbUpdate(env,table,[{column:"id",operator:"eq",value:id}],data);
  else await sbInsert(env,table,data);
  return json({ok:true});
}

async function adminDelete(request, env) {
  const body = await request.json();
  const table = String(body?.table || "");
  const id = body?.id;
  if (!adminAllowedTable(table) || !id) return json({ok:false,error:"Invalid delete request"},400);
  await sbDelete(env,table,[{column:"id",operator:"eq",value:id}]);
  return json({ok:true});
}

async function adminCookie(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\\s*)po_admin=([^;]+)/);
  if (!match || !env.ADMIN_PANEL_PASSWORD) return null;
  const token = decodeURIComponent(match[1]);
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const ts = Number(parts[0]);
  if (!Number.isFinite(ts) || Date.now() - ts > 86400000) return null;
  const expected = await makeAdminToken(env, ts);
  return token === expected ? token : null;
}

async function makeAdminToken(env, timestamp) {
  const data = String(timestamp);
  const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(String(env.ADMIN_PANEL_PASSWORD || "")),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const sig = await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(data));
  const bytes = new Uint8Array(sig);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2,"0");
  return data+"."+out;
}

const ADMIN_LOGIN_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tele PDF Admin Login</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6fb;font-family:Inter,system-ui}.box{width:min(400px,calc(100% - 32px));background:#fff;padding:30px;border-radius:22px;box-shadow:0 20px 60px #17203318}h1{margin-top:0}input,button{width:100%;box-sizing:border-box;padding:14px;border-radius:12px;border:1px solid #dce1ea;font-size:16px;margin-top:10px}button{background:#3157d5;color:#fff;border:0;font-weight:800;cursor:pointer}.err{color:#c62828;margin-top:12px}</style></head><body><form class="box" id="f"><h1>🔐 Tele PDF</h1><p>Admin Panel Login</p><input id="p" type="password" placeholder="Admin password" required><button>Login</button><div class="err" id="e"></div></form><script>f.onsubmit=async e=>{e.preventDefault();const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:p.value})});const j=await r.json();if(j.ok)location.href='/admin';else document.querySelector('#e').textContent=j.error||'Login failed'}</script></body></html>`;

const ADMIN_PANEL_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tele PDF Admin</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f7fb;color:#182033;font-family:Inter,system-ui,sans-serif}.app{display:flex;min-height:100vh}.side{width:230px;background:#101936;color:#fff;padding:22px 14px;position:fixed;inset:0 auto 0 0}.side h2{margin:0 8px 22px}.side button{display:block;width:100%;border:0;background:transparent;color:#dce3ff;text-align:left;padding:12px;border-radius:10px;cursor:pointer;margin:4px 0}.side button.active,.side button:hover{background:#2e4fc4;color:#fff}.main{margin-left:230px;padding:25px;width:calc(100% - 230px)}.top{display:flex;justify-content:space-between;align-items:center;gap:10px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:20px 0}.stat,.panel{background:#fff;border:1px solid #e6eaf1;border-radius:16px;padding:18px;box-shadow:0 8px 25px #17203308}.stat b{font-size:28px}.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}input,textarea,select{width:100%;padding:11px;border:1px solid #dce1ea;border-radius:10px;background:#fff}textarea{min-height:120px}.btn{border:0;border-radius:10px;padding:10px 14px;background:#3157d5;color:#fff;font-weight:800;cursor:pointer}.btn.danger{background:#c62828}.btn.gray{background:#667085}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.item{border:1px solid #e6eaf1;border-radius:14px;padding:14px}.item h3{margin:0 0 6px}.muted{color:#667085;font-size:13px}.modal{position:fixed;inset:0;background:#0008;display:none;place-items:center;padding:15px}.modal.open{display:grid}.modalbox{background:#fff;width:min(760px,100%);max-height:92vh;overflow:auto;border-radius:18px;padding:20px}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field{margin:9px 0}.field label{font-size:12px;font-weight:800;display:block;margin-bottom:5px}.wide{grid-column:1/-1}@media(max-width:800px){.side{width:70px;padding:10px 7px}.side h2{font-size:0}.side h2:after{content:'PO';font-size:18px}.side button{font-size:0;text-align:center}.side button:before{content:'•';font-size:20px}.main{margin-left:70px;width:calc(100% - 70px);padding:15px}.stats{grid-template-columns:1fr 1fr}.grid,.row{grid-template-columns:1fr}.top h1{font-size:22px}}</style></head><body><div class="app"><aside class="side"><h2>Tele PDF</h2><button data-tab="dashboard">📊 Dashboard</button><button data-tab="products">📦 Products</button><button data-tab="posts">📝 Posts</button><button data-tab="categories">📂 Categories</button><button data-tab="links">🔗 Links & Tasks</button><button data-tab="admins">👑 Admins</button><button data-tab="settings">⚙️ Settings</button><button id="logout">🚪 Logout</button></aside><main class="main"><div class="top"><h1 id="title">Dashboard</h1><button class="btn" id="add">＋ Add</button></div><div id="view"></div></main></div><div class="modal" id="modal"><div class="modalbox"><div class="top"><h2 id="mt">Edit</h2><button class="btn gray" onclick="closeModal()">Close</button></div><form id="form"></form></div></div><script>
let D={},tab='dashboard',editId=null;
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
async function load(){const r=await fetch('/api/admin/data');if(r.status===401){location.href='/admin';return}D=await r.json();render()}
function render(){document.querySelectorAll('.side button[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));document.querySelector('#title').textContent=tab[0].toUpperCase()+tab.slice(1);const v=document.querySelector('#view');if(tab==='dashboard'){v.innerHTML='<div class="stats">'+[['Products',D.products?.length],['Posts',D.posts?.length],['Categories',D.categories?.length],['Admins',D.admins?.length]].map(x=>'<div class="stat"><div>'+x[0]+'</div><b>'+x[1]+'</b></div>').join('')+'</div><div class="panel"><h2>Quick Management</h2><p class="muted">Manage products, posts, categories, links, admins and SEO settings from this panel.</p></div>';return}const rows=D[tab==='links'?'links':tab]||[];v.innerHTML='<div class="toolbar"><button class="btn" onclick="newItem()">＋ Create New</button><button class="btn gray" onclick="load()">↻ Refresh</button></div><div class="grid">'+rows.map(itemCard).join('')+'</div>'}
function itemCard(x){const title=x.title||x.name||x.key||x.product_id||x.post_id||x.telegram_user_id||'Item';const sub=x.slug||x.description||x.role||x.value||x.url||x.link_type||'';return '<div class="item"><h3>'+esc(title)+'</h3><div class="muted">'+esc(sub).slice(0,220)+'</div><div class="toolbar"><button class="btn" onclick="edit(\\''+esc(x.id||'')+'\\',\\''+encodeURIComponent(JSON.stringify(x))+'\\')">Edit</button><button class="btn danger" onclick="delItem(\\''+esc(x.id||'')+'\\')">Delete</button></div></div>'}
function fieldsFor(x){if(tab==='products')return [['title','Title'],['description','Description','wide'],['price','Price'],['product_type','Product type'],['media_type','Media type'],['category_id','Category ID'],['slug','Slug'],['cover_image','Thumbnail URL'],['telegram_file_id','Telegram File ID'],['file_name','File name'],['external_url','External URL'],['content_html','HTML content','wide'],['seo_title','SEO title'],['seo_description','SEO description','wide'],['faq_json','FAQ JSON','wide'],['status','Status'],['noindex','Noindex']];if(tab==='posts')return [['title','Title'],['category_id','Category ID'],['slug','Slug'],['excerpt','Excerpt','wide'],['content_html','HTML content','wide'],['thumbnail_url','Thumbnail URL'],['seo_title','SEO title'],['seo_description','SEO description','wide'],['faq_json','FAQ JSON','wide'],['status','Status'],['noindex','Noindex']];if(tab==='categories')return [['name','Name'],['slug','Slug'],['description','Description','wide'],['image_url','Image URL'],['seo_title','SEO title'],['seo_description','SEO description','wide'],['status','Status'],['noindex','Noindex']];if(tab==='links')return [['title','Title'],['url','URL','wide'],['link_type','Link type'],['placement','Placement'],['sort_order','Sort order'],['status','Status']];if(tab==='admins')return [['telegram_user_id','Telegram User ID'],['name','Name'],['role','Role'],['status','Status']];return [['key','Setting key'],['value','Value','wide']];}
function edit(id,encoded){editId=id||null;const x=encoded?JSON.parse(decodeURIComponent(encoded)):{};document.querySelector('#mt').textContent=editId?'Edit':'Create';document.querySelector('#form').innerHTML='<div class="row">'+fieldsFor(x).map(f=>'<div class="field '+(f[2]||'')+'"><label>'+f[1]+'</label><textarea data-k="'+f[0]+'" '+(f[0]==='content_html'||f[0]==='description'||f[0]==='faq_json'||f[0]==='seo_description'||f[0]==='value'?'':'style="min-height:44px"')+'>'+esc(x[f[0]]??'')+'</textarea></div>').join('')+'</div><div class="toolbar"><button class="btn">Save</button></div>';document.querySelector('#modal').classList.add('open');document.querySelector('#form').onsubmit=save}
function newItem(){edit('',encodeURIComponent('{}'))}
async function save(e){e.preventDefault();const data={};document.querySelectorAll('#form [data-k]').forEach(el=>data[el.dataset.k]=el.value);if(data.noindex!==undefined)data.noindex=['true','1','yes','on'].includes(String(data.noindex).toLowerCase());const r=await fetch('/api/admin/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table:tab==='links'?'site_links':tab,id:editId,data})});const j=await r.json();if(!j.ok)return alert(j.error||'Save failed');closeModal();await load()}
async function delItem(id){if(!id||!confirm('Delete this item?'))return;const r=await fetch('/api/admin/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table:tab==='links'?'site_links':tab,id})});const j=await r.json();if(!j.ok)alert(j.error||'Delete failed');await load()}
function closeModal(){document.querySelector('#modal').classList.remove('open')}
document.querySelectorAll('.side button[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;render()});document.querySelector('#add').onclick=newItem;document.querySelector('#logout').onclick=async()=>{await fetch('/api/admin/logout',{method:'POST'});location.href='/admin'};load();
</script></body></html>`;

/* =========================================================
   SEO STOREFRONT
========================================================= */

async function siteOrigin(request,env){const configured=await getSetting(env,"website_url");if(configured&&/^https?:\/\//i.test(configured))return configured.replace(/\/$/,"");const host=request&&request.headers&&request.headers.get("host")||"telepdfs.blogspot.com";return "https://"+host;}
function pageShell(title,description,canonical,body,extra){return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>"+escapeHtml(title)+"</title><meta name=\"description\" content=\""+escapeHtml(description)+"\"><link rel=\"canonical\" href=\""+escapeHtml(canonical)+"\"><meta property=\"og:title\" content=\""+escapeHtml(title)+"\"><meta property=\"og:description\" content=\""+escapeHtml(description)+"\">"+(extra||"")+"<style>body{margin:0;background:#f5f7fb;color:#172033;font-family:Inter,system-ui,sans-serif}.wrap{max-width:1120px;margin:auto;padding:24px 16px}.hero{background:linear-gradient(135deg,#101936,#3f5fe2);color:#fff;border-radius:24px;padding:38px 28px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:18px}.card{background:#fff;border:1px solid #e8ebf2;border-radius:18px;padding:20px;box-shadow:0 8px 28px #1720330d}.cover{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:14px}.pill{display:inline-block;background:#edf1ff;color:#314ccf;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:800}.btn{display:inline-block;background:#3f5fe2;color:#fff;padding:12px 17px;border-radius:10px;font-weight:800;margin:8px 6px 0 0}.content{font-size:17px;line-height:1.8}.faq{border-top:1px solid #e7eaf1;padding:14px 0}.nav{display:flex;gap:15px;flex-wrap:wrap;margin:18px 0;color:#3f5fe2;font-weight:800}</style></head><body><main class=\"wrap\">"+body+"</main></body></html>";}
function websiteResponse(body,status,type){return new Response(body,{status:status||200,headers:{"Content-Type":type||"text/html; charset=utf-8","Cache-Control":"public,max-age=120"}});}
async function websiteHome(request,env){const origin=await siteOrigin(request,env);const name=await getSetting(env,"site_name")||"Tele PDF";const desc=await getSetting(env,"site_description")||"PDFs, notes, books, videos and study resources.";const ps=await sb(env,"products",{select:"product_id,title,description,cover_image,category_id,product_type,slug,media_type",filter:[{column:"status",operator:"eq",value:"active"}],order:"created_at.desc",limit:30});const cs=await sb(env,"categories",{select:"id,name,slug,description,image_url",filter:[{column:"status",operator:"eq",value:"active"}],order:"name.asc",limit:50});const cm=Object.fromEntries(cs.map(function(x){return[x.id,x];}));const cards=ps.map(function(p){const c=cm[p.category_id];const u=origin+"/p/"+slugify(c&&c.slug||"library")+"/"+slugify(p.slug||p.title)+"/"+encodeURIComponent(p.product_id);return "<article class=\"card\">"+(p.cover_image?"<img class=\"cover\" src=\""+escapeHtml(p.cover_image)+"\" alt=\""+escapeHtml(p.title)+" thumbnail\">":"")+"<span class=\"pill\">"+escapeHtml(p.media_type||p.product_type||"product")+"</span><h2><a href=\""+u+"\">"+escapeHtml(p.title)+"</a></h2><p>"+escapeHtml((p.description||"").slice(0,180))+"</p><a class=\"btn\" href=\""+u+"\">View</a></article>";}).join("");const cats=cs.map(function(x){return "<a class=\"card\" href=\""+origin+"/category/"+encodeURIComponent(x.slug)+"\"><h2>"+escapeHtml(x.name)+"</h2><p>"+escapeHtml(x.description||"")+"</p></a>";}).join("");return websiteResponse(pageShell(name,desc,origin,"<section class=\"hero\"><h1>"+escapeHtml(name)+"</h1><p>"+escapeHtml(desc)+"</p></section><nav class=\"nav\"><a href=\""+origin+"/\">Home</a><a href=\"#categories\">Categories</a><a href=\""+origin+"/sitemap.xml\">Sitemap</a></nav><section id=\"categories\"><h2>Categories</h2><div class=\"grid\">"+cats+"</div></section><h2>Latest Products</h2><div class=\"grid\">"+cards+"</div>"));}
async function websiteCategory(request,env,slug){const origin=await siteOrigin(request,env);const cs=await sb(env,"categories",{select:"id,name,slug,description,seo_title,seo_description,noindex",filter:[{column:"slug",operator:"eq",value:slug},{column:"status",operator:"eq",value:"active"}],limit:1});if(!cs.length)return websiteResponse(pageShell("Category not found","",origin,"<div class=\"card\"><h1>Category not found</h1></div>"),404);const c=cs[0];const ps=await sb(env,"products",{select:"product_id,title,description,cover_image,product_type,media_type,slug",filter:[{column:"category_id",operator:"eq",value:c.id},{column:"status",operator:"eq",value:"active"}],order:"created_at.desc",limit:100});const cards=ps.map(function(p){const u=origin+"/p/"+slugify(c.slug)+"/"+slugify(p.slug||p.title)+"/"+encodeURIComponent(p.product_id);return "<article class=\"card\">"+(p.cover_image?"<img class=\"cover\" src=\""+escapeHtml(p.cover_image)+"\" alt=\""+escapeHtml(p.title)+"\">":"")+"<h2><a href=\""+u+"\">"+escapeHtml(p.title)+"</a></h2><p>"+escapeHtml(p.description||"")+"</p><a class=\"btn\" href=\""+u+"\">View</a></article>";}).join("");const noindex=c.noindex?"<meta name=\"robots\" content=\"noindex,follow\">":"";return websiteResponse(pageShell(c.seo_title||c.name,c.seo_description||c.description||"",origin+"/category/"+encodeURIComponent(c.slug),"<nav class=\"nav\"><a href=\""+origin+"/\">← Home</a></nav><section class=\"hero\"><h1>"+escapeHtml(c.name)+"</h1><p>"+escapeHtml(c.description||"")+"</p></section><div class=\"grid\">"+cards+"</div>",noindex));}
async function websiteProduct(request,env,route){const origin=await siteOrigin(request,env);const id=route.split("/").pop();const rs=await sb(env,"products",{select:"id,product_id,title,description,cover_image,category_id,product_type,slug,seo_title,seo_description,content_html,faq_json,external_url,media_type,noindex,status",filter:[{column:"product_id",operator:"eq",value:id},{column:"status",operator:"eq",value:"active"}],limit:1});if(!rs.length)return websiteResponse(pageShell("Product not found","",origin,"<div class=\"card\"><h1>Product not found</h1></div>"),404);const p=rs[0];const cs=p.category_id?await sb(env,"categories",{select:"name,slug",filter:[{column:"id",operator:"eq",value:p.category_id}],limit:1}):[];const cat=cs[0];const url=origin+"/p/"+slugify(cat&&cat.slug||"library")+"/"+slugify(p.slug||p.title)+"/"+encodeURIComponent(p.product_id);const faq=Array.isArray(p.faq_json)?p.faq_json.map(function(x){return "<div class=\"faq\"><b>"+escapeHtml(x.q||x.question||"")+"</b><div>"+escapeHtml(x.a||x.answer||"")+"</div></div>";}).join(""):"";const noindex=p.noindex?"<meta name=\"robots\" content=\"noindex,follow\">":"";const bot=await getSetting(env,"telegram_username")||"telepdfsbot";const action=p.external_url?"<a class=\"btn\" href=\""+escapeHtml(p.external_url)+"\">🌐 Open Link</a>":"<a class=\"btn\" href=\"https://t.me/"+String(bot).replace(/^@/,"")+"?start="+encodeURIComponent(p.product_id)+"\">📥 Get on Telegram</a>";const schema=JSON.stringify({"@context":"https://schema.org","@type":"Product","name":p.title,"description":p.description||"","url":url,"image":p.cover_image||undefined});return websiteResponse(pageShell(p.seo_title||p.title,p.seo_description||p.description||"",url,"<nav class=\"nav\"><a href=\""+origin+"/\">← Home</a>"+(cat?"<a href=\""+origin+"/category/"+encodeURIComponent(cat.slug)+"\">"+escapeHtml(cat.name)+"</a>":"")+"</nav><article class=\"card\">"+(p.cover_image?"<img class=\"cover\" src=\""+escapeHtml(p.cover_image)+"\" alt=\""+escapeHtml(p.title)+"\">":"")+"<span class=\"pill\">"+escapeHtml(p.media_type||p.product_type||"product")+"</span><h1>"+escapeHtml(p.title)+"</h1><p>"+escapeHtml(p.description||"")+"</p><div class=\"content\">"+(p.content_html||"")+"</div>"+action+"<h2>FAQs</h2>"+(faq||"<p>No FAQs added.</p>")+"</article><script type=\"application/ld+json\">"+schema+"</script>",noindex));}
async function websitePost(request,env,slug){const origin=await siteOrigin(request,env);const rs=await sb(env,"posts",{select:"post_id,title,slug,category_id,content_html,excerpt,thumbnail_url,faq_json,seo_title,seo_description,noindex,status",filter:[{column:"slug",operator:"eq",value:slug},{column:"status",operator:"eq",value:"active"}],limit:1});if(!rs.length)return websiteResponse(pageShell("Post not found","",origin,"<div class=\"card\"><h1>Post not found</h1></div>"),404);const p=rs[0];const url=origin+"/post/"+encodeURIComponent(p.slug);const faq=Array.isArray(p.faq_json)?p.faq_json.map(function(x){return "<div class=\"faq\"><b>"+escapeHtml(x.q||x.question||"")+"</b><div>"+escapeHtml(x.a||x.answer||"")+"</div></div>";}).join(""):"";const noindex=p.noindex?"<meta name=\"robots\" content=\"noindex,follow\">":"";const schema=JSON.stringify({"@context":"https://schema.org","@type":"Article","headline":p.title,"description":p.seo_description||p.excerpt||"","url":url});return websiteResponse(pageShell(p.seo_title||p.title,p.seo_description||p.excerpt||"",url,"<nav class=\"nav\"><a href=\""+origin+"/\">← Home</a></nav><article class=\"card\">"+(p.thumbnail_url?"<img class=\"cover\" src=\""+escapeHtml(p.thumbnail_url)+"\" alt=\""+escapeHtml(p.title)+"\">":"")+"<h1>"+escapeHtml(p.title)+"</h1><div class=\"content\">"+(p.content_html||"")+"</div><h2>FAQs</h2>"+(faq||"<p>No FAQs added.</p>")+"</article><script type=\"application/ld+json\">"+schema+"</script>",noindex));}
async function websiteSitemap(request,env){const origin=await siteOrigin(request,env);const [ps,cs,posts]=await Promise.all([sb(env,"products",{select:"product_id,title,slug,category_id,updated_at,noindex",filter:[{column:"status",operator:"eq",value:"active"}],limit:5000}),sb(env,"categories",{select:"id,slug,noindex",filter:[{column:"status",operator:"eq",value:"active"}],limit:500}),sb(env,"posts",{select:"slug,updated_at,noindex",filter:[{column:"status",operator:"eq",value:"active"}],limit:5000})]);const cm=Object.fromEntries(cs.map(function(x){return[x.id,x.slug];}));const urls=["<url><loc>"+origin+"/</loc></url>"].concat(cs.filter(function(x){return !x.noindex;}).map(function(x){return "<url><loc>"+origin+"/category/"+encodeURIComponent(x.slug)+"</loc></url>";}),ps.filter(function(x){return !x.noindex;}).map(function(p){return "<url><loc>"+origin+"/p/"+slugify(cm[p.category_id]||"library")+"/"+slugify(p.slug||p.title)+"/"+encodeURIComponent(p.product_id)+"</loc></url>";}),posts.filter(function(x){return !x.noindex;}).map(function(p){return "<url><loc>"+origin+"/post/"+encodeURIComponent(p.slug)+"</loc></url>";})).join("");return websiteResponse("<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">"+urls+"</urlset>",200,"application/xml; charset=utf-8");}
async function websiteRobots(request,env){const origin=await siteOrigin(request,env);return websiteResponse("User-agent: *\nAllow: /\nSitemap: "+origin+"/sitemap.xml\n",200,"text/plain; charset=utf-8");}
