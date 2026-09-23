/**
 * Telegram PDF Delivery + Product Bot
 * Cloudflare Worker + Supabase
 *
 * Required Secrets:
 * BOT_TOKEN
 * SUPABASE_URL
 * SUPABASE_KEY
 * ADMIN_TELEGRAM_ID
 * WEBHOOK_SECRET
 * CHANNEL_ID
 * CHANNEL_INVITE_URL
 */

const TG = "https://api.telegram.org/bot";
const PRODUCT_TYPES = [
  ["type:book", "📕 Book"],
  ["type:notes", "📚 Notes"],
  ["type:pdf", "📄 PDF"],
  ["type:test", "📝 Test"],
  ["type:study", "🎓 Study Material"],
  ["type:other", "📦 Other"]
];

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      // Health
      if (request.method === "GET" && url.pathname === "/") {
        return json({
          ok: true,
          service: "Telegram PDF Bot",
          status: "running"
        });
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return json({
          ok: true,
          status: "healthy",
          time: new Date().toISOString()
        });
      }

      // Website API
      if (request.method === "GET" && url.pathname === "/api/products") {
        return await apiProducts(env);
      }

      if (request.method === "GET" && url.pathname === "/api/search") {
        return await apiSearch(env, url.searchParams.get("q") || "");
      }

      if (
        request.method === "GET" &&
        url.pathname.startsWith("/api/product/")
      ) {
        const productId = decodeURIComponent(
          url.pathname.substring("/api/product/".length)
        );

        return await apiProduct(env, productId);
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/settings"
      ) {
        return await apiSettings(env);
      }

      // Telegram webhook
      if (request.method === "POST") {
        if (env.WEBHOOK_SECRET) {
          const secret =
            request.headers.get("X-Telegram-Bot-Api-Secret-Token");

          if (secret !== env.WEBHOOK_SECRET) {
            return new Response("Unauthorized", { status: 401 });
          }
        }

        const update = await request.json();
        await handleUpdate(update, env);

        return json({ ok: true });
      }

      return json({ ok: false, error: "Not found" }, 404);
    } catch (err) {
      console.error(err);
      return json(
        {
          ok: false,
          error: String(err?.message || err)
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
   UPDATE HANDLER
========================================================= */

async function handleUpdate(update, env) {
  if (update.callback_query) {
    await handleCallback(update.callback_query, env);
    return;
  }

  if (!update.message) return;

  const message = update.message;
  const user = message.from;

  if (!user?.id) return;

  await touchUser(user, env);

  if (message.text) {
    await handleText(message, env);
    return;
  }

  if (message.document) {
    await handleDocument(message, env);
    return;
  }

  if (message.photo) {
    await handlePhoto(message, env);
    return;
  }
}


/* =========================================================
   TEXT HANDLER
========================================================= */

async function handleText(message, env) {
  const chatId = message.chat.id;
  const user = message.from;
  const text = String(message.text || "").trim();

  if (text.startsWith("/start")) {
    await handleStart(message, env);
    return;
  }

  if (text === "/cancel") {
    await clearSession(user.id, env);
    await sendMessage(
      env,
      chatId,
      "❌ Current process cancelled."
    );
    return;
  }

  if (text === "/admin") {
    if (!(await isAdmin(user.id, env))) {
      await sendMessage(env, chatId, "⛔ Admin access required.");
      return;
    }

    await adminPanel(chatId, env);
    return;
  }

  if (text === "/newproduct") {
    if (!(await can(user.id, env, "product"))) {
      await sendMessage(env, chatId, "⛔ You don't have permission.");
      return;
    }

    await startProductCreation(user.id, chatId, env);
    return;
  }

  if (text === "/search") {
    await sendMessage(
      env,
      chatId,
      "🔎 Product search\n\nUse:\n/search keyword"
    );
    return;
  }

  if (text.startsWith("/search ")) {
    const q = text.substring(8).trim();

    if (!q) {
      await sendMessage(env, chatId, "Please enter a search keyword.");
      return;
    }

    await telegramSearch(chatId, q, env);
    return;
  }

  // Search fallback
  if (text.startsWith("search ")) {
    const q = text.substring(7).trim();
    await telegramSearch(chatId, q, env);
    return;
  }

  // Admin session
  const session = await getSession(user.id, env);

  if (
    session &&
    session.step &&
    session.step !== "idle"
  ) {
    await processAdminSession(message, session, env);
    return;
  }

  await sendMainMenu(chatId, env);
}


/* =========================================================
   START / DEEP LINK
========================================================= */

async function handleStart(message, env) {
  const chatId = message.chat.id;
  const user = message.from;

  const parts = String(message.text || "").split(/\s+/);
  const payload = parts[1] || "";

  await touchUser(user, env);

  // Referral start
  if (payload.startsWith("ref_")) {
    const value = payload.substring(4);

    const sep = value.indexOf("_");

    if (sep > 0) {
      const referrer = value.substring(0, sep);
      const productId = value.substring(sep + 1);

      await processReferralStart(
        user.id,
        referrer,
        productId,
        env
      );
    }

    await sendMainMenu(chatId, env);
    return;
  }

  // Product start
  if (payload) {
    const product = await getProductByProductId(
      payload,
      env
    );

    if (product) {
      await openProduct(
        user,
        chatId,
        product,
        env
      );
      return;
    }
  }

  await sendMainMenu(chatId, env);
}


/* =========================================================
   MAIN MENU
========================================================= */

async function sendMainMenu(chatId, env) {
  const buttons = [
    [
      {
        text: "🔎 Search Products",
        callback_data: "search"
      }
    ],
    [
      {
        text: "📚 Latest Products",
        callback_data: "latest"
      }
    ],
    [
      {
        text: "👤 Contact Admin",
        callback_data: "contact"
      }
    ]
  ];

  if (await isAdmin(chatId, env)) {
    buttons.push([
      {
        text: "👑 Admin Panel",
        callback_data: "admin"
      }
    ]);
  }

  await sendMessage(
    env,
    chatId,
    "👋 <b>Welcome!</b>\n\nChoose an option:",
    buttons
  );
}


/* =========================================================
   PRODUCT OPEN
========================================================= */

async function openProduct(user, chatId, product, env) {
  if (product.status !== "active" || product.deleted_at) {
    await sendMessage(
      env,
      chatId,
      "❌ This product is no longer available."
    );
    return;
  }

  await updateUserProduct(
    user.id,
    product.id,
    env
  );

  const websiteUrl = await productWebsiteUrl(
    product.product_id,
    env
  );

  const buttons = [];

  if (websiteUrl) {
    buttons.push([
      {
        text: "🌐 Open Website",
        url: websiteUrl
      }
    ]);
  }

  const joined = await verifyRequiredChannel(
    user.id,
    env
  );

  if (!joined) {
    const invite =
      env.CHANNEL_INVITE_URL ||
      await getSetting("channel_join_url", env);

    if (invite) {
      buttons.push([
        {
          text: "📢 Join Channel",
          url: invite
        }
      ]);
    }

    buttons.push([
      {
        text: "✅ I've Joined - Verify",
        callback_data:
          "verifyjoin:" + product.product_id
      }
    ]);

    await sendMessage(
      env,
      chatId,
      "📕 <b>" +
        escapeHtml(product.title) +
        "</b>\n\n" +
        escapeHtml(product.description || "") +
        "\n\n🔐 First join our required Telegram channel and then verify.",
      buttons
    );

    return;
  }

  await unlockProduct(
    user.id,
    chatId,
    product,
    env
  );
}


/* =========================================================
   UNLOCK PRODUCT
========================================================= */

async function unlockProduct(
  telegramUserId,
  chatId,
  product,
  env
) {
  const tasks = await getProductTasks(
    product.id,
    env
  );

  const requiredTasks =
    tasks.filter(t => t.required !== false);

  let incomplete = [];

  for (const task of requiredTasks) {
    const done = await isTaskCompleted(
      telegramUserId,
      task.id,
      env
    );

    if (!done) incomplete.push(task);
  }

  if (incomplete.length) {
    const buttons = [];

    for (const task of incomplete) {
      if (task.task_url) {
        buttons.push([
          {
            text: "🔗 " + task.title,
            url: task.task_url
          }
        ]);
      }

      if (
        task.task_type === "channel" ||
        task.task_type === "group"
      ) {
        buttons.push([
          {
            text: "📢 " + task.title,
            callback_data:
              "taskverify:" + task.id
          }
        ]);
      } else if (
        task.task_type === "website" ||
        task.task_type === "custom"
      ) {
        buttons.push([
          {
            text: "✅ Complete: " + task.title,
            callback_data:
              "taskclick:" + task.id
          }
        ]);
      }
    }

    buttons.push([
      {
        text: "🔄 Check Tasks",
        callback_data:
          "checktasks:" + product.product_id
      }
    ]);

    await sendMessage(
      env,
      chatId,
      "🔐 <b>Complete required tasks</b>\n\n" +
        "Product: <b>" +
        escapeHtml(product.title) +
        "</b>\n\n" +
        "Complete all required tasks below:",
      buttons
    );

    return;
  }

  // Referral requirement
  const referralTask = tasks.find(
    t =>
      t.required !== false &&
      t.task_type === "referral"
  );

  if (referralTask) {
    const count = await countSuccessfulReferrals(
      telegramUserId,
      product.id,
      env
    );

    const required =
      Number(referralTask.required_count || 1);

    if (count < required) {
      const bot = await getBotUsername(env);

      const referralLink =
        "https://t.me/" +
        bot +
        "?start=ref_" +
        telegramUserId +
        "_" +
        product.product_id;

      const buttons = [
        [
          {
            text: "📨 Invite Friends",
            url:
              "https://t.me/share/url?url=" +
              encodeURIComponent(referralLink) +
              "&text=" +
              encodeURIComponent(
                "Get this free study material"
              )
          }
        ],
        [
          {
            text: "🔄 Check Referrals",
            callback_data:
              "checkref:" +
              product.product_id
          }
        ]
      ];

      await sendMessage(
        env,
        chatId,
        "🎁 <b>Referral Requirement</b>\n\n" +
          "Required: <b>" +
          required +
          "</b>\n" +
          "Completed: <b>" +
          count +
          "</b>\n\n" +
          "Invite qualifying users using your referral link.",
        buttons
      );

      return;
    }
  }

  // Paid product
  if (Number(product.price || 0) > 0) {
    await sendMessage(
      env,
      chatId,
      "💳 <b>Paid Product</b>\n\n" +
        "Price: ₹" +
        Number(product.price).toFixed(2) +
        "\n\nPayment gateway is not configured yet."
    );

    return;
  }

  if (!product.telegram_file_id) {
    await sendMessage(
      env,
      chatId,
      "❌ PDF file is not available."
    );
    return;
  }

  const result = await sendDocument(
    env,
    chatId,
    product.telegram_file_id,
    product.title
  );

  if (!result.ok) {
    await sendMessage(
      env,
      chatId,
      "❌ PDF delivery failed. Please contact admin."
    );
  }
}


/* =========================================================
   CALLBACK HANDLER
========================================================= */

async function handleCallback(query, env) {
  const user = query.from;
  const chatId = query.message?.chat?.id || user.id;
  const data = query.data || "";

  await answerCallbackQuery(
    env,
    query.id
  );

  if (data === "admin") {
    if (await isAdmin(user.id, env)) {
      await adminPanel(chatId, env);
    }
    return;
  }

  if (data === "contact") {
    const contact =
      await getSetting("contact_admin", env);

    await sendMessage(
      env,
      chatId,
      contact
        ? "👤 <b>Contact Admin</b>\n\n" +
          escapeHtml(contact)
        : "❌ Admin contact is not configured."
    );

    return;
  }

  if (data === "search") {
    await sendMessage(
      env,
      chatId,
      "🔎 Send:\n\n/search keyword"
    );
    return;
  }

  if (data === "latest") {
    await latestProducts(chatId, env);
    return;
  }

  if (data.startsWith("verifyjoin:")) {
    const productId = data.substring(11);

    const product =
      await getProductByProductId(
        productId,
        env
      );

    if (!product) {
      await sendMessage(
        env,
        chatId,
        "❌ Product not found."
      );
      return;
    }

    const joined =
      await verifyRequiredChannel(
        user.id,
        env
      );

    if (!joined) {
      await sendMessage(
        env,
        chatId,
        "❌ Channel membership not detected.\n\nPlease join the channel first."
      );
      return;
    }

    await sendMessage(
      env,
      chatId,
      "✅ Channel verified!"
    );

    await unlockProduct(
      user.id,
      chatId,
      product,
      env
    );

    return;
  }

  if (data.startsWith("taskverify:")) {
    const taskId =
      Number(data.substring(11));

    await verifyTask(
      user.id,
      chatId,
      taskId,
      env
    );

    return;
  }

  if (data.startsWith("taskclick:")) {
    const taskId =
      Number(data.substring(10));

    await markTaskComplete(
      user.id,
      taskId,
      env
    );

    await sendMessage(
      env,
      chatId,
      "✅ Task marked complete.\n\nClick Check Tasks to continue."
    );

    return;
  }

  if (data.startsWith("checktasks:")) {
    const productId =
      data.substring(11);

    const product =
      await getProductByProductId(
        productId,
        env
      );

    if (product) {
      await unlockProduct(
        user.id,
        chatId,
        product,
        env
      );
    }

    return;
  }

  if (data.startsWith("checkref:")) {
    const productId =
      data.substring(9);

    const product =
      await getProductByProductId(
        productId,
        env
      );

    if (product) {
      await unlockProduct(
        user.id,
        chatId,
        product,
        env
      );
    }

    return;
  }

  /* ---------------- ADMIN ---------------- */

  if (!(await isAdmin(user.id, env))) {
    return;
  }

  if (data === "admin_products") {
    await productAdminMenu(chatId, env);
    return;
  }

  if (data === "admin_add_product") {
    await startProductCreation(
      user.id,
      chatId,
      env
    );
    return;
  }

  if (data === "admin_product_list") {
    await adminProductList(chatId, env);
    return;
  }

  if (data === "admin_tasks") {
    await taskAdminMenu(chatId, env);
    return;
  }

  if (data === "admin_add_task") {
    await startTaskCreation(
      user.id,
      chatId,
      env
    );
    return;
  }

  if (data === "admin_users") {
    await userStatistics(chatId, env);
    return;
  }

  if (data === "admin_admins") {
    await adminManagement(
      chatId,
      env
    );
    return;
  }

  if (data === "admin_add_admin") {
    await startAdminCreation(
      user.id,
      chatId,
      env
    );
    return;
  }

  if (data === "admin_website") {
    await startWebsiteSetting(
      user.id,
      chatId,
      env
    );
    return;
  }

  if (data === "admin_contact") {
    await startContactSetting(
      user.id,
      chatId,
      env
    );
    return;
  }

  if (data === "admin_categories") {
    await categoryAdminMenu(
      chatId,
      env
    );
    return;
  }

  if (data === "admin_cleanup") {
    await cleanupExpired(env);

    await sendMessage(
      env,
      chatId,
      "🧹 Cleanup completed."
    );

    return;
  }

  if (data.startsWith("delete_product:")) {
    const id =
      Number(data.substring(15));

    await deleteProduct(
      id,
      chatId,
      env
    );

    return;
  }

  if (data.startsWith("product_info:")) {
    const id =
      Number(data.substring(13));

    await adminProductInfo(
      id,
      chatId,
      env
    );

    return;
  }

  if (data.startsWith("select_task_product:")) {
    const id =
      Number(data.substring(20));

    const session =
      await getSession(user.id, env);

    if (session) {
      await updateSession(
        user.id,
        {
          product_id: String(id),
          step: "task_type"
        },
        env
      );

      await sendMessage(
        env,
        chatId,
        "Choose task type:",
        [
          [
            {
              text: "📢 Channel",
              callback_data: "tasktype:channel"
            },
            {
              text: "👥 Group",
              callback_data: "tasktype:group"
            }
          ],
          [
            {
              text: "🌐 Website",
              callback_data: "tasktype:website"
            },
            {
              text: "🔗 Custom Link",
              callback_data: "tasktype:custom"
            }
          ],
          [
            {
              text: "🎁 Referral",
              callback_data: "tasktype:referral"
            }
          ]
        ]
      );
    }

    return;
  }

  if (data.startsWith("tasktype:")) {
    const type =
      data.substring(9);

    const session =
      await getSession(user.id, env);

    if (!session) return;

    await updateSession(
      user.id,
      {
        task_type: type,
        step: "task_title"
      },
      env
    );

    await sendMessage(
      env,
      chatId,
      "Enter task title:"
    );

    return;
  }

  if (data.startsWith("type:")) {
    const type =
      data.substring(5);

    const session =
      await getSession(user.id, env);

    if (!session) return;

    await updateSession(
      user.id,
      {
        product_type: type,
        step: "product_cover"
      },
      env
    );

    await sendMessage(
      env,
      chatId,
      "🖼️ Send cover image/photo.\n\nOr type <code>skip</code>."
    );

    return;
  }

  if (data.startsWith("cat:")) {
    const catId =
      Number(data.substring(4));

    const session =
      await getSession(user.id, env);

    if (!session) return;

    await updateSession(
      user.id,
      {
        category_id: catId,
        step: "product_type"
      },
      env
    );

    await sendMessage(
      env,
      chatId,
      "Choose product type:",
      PRODUCT_TYPES.map(x => [
        {
          text: x[1],
          callback_data: x[0]
        }
      ])
    );

    return;
  }

  if (data === "cat:new") {
    await updateSession(
      user.id,
      {
        step: "category_new"
      },
      env
    );

    await sendMessage(
      env,
      chatId,
      "Enter new category name:"
    );

    return;
  }

  if (data === "publish_product") {
    await publishProductFromSession(
      user.id,
      chatId,
      env
    );
    return;
  }

  if (data === "cancel_session") {
    await clearSession(
      user.id,
      env
    );

    await sendMessage(
      env,
      chatId,
      "❌ Cancelled."
    );

    return;
  }

  if (data.startsWith("remove_admin:")) {
    const id =
      Number(data.substring(13));

    await removeAdmin(
      id,
      chatId,
      env
    );

    return;
  }
}


/* =========================================================
   ADMIN PANEL
========================================================= */

async function adminPanel(chatId, env) {
  await sendMessage(
    env,
    chatId,
    "👑 <b>ADMIN PANEL</b>\n\nChoose an option:",
    [
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
          text: "👑 Admins",
          callback_data: "admin_admins"
        }
      ],
      [
        {
          text: "📂 Categories",
          callback_data: "admin_categories"
        }
      ],
      [
        {
          text: "🌐 Website URL",
          callback_data: "admin_website"
        },
        {
          text: "👤 Contact Admin",
          callback_data: "admin_contact"
        }
      ],
      [
        {
          text: "🧹 Cleanup",
          callback_data: "admin_cleanup"
        }
      ]
    ]
  );
}


/* =========================================================
   PRODUCT ADMIN
========================================================= */

async function productAdminMenu(chatId, env) {
  await sendMessage(
    env,
    chatId,
    "📦 <b>PRODUCT MANAGEMENT</b>",
    [
      [
        {
          text: "➕ Add Product",
          callback_data: "admin_add_product"
        }
      ],
      [
        {
          text: "📋 Product List",
          callback_data: "admin_product_list"
        }
      ],
      [
        {
          text: "🔙 Admin Panel",
          callback_data: "admin"
        }
      ]
    ]
  );
}

async function adminProductList(chatId, env) {
  const products = await sb(
    env,
    "/rest/v1/products" +
      "?select=id,product_id,title,price,status,product_type" +
      "&deleted_at=is.null" +
      "&order=id.desc" +
      "&limit=50"
  );

  if (!products.length) {
    await sendMessage(
      env,
      chatId,
      "No products found."
    );
    return;
  }

  for (const p of products) {
    await sendMessage(
      env,
      chatId,
      "📦 <b>" +
        escapeHtml(p.title) +
        "</b>\n\n" +
        "ID: <code>" +
        escapeHtml(p.product_id) +
        "</code>\n" +
        "Type: " +
        escapeHtml(p.product_type || "pdf") +
        "\n" +
        "Price: ₹" +
        Number(p.price || 0),
      [
        [
          {
            text: "ℹ️ Info",
            callback_data:
              "product_info:" + p.id
          },
          {
            text: "🗑 Delete",
            callback_data:
              "delete_product:" + p.id
          }
        ]
      ]
    );
  }
}

async function adminProductInfo(id, chatId, env) {
  const rows = await sb(
    env,
    "/rest/v1/products?id=eq." +
      encodeURIComponent(id) +
      "&select=*"
  );

  const p = rows[0];

  if (!p) {
    await sendMessage(
      env,
      chatId,
      "❌ Product not found."
    );
    return;
  }

  const website =
    await productWebsiteUrl(
      p.product_id,
      env
    );

  await sendMessage(
    env,
    chatId,
    "📦 <b>Product</b>\n\n" +
      "ID: <code>" +
      escapeHtml(p.product_id) +
      "</code>\n" +
      "Title: " +
      escapeHtml(p.title) +
      "\n" +
      "Type: " +
      escapeHtml(p.product_type || "") +
      "\n" +
      "Price: ₹" +
      Number(p.price || 0) +
      "\n" +
      "Status: " +
      escapeHtml(p.status || "") +
      "\n\n" +
      (website
        ? "🌐 " + escapeHtml(website)
        : "")
  );
}

async function deleteProduct(id, chatId, env) {
  await sb(
    env,
    "/rest/v1/products?id=eq." +
      encodeURIComponent(id),
    {
      method: "DELETE"
    }
  );

  await sendMessage(
    env,
    chatId,
    "🗑 <b>Product permanently removed from database.</b>\n\nFuture Telegram delivery has been stopped."
  );
}


/* =========================================================
   PRODUCT CREATION
========================================================= */

async function startProductCreation(
  userId,
  chatId,
  env
) {
  await createSession(
    userId,
    {
      step: "product_pdf",
      product_type: "pdf"
    },
    env
  );

  await sendMessage(
    env,
    chatId,
    "➕ <b>Add Product</b>\n\nSend the PDF document now."
  );
}

async function handleDocument(message, env) {
  const userId = message.from.id;

  if (!(await can(userId, env, "product"))) {
    return;
  }

  const session =
    await getSession(userId, env);

  if (!session) return;

  if (session.step !== "product_pdf") {
    return;
  }

  const doc = message.document;

  await updateSession(
    userId,
    {
      telegram_file_id: doc.file_id,
      file_name: doc.file_name || "",
      file_size: doc.file_size || null,
      mime_type: doc.mime_type || "",
      step: "product_id"
    },
    env
  );

  await sendMessage(
    env,
    message.chat.id,
    "Enter unique Product ID.\n\nExample:\n<code>PHY001</code>"
  );
}

async function handlePhoto(message, env) {
  const userId = message.from.id;

  const session =
    await getSession(userId, env);

  if (!session) return;

  if (
    session.step === "product_cover"
  ) {
    const photos = message.photo || [];
    const last = photos[photos.length - 1];

    await updateSession(
      userId,
      {
        cover_image_file_id: last?.file_id || null,
        step: "product_preview"
      },
      env
    );

    await showProductPreview(
      userId,
      message.chat.id,
      env
    );
  }
}

async function processAdminSession(
  message,
  session,
  env
) {
  const userId = message.from.id;
  const chatId = message.chat.id;
  const text =
    String(message.text || "").trim();

  if (session.step === "product_id") {
    const existing =
      await getProductByProductId(
        text,
        env
      );

    if (existing) {
      await sendMessage(
        env,
        chatId,
        "❌ This Product ID already exists. Enter another."
      );
      return;
    }

    await updateSession(
      userId,
      {
        product_id: text,
        step: "product_title"
      },
      env
    );

    await sendMessage(
      env,
      chatId,
      "Enter product title:"
    );

    return;
  }

  if (session.step === "product_title") {
    await updateSession(
      userId,
      {
        title: text,
        step: "product_price"
      },
      env
    );

    await sendMessage(
      env,
      chatId,
      "Enter price.\n\nFor free product enter <code>0</code>."
    );

    return;
  }

  if (session.step === "product_price") {
    const price = Number(text);

    if (Number.isNaN(price) || price < 0) {
      await sendMessage(
        env,
        chatId,
        "❌ Enter a valid price."
      );
      return;
    }

    await updateSession(
      userId,
      {
        price,
        step: "product_description"
      },
      env
    );

    await sendMessage(
      env,
      chatId,
      "Enter product description:"
    );

    return;
  }

  if (session.step === "product_description") {
    await updateSession(
      userId,
      {
        description: text,
        step: "product_category"
      },
      env
    );

    await showCategoriesForProduct(
      chatId,
      env
    );

    return;
  }

  if (session.step === "category_new") {
    const name = text;

    const slug =
      slugify(name);

    const rows =
      await sb(
        env,
        "/rest/v1/categories",
        {
          method: "POST",
          body: {
            category_id:
              "CAT-" +
              Date.now(),
            name,
            slug,
            status: "active"
          },
          returnData: true
        }
      );

    const category =
      Array.isArray(rows)
        ? rows[0]
        : rows;

    await updateSession(
      userId,
      {
        category_id: category.id,
        step: "product_type"
      },
      env
    );

    await sendMessage(
      env,
      chatId,
      "Choose product type:",
      PRODUCT_TYPES.map(x => [
        {
          text: x[1],
          callback_data: x[0]
        }
      ])
    );

    return;
  }

  if (session.step === "product_cover") {
    if (text.toLowerCase() === "skip") {
      await updateSession(
        userId,
        {
          cover_image_file_id: null,
          step: "product_preview"
        },
        env
      );

      await showProductPreview(
        userId,
        chatId,
        env
      );
    }

    return;
  }

  if (session.step === "product_preview") {
    return;
  }

  /* TASK FLOW */

  if (session.step === "task_title") {
    await updateSession(
      userId,
      {
        title: text,
        step: "task_url"
      },
      env
    );

    if (
      session.task_type === "channel" ||
      session.task_type === "group"
    ) {
      await sendMessage(
        env,
        chatId,
        "Enter Telegram channel/group ID.\n\nExample:\n<code>-1001234567890</code>"
      );
    } else if (
      session.task_type === "referral"
    ) {
      await sendMessage(
        env,
        chatId,
        "Enter required referral count.\n\nExample: <code>10</code>"
      );
    } else {
      await sendMessage(
        env,
        chatId,
        "Enter task URL:"
      );
    }

    return;
  }

  if (session.step === "task_url") {
    await updateSession(
      userId,
      {
        task_url:
          session.task_type === "referral"
            ? null
            : text,
        channel_id:
          session.task_type === "channel" ||
          session.task_type === "group"
            ? text
            : null,
        step:
          session.task_type === "referral"
            ? "task_count"
            : "task_required"
      },
      env
    );

    if (
      session.task_type !== "referral"
    ) {
      await sendMessage(
        env,
        chatId,
        "Required task?\n\nSend <code>yes</code> or <code>no</code>."
      );
    } else {
      await sendMessage(
        env,
        chatId,
        "Enter required referral count:"
      );
    }

    return;
  }

  if (session.step === "task_count") {
    const count = Number(text);

    if (!Number.isInteger(count) || count < 1) {
      await sendMessage(
        env,
        chatId,
        "Enter a valid number."
      );
      return;
    }

    await updateSession(
      userId,
      {
        required_count: count,
        step: "task_required"
      },
      env
    );

    await sendMessage(
      env,
      chatId,
      "Required task?\n\nSend <code>yes</code> or <code>no</code>."
    );

    return;
  }

  if (session.step === "task_required") {
    const required =
      text.toLowerCase() !== "no";

    await createTaskFromSession(
      userId,
      chatId,
      session,
      required,
      env
    );

    return;
  }

  /* WEBSITE */

  if (session.step === "website_url") {
    let website = text;

    if (
      !website.startsWith("http://") &&
      !website.startsWith("https://")
    ) {
      website =
        "https://" + website;
    }

    await setSetting(
      "website_url",
      website,
      env
    );

    await clearSession(
      userId,
      env
    );

    await sendMessage(
      env,
      chatId,
      "✅ Website URL saved:\n\n" +
        escapeHtml(website)
    );

    return;
  }

  /* CONTACT */

  if (session.step === "contact_admin") {
    await setSetting(
      "contact_admin",
      text,
      env
    );

    await clearSession(
      userId,
      env
    );

    await sendMessage(
      env,
      chatId,
      "✅ Contact Admin updated."
    );

    return;
  }

  /* ADD ADMIN */

  if (session.step === "admin_user_id") {
    const telegramId =
      Number(text);

    if (
      !Number.isSafeInteger(
        telegramId
      )
    ) {
      await sendMessage(
        env,
        chatId,
        "❌ Invalid Telegram User ID."
      );
      return;
    }

    await sb(
      env,
      "/rest/v1/admins",
      {
        method: "POST",
        body: {
          telegram_user_id:
            telegramId,
          name: "",
          role: "admin",
          status: "active"
        },
        returnData: true
      }
    );

    await clearSession(
      userId,
      env
    );

    await sendMessage(
      env,
      chatId,
      "✅ Admin added."
    );

    return;
  }
}


/* =========================================================
   PRODUCT PREVIEW
========================================================= */

async function showProductPreview(
  userId,
  chatId,
  env
) {
  const s =
    await getSession(userId, env);

  if (!s) return;

  await sendMessage(
    env,
    chatId,
    "📦 <b>PRODUCT PREVIEW</b>\n\n" +
      "ID: <code>" +
      escapeHtml(s.product_id) +
      "</code>\n" +
      "Title: <b>" +
      escapeHtml(s.title) +
      "</b>\n" +
      "Type: " +
      escapeHtml(s.product_type || "") +
      "\n" +
      "Price: ₹" +
      Number(s.price || 0) +
      "\n\n" +
      escapeHtml(s.description || ""),
    [
      [
        {
          text: "✅ Publish",
          callback_data:
            "publish_product"
        }
      ],
      [
        {
          text: "❌ Cancel",
          callback_data:
            "cancel_session"
        }
      ]
    ]
  );
}

async function publishProductFromSession(
  userId,
  chatId,
  env
) {
  const s =
    await getSession(userId, env);

  if (!s) {
    await sendMessage(
      env,
      chatId,
      "❌ Session expired."
    );
    return;
  }

  if (!s.telegram_file_id) {
    await sendMessage(
      env,
      chatId,
      "❌ PDF missing."
    );
    return;
  }

  const existing =
    await getProductByProductId(
      s.product_id,
      env
    );

  if (existing) {
    await sendMessage(
      env,
      chatId,
      "❌ Product ID already exists."
    );
    return;
  }

  await sb(
    env,
    "/rest/v1/products",
    {
      method: "POST",
      body: {
        product_id:
          s.product_id,
        title:
          s.title,
        description:
          s.description || "",
        product_type:
          s.product_type || "pdf",
        price:
          Number(s.price || 0),
        telegram_file_id:
          s.telegram_file_id,
        file_name:
          s.file_name || "",
        file_size:
          s.file_size || null,
        mime_type:
          s.mime_type || "application/pdf",
        cover_image:
          s.cover_image_file_id || null,
        category_id:
          s.category_id || null,
        status:
          "active"
      },
      returnData: true
    }
  );

  await clearSession(
    userId,
    env
  );

  const website =
    await productWebsiteUrl(
      s.product_id,
      env
    );

  const bot =
    await getBotUsername(env);

  const telegram =
    "https://t.me/" +
    bot +
    "?start=" +
    encodeURIComponent(
      s.product_id
    );

  await sendMessage(
    env,
    chatId,
    "🎉 <b>Product Published!</b>\n\n" +
      "Product ID: <code>" +
      escapeHtml(s.product_id) +
      "</code>\n\n" +
      "🌐 Website:\n" +
      escapeHtml(website || "Not configured") +
      "\n\n" +
      "🤖 Telegram:\n" +
      escapeHtml(telegram)
  );
}


/* =========================================================
   CATEGORIES
========================================================= */

async function showCategoriesForProduct(
  chatId,
  env
) {
  const categories =
    await sb(
      env,
      "/rest/v1/categories" +
        "?select=id,name" +
        "&status=eq.active" +
        "&order=name.asc"
    );

  const buttons =
    categories.map(c => [
      {
        text: "📂 " + c.name,
        callback_data:
          "cat:" + c.id
      }
    ]);

  buttons.push([
    {
      text: "➕ New Category",
      callback_data:
        "cat:new"
    }
  ]);

  await sendMessage(
    env,
    chatId,
    "Choose category:",
    buttons
  );
}

async function categoryAdminMenu(
  chatId,
  env
) {
  await showCategoriesForProduct(
    chatId,
    env
  );
}


/* =========================================================
   TASK ADMIN
========================================================= */

async function taskAdminMenu(
  chatId,
  env
) {
  await sendMessage(
    env,
    chatId,
    "📋 <b>UNLOCK TASKS</b>",
    [
      [
        {
          text: "➕ Add Task",
          callback_data:
            "admin_add_task"
        }
      ],
      [
        {
          text: "🔙 Admin Panel",
          callback_data:
            "admin"
        }
      ]
    ]
  );
}

async function startTaskCreation(
  userId,
  chatId,
  env
) {
  await createSession(
    userId,
    {
      step:
        "task_product"
    },
    env
  );

  const products =
    await sb(
      env,
      "/rest/v1/products" +
        "?select=id,product_id,title" +
        "&status=eq.active" +
        "&deleted_at=is.null" +
        "&order=id.desc" +
        "&limit=50"
    );

  if (!products.length) {
    await sendMessage(
      env,
      chatId,
      "❌ No products available."
    );
    return;
  }

  await sendMessage(
    env,
    chatId,
    "Choose product:",
    products.map(p => [
      {
        text:
          "📦 " +
          p.product_id +
          " - " +
          p.title.substring(0, 30),
        callback_data:
          "select_task_product:" +
          p.id
      }
    ])
  );
}

async function createTaskFromSession(
  userId,
  chatId,
  session,
  required,
  env
) {
  await sb(
    env,
    "/rest/v1/product_tasks",
    {
      method: "POST",
      body: {
        product_id:
          Number(session.product_id),
        task_type:
          session.task_type,
        title:
          session.title,
        description:
          "",
        task_url:
          session.task_url || null,
        channel_id:
          session.channel_id || null,
        required_count:
          Number(
            session.required_count || 1
          ),
        sort_order:
          0,
        status:
          "active",
        required
      },
      returnData: true
    }
  );

  await clearSession(
    userId,
    env
  );

  await sendMessage(
    env,
    chatId,
    "✅ Unlock task added successfully."
  );
}


/* =========================================================
   TASK VERIFICATION
========================================================= */

async function verifyTask(
  telegramUserId,
  chatId,
  taskId,
  env
) {
  const tasks =
    await sb(
      env,
      "/rest/v1/product_tasks" +
        "?id=eq." +
        encodeURIComponent(taskId) +
        "&select=*"
    );

  const task = tasks[0];

  if (!task) {
    await sendMessage(
      env,
      chatId,
      "❌ Task not found."
    );
    return;
  }

  if (
    task.task_type !== "channel" &&
    task.task_type !== "group"
  ) {
    await sendMessage(
      env,
      chatId,
      "ℹ️ This task does not support Telegram membership verification."
    );
    return;
  }

  const channelId =
    task.channel_id;

  if (!channelId) {
    await sendMessage(
      env,
      chatId,
      "❌ Channel ID is not configured."
    );
    return;
  }

  const result =
    await telegram(
      env,
      "getChatMember",
      {
        chat_id:
          channelId,
        user_id:
          telegramUserId
      }
    );

  if (
    result.ok &&
    result.result &&
    ["member", "administrator", "creator"].includes(
      result.result.status
    )
  ) {
    await markTaskComplete(
      telegramUserId,
      taskId,
      env
    );

    await sendMessage(
      env,
      chatId,
      "✅ Task verified successfully."
    );
  } else {
    await sendMessage(
      env,
      chatId,
      "❌ Membership not detected yet."
    );
  }
}

async function markTaskComplete(
  telegramUserId,
  taskId,
  env
) {
  const existing =
    await sb(
      env,
      "/rest/v1/user_tasks" +
        "?telegram_user_id=eq." +
        encodeURIComponent(
          telegramUserId
        ) +
        "&product_task_id=eq." +
        encodeURIComponent(taskId) +
        "&select=id"
    );

  if (existing.length) {
    await sb(
      env,
      "/rest/v1/user_tasks?id=eq." +
        existing[0].id,
      {
        method: "PATCH",
        body: {
          completed: true,
          completed_at:
            new Date().toISOString(),
          expires_at:
            new Date(
              Date.now() +
              20 * 60 * 1000
            ).toISOString()
        }
      }
    );
  } else {
    await sb(
      env,
      "/rest/v1/user_tasks",
      {
        method: "POST",
        body: {
          telegram_user_id:
            telegramUserId,
          product_task_id:
            taskId,
          completed:
            true,
          completed_at:
            new Date().toISOString(),
          expires_at:
            new Date(
              Date.now() +
              20 * 60 * 1000
            ).toISOString()
        }
      }
    );
  }
}

async function isTaskCompleted(
  telegramUserId,
  taskId,
  env
) {
  const rows =
    await sb(
      env,
      "/rest/v1/user_tasks" +
        "?telegram_user_id=eq." +
        encodeURIComponent(
          telegramUserId
        ) +
        "&product_task_id=eq." +
        encodeURIComponent(taskId) +
        "&completed=eq.true" +
        "&select=id"
    );

  return rows.length > 0;
}


/* =========================================================
   REFERRALS
========================================================= */

async function processReferralStart(
  referredUserId,
  referrerId,
  productId,
  env
) {
  const referrer =
    Number(referrerId);

  if (
    !Number.isSafeInteger(
      referrer
    ) ||
    referrer === referredUserId
  ) {
    return;
  }

  const product =
    await getProductByProductId(
      productId,
      env
    );

  if (!product) return;

  const existing =
    await sb(
      env,
      "/rest/v1/referrals" +
        "?referrer_telegram_user_id=eq." +
        encodeURIComponent(
          referrer
        ) +
        "&referred_telegram_user_id=eq." +
        encodeURIComponent(
          referredUserId
        ) +
        "&product_id=eq." +
        product.id +
        "&select=id"
    );

  if (existing.length) return;

  await sb(
    env,
    "/rest/v1/referrals",
    {
      method: "POST",
      body: {
        referrer_telegram_user_id:
          referrer,
        referred_telegram_user_id:
          referredUserId,
        product_id:
          product.id,
        status:
          "completed",
        completed_at:
          new Date().toISOString(),
        expires_at:
          new Date(
            Date.now() +
            20 * 60 * 1000
          ).toISOString()
      }
    }
  );
}

async function countSuccessfulReferrals(
  telegramUserId,
  productDbId,
  env
) {
  const rows =
    await sb(
      env,
      "/rest/v1/referrals" +
        "?referrer_telegram_user_id=eq." +
        encodeURIComponent(
          telegramUserId
        ) +
        "&product_id=eq." +
        productDbId +
        "&status=eq.completed" +
        "&select=id"
    );

  return rows.length;
}


/* =========================================================
   CHANNEL VERIFICATION
========================================================= */

async function verifyRequiredChannel(
  userId,
  env
) {
  const channelId =
    env.CHANNEL_ID ||
    await getSetting(
      "channel_id",
      env
    );

  if (!channelId) {
    return true;
  }

  const result =
    await telegram(
      env,
      "getChatMember",
      {
        chat_id:
          channelId,
        user_id:
          userId
      }
    );

  if (!result.ok) {
    return false;
  }

  return [
    "member",
    "administrator",
    "creator"
  ].includes(
    result.result?.status
  );
}


/* =========================================================
   SEARCH
========================================================= */

async function telegramSearch(
  chatId,
  q,
  env
) {
  const products =
    await sb(
      env,
      "/rest/v1/products" +
        "?select=id,product_id,title,description,price,product_type" +
        "&status=eq.active" +
        "&deleted_at=is.null" +
        "&or=(" +
          "title.ilike.*" +
          encodeURIComponent(q) +
          "*," +
          "description.ilike.*" +
          encodeURIComponent(q) +
          "*," +
          "product_id.ilike.*" +
          encodeURIComponent(q) +
          "*" +
        ")" +
        "&order=id.desc" +
        "&limit=10"
    );

  if (!products.length) {
    await sendMessage(
      env,
      chatId,
      "❌ No products found."
    );
    return;
  }

  for (const p of products) {
    const website =
      await productWebsiteUrl(
        p.product_id,
        env
      );

    await sendMessage(
      env,
      chatId,
      "📦 <b>" +
        escapeHtml(p.title) +
        "</b>\n\n" +
        escapeHtml(
          p.description || ""
        ).substring(0, 400) +
        "\n\n" +
        "Type: " +
        escapeHtml(
          p.product_type || "pdf"
        ) +
        "\nPrice: ₹" +
        Number(p.price || 0),
      [
        website
          ? [
              {
                text:
                  "🌐 Open Website",
                url: website
              }
            ]
          : []
      ].filter(
        x => x.length
      )
    );
  }
}

async function latestProducts(
  chatId,
  env
) {
  const products =
    await sb(
      env,
      "/rest/v1/products" +
        "?select=id,product_id,title,price,product_type" +
        "&status=eq.active" +
        "&deleted_at=is.null" +
        "&order=created_at.desc" +
        "&limit=10"
    );

  if (!products.length) {
    await sendMessage(
      env,
      chatId,
      "No products available."
    );
    return;
  }

  for (const p of products) {
    const website =
      await productWebsiteUrl(
        p.product_id,
        env
      );

    await sendMessage(
      env,
      chatId,
      "📦 <b>" +
        escapeHtml(p.title) +
        "</b>\n\n" +
        "₹" +
        Number(p.price || 0),
      website
        ? [
            [
              {
                text:
                  "🌐 Open Website",
                url: website
              }
            ]
          ]
        : []
    );
  }
}


/* =========================================================
   USER MANAGEMENT
========================================================= */

async function touchUser(user, env) {
  const expires =
    new Date(
      Date.now() +
      20 * 60 * 1000
    ).toISOString();

  const existing =
    await sb(
      env,
      "/rest/v1/users" +
        "?telegram_user_id=eq." +
        encodeURIComponent(user.id) +
        "&select=id"
    );

  if (existing.length) {
    await sb(
      env,
      "/rest/v1/users?id=eq." +
        existing[0].id,
      {
        method: "PATCH",
        body: {
          username:
            user.username || null,
          first_name:
            user.first_name || null,
          last_activity_at:
            new Date().toISOString(),
          expires_at:
            expires
        }
      }
    );
  } else {
    await sb(
      env,
      "/rest/v1/users",
      {
        method: "POST",
        body: {
          telegram_user_id:
            user.id,
          username:
            user.username || null,
          first_name:
            user.first_name || null,
          last_activity_at:
            new Date().toISOString(),
          expires_at:
            expires
        }
      }
    );
  }
}

async function updateUserProduct(
  userId,
  productDbId,
  env
) {
  await sb(
    env,
    "/rest/v1/users" +
      "?telegram_user_id=eq." +
      encodeURIComponent(userId),
    {
      method: "PATCH",
      body: {
        current_product_id:
          productDbId,
        last_activity_at:
          new Date().toISOString(),
        expires_at:
          new Date(
            Date.now() +
            20 * 60 * 1000
          ).toISOString()
      }
    }
  );
}

async function userStatistics(
  chatId,
  env
) {
  const users =
    await sb(
      env,
      "/rest/v1/users?select=id"
    );

  const products =
    await sb(
      env,
      "/rest/v1/products" +
        "?status=eq.active" +
        "&deleted_at=is.null" +
        "&select=id"
    );

  const purchases =
    await sb(
      env,
      "/rest/v1/purchases?select=id"
    );

  await sendMessage(
    env,
    chatId,
    "👥 <b>STATISTICS</b>\n\n" +
      "Users: " +
      users.length +
      "\n" +
      "Active Products: " +
      products.length +
      "\n" +
      "Purchases: " +
      purchases.length
  );
}


/* =========================================================
   ADMIN MANAGEMENT
========================================================= */

async function adminManagement(
  chatId,
  env
) {
  const admins =
    await sb(
      env,
      "/rest/v1/admins" +
        "?select=id,telegram_user_id,name,role,status" +
        "&order=id.asc"
    );

  let text =
    "👑 <b>ADMINS</b>\n\n";

  const buttons = [];

  for (const a of admins) {
    text +=
      "• " +
      a.telegram_user_id +
      " — " +
      escapeHtml(
        a.name || "Admin"
      ) +
      " (" +
      escapeHtml(
        a.role || "admin"
      ) +
      ")\n";

    buttons.push([
      {
        text:
          "🗑 Remove " +
          a.telegram_user_id,
        callback_data:
          "remove_admin:" +
          a.id
      }
    ]);
  }

  buttons.push([
    {
      text: "➕ Add Admin",
      callback_data:
        "admin_add_admin"
    }
  ]);

  await sendMessage(
    env,
    chatId,
    text,
    buttons
  );
}

async function startAdminCreation(
  userId,
  chatId,
  env
) {
  await createSession(
    userId,
    {
      step:
        "admin_user_id"
    },
    env
  );

  await sendMessage(
    env,
    chatId,
    "Enter Telegram User ID of new admin:"
  );
}

async function removeAdmin(
  id,
  chatId,
  env
) {
  const rows =
    await sb(
      env,
      "/rest/v1/admins?id=eq." +
        encodeURIComponent(id) +
        "&select=telegram_user_id"
    );

  if (!rows.length) return;

  const target =
    Number(
      rows[0].telegram_user_id
    );

  if (
    String(target) ===
    String(
      env.ADMIN_TELEGRAM_ID
    )
  ) {
    await sendMessage(
      env,
      chatId,
      "⛔ Owner cannot be removed."
    );
    return;
  }

  await sb(
    env,
    "/rest/v1/admins?id=eq." +
      encodeURIComponent(id),
    {
      method: "DELETE"
    }
  );

  await sendMessage(
    env,
    chatId,
    "✅ Admin removed."
  );
}


/* =========================================================
   SETTINGS
========================================================= */

async function startWebsiteSetting(
  userId,
  chatId,
  env
) {
  await createSession(
    userId,
    {
      step:
        "website_url"
    },
    env
  );

  const current =
    await getSetting(
      "website_url",
      env
    );

  await sendMessage(
    env,
    chatId,
    "🌐 Enter website base URL.\n\nCurrent:\n" +
      escapeHtml(
        current || "Not configured"
      )
  );
}

async function startContactSetting(
  userId,
  chatId,
  env
) {
  await createSession(
    userId,
    {
      step:
        "contact_admin"
    },
    env
  );

  const current =
    await getSetting(
      "contact_admin",
      env
    );

  await sendMessage(
    env,
    chatId,
    "👤 Enter Admin Contact.\n\nExample:\n<code>@yourusername</code>\n\nCurrent:\n" +
      escapeHtml(
        current || "Not configured"
      )
  );
}


/* =========================================================
   WEBSITE API
========================================================= */

async function apiProducts(env) {
  const products =
    await sb(
      env,
      "/rest/v1/products" +
        "?select=id,product_id,title,description,price,product_type,file_name,file_size,mime_type,cover_image,category_id,status,created_at,updated_at" +
        "&status=eq.active" +
        "&deleted_at=is.null" +
        "&order=created_at.desc"
    );

  const website =
    await getSetting(
      "website_url",
      env
    );

  const data =
    products.map(p => ({
      ...p,
      website_url:
        buildProductUrl(
          website,
          p.product_id
        ),
      telegram_url:
        null
    }));

  return json({
    ok: true,
    products: data
  });
}

async function apiProduct(
  env,
  productId
) {
  const product =
    await getProductByProductId(
      productId,
      env
    );

  if (
    !product ||
    product.status !== "active" ||
    product.deleted_at
  ) {
    return json(
      {
        ok: false,
        error: "Product not found"
      },
      404
    );
  }

  const website =
    await getSetting(
      "website_url",
      env
    );

  const tasks =
    await getProductTasks(
      product.id,
      env
    );

  return json({
    ok: true,
    product: {
      id: product.id,
      product_id:
        product.product_id,
      title:
        product.title,
      description:
        product.description,
      price:
        product.price,
      product_type:
        product.product_type,
      file_name:
        product.file_name,
      file_size:
        product.file_size,
      mime_type:
        product.mime_type,
      cover_image:
        product.cover_image,
      category_id:
        product.category_id,
      website_url:
        buildProductUrl(
          website,
          product.product_id
        ),
      tasks:
        tasks.map(t => ({
          id: t.id,
          task_type:
            t.task_type,
          title:
            t.title,
          description:
            t.description,
          task_url:
            t.task_url,
          required_count:
            t.required_count,
          required:
            t.required
        }))
    }
  });
}

async function apiSearch(env, q) {
  if (!q.trim()) {
    return json({
      ok: true,
      products: []
    });
  }

  const products =
    await sb(
      env,
      "/rest/v1/products" +
        "?select=id,product_id,title,description,price,product_type,cover_image" +
        "&status=eq.active" +
        "&deleted_at=is.null" +
        "&or=(" +
          "title.ilike.*" +
          encodeURIComponent(q) +
          "*," +
          "description.ilike.*" +
          encodeURIComponent(q) +
          "*," +
          "product_id.ilike.*" +
          encodeURIComponent(q) +
          "*" +
        ")" +
        "&limit=30"
    );

  const website =
    await getSetting(
      "website_url",
      env
    );

  return json({
    ok: true,
    products:
      products.map(p => ({
        ...p,
        website_url:
          buildProductUrl(
            website,
            p.product_id
          )
      }))
  });
}

async function apiSettings(env) {
  return json({
    ok: true,
    website_url:
      await getSetting(
        "website_url",
        env
      ),
    contact_admin:
      await getSetting(
        "contact_admin",
        env
      )
  });
}


/* =========================================================
   PRODUCT HELPERS
========================================================= */

async function getProductByProductId(
  productId,
  env
) {
  const rows =
    await sb(
      env,
      "/rest/v1/products" +
        "?product_id=eq." +
        encodeURIComponent(
          productId
        ) +
        "&select=*"
    );

  return rows[0] || null;
}

async function getProductTasks(
  productDbId,
  env
) {
  return await sb(
    env,
    "/rest/v1/product_tasks" +
      "?product_id=eq." +
      encodeURIComponent(
        productDbId
      ) +
      "&status=eq.active" +
      "&select=*" +
      "&order=sort_order.asc,id.asc"
  );
}

async function productWebsiteUrl(
  productId,
  env
) {
  const base =
    await getSetting(
      "website_url",
      env
    );

  return buildProductUrl(
    base,
    productId
  );
}

function buildProductUrl(
  base,
  productId
) {
  if (!base) return null;

  return (
    String(base).replace(
      /\/+$/,
      ""
    ) +
    "/product/" +
    encodeURIComponent(
      productId
    )
  );
}


/* =========================================================
   SESSIONS
========================================================= */

async function getSession(
  userId,
  env
) {
  const rows =
    await sb(
      env,
      "/rest/v1/bot_sessions" +
        "?telegram_user_id=eq." +
        encodeURIComponent(userId) +
        "&select=*"
    );

  return rows[0] || null;
}

async function createSession(
  userId,
  data,
  env
) {
  const existing =
    await getSession(
      userId,
      env
    );

  const values = {
    telegram_user_id:
      userId,
    step:
      data.step || "idle",
    expires_at:
      new Date(
        Date.now() +
        20 * 60 * 1000
      ).toISOString(),
    updated_at:
      new Date().toISOString(),
    ...data
  };

  if (existing) {
    await sb(
      env,
      "/rest/v1/bot_sessions" +
        "?telegram_user_id=eq." +
        encodeURIComponent(userId),
      {
        method: "PATCH",
        body: values
      }
    );
  } else {
    await sb(
      env,
      "/rest/v1/bot_sessions",
      {
        method: "POST",
        body: values
      }
    );
  }
}

async function updateSession(
  userId,
  data,
  env
) {
  await createSession(
    userId,
    data,
    env
  );
}

async function clearSession(
  userId,
  env
) {
  await sb(
    env,
    "/rest/v1/bot_sessions" +
      "?telegram_user_id=eq." +
      encodeURIComponent(userId),
    {
      method: "DELETE"
    }
  );
}


/* =========================================================
   ADMIN PERMISSIONS
========================================================= */

async function isAdmin(
  userId,
  env
) {
  if (
    String(userId) ===
    String(env.ADMIN_TELEGRAM_ID)
  ) {
    return true;
  }

  const rows =
    await sb(
      env,
      "/rest/v1/admins" +
        "?telegram_user_id=eq." +
        encodeURIComponent(userId) +
        "&status=eq.active" +
        "&select=id"
    );

  return rows.length > 0;
}

async function can(
  userId,
  env,
  type
) {
  if (
    String(userId) ===
    String(env.ADMIN_TELEGRAM_ID)
  ) {
    return true;
  }

  const rows =
    await sb(
      env,
      "/rest/v1/admins" +
        "?telegram_user_id=eq." +
        encodeURIComponent(userId) +
        "&status=eq.active" +
        "&select=role"
    );

  if (!rows.length) return false;

  const role =
    rows[0].role;

  if (
    role === "owner" ||
    role === "admin"
  ) {
    return true;
  }

  if (
    type === "product" &&
    role === "product_admin"
  ) {
    return true;
  }

  if (
    type === "task" &&
    role === "task_admin"
  ) {
    return true;
  }

  if (
    type === "user" &&
    role === "user_admin"
  ) {
    return true;
  }

  return false;
}


/* =========================================================
   CLEANUP
========================================================= */

async function cleanupExpired(env) {
  try {
    await sb(
      env,
      "/rest/v1/rpc/cleanup_expired_data",
      {
        method: "POST",
        body: {}
      }
    );

    console.log(
      "Expired temporary data cleaned."
    );
  } catch (e) {
    console.error(
      "Cleanup failed:",
      e
    );
  }
}


/* =========================================================
   SETTINGS HELPERS
========================================================= */

async function getSetting(
  key,
  env
) {
  const rows =
    await sb(
      env,
      "/rest/v1/settings" +
        "?key=eq." +
        encodeURIComponent(key) +
        "&select=value"
    );

  return rows[0]?.value || "";
}

async function setSetting(
  key,
  value,
  env
) {
  const rows =
    await sb(
      env,
      "/rest/v1/settings" +
        "?key=eq." +
        encodeURIComponent(key),
      {
        method: "PATCH",
        body: {
          value,
          updated_at:
            new Date().toISOString()
        }
      }
    );

  if (!rows.length) {
    await sb(
      env,
      "/rest/v1/settings",
      {
        method: "POST",
        body: {
          key,
          value
        }
      }
    );
  }
}


/* =========================================================
   TELEGRAM
========================================================= */

async function telegram(
  env,
  method,
  body
) {
  const response =
    await fetch(
      TG +
        env.BOT_TOKEN +
        "/" +
        method,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body:
          JSON.stringify(body)
      }
    );

  return await response.json();
}

async function sendMessage(
  env,
  chatId,
  text,
  buttons = []
) {
  const body = {
    chat_id:
      chatId,
    text,
    parse_mode:
      "HTML",
    disable_web_page_preview:
      false
  };

  if (buttons.length) {
    body.reply_markup = {
      inline_keyboard:
        buttons
    };
  }

  return await telegram(
    env,
    "sendMessage",
    body
  );
}

async function sendDocument(
  env,
  chatId,
  fileId,
  caption
) {
  return await telegram(
    env,
    "sendDocument",
    {
      chat_id:
        chatId,
      document:
        fileId,
      caption:
        caption
          ? "📚 " +
            escapeHtml(
              caption
            )
          : undefined,
      parse_mode:
        "HTML"
    }
  );
}

async function answerCallbackQuery(
  env,
  callbackId
) {
  return await telegram(
    env,
    "answerCallbackQuery",
    {
      callback_query_id:
        callbackId
    }
  );
}

async function getBotUsername(
  env
) {
  const result =
    await telegram(
      env,
      "getMe",
      {}
    );

  return (
    result.result?.username ||
    "YOUR_BOT"
  );
}


/* =========================================================
   SUPABASE
========================================================= */

async function sb(
  env,
  path,
  options = {}
) {
  const {
    method = "GET",
    body = undefined,
    returnData = false
  } = options;

  const headers = {
    apikey:
      env.SUPABASE_KEY,
    Authorization:
      "Bearer " +
      env.SUPABASE_KEY,
    "Content-Type":
      "application/json"
  };

  if (
    method === "POST" &&
    returnData
  ) {
    headers.Prefer =
      "return=representation";
  }

  const response =
    await fetch(
      String(env.SUPABASE_URL).replace(
        /\/+$/,
        ""
      ) +
        path,
      {
        method,
        headers,
        body:
          body !== undefined
            ? JSON.stringify(body)
            : undefined
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      "Supabase " +
        response.status +
        ": " +
        text
    );
  }

  if (!text) return [];

  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}


/* =========================================================
   UTILITY
========================================================= */

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        "Access-Control-Allow-Origin":
          "*",
        "Access-Control-Allow-Headers":
          "*"
      }
    }
  );
}

function escapeHtml(value) {
  return String(
    value ?? ""
  )
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(
      /[^a-z0-9]+/g,
      "-"
    )
    .replace(
      /^-+|-+$/g,
      "");
}
