/**
 * ============================================================
 * PDF ORBIT
 * Telegram Free PDF / Notes / Study Material Bot
 * Cloudflare Worker + Supabase
 *
 * SINGLE FILE: index.js
 *
 * ALL PRODUCTS ARE FREE
 *
 * Required Cloudflare Secrets:
 *
 * BOT_TOKEN
 * SUPABASE_URL
 * SUPABASE_KEY
 * ADMIN_TELEGRAM_ID
 * WEBHOOK_SECRET
 * CHANNEL_ID
 * CHANNEL_INVITE_URL
 *
 * Optional:
 * No payment gateway required.
 * ============================================================
 */

const TELEGRAM_API = "https://api.telegram.org/bot";

const SESSION_MINUTES = 20;


/* ============================================================
   PRODUCT TYPES
============================================================ */

const PRODUCT_TYPES = [
  ["type:book", "📕 Book"],
  ["type:notes", "📚 Notes"],
  ["type:pdf", "📄 PDF"],
  ["type:test", "📝 Test"],
  ["type:study", "🎓 Study Material"],
  ["type:other", "📦 Other"]
];


/* ============================================================
   WORKER
============================================================ */

export default {

  async fetch(request, env) {

    try {

      const url =
        new URL(request.url);


      /* ======================================================
         HEALTH
      ====================================================== */

      if (
        request.method === "GET" &&
        url.pathname === "/"
      ) {

        return json({

          ok: true,

          service:
            "PDF ORBIT Telegram Bot",

          status:
            "running"

        });
      }


      if (
        request.method === "GET" &&
        url.pathname === "/health"
      ) {

        return json({

          ok: true,

          status:
            "healthy",

          time:
            new Date().toISOString()

        });
      }


      /* ======================================================
         WEBSITE API
      ====================================================== */

      if (
        request.method === "GET" &&
        url.pathname === "/api/products"
      ) {

        return await apiProducts(
          env
        );
      }


      if (
        request.method === "GET" &&
        url.pathname === "/api/search"
      ) {

        return await apiSearch(
          env,
          url.searchParams.get("q") || ""
        );
      }


      if (
        request.method === "GET" &&
        url.pathname.startsWith(
          "/api/product/"
        )
      ) {

        const productId =
          decodeURIComponent(
            url.pathname.substring(
              "/api/product/".length
            )
          );


        return await apiProduct(
          env,
          productId
        );
      }


      if (
        request.method === "GET" &&
        url.pathname === "/api/settings"
      ) {

        return await apiSettings(
          env
        );
      }


      /* ======================================================
         TELEGRAM WEBHOOK
      ====================================================== */

      if (
        request.method === "POST"
      ) {

        if (
          env.WEBHOOK_SECRET
        ) {

          const secret =
            request.headers.get(
              "X-Telegram-Bot-Api-Secret-Token"
            );


          if (
            secret !==
            env.WEBHOOK_SECRET
          ) {

            return new Response(
              "Unauthorized",
              {
                status: 401
              }
            );
          }
        }


        const update =
          await request.json();


        await handleUpdate(
          update,
          env
        );


        return json({
          ok: true
        });
      }


      return json(
        {
          ok: false,
          error: "Not found"
        },
        404
      );

    } catch (error) {

      console.error(
        error
      );


      return json(
        {
          ok: false,

          error:
            String(
              error?.message ||
              error
            )
        },
        500
      );
    }
  },


  /* ========================================================
     CRON CLEANUP
  ======================================================== */

  async scheduled(
    event,
    env,
    ctx
  ) {

    ctx.waitUntil(
      cleanupExpired(
        env
      )
    );
  }

};


/* ============================================================
   UPDATE HANDLER
============================================================ */

async function handleUpdate(
  update,
  env
) {

  if (
    update.callback_query
  ) {

    await handleCallback(
      update.callback_query,
      env
    );

    return;
  }


  if (
    !update.message
  ) {

    return;
  }


  const message =
    update.message;


  const user =
    message.from;


  if (
    !user ||
    !user.id
  ) {

    return;
  }


  await touchUser(
    user,
    env
  );


  if (
    message.text
  ) {

    await handleText(
      message,
      env
    );

    return;
  }


  if (
    message.document
  ) {

    await handleDocument(
      message,
      env
    );

    return;
  }


  if (
    message.photo
  ) {

    await handlePhoto(
      message,
      env
    );

    return;
  }
}


/* ============================================================
   TEXT HANDLER
============================================================ */

async function handleText(
  message,
  env
) {

  const chatId =
    message.chat.id;


  const user =
    message.from;


  const text =
    String(
      message.text || ""
    ).trim();


  /* ========================================================
     START
  ======================================================== */

  if (
    text.startsWith(
      "/start"
    )
  ) {

    await handleStart(
      message,
      env
    );

    return;
  }


  /* ========================================================
     CANCEL
  ======================================================== */

  if (
    text === "/cancel"
  ) {

    await clearSession(
      user.id,
      env
    );


    await sendMessage(
      env,
      chatId,

      "❌ <b>Process cancelled.</b>\n\n" +
      "You are back to the main menu.",

      [
        [
          {
            text:
              "🏠 Main Menu",

            callback_data:
              "home"
          }
        ]
      ]
    );

    return;
  }


  /* ========================================================
     ADMIN
  ======================================================== */

  if (
    text === "/admin"
  ) {

    if (
      !(await isAdmin(
        user.id,
        env
      ))
    ) {

      await sendMessage(
        env,
        chatId,
        "⛔ <b>Admin access required.</b>"
      );

      return;
    }


    await adminPanel(
      chatId,
      env
    );

    return;
  }


  /* ========================================================
     NEW PRODUCT
  ======================================================== */

  if (
    text === "/newproduct"
  ) {

    if (
      !(await can(
        user.id,
        env,
        "product"
      ))
    ) {

      await sendMessage(
        env,
        chatId,
        "⛔ You don't have permission."
      );

      return;
    }


    await startProductCreation(
      user.id,
      chatId,
      env
    );

    return;
  }


  /* ========================================================
     SEARCH
  ======================================================== */

  if (
    text === "/search"
  ) {

    await sendMessage(
      env,
      chatId,

      "🔎 <b>Search Products</b>\n\n" +
      "Send:\n" +
      "<code>/search keyword</code>"
    );

    return;
  }


  if (
    text.startsWith(
      "/search "
    )
  ) {

    const query =
      text
        .substring(8)
        .trim();


    if (!query) {

      await sendMessage(
        env,
        chatId,
        "❌ Please enter a search keyword."
      );

      return;
    }


    await telegramSearch(
      chatId,
      query,
      env
    );

    return;
  }


  /* ========================================================
     SEARCH WITHOUT SLASH
  ======================================================== */

  if (
    text.startsWith(
      "search "
    )
  ) {

    const query =
      text
        .substring(7)
        .trim();


    if (query) {

      await telegramSearch(
        chatId,
        query,
        env
      );
    }

    return;
  }


  /* ========================================================
     ADMIN SESSION
  ======================================================== */

  const session =
    await getSession(
      user.id,
      env
    );


  if (
    session &&
    session.step &&
    session.step !== "idle"
  ) {

    await processAdminSession(
      message,
      session,
      env
    );

    return;
  }


  /* ========================================================
     DEFAULT
  ======================================================== */

  await sendMainMenu(
    chatId,
    env
  );
}


/* ============================================================
   START / DEEP LINK
============================================================ */

async function handleStart(
  message,
  env
) {

  const chatId =
    message.chat.id;


  const user =
    message.from;


  const parts =
    String(
      message.text || ""
    ).split(/\s+/);


  const payload =
    parts[1] || "";


  await touchUser(
    user,
    env
  );


  /* ========================================================
     REFERRAL
  ======================================================== */

  if (
    payload.startsWith(
      "ref_"
    )
  ) {

    const value =
      payload.substring(4);


    const separator =
      value.indexOf("_");


    if (
      separator > 0
    ) {

      const referrer =
        value.substring(
          0,
          separator
        );


      const productId =
        value.substring(
          separator + 1
        );


      await processReferralStart(
        user.id,
        referrer,
        productId,
        env
      );
    }


    await sendMainMenu(
      chatId,
      env
    );

    return;
  }


  /* ========================================================
     PRODUCT DEEP LINK
  ======================================================== */

  if (
    payload
  ) {

    const product =
      await getProductByProductId(
        payload,
        env
      );


    if (
      product
    ) {

      await openProduct(
        user,
        chatId,
        product,
        env
      );

      return;
    }
  }


  await sendMainMenu(
    chatId,
    env
  );
}


/* ============================================================
   MAIN MENU
============================================================ */

async function sendMainMenu(
  chatId,
  env
) {

  const buttons = [

    [
      {
        text:
          "🔎 Search",

        callback_data:
          "search"
      },

      {
        text:
          "📚 Latest",

        callback_data:
          "latest"
      }
    ],

    [
      {
        text:
          "📂 Categories",

        callback_data:
          "categories"
      },

      {
        text:
          "⭐ Popular",

        callback_data:
          "latest"
      }
    ],

    [
      {
        text:
          "📢 Join Telegram",

        url:
          env.CHANNEL_INVITE_URL ||
          "https://t.me/"
      }
    ],

    [
      {
        text:
          "👤 Contact Admin",

        callback_data:
          "contact"
      }
    ]

  ];


  if (
    await isAdmin(
      chatId,
      env
    )
  ) {

    buttons.push([
      {
        text:
          "👑 Admin Panel",

        callback_data:
          "admin"
      }
    ]);
  }


  const text =

    "📚 <b>PDF ORBIT</b> 🚀\n" +

    "<i>Your Study Companion</i>\n\n" +

    "👋 <b>Welcome!</b>\n\n" +

    "Get free study materials, notes, PYQs, books and PDFs — all in one place.\n\n" +

    "🆓 <b>100% FREE</b>\n" +

    "⚡ Instant Access\n" +

    "📖 Notes • 📝 Tests • 📕 Books\n\n" +

    "━━━━━━━━━━━━━━━━━━\n\n" +

    "👇 <b>Choose an option below</b>";


  await sendMessage(
    env,
    chatId,
    text,
    buttons
  );
}


/* ============================================================
   PRODUCT OPEN
============================================================ */

async function openProduct(
  user,
  chatId,
  product,
  env
) {

  if (
    product.status !==
      "active" ||
    product.deleted_at
  ) {

    await sendMessage(
      env,
      chatId,

      "❌ <b>This product is no longer available.</b>"
    );

    return;
  }


  await updateUserProduct(
    user.id,
    product.id,
    env
  );


  const website =
    await productWebsiteUrl(
      product.product_id,
      env
    );


  /* ========================================================
     MAIN CHANNEL VERIFICATION
  ======================================================== */

  const joined =
    await verifyRequiredChannel(
      user.id,
      env
    );


  if (
    !joined
  ) {

    const invite =
      env.CHANNEL_INVITE_URL ||
      await getSetting(
        "channel_join_url",
        env
      );


    const buttons = [];


    if (
      invite
    ) {

      buttons.push([
        {
          text:
            "📢 Join Channel",

          url:
            invite
        }
      ]);
    }


    buttons.push([
      {
        text:
          "✅ Verify Membership",

        callback_data:
          "verifyjoin:" +
          product.product_id
      }
    ]);


    if (
      website
    ) {

      buttons.push([
        {
          text:
            "🌐 Open Website",

          url:
            website
        }
      ]);
    }


    await sendProductCard(
      env,
      chatId,
      product,

      "🔐 <b>Channel Verification Required</b>\n\n" +
      "Join the required Telegram channel and then tap <b>Verify Membership</b>.",

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


/* ============================================================
   UNLOCK PRODUCT
============================================================ */

async function unlockProduct(
  telegramUserId,
  chatId,
  product,
  env
) {

  const tasks =
    await getProductTasks(
      product.id,
      env
    );


  const requiredTasks =
    tasks.filter(
      task =>
        task.required !== false
    );


  const incomplete = [];


  for (
    const task of requiredTasks
  ) {

    const completed =
      await isTaskCompleted(
        telegramUserId,
        task.id,
        env
      );


    if (
      !completed
    ) {

      incomplete.push(
        task
      );
    }
  }


  /* ========================================================
     REQUIRED TASKS
  ======================================================== */

  if (
    incomplete.length
  ) {

    const buttons = [];


    for (
      const task of incomplete
    ) {

      if (
        task.task_url
      ) {

        buttons.push([
          {
            text:
              "🔗 " +
              task.title,

            url:
              task.task_url
          }
        ]);
      }


      if (
        task.task_type ===
          "channel" ||
        task.task_type ===
          "group"
      ) {

        buttons.push([
          {
            text:
              "✅ Verify " +
              task.title,

            callback_data:
              "taskverify:" +
              task.id
          }
        ]);

      } else if (
        task.task_type ===
          "website" ||
        task.task_type ===
          "custom"
      ) {

        buttons.push([
          {
            text:
              "✅ Complete: " +
              task.title,

            callback_data:
              "taskclick:" +
              task.id
          }
        ]);
      }
    }


    buttons.push([
      {
        text:
          "🔄 Check Tasks",

        callback_data:
          "checktasks:" +
          product.product_id
      }
    ]);


    await sendProductCard(
      env,
      chatId,
      product,

      "🔐 <b>Complete Required Tasks</b>\n\n" +
      "Complete all required tasks to unlock this free PDF.",

      buttons
    );

    return;
  }


  /* ========================================================
     REFERRAL TASK
  ======================================================== */

  const referralTask =
    tasks.find(
      task =>
        task.required !== false &&
        task.task_type ===
          "referral"
    );


  if (
    referralTask
  ) {

    const count =
      await countSuccessfulReferrals(
        telegramUserId,
        product.id,
        env
      );


    const required =
      Number(
        referralTask.required_count ||
        1
      );


    if (
      count <
      required
    ) {

      const bot =
        await getBotUsername(
          env
        );


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
            text:
              "📨 Invite Friends",

            url:
              "https://t.me/share/url?url=" +
              encodeURIComponent(
                referralLink
              ) +
              "&text=" +
              encodeURIComponent(
                "Get this free study material from PDF ORBIT 📚"
              )
          }
        ],

        [
          {
            text:
              "🔄 Check Referrals",

            callback_data:
              "checkref:" +
              product.product_id
          }
        ]

      ];


      await sendProductCard(
        env,
        chatId,
        product,

        "🎁 <b>Referral Unlock</b>\n\n" +

        "Invite friends to unlock this PDF.\n\n" +

        "Required: <b>" +
        required +
        "</b>\n" +

        "Completed: <b>" +
        count +
        "</b>",

        buttons
      );

      return;
    }
  }


  /* ========================================================
     PDF DELIVERY
  ======================================================== */

  if (
    !product.telegram_file_id
  ) {

    await sendMessage(
      env,
      chatId,

      "❌ <b>PDF file is not available.</b>\n\n" +
      "Please contact admin."
    );

    return;
  }


  await sendMessage(
    env,
    chatId,

    "🎉 <b>Unlocked Successfully!</b>\n\n" +

    "📚 " +
    escapeHtml(
      product.title
    ) +
    "\n" +

    "🆓 <b>FREE</b>\n\n" +

    "📥 Sending your PDF..."
  );


  const result =
    await sendDocument(
      env,
      chatId,
      product.telegram_file_id,
      product.title
    );


  if (
    !result.ok
  ) {

    await sendMessage(
      env,
      chatId,

      "❌ <b>PDF delivery failed.</b>\n\n" +
      "Please contact admin."
    );

  } else {

    await sendMessage(
      env,
      chatId,

      "✅ <b>PDF delivered successfully!</b>\n\n" +
      "Enjoy your study material 📚",

      [
        [
          {
            text:
              "🏠 Main Menu",

            callback_data:
              "home"
          }
        ]
      ]
    );
  }
}


/* ============================================================
   PRODUCT CARD
============================================================ */

async function sendProductCard(
  env,
  chatId,
  product,
  extraText = "",
  buttons = []
) {

  const description =
    product.description
      ? escapeHtml(
          product.description
        ).substring(
          0,
          500
        ) +
        "\n\n"
      : "";


  const text =

    "📚 <b>" +
    escapeHtml(
      product.title
    ) +
    "</b>\n\n" +

    description +

    "🏷️ Type: <b>" +
    escapeHtml(
      product.product_type ||
      "PDF"
    ) +
    "</b>\n" +

    "💰 Price: <b>FREE</b>\n\n" +

    extraText;


  if (
    product.cover_image
  ) {

    const result =
      await sendPhoto(
        env,
        chatId,
        product.cover_image,
        text,
        buttons
      );


    if (
      result.ok
    ) {

      return result;
    }
  }


  return await sendMessage(
    env,
    chatId,
    text,
    buttons
  );
}


/* ============================================================
   CALLBACK HANDLER
============================================================ */

async function handleCallback(
  query,
  env
) {

  const user =
    query.from;


  const chatId =
    query.message?.chat?.id ||
    user.id;


  const data =
    query.data || "";


  await answerCallbackQuery(
    env,
    query.id
  );


  /* ========================================================
     HOME
  ======================================================== */

  if (
    data === "home"
  ) {

    await sendMainMenu(
      chatId,
      env
    );

    return;
  }


  /* ========================================================
     SEARCH
  ======================================================== */

  if (
    data === "search"
  ) {

    await sendMessage(
      env,
      chatId,

      "🔎 <b>Search Products</b>\n\n" +

      "Use:\n" +

      "<code>/search keyword</code>"
    );

    return;
  }


  /* ========================================================
     LATEST
  ======================================================== */

  if (
    data === "latest"
  ) {

    await latestProducts(
      chatId,
      env
    );

    return;
  }


  /* ========================================================
     CATEGORIES
  ======================================================== */

  if (
    data === "categories"
  ) {

    await userCategories(
      chatId,
      env
    );

    return;
  }


  /* ========================================================
     CONTACT
  ======================================================== */

  if (
    data === "contact"
  ) {

    const contact =
      await getSetting(
        "contact_admin",
        env
      );


    await sendMessage(
      env,
      chatId,

      contact

        ? "👤 <b>Contact Admin</b>\n\n" +
          escapeHtml(
            contact
          )

        : "❌ Admin contact is not configured.",

      [
        [
          {
            text:
              "🏠 Main Menu",

            callback_data:
              "home"
          }
        ]
      ]
    );

    return;
  }


  /* ========================================================
     CATEGORY PRODUCTS
  ======================================================== */

  if (
    data.startsWith(
      "usercat:"
    )
  ) {

    const categoryId =
      Number(
        data.substring(8)
      );


    await categoryProducts(
      chatId,
      categoryId,
      env
    );

    return;
  }


  /* ========================================================
     OPEN PRODUCT
  ======================================================== */

  if (
    data.startsWith(
      "openproduct:"
    )
  ) {

    const productId =
      data.substring(
        12
      );


    const product =
      await getProductByProductId(
        productId,
        env
      );


    if (
      product
    ) {

      await openProduct(
        user,
        chatId,
        product,
        env
      );

    } else {

      await sendMessage(
        env,
        chatId,
        "❌ Product not found."
      );
    }

    return;
  }


  /* ========================================================
     MAIN CHANNEL VERIFY
  ======================================================== */

  if (
    data.startsWith(
      "verifyjoin:"
    )
  ) {

    const productId =
      data.substring(
        11
      );


    const product =
      await getProductByProductId(
        productId,
        env
      );


    if (
      !product
    ) {

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


    if (
      !joined
    ) {

      await sendMessage(
        env,
        chatId,

        "❌ <b>Channel membership not detected.</b>\n\n" +
        "Please join the channel first and try again.",

        [
          [
            {
              text:
                "🔄 Verify Again",

              callback_data:
                "verifyjoin:" +
                product.product_id
            }
          ]
        ]
      );

      return;
    }


    await sendMessage(
      env,
      chatId,

      "✅ <b>Channel verified!</b>"
    );


    await unlockProduct(
      user.id,
      chatId,
      product,
      env
    );

    return;
  }


  /* ========================================================
     TASK VERIFY
  ======================================================== */

  if (
    data.startsWith(
      "taskverify:"
    )
  ) {

    const taskId =
      Number(
        data.substring(
          11
        )
      );


    await verifyTask(
      user.id,
      chatId,
      taskId,
      env
    );

    return;
  }


  /* ========================================================
     TASK CLICK
  ======================================================== */

  if (
    data.startsWith(
      "taskclick:"
    )
  ) {

    const taskId =
      Number(
        data.substring(
          10
        )
      );


    await markTaskComplete(
      user.id,
      taskId,
      env
    );


    await sendMessage(
      env,
      chatId,

      "✅ <b>Task marked complete.</b>\n\n" +
      "Click <b>Check Tasks</b> to continue.",

      [
        [
          {
            text:
              "🔄 Check Tasks",

            callback_data:
              "check_current_task"
          }
        ]
      ]
    );

    return;
  }


  /* ========================================================
     CHECK TASKS
  ======================================================== */

  if (
    data.startsWith(
      "checktasks:"
    )
  ) {

    const productId =
      data.substring(
        11
      );


    const product =
      await getProductByProductId(
        productId,
        env
      );


    if (
      product
    ) {

      await unlockProduct(
        user.id,
        chatId,
        product,
        env
      );
    }

    return;
  }


  /* ========================================================
     CHECK REFERRALS
  ======================================================== */

  if (
    data.startsWith(
      "checkref:"
    )
  ) {

    const productId =
      data.substring(
        9
      );


    const product =
      await getProductByProductId(
        productId,
        env
      );


    if (
      product
    ) {

      await unlockProduct(
        user.id,
        chatId,
        product,
        env
      );
    }

    return;
  }


  /* ========================================================
     ADMIN
  ======================================================== */

  if (
    data === "admin"
  ) {

    if (
      await isAdmin(
        user.id,
        env
      )
    ) {

      await adminPanel(
        chatId,
        env
      );
    }

    return;
  }


  if (
    !(await isAdmin(
      user.id,
      env
    ))
  ) {

    return;
  }


  /* ========================================================
     PRODUCT MANAGEMENT
  ======================================================== */

  if (
    data ===
    "admin_products"
  ) {

    await productAdminMenu(
      chatId,
      env
    );

    return;
  }


  if (
    data ===
    "admin_add_product"
  ) {

    await startProductCreation(
      user.id,
      chatId,
      env
    );

    return;
  }


  if (
    data ===
    "admin_product_list"
  ) {

    await adminProductList(
      chatId,
      env
    );

    return;
  }


  /* ========================================================
     TASK MANAGEMENT
  ======================================================== */

  if (
    data ===
    "admin_tasks"
  ) {

    await taskAdminMenu(
      chatId,
      env
    );

    return;
  }


  if (
    data ===
    "admin_add_task"
  ) {

    await startTaskCreation(
      user.id,
      chatId,
      env
    );

    return;
  }


  /* ========================================================
     USERS
  ======================================================== */

  if (
    data ===
    "admin_users"
  ) {

    await userStatistics(
      chatId,
      env
    );

    return;
  }


  /* ========================================================
     ADMINS
  ======================================================== */

  if (
    data ===
    "admin_admins"
  ) {

    await adminManagement(
      chatId,
      env
    );

    return;
  }


  if (
    data ===
    "admin_add_admin"
  ) {

    await startAdminCreation(
      user.id,
      chatId,
      env
    );

    return;
  }


  /* ========================================================
     WEBSITE
  ======================================================== */

  if (
    data ===
    "admin_website"
  ) {

    await startWebsiteSetting(
      user.id,
      chatId,
      env
    );

    return;
  }


  /* ========================================================
     CONTACT SETTING
  ======================================================== */

  if (
    data ===
    "admin_contact"
  ) {

    await startContactSetting(
      user.id,
      chatId,
      env
    );

    return;
  }


  /* ========================================================
     CATEGORIES
  ======================================================== */

  if (
    data ===
    "admin_categories"
  ) {

    await categoryAdminMenu(
      chatId,
      env
    );

    return;
  }


  if (
    data ===
    "admin_category_new"
  ) {

    await createSession(
      user.id,

      {
        step:
          "category_admin_new"
      },

      env
    );


    await sendMessage(
      env,
      chatId,

      "📂 <b>Add New Category</b>\n\n" +
      "Enter category name:\n\n" +
      "Example:\n" +
      "<code>SSC Exams</code>"
    );

    return;
  }


  /* ========================================================
     CLEANUP
  ======================================================== */

  if (
    data ===
    "admin_cleanup"
  ) {

    await cleanupExpired(
      env
    );


    await sendMessage(
      env,
      chatId,

      "🧹 <b>Cleanup completed.</b>"
    );

    return;
  }


  /* ========================================================
     DELETE PRODUCT
  ======================================================== */

  if (
    data.startsWith(
      "delete_product:"
    )
  ) {

    const id =
      Number(
        data.substring(
          15
        )
      );


    await deleteProduct(
      id,
      chatId,
      env
    );

    return;
  }


  /* ========================================================
     PRODUCT INFO
  ======================================================== */

  if (
    data.startsWith(
      "product_info:"
    )
  ) {

    const id =
      Number(
        data.substring(
          13
        )
      );


    await adminProductInfo(
      id,
      chatId,
      env
    );

    return;
  }


  /* ========================================================
     SELECT TASK PRODUCT
  ======================================================== */

  if (
    data.startsWith(
      "select_task_product:"
    )
  ) {

    const id =
      Number(
        data.substring(
          20
        )
      );


    const session =
      await getSession(
        user.id,
        env
      );


    if (
      session
    ) {

      await updateSession(
        user.id,

        {
          product_id:
            String(id),

          step:
            "task_type"
        },

        env
      );


      await sendMessage(
        env,
        chatId,

        "📋 <b>Choose Task Type</b>",

        [
          [
            {
              text:
                "📢 Channel",

              callback_data:
                "tasktype:channel"
            },

            {
              text:
                "👥 Group",

              callback_data:
                "tasktype:group"
            }
          ],

          [
            {
              text:
                "🌐 Website",

              callback_data:
                "tasktype:website"
            },

            {
              text:
                "🔗 Custom Link",

              callback_data:
                "tasktype:custom"
            }
          ],

          [
            {
              text:
                "🎁 Referral",

              callback_data:
                "tasktype:referral"
            }
          ]
        ]
      );
    }

    return;
  }


  /* ========================================================
     TASK TYPE
  ======================================================== */

  if (
    data.startsWith(
      "tasktype:"
    )
  ) {

    const type =
      data.substring(
        9
      );


    const session =
      await getSession(
        user.id,
        env
      );


    if (
      !session
    ) {
      return;
    }


    await updateSession(
      user.id,

      {
        task_type:
          type,

        step:
          "task_title"
      },

      env
    );


    await sendMessage(
      env,
      chatId,

      "✏️ <b>Enter task title:</b>"
    );

    return;
  }


  /* ========================================================
     PRODUCT TYPE
  ======================================================== */

  if (
    data.startsWith(
      "type:"
    )
  ) {

    const type =
      data.substring(
        5
      );


    const session =
      await getSession(
        user.id,
        env
      );


    if (
      !session
    ) {
      return;
    }


    await updateSession(
      user.id,

      {
        product_type:
          type,

        step:
          "product_cover"
      },

      env
    );


    await sendMessage(
      env,
      chatId,

      "🖼️ <b>Product Cover</b>\n\n" +
      "Send cover image/photo.\n\n" +
      "Or type <code>skip</code>."
    );

    return;
  }


  /* ========================================================
     PRODUCT CATEGORY
  ======================================================== */

  if (
    data.startsWith(
      "cat:"
    )
  ) {

    const categoryId =
      Number(
        data.substring(
          4
        )
      );


    const session =
      await getSession(
        user.id,
        env
      );


    if (
      !session
    ) {
      return;
    }


    await updateSession(
      user.id,

      {
        category_id:
          categoryId,

        step:
          "product_type"
      },

      env
    );


    await sendMessage(
      env,
      chatId,

      "📚 <b>Choose Product Type</b>",

      PRODUCT_TYPES.map(
        item => [

          {
            text:
              item[1],

            callback_data:
              item[0]
          }

        ]
      )
    );

    return;
  }


  /* ========================================================
     NEW CATEGORY
  ======================================================== */

  if (
    data ===
    "cat:new"
  ) {

    await updateSession(
      user.id,

      {
        step:
          "category_new"
      },

      env
    );


    await sendMessage(
      env,
      chatId,

      "📂 <b>Enter new category name:</b>"
    );

    return;
  }


  /* ========================================================
     PUBLISH PRODUCT
  ======================================================== */

  if (
    data ===
    "publish_product"
  ) {

    await publishProductFromSession(
      user.id,
      chatId,
      env
    );

    return;
  }


  /* ========================================================
     CANCEL SESSION
  ======================================================== */

  if (
    data ===
    "cancel_session"
  ) {

    await clearSession(
      user.id,
      env
    );


    await sendMessage(
      env,
      chatId,

      "❌ <b>Cancelled.</b>",

      [
        [
          {
            text:
              "🏠 Main Menu",

            callback_data:
              "home"
          }
        ]
      ]
    );

    return;
  }


  /* ========================================================
     REMOVE ADMIN
  ======================================================== */

  if (
    data.startsWith(
      "remove_admin:"
    )
  ) {

    const id =
      Number(
        data.substring(
          13
        )
      );


    await removeAdmin(
      id,
      chatId,
      env
    );

    return;
  }


  /* ========================================================
     CHECK CURRENT TASK
  ======================================================== */

  if (
    data ===
    "check_current_task"
  ) {

    const session =
      await getSession(
        user.id,
        env
      );


    if (
      session?.product_id
    ) {

      let product =
        await getProductByProductId(
          session.product_id,
          env
        );


      /* task session stores database id */
      if (
        !product &&
        /^\d+$/.test(
          session.product_id
        )
      ) {

        const rows =
          await sb(
            env,
            "/rest/v1/products" +
              "?id=eq." +
              session.product_id +
              "&select=*"
          );


        product =
          rows[0] ||
          null;
      }


      if (
        product
      ) {

        await unlockProduct(
          user.id,
          chatId,
          product,
          env
        );
      }
    }

    return;
  }
}


/* ============================================================
   ADMIN PANEL
============================================================ */

async function adminPanel(
  chatId,
  env
) {

  await sendMessage(
    env,
    chatId,

    "👑 <b>PDF ORBIT ADMIN PANEL</b>\n\n" +
    "Manage products, tasks, categories and bot settings.",

    [

      [
        {
          text:
            "📦 Products",

          callback_data:
            "admin_products"
        },

        {
          text:
            "📋 Tasks",

          callback_data:
            "admin_tasks"
        }
      ],

      [
        {
          text:
            "👥 Users",

          callback_data:
            "admin_users"
        },

        {
          text:
            "👑 Admins",

          callback_data:
            "admin_admins"
        }
      ],

      [
        {
          text:
            "📂 Categories",

          callback_data:
            "admin_categories"
        }
      ],

      [
        {
          text:
            "🌐 Website",

          callback_data:
            "admin_website"
        },

        {
          text:
            "👤 Contact",

          callback_data:
            "admin_contact"
        }
      ],

      [
        {
          text:
            "🧹 Cleanup",

          callback_data:
            "admin_cleanup"
        }
      ],

      [
        {
          text:
            "🏠 Main Menu",

          callback_data:
            "home"
        }
      ]

    ]
  );
}


/* ============================================================
   PRODUCT ADMIN MENU
============================================================ */

async function productAdminMenu(
  chatId,
  env
) {

  await sendMessage(
    env,
    chatId,

    "📦 <b>PRODUCT MANAGEMENT</b>\n\n" +

    "All products are automatically FREE.",

    [

      [
        {
          text:
            "➕ Add Product",

          callback_data:
            "admin_add_product"
        }
      ],

      [
        {
          text:
            "📋 Product List",

          callback_data:
            "admin_product_list"
        }
      ],

      [
        {
          text:
            "🔙 Admin Panel",

          callback_data:
            "admin"
        }
      ]

    ]
  );
}


/* ============================================================
   PRODUCT LIST
============================================================ */

async function adminProductList(
  chatId,
  env
) {

  const products =
    await sb(
      env,

      "/rest/v1/products" +
      "?select=id,product_id,title,price,status,product_type" +
      "&deleted_at=is.null" +
      "&order=id.desc" +
      "&limit=50"
    );


  if (
    !products.length
  ) {

    await sendMessage(
      env,
      chatId,

      "📦 <b>No products found.</b>",

      [
        [
          {
            text:
              "➕ Add Product",

            callback_data:
              "admin_add_product"
          }
        ]
      ]
    );

    return;
  }


  for (
    const product of products
  ) {

    await sendMessage(
      env,
      chatId,

      "📦 <b>" +
      escapeHtml(
        product.title
      ) +
      "</b>\n\n" +

      "🆔 ID: <code>" +
      escapeHtml(
        product.product_id
      ) +
      "</code>\n" +

      "📌 Type: " +
      escapeHtml(
        product.product_type ||
        "pdf"
      ) +
      "\n" +

      "💰 Price: <b>FREE</b>",

      [

        [
          {
            text:
              "ℹ️ Info",

            callback_data:
              "product_info:" +
              product.id
          },

          {
            text:
              "🗑 Delete",

            callback_data:
              "delete_product:" +
              product.id
          }
        ]

      ]
    );
  }
}


/* ============================================================
   PRODUCT INFO
============================================================ */

async function adminProductInfo(
  id,
  chatId,
  env
) {

  const rows =
    await sb(
      env,

      "/rest/v1/products" +
      "?id=eq." +
      encodeURIComponent(
        id
      ) +
      "&select=*"
    );


  const product =
    rows[0];


  if (
    !product
  ) {

    await sendMessage(
      env,
      chatId,
      "❌ Product not found."
    );

    return;
  }


  const website =
    await productWebsiteUrl(
      product.product_id,
      env
    );


  await sendMessage(
    env,
    chatId,

    "📦 <b>PRODUCT INFO</b>\n\n" +

    "🆔 ID: <code>" +
    escapeHtml(
      product.product_id
    ) +
    "</code>\n" +

    "📚 Title: <b>" +
    escapeHtml(
      product.title
    ) +
    "</b>\n" +

    "📌 Type: " +
    escapeHtml(
      product.product_type ||
      "pdf"
    ) +
    "\n" +

    "💰 Price: <b>FREE</b>\n" +

    "📊 Status: " +
    escapeHtml(
      product.status ||
      ""
    ) +

    (

      website

        ? "\n\n🌐 " +
          escapeHtml(
            website
          )

        : ""
    )
  );
}


/* ============================================================
   DELETE PRODUCT
============================================================ */

async function deleteProduct(
  id,
  chatId,
  env
) {

  await sb(
    env,

    "/rest/v1/products?id=eq." +
    encodeURIComponent(
      id
    ),

    {
      method:
        "DELETE"
    }
  );


  await sendMessage(
    env,
    chatId,

    "🗑 <b>Product removed.</b>\n\n" +

    "Future delivery has been stopped.",

    [
      [
        {
          text:
            "📦 Product List",

          callback_data:
            "admin_product_list"
        }
      ]
    ]
  );
}


/* ============================================================
   START PRODUCT CREATION
============================================================ */

async function startProductCreation(
  userId,
  chatId,
  env
) {

  await createSession(
    userId,

    {
      step:
        "product_pdf",

      product_type:
        "pdf",

      price:
        0
    },

    env
  );


  await sendMessage(
    env,
    chatId,

    "➕ <b>ADD FREE PRODUCT</b>\n\n" +

    "📄 Send the PDF document now.\n\n" +

    "💰 Price: <b>FREE</b>"
  );
}


/* ============================================================
   DOCUMENT UPLOAD
============================================================ */

async function handleDocument(
  message,
  env
) {

  const userId =
    message.from.id;


  if (
    !(await can(
      userId,
      env,
      "product"
    ))
  ) {

    return;
  }


  const session =
    await getSession(
      userId,
      env
    );


  if (
    !session
  ) {

    return;
  }


  if (
    session.step !==
    "product_pdf"
  ) {

    return;
  }


  const document =
    message.document;


  await updateSession(
    userId,

    {

      telegram_file_id:
        document.file_id,

      file_name:
        document.file_name ||
        "",

      file_size:
        document.file_size ||
        null,

      mime_type:
        document.mime_type ||
        "application/pdf",

      price:
        0,

      step:
        "product_id"
    },

    env
  );


  await sendMessage(
    env,
    message.chat.id,

    "🆔 <b>Product ID</b>\n\n" +

    "Enter a unique ID.\n\n" +

    "Example:\n" +

    "<code>PHY001</code>"
  );
}


/* ============================================================
   PHOTO / COVER
============================================================ */

async function handlePhoto(
  message,
  env
) {

  const userId =
    message.from.id;


  const session =
    await getSession(
      userId,
      env
    );


  if (
    !session
  ) {

    return;
  }


  if (
    session.step !==
    "product_cover"
  ) {

    return;
  }


  const photos =
    message.photo ||
    [];


  const last =
    photos[
      photos.length - 1
    ];


  await updateSession(
    userId,

    {

      cover_image_file_id:
        last?.file_id ||
        null,

      step:
        "product_preview"
    },

    env
  );


  await showProductPreview(
    userId,
    message.chat.id,
    env
  );
}


/* ============================================================
   ADMIN SESSION PROCESSOR
============================================================ */

async function processAdminSession(
  message,
  session,
  env
) {

  const userId =
    message.from.id;


  const chatId =
    message.chat.id;


  const text =
    String(
      message.text || ""
    ).trim();


  /* ========================================================
     PRODUCT ID
  ======================================================== */

  if (
    session.step ===
    "product_id"
  ) {

    const existing =
      await getProductByProductId(
        text,
        env
      );


    if (
      existing
    ) {

      await sendMessage(
        env,
        chatId,

        "❌ <b>This Product ID already exists.</b>\n\n" +
        "Enter another ID."
      );

      return;
    }


    await updateSession(
      userId,

      {
        product_id:
          text,

        step:
          "product_title"
      },

      env
    );


    await sendMessage(
      env,
      chatId,

      "📚 <b>Enter product title:</b>"
    );

    return;
  }


  /* ========================================================
     TITLE
  ======================================================== */

  if (
    session.step ===
    "product_title"
  ) {

    await updateSession(
      userId,

      {

        title:
          text,

        price:
          0,

        step:
          "product_description"
      },

      env
    );


    await sendMessage(
      env,
      chatId,

      "📝 <b>Enter product description:</b>"
    );

    return;
  }


  /* ========================================================
     DESCRIPTION
  ======================================================== */

  if (
    session.step ===
    "product_description"
  ) {

    await updateSession(
      userId,

      {

        description:
          text,

        step:
          "product_category"
      },

      env
    );


    await showCategoriesForProduct(
      chatId,
      env
    );

    return;
  }


  /* ========================================================
     NEW CATEGORY WHILE ADDING PRODUCT
  ======================================================== */

  if (
    session.step ===
    "category_new"
  ) {

    const name =
      text.trim();


    if (
      !name
    ) {

      await sendMessage(
        env,
        chatId,

        "❌ Category name cannot be empty."
      );

      return;
    }


    const category =
      await createCategory(
        name,
        env
      );


    if (
      !category
    ) {

      await sendMessage(
        env,
        chatId,

        "❌ Category could not be created."
      );

      return;
    }


    await updateSession(
      userId,

      {

        category_id:
          category.id,

        step:
          "product_type"
      },

      env
    );


    await sendMessage(
      env,
      chatId,

      "✅ <b>Category created.</b>\n\n" +

      "📚 Choose product type:",

      PRODUCT_TYPES.map(
        item => [
          {
            text:
              item[1],

            callback_data:
              item[0]
          }
        ]
      )
    );

    return;
  }


  /* ========================================================
     ADMIN NEW CATEGORY
  ======================================================== */

  if (
    session.step ===
    "category_admin_new"
  ) {

    const name =
      text.trim();


    if (
      !name
    ) {

      await sendMessage(
        env,
        chatId,

        "❌ Category name cannot be empty."
      );

      return;
    }


    const category =
      await createCategory(
        name,
        env
      );


    if (
      !category
    ) {

      await sendMessage(
        env,
        chatId,

        "❌ Category could not be created.\n\n" +
        "Check Supabase categories table."
      );

      return;
    }


    await clearSession(
      userId,
      env
    );


    await sendMessage(
      env,
      chatId,

      "🎉 <b>Category Created!</b>\n\n" +

      "📂 Name: <b>" +
      escapeHtml(
        category.name
      ) +
      "</b>\n" +

      "🔗 Slug: <code>" +
      escapeHtml(
        category.slug
      ) +
      "</code>",

      [
        [
          {
            text:
              "📂 Categories",

            callback_data:
              "admin_categories"
          }
        ],

        [
          {
            text:
              "👑 Admin Panel",

            callback_data:
              "admin"
          }
        ]
      ]
    );

    return;
  }


  /* ========================================================
     COVER SKIP
  ======================================================== */

  if (
    session.step ===
    "product_cover"
  ) {

    if (
      text.toLowerCase() ===
      "skip"
    ) {

      await updateSession(
        userId,

        {

          cover_image_file_id:
            null,

          step:
            "product_preview"
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


  /* ========================================================
     TASK TITLE
  ======================================================== */

  if (
    session.step ===
    "task_title"
  ) {

    await updateSession(
      userId,

      {

        title:
          text,

        step:
          "task_url"
      },

      env
    );


    if (
      session.task_type ===
        "channel" ||
      session.task_type ===
        "group"
    ) {

      await sendMessage(
        env,
        chatId,

        "📢 <b>Enter Telegram Channel/Group ID</b>\n\n" +

        "Example:\n" +

        "<code>-1001234567890</code>"
      );

    } else if (
      session.task_type ===
      "referral"
    ) {

      await sendMessage(
        env,
        chatId,

        "🎁 <b>Enter required referral count</b>\n\n" +

        "Example:\n" +

        "<code>2</code>"
      );

    } else {

      await sendMessage(
        env,
        chatId,

        "🔗 <b>Enter task URL:</b>"
      );
    }

    return;
  }


  /* ========================================================
     TASK URL
  ======================================================== */

  if (
    session.step ===
    "task_url"
  ) {

    await updateSession(
      userId,

      {

        task_url:
          session.task_type ===
            "referral"

            ? null

            : text,

        channel_id:
          (
            session.task_type ===
              "channel" ||

            session.task_type ===
              "group"
          )

            ? text

            : null,

        step:
          session.task_type ===
            "referral"

            ? "task_count"

            : "task_required"
      },

      env
    );


    if (
      session.task_type !==
      "referral"
    ) {

      await sendMessage(
        env,
        chatId,

        "🔐 <b>Required task?</b>\n\n" +

        "Send <code>yes</code> or <code>no</code>."
      );

    } else {

      await sendMessage(
        env,
        chatId,

        "🎁 <b>Enter required referral count:</b>"
      );
    }

    return;
  }


  /* ========================================================
     TASK COUNT
  ======================================================== */

  if (
    session.step ===
    "task_count"
  ) {

    const count =
      Number(
        text
      );


    if (
      !Number.isInteger(
        count
      ) ||
      count < 1
    ) {

      await sendMessage(
        env,
        chatId,

        "❌ Enter a valid number."
      );

      return;
    }


    await updateSession(
      userId,

      {

        required_count:
          count,

        step:
          "task_required"
      },

      env
    );


    await sendMessage(
      env,
      chatId,

      "🔐 <b>Required task?</b>\n\n" +

      "Send <code>yes</code> or <code>no</code>."
    );

    return;
  }


  /* ========================================================
     TASK REQUIRED
  ======================================================== */

  if (
    session.step ===
    "task_required"
  ) {

    const required =
      text.toLowerCase() !==
      "no";


    await createTaskFromSession(
      userId,
      chatId,
      session,
      required,
      env
    );

    return;
  }


  /* ========================================================
     WEBSITE URL
  ======================================================== */

  if (
    session.step ===
    "website_url"
  ) {

    let website =
      text;


    if (
      !website.startsWith(
        "http://"
      ) &&
      !website.startsWith(
        "https://"
      )
    ) {

      website =
        "https://" +
        website;
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

      "✅ <b>Website URL saved.</b>\n\n" +

      "🌐 " +
      escapeHtml(
        website
      ),

      [
        [
          {
            text:
              "👑 Admin Panel",

            callback_data:
              "admin"
          }
        ]
      ]
    );

    return;
  }


  /* ========================================================
     CONTACT ADMIN
  ======================================================== */

  if (
    session.step ===
    "contact_admin"
  ) {

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

      "✅ <b>Contact Admin updated.</b>"
    );

    return;
  }


  /* ========================================================
     ADD ADMIN
  ======================================================== */

  if (
    session.step ===
    "admin_user_id"
  ) {

    const telegramId =
      Number(
        text
      );


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

        method:
          "POST",

        body: {

          telegram_user_id:
            telegramId,

          name:
            "",

          role:
            "admin",

          status:
            "active"
        },

        returnData:
          true
      }
    );


    await clearSession(
      userId,
      env
    );


    await sendMessage(
      env,
      chatId,

      "✅ <b>Admin added successfully.</b>"
    );

    return;
  }
}


/* ============================================================
   PRODUCT PREVIEW
============================================================ */

async function showProductPreview(
  userId,
  chatId,
  env
) {

  const session =
    await getSession(
      userId,
      env
    );


  if (
    !session
  ) {
    return;
  }


  await sendMessage(
    env,
    chatId,

    "📦 <b>PRODUCT PREVIEW</b>\n\n" +

    "🆔 ID: <code>" +
    escapeHtml(
      session.product_id
    ) +
    "</code>\n" +

    "📚 Title: <b>" +
    escapeHtml(
      session.title
    ) +
    "</b>\n" +

    "📌 Type: " +
    escapeHtml(
      session.product_type ||
      "pdf"
    ) +
    "\n" +

    "💰 Price: <b>FREE</b>\n\n" +

    escapeHtml(
      session.description ||
      ""
    ),

    [
      [
        {
          text:
            "✅ Publish FREE PDF",

          callback_data:
            "publish_product"
        }
      ],

      [
        {
          text:
            "❌ Cancel",

          callback_data:
            "cancel_session"
        }
      ]
    ]
  );
}


/* ============================================================
   PUBLISH PRODUCT
============================================================ */

async function publishProductFromSession(
  userId,
  chatId,
  env
) {

  const session =
    await getSession(
      userId,
      env
    );


  if (
    !session
  ) {

    await sendMessage(
      env,
      chatId,

      "❌ <b>Session expired.</b>"
    );

    return;
  }


  if (
    !session.telegram_file_id
  ) {

    await sendMessage(
      env,
      chatId,

      "❌ PDF missing."
    );

    return;
  }


  const existing =
    await getProductByProductId(
      session.product_id,
      env
    );


  if (
    existing
  ) {

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

      method:
        "POST",

      body: {

        product_id:
          session.product_id,

        title:
          session.title,

        description:
          session.description ||
          "",

        product_type:
          session.product_type ||
          "pdf",

        price:
          0,

        telegram_file_id:
          session.telegram_file_id,

        file_name:
          session.file_name ||
          "",

        file_size:
          session.file_size ||
          null,

        mime_type:
          session.mime_type ||
          "application/pdf",

        cover_image:
          session.cover_image_file_id ||
          null,

        category_id:
          session.category_id ||
          null,

        status:
          "active"
      },

      returnData:
        true
    }
  );


  await clearSession(
    userId,
    env
  );


  const website =
    await productWebsiteUrl(
      session.product_id,
      env
    );


  const bot =
    await getBotUsername(
      env
    );


  const telegramUrl =
    "https://t.me/" +
    bot +
    "?start=" +
    encodeURIComponent(
      session.product_id
    );


  await sendMessage(
    env,
    chatId,

    "🎉 <b>PRODUCT PUBLISHED!</b>\n\n" +

    "📚 " +
    escapeHtml(
      session.title
    ) +
    "\n\n" +

    "💰 Price: <b>FREE</b>\n" +

    "🆔 ID: <code>" +
    escapeHtml(
      session.product_id
    ) +
    "</code>\n\n" +

    "🌐 Website:\n" +
    escapeHtml(
      website ||
      "Not configured"
    ) +

    "\n\n" +

    "🤖 Telegram:\n" +
    escapeHtml(
      telegramUrl
    ),

    [
      [
        {
          text:
            "📦 Product List",

          callback_data:
            "admin_product_list"
        }
      ],

      [
        {
          text:
            "👑 Admin Panel",

          callback_data:
            "admin"
        }
      ]
    ]
  );
}


/* ============================================================
   CATEGORY SYSTEM
============================================================ */

async function createCategory(
  name,
  env
) {

  const cleanName =
    String(
      name || ""
    ).trim();


  if (
    !cleanName
  ) {

    return null;
  }


  const slug =
    slugify(
      cleanName
    );


  if (
    !slug
  ) {

    return null;
  }


  const existing =
    await sb(
      env,

      "/rest/v1/categories" +

      "?or=(" +

      "name.ilike." +
      encodeURIComponent(
        cleanName
      ) +

      ",slug.eq." +
      encodeURIComponent(
        slug
      ) +

      ")" +

      "&select=id,name,slug"
    );


  if (
    existing.length
  ) {

    return existing[0];
  }


  const rows =
    await sb(
      env,

      "/rest/v1/categories",

      {

        method:
          "POST",

        body: {

          category_id:
            "CAT-" +
            Date.now(),

          name:
            cleanName,

          slug:
            slug,

          description:
            "",

          image_url:
            "",

          status:
            "active"
        },

        returnData:
          true
      }
    );


  return Array.isArray(
    rows
  )
    ? rows[0]
    : rows;
}


/* ============================================================
   PRODUCT CATEGORY SELECT
============================================================ */

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
    categories.map(
      category => [

        {
          text:
            "📂 " +
            category.name,

          callback_data:
            "cat:" +
            category.id
        }

      ]
    );


  buttons.push([
    {
      text:
        "➕ New Category",

      callback_data:
        "cat:new"
    }
  ]);


  buttons.push([
    {
      text:
        "❌ Cancel",

      callback_data:
        "cancel_session"
    }
  ]);


  await sendMessage(
    env,
    chatId,

    "📂 <b>Choose Category</b>\n\n" +

    "Select an existing category or create a new one.",

    buttons
  );
}


/* ============================================================
   ADMIN CATEGORY MENU
============================================================ */

async function categoryAdminMenu(
  chatId,
  env
) {

  const categories =
    await sb(
      env,

      "/rest/v1/categories" +

      "?select=id,category_id,name,slug,status" +

      "&order=name.asc"
    );


  let text =
    "📂 <b>CATEGORY MANAGEMENT</b>\n\n";


  if (
    !categories.length
  ) {

    text +=
      "No categories created yet.\n";

  } else {

    text +=
      "Available categories:\n\n";


    for (
      const category of categories
    ) {

      text +=

        "📁 <b>" +
        escapeHtml(
          category.name
        ) +
        "</b>\n" +

        "🆔 <code>" +
        escapeHtml(
          category.category_id
        ) +
        "</code>\n\n";
    }
  }


  await sendMessage(
    env,
    chatId,
    text,

    [
      [
        {
          text:
            "➕ Add Category",

          callback_data:
            "admin_category_new"
        }
      ],

      [
        {
          text:
            "🔄 Refresh",

          callback_data:
            "admin_categories"
        }
      ],

      [
        {
          text:
            "🔙 Admin Panel",

          callback_data:
            "admin"
        }
      ]
    ]
  );
}


/* ============================================================
   USER CATEGORIES
============================================================ */

async function userCategories(
  chatId,
  env
) {

  const categories =
    await sb(
      env,

      "/rest/v1/categories" +

      "?select=id,name,description" +

      "&status=eq.active" +

      "&order=name.asc"
    );


  if (
    !categories.length
  ) {

    await sendMessage(
      env,
      chatId,

      "📂 <b>No categories available yet.</b>",

      [
        [
          {
            text:
              "🏠 Main Menu",

            callback_data:
              "home"
          }
        ]
      ]
    );

    return;
  }


  const buttons =
    categories.map(
      category => [

        {
          text:
            "📂 " +
            category.name,

          callback_data:
            "usercat:" +
            category.id
        }

      ]
    );


  buttons.push([
    {
      text:
        "🏠 Main Menu",

      callback_data:
        "home"
    }
  ]);


  await sendMessage(
    env,
    chatId,

    "📂 <b>Categories</b>\n\n" +
    "Choose a category:",

    buttons
  );
}


/* ============================================================
   CATEGORY PRODUCTS
============================================================ */

async function categoryProducts(
  chatId,
  categoryId,
  env
) {

  const products =
    await sb(
      env,

      "/rest/v1/products" +

      "?select=id,product_id,title,description,price,product_type,cover_image" +

      "&category_id=eq." +
      encodeURIComponent(
        categoryId
      ) +

      "&status=eq.active" +

      "&deleted_at=is.null" +

      "&order=created_at.desc" +

      "&limit=20"
    );


  if (
    !products.length
  ) {

    await sendMessage(
      env,
      chatId,

      "📂 <b>No products found in this category.</b>",

      [
        [
          {
            text:
              "📂 Categories",

            callback_data:
              "categories"
          }
        ]
      ]
    );

    return;
  }


  for (
    const product of products
  ) {

    const website =
      await productWebsiteUrl(
        product.product_id,
        env
      );


    const buttons = [

      [
        {
          text:
            "📥 Get FREE PDF",

          callback_data:
            "openproduct:" +
            product.product_id
        }
      ]

    ];


    if (
      website
    ) {

      buttons.push([
        {
          text:
            "🌐 Website",

          url:
            website
        }
      ]);
    }


    await sendProductCard(
      env,
      chatId,
      product,

      "🆓 <b>FREE STUDY MATERIAL</b>",

      buttons
    );
  }
}


/* ============================================================
   TASK ADMIN
============================================================ */

async function taskAdminMenu(
  chatId,
  env
) {

  await sendMessage(
    env,
    chatId,

    "📋 <b>UNLOCK TASKS</b>\n\n" +

    "Add tasks that users must complete before receiving a PDF.",

    [
      [
        {
          text:
            "➕ Add Task",

          callback_data:
            "admin_add_task"
        }
      ],

      [
        {
          text:
            "🔙 Admin Panel",

          callback_data:
            "admin"
        }
      ]
    ]
  );
}


/* ============================================================
   START TASK CREATION
============================================================ */

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


  if (
    !products.length
  ) {

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

    "📦 <b>Choose product:</b>",

    products.map(
      product => [

        {
          text:
            "📚 " +
            product.product_id +
            " — " +
            String(
              product.title
            ).substring(
              0,
              30
            ),

          callback_data:
            "select_task_product:" +
            product.id
        }

      ]
    )
  );
}


/* ============================================================
   CREATE TASK
============================================================ */

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

      method:
        "POST",

      body: {

        product_id:
          Number(
            session.product_id
          ),

        task_type:
          session.task_type,

        title:
          session.title,

        description:
          "",

        task_url:
          session.task_url ||
          null,

        channel_id:
          session.channel_id ||
          null,

        required_count:
          Number(
            session.required_count ||
            1
          ),

        sort_order:
          0,

        status:
          "active",

        required:
          required
      },

      returnData:
        true
    }
  );


  await clearSession(
    userId,
    env
  );


  await sendMessage(
    env,
    chatId,

    "✅ <b>Unlock task added successfully.</b>",

    [
      [
        {
          text:
            "📋 Tasks",

          callback_data:
            "admin_tasks"
        }
      ]
    ]
  );
}


/* ============================================================
   VERIFY TASK
============================================================ */

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
      encodeURIComponent(
        taskId
      ) +

      "&select=*"
    );


  const task =
    tasks[0];


  if (
    !task
  ) {

    await sendMessage(
      env,
      chatId,

      "❌ Task not found."
    );

    return;
  }


  if (
    task.task_type !==
      "channel" &&

    task.task_type !==
      "group"
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


  if (
    !channelId
  ) {

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

    [
      "member",
      "administrator",
      "creator"
    ].includes(
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

      "✅ <b>Task verified successfully.</b>"
    );

  } else {

    await sendMessage(
      env,
      chatId,

      "❌ <b>Membership not detected yet.</b>\n\n" +
      "Make sure you joined the channel/group and try again."
    );
  }
}


/* ============================================================
   MARK TASK COMPLETE
============================================================ */

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
      encodeURIComponent(
        taskId
      ) +

      "&select=id"
    );


  const expires =
    new Date(
      Date.now() +
      SESSION_MINUTES *
      60 *
      1000
    ).toISOString();


  if (
    existing.length
  ) {

    await sb(
      env,

      "/rest/v1/user_tasks?id=eq." +
      existing[0].id,

      {

        method:
          "PATCH",

        body: {

          completed:
            true,

          completed_at:
            new Date().toISOString(),

          expires_at:
            expires
        }
      }
    );

  } else {

    await sb(
      env,

      "/rest/v1/user_tasks",

      {

        method:
          "POST",

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
            expires
        }
      }
    );
  }
}


/* ============================================================
   CHECK TASK
============================================================ */

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
      encodeURIComponent(
        taskId
      ) +

      "&completed=eq.true" +

      "&select=id"
    );


  return (
    rows.length >
    0
  );
}


/* ============================================================
   REFERRALS
============================================================ */

async function processReferralStart(
  referredUserId,
  referrerId,
  productId,
  env
) {

  const referrer =
    Number(
      referrerId
    );


  if (
    !Number.isSafeInteger(
      referrer
    ) ||

    referrer ===
      referredUserId
  ) {

    return;
  }


  const product =
    await getProductByProductId(
      productId,
      env
    );


  if (
    !product
  ) {

    return;
  }


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


  if (
    existing.length
  ) {

    return;
  }


  await sb(
    env,

    "/rest/v1/referrals",

    {

      method:
        "POST",

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
            SESSION_MINUTES *
            60 *
            1000
          ).toISOString()
      }
    }
  );
}


/* ============================================================
   REFERRAL COUNT
============================================================ */

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


/* ============================================================
   CHANNEL VERIFICATION
============================================================ */

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


  if (
    !channelId
  ) {

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


  if (
    !result.ok
  ) {

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


/* ============================================================
   SEARCH
============================================================ */

async function telegramSearch(
  chatId,
  query,
  env
) {

  const products =
    await sb(
      env,

      "/rest/v1/products" +

      "?select=id,product_id,title,description,price,product_type,cover_image" +

      "&status=eq.active" +

      "&deleted_at=is.null" +

      "&or=(" +

      "title.ilike.*" +
      encodeURIComponent(
        query
      ) +
      "*," +

      "description.ilike.*" +
      encodeURIComponent(
        query
      ) +
      "*," +

      "product_id.ilike.*" +
      encodeURIComponent(
        query
      ) +

      "*" +

      ")" +

      "&order=id.desc" +

      "&limit=10"
    );


  if (
    !products.length
  ) {

    await sendMessage(
      env,
      chatId,

      "❌ <b>No products found.</b>"
    );

    return;
  }


  for (
    const product of products
  ) {

    const website =
      await productWebsiteUrl(
        product.product_id,
        env
      );


    const buttons = [

      [
        {
          text:
            "📥 Get FREE PDF",

          callback_data:
            "openproduct:" +
            product.product_id
        }
      ]

    ];


    if (
      website
    ) {

      buttons.push([
        {
          text:
            "🌐 Open Website",

          url:
            website
        }
      ]);
    }


    await sendProductCard(
      env,
      chatId,
      product,

      "🆓 <b>FREE STUDY MATERIAL</b>",

      buttons
    );
  }
}


/* ============================================================
   LATEST
============================================================ */

async function latestProducts(
  chatId,
  env
) {

  const products =
    await sb(
      env,

      "/rest/v1/products" +

      "?select=id,product_id,title,description,price,product_type,cover_image" +

      "&status=eq.active" +

      "&deleted_at=is.null" +

      "&order=created_at.desc" +

      "&limit=10"
    );


  if (
    !products.length
  ) {

    await sendMessage(
      env,
      chatId,

      "📚 <b>No products available yet.</b>"
    );

    return;
  }


  for (
    const product of products
  ) {

    const website =
      await productWebsiteUrl(
        product.product_id,
        env
      );


    const buttons = [

      [
        {
          text:
            "📥 Get FREE PDF",

          callback_data:
            "openproduct:" +
            product.product_id
        }
      ]

    ];


    if (
      website
    ) {

      buttons.push([
        {
          text:
            "🌐 Website",

          url:
            website
        }
      ]);
    }


    await sendProductCard(
      env,
      chatId,
      product,

      "✨ <b>Latest Study Material</b>\n\n" +
      "🆓 FREE",

      buttons
    );
  }
}


/* ============================================================
   USER
============================================================ */

async function touchUser(
  user,
  env
) {

  const expires =
    new Date(
      Date.now() +
      SESSION_MINUTES *
      60 *
      1000
    ).toISOString();


  const existing =
    await sb(
      env,

      "/rest/v1/users" +

      "?telegram_user_id=eq." +
      encodeURIComponent(
        user.id
      ) +

      "&select=id"
    );


  if (
    existing.length
  ) {

    await sb(
      env,

      "/rest/v1/users?id=eq." +
      existing[0].id,

      {

        method:
          "PATCH",

        body: {

          username:
            user.username ||
            null,

          first_name:
            user.first_name ||
            null,

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

        method:
          "POST",

        body: {

          telegram_user_id:
            user.id,

          username:
            user.username ||
            null,

          first_name:
            user.first_name ||
            null,

          last_activity_at:
            new Date().toISOString(),

          expires_at:
            expires
        }
      }
    );
  }
}


/* ============================================================
   UPDATE USER PRODUCT
============================================================ */

async function updateUserProduct(
  userId,
  productDbId,
  env
) {

  await sb(
    env,

    "/rest/v1/users" +

    "?telegram_user_id=eq." +
    encodeURIComponent(
      userId
    ),

    {

      method:
        "PATCH",

      body: {

        current_product_id:
          productDbId,

        last_activity_at:
          new Date().toISOString(),

        expires_at:
          new Date(
            Date.now() +
            SESSION_MINUTES *
            60 *
            1000
          ).toISOString()
      }
    }
  );
}


/* ============================================================
   USER STATISTICS
============================================================ */

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

    "👤 Users: " +
    users.length +
    "\n" +

    "📦 Active Products: " +
    products.length +
    "\n" +

    "💳 Purchases: " +
    purchases.length,

    [
      [
        {
          text:
            "🔙 Admin Panel",

          callback_data:
            "admin"
        }
      ]
    ]
  );
}


/* ============================================================
   ADMIN MANAGEMENT
============================================================ */

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


  for (
    const admin of admins
  ) {

    text +=

      "• <code>" +
      admin.telegram_user_id +
      "</code> — " +

      escapeHtml(
        admin.name ||
        "Admin"
      ) +

      " (" +

      escapeHtml(
        admin.role ||
        "admin"
      ) +

      ")\n";


    buttons.push([
      {
        text:
          "🗑 Remove " +
          admin.telegram_user_id,

        callback_data:
          "remove_admin:" +
          admin.id
      }
    ]);
  }


  buttons.push([
    {
      text:
        "➕ Add Admin",

      callback_data:
        "admin_add_admin"
    }
  ]);


  buttons.push([
    {
      text:
        "🔙 Admin Panel",

      callback_data:
        "admin"
    }
  ]);


  await sendMessage(
    env,
    chatId,
    text,
    buttons
  );
}


/* ============================================================
   START ADMIN
============================================================ */

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

    "👤 <b>Add Admin</b>\n\n" +

    "Enter Telegram User ID:"
  );
}


/* ============================================================
   REMOVE ADMIN
============================================================ */

async function removeAdmin(
  id,
  chatId,
  env
) {

  const rows =
    await sb(
      env,

      "/rest/v1/admins?id=eq." +
      encodeURIComponent(
        id
      ) +

      "&select=telegram_user_id"
    );


  if (
    !rows.length
  ) {

    return;
  }


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

      "⛔ <b>Owner cannot be removed.</b>"
    );

    return;
  }


  await sb(
    env,

    "/rest/v1/admins?id=eq." +
    encodeURIComponent(
      id
    ),

    {
      method:
        "DELETE"
    }
  );


  await sendMessage(
    env,
    chatId,

    "✅ <b>Admin removed.</b>"
  );
}


/* ============================================================
   WEBSITE SETTING
============================================================ */

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

    "🌐 <b>Website Settings</b>\n\n" +

    "Current:\n" +

    escapeHtml(
      current ||
      "Not configured"
    ) +

    "\n\n" +

    "Send your website base URL.\n\n" +

    "Example:\n" +

    "<code>https://example.com</code>"
  );
}


/* ============================================================
   CONTACT SETTING
============================================================ */

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

    "👤 <b>Contact Admin</b>\n\n" +

    "Current:\n" +

    escapeHtml(
      current ||
      "Not configured"
    ) +

    "\n\n" +

    "Example:\n" +

    "<code>@yourusername</code>"
  );
}


/* ============================================================
   API PRODUCTS
============================================================ */

async function apiProducts(
  env
) {

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
    products.map(
      product => ({

        ...product,

        price:
          0,

        website_url:
          buildProductUrl(
            website,
            product.product_id
          ),

        telegram_url:
          null

      })
    );


  return json({

    ok:
      true,

    products:
      data
  });
}


/* ============================================================
   API PRODUCT
============================================================ */

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
    product.status !==
      "active" ||
    product.deleted_at
  ) {

    return json(

      {
        ok:
          false,

        error:
          "Product not found"
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

    ok:
      true,

    product: {

      id:
        product.id,

      product_id:
        product.product_id,

      title:
        product.title,

      description:
        product.description,

      price:
        0,

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
        tasks.map(
          task => ({

            id:
              task.id,

            task_type:
              task.task_type,

            title:
              task.title,

            description:
              task.description,

            task_url:
              task.task_url,

            required_count:
              task.required_count,

            required:
              task.required

          })
        )
    }
  });
}


/* ============================================================
   API SEARCH
============================================================ */

async function apiSearch(
  env,
  query
) {

  if (
    !query.trim()
  ) {

    return json({

      ok:
        true,

      products:
        []
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
      encodeURIComponent(
        query
      ) +
      "*," +

      "description.ilike.*" +
      encodeURIComponent(
        query
      ) +
      "*," +

      "product_id.ilike.*" +
      encodeURIComponent(
        query
      ) +

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

    ok:
      true,

    products:
      products.map(
        product => ({

          ...product,

          price:
            0,

          website_url:
            buildProductUrl(
              website,
              product.product_id
            )
        })
      )
  });
}


/* ============================================================
   API SETTINGS
============================================================ */

async function apiSettings(
  env
) {

  return json({

    ok:
      true,

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


/* ============================================================
   PRODUCT HELPERS
============================================================ */

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


  return (
    rows[0] ||
    null
  );
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


/* ============================================================
   WEBSITE URL
============================================================ */

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

  if (
    !base
  ) {

    return null;
  }


  return (

    String(base)
      .replace(
        /\/+$/,
        ""
      ) +

    "/product/" +

    encodeURIComponent(
      productId
    )
  );
}


/* ============================================================
   SESSIONS
============================================================ */

async function getSession(
  userId,
  env
) {

  const rows =
    await sb(
      env,

      "/rest/v1/bot_sessions" +

      "?telegram_user_id=eq." +
      encodeURIComponent(
        userId
      ) +

      "&select=*"
    );


  return (
    rows[0] ||
    null
  );
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
      data.step ||
      "idle",

    expires_at:
      new Date(
        Date.now() +
        SESSION_MINUTES *
        60 *
        1000
      ).toISOString(),

    updated_at:
      new Date().toISOString(),

    ...data
  };


  if (
    existing
  ) {

    await sb(
      env,

      "/rest/v1/bot_sessions" +

      "?telegram_user_id=eq." +
      encodeURIComponent(
        userId
      ),

      {

        method:
          "PATCH",

        body:
          values
      }
    );

  } else {

    await sb(
      env,

      "/rest/v1/bot_sessions",

      {

        method:
          "POST",

        body:
          values
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
    encodeURIComponent(
      userId
    ),

    {

      method:
        "DELETE"
    }
  );
}


/* ============================================================
   ADMIN PERMISSIONS
============================================================ */

async function isAdmin(
  userId,
  env
) {

  if (
    String(userId) ===
    String(
      env.ADMIN_TELEGRAM_ID
    )
  ) {

    return true;
  }


  const rows =
    await sb(
      env,

      "/rest/v1/admins" +

      "?telegram_user_id=eq." +
      encodeURIComponent(
        userId
      ) +

      "&status=eq.active" +

      "&select=id"
    );


  return (
    rows.length >
    0
  );
}


async function can(
  userId,
  env,
  type
) {

  if (
    String(userId) ===
    String(
      env.ADMIN_TELEGRAM_ID
    )
  ) {

    return true;
  }


  const rows =
    await sb(
      env,

      "/rest/v1/admins" +

      "?telegram_user_id=eq." +
      encodeURIComponent(
        userId
      ) +

      "&status=eq.active" +

      "&select=role"
    );


  if (
    !rows.length
  ) {

    return false;
  }


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


/* ============================================================
   CLEANUP
============================================================ */

async function cleanupExpired(
  env
) {

  try {

    await sb(
      env,

      "/rest/v1/rpc/cleanup_expired_data",

      {

        method:
          "POST",

        body:
          {}
      }
    );


    console.log(
      "Expired temporary data cleaned."
    );

  } catch (error) {

    console.error(
      "Cleanup failed:",
      error
    );
  }
}


/* ============================================================
   SETTINGS
============================================================ */

async function getSetting(
  key,
  env
) {

  const rows =
    await sb(
      env,

      "/rest/v1/settings" +

      "?key=eq." +
      encodeURIComponent(
        key
      ) +

      "&select=value"
    );


  return (
    rows[0]?.value ||
    ""
  );
}


async function setSetting(
  key,
  value,
  env
) {

  const existing =
    await sb(
      env,

      "/rest/v1/settings" +

      "?key=eq." +
      encodeURIComponent(
        key
      ) +

      "&select=id"
    );


  if (
    existing.length
  ) {

    await sb(
      env,

      "/rest/v1/settings" +

      "?key=eq." +
      encodeURIComponent(
        key
      ),

      {

        method:
          "PATCH",

        body: {

          value:
            value,

          updated_at:
            new Date().toISOString()
        }
      }
    );

  } else {

    await sb(
      env,

      "/rest/v1/settings",

      {

        method:
          "POST",

        body: {

          key:
            key,

          value:
            value
        }
      }
    );
  }
}


/* ============================================================
   TELEGRAM API
============================================================ */

async function telegram(
  env,
  method,
  body
) {

  const response =
    await fetch(

      TELEGRAM_API +
      env.BOT_TOKEN +
      "/" +
      method,

      {

        method:
          "POST",

        headers: {

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(
            body
          )
      }
    );


  return await response.json();
}


/* ============================================================
   SEND MESSAGE
============================================================ */

async function sendMessage(
  env,
  chatId,
  text,
  buttons = []
) {

  const body = {

    chat_id:
      chatId,

    text:
      text,

    parse_mode:
      "HTML",

    disable_web_page_preview:
      false
  };


  if (
    buttons.length
  ) {

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


/* ============================================================
   SEND PHOTO
============================================================ */

async function sendPhoto(
  env,
  chatId,
  photo,
  caption,
  buttons = []
) {

  const body = {

    chat_id:
      chatId,

    photo:
      photo,

    caption:
      caption,

    parse_mode:
      "HTML"
  };


  if (
    buttons.length
  ) {

    body.reply_markup = {

      inline_keyboard:
        buttons
    };
  }


  return await telegram(
    env,
    "sendPhoto",
    body
  );
}


/* ============================================================
   SEND DOCUMENT
============================================================ */

async function sendDocument(
  env,
  chatId,
  fileId,
  caption
) {

  const body = {

    chat_id:
      chatId,

    document:
      fileId,

    parse_mode:
      "HTML"
  };


  if (
    caption
  ) {

    body.caption =
      "📚 " +
      escapeHtml(
        caption
      );
  }


  return await telegram(
    env,
    "sendDocument",
    body
  );
}


/* ============================================================
   CALLBACK ANSWER
============================================================ */

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


/* ============================================================
   BOT USERNAME
============================================================ */

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


/* ============================================================
   SUPABASE
============================================================ */

async function sb(
  env,
  path,
  options = {}
) {

  const {

    method =
      "GET",

    body =
      undefined,

    returnData =
      false

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

      String(
        env.SUPABASE_URL
      ).replace(
        /\/+$/,
        ""
      ) +

      path,

      {

        method:
          method,

        headers:
          headers,

        body:
          body !== undefined

            ? JSON.stringify(
                body
              )

            : undefined
      }
    );


  const text =
    await response.text();


  if (
    !response.ok
  ) {

    throw new Error(

      "Supabase " +
      response.status +
      ": " +
      text

    );
  }


  if (
    !text
  ) {

    return [];
  }


  try {

    return JSON.parse(
      text
    );

  } catch {

    return [];
  }
}


/* ============================================================
   JSON RESPONSE
============================================================ */

function json(
  data,
  status = 200
) {

  return new Response(

    JSON.stringify(
      data
    ),

    {

      status:

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


/* ============================================================
   HTML ESCAPE
============================================================ */

function escapeHtml(
  value
) {

  return String(
    value ?? ""
  )

    .replaceAll(
      "&",
      "&amp;"
    )

    .replaceAll(
      "<",
      "&lt;"
    )

    .replaceAll(
      ">",
      "&gt;"
    )

    .replaceAll(
      '"',
      "&quot;"
    );
}


/* ============================================================
   SLUG
============================================================ */

function slugify(
  value
) {

  return String(
    value
  )

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