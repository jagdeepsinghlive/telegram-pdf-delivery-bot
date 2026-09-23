async function sendMainMenu(chatId, env) {
  const buttons = [
    [
      { text: "🔎 Search Products", callback_data: "search" },
      { text: "📚 Latest Products", callback_data: "latest" }
    ],
    [
      { text: "📂 Categories", callback_data: "categories" },
      { text: "⭐ Popular PDFs", callback_data: "latest" }
    ],
    [
      { text: "📢 Join Telegram", url: env.CHANNEL_INVITE_URL || "https://t.me/" }
    ],
    [
      { text: "👤 Contact Admin", callback_data: "contact" }
    ]
  ];

  if (await isAdmin(chatId, env)) {
    buttons.push([
      { text: "👑 Admin Panel", callback_data: "admin" }
    ]);
  }

  const text =
    "📚 <b>PDF ORBIT</b> 🚀\n" +
    "<i>Your Study Companion</i>\n\n" +
    "👋 <b>Welcome!</b>\n\n" +
    "Get free study materials, notes, PYQs, books and PDFs — all in one place.\n\n" +
    "🆓 <b>100% Free</b>  •  ⚡ Instant Access\n" +
    "📖 Notes  •  📝 Tests  •  📕 Books\n\n" +
    "👇 <b>Choose an option below</b>";

  await sendMessage(
    env,
    chatId,
    text,
    buttons
  );
}