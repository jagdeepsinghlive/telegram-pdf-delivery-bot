/**
 * Tele PDF Platform API
 * Backend-only management/search/rating/referral API for the custom website + admin panel.
 */

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function out(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extra }
  });
}

function ok(data = {}) { return out({ ok: true, ...data }); }

async function db(env, table, { select = "*", filters = [], order, limit, method = "GET", body } = {}) {
  let url = `${env.SUPABASE_URL}/rest/v1/${table}`;
  const q = [];
  if (select) q.push("select=" + encodeURIComponent(select));
  for (const f of filters) q.push(encodeURIComponent(f[0]) + "=" + encodeURIComponent(f[1] + "." + f[2]));
  if (order) q.push("order=" + encodeURIComponent(order));
  if (limit) q.push("limit=" + encodeURIComponent(limit));
  if (q.length) url += "?" + q.join("&");
  const r = await fetch(url, {
    method,
    headers: {
      apikey: env.SUPABASE_KEY,
      Authorization: "Bearer " + env.SUPABASE_KEY,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const t = await r.text();
  if (!r.ok) throw new Error("Supabase " + r.status + ": " + t);
  return t ? JSON.parse(t) : [];
}

function adminAuthorized(request, env) {
  const configured = String(env.ADMIN_API_KEY || "").trim();
  if (!configured) return false;
  const h = request.headers.get("Authorization") || "";
  return h === "Bearer " + configured;
}

function requireAdmin(request, env) {
  return adminAuthorized(request, env);
}

const PUBLIC_PRODUCT_FIELDS =
  "id,product_id,title,description,price,file_name,file_size,mime_type,cover_image,category_id,product_type,status,created_at,updated_at,slug,seo_title,seo_description,content_html,faq_json,external_url,media_type,noindex,keywords,sort_order,featured";

export async function handlePlatform(request, env, url) {
  try {
    const path = url.pathname;

    // Safe public catalog/search APIs.
    if (request.method === "GET" && path === "/api/v2/products") {
      const q = (url.searchParams.get("q") || "").trim();
      const category = url.searchParams.get("category");
      const limit = Math.min(Number(url.searchParams.get("limit") || 50), 100);
      const filters = [["status", "eq", "active"]];
      if (category) filters.push(["category_id", "eq", category]);
      let rows;
      if (q) {
        const term = q.replace(/[%_,]/g, " ").trim();
        const u = `${env.SUPABASE_URL}/rest/v1/products?select=${encodeURIComponent(PUBLIC_PRODUCT_FIELDS)}&status=eq.active&or=${encodeURIComponent("(title.ilike.*" + term + "*,description.ilike.*" + term + "*,keywords.ilike.*" + term + "*,file_name.ilike.*" + term + "*)")}&order=featured.desc,created_at.desc&limit=${limit}`;
        const r = await fetch(u, { headers: { apikey: env.SUPABASE_KEY, Authorization: "Bearer " + env.SUPABASE_KEY }});
        if (!r.ok) return out({ ok:false, error:"Search failed" }, 502);
        rows = await r.json();
      } else {
        rows = await db(env, "products", { select: PUBLIC_PRODUCT_FIELDS, filters, order:"featured.desc,created_at.desc", limit });
      }
      return out({ ok:true, items:rows });
    }

    if (request.method === "GET" && path === "/api/v2/categories") {
      const rows = await db(env, "categories", {
        select:"id,category_id,name,slug,description,image_url,status,parent_id,seo_title,seo_description,content_html,noindex,created_at",
        filters:[["status","eq","active"]], order:"name.asc"
      });
      return out({ok:true,items:rows});
    }

    if (request.method === "GET" && path === "/api/v2/settings") {
      const rows = await db(env, "settings", {select:"key,value"});
      const safe = {};
      for (const x of rows) {
        if (!["SUPABASE_KEY","BOT_TOKEN","WEBHOOK_SECRET","ADMIN_API_KEY"].includes(String(x.key).toUpperCase())) safe[x.key]=x.value;
      }
      return out({ok:true,settings:safe});
    }

    if (request.method === "GET" && path.startsWith("/api/v2/product/") && path.endsWith("/ratings")) {
      const id = decodeURIComponent(path.substring("/api/v2/product/".length,path.length-"/ratings".length));
      const products = await db(env,"products",{select:"id",filters:[["product_id","eq",id],["status","eq","active"]],limit:1});
      if (!products.length) return out({ok:false,error:"Product not found"},404);
      const rows = await db(env,"product_ratings",{select:"rating,review,created_at",filters:[["product_id","eq",products[0].id],["status","eq","published"]],order:"created_at.desc",limit:100});
      return out({ok:true,items:rows});
    }

    if (request.method === "GET" && path.startsWith("/api/v2/product/")) {
      const id = decodeURIComponent(path.substring("/api/v2/product/".length));
      const rows = await db(env, "products", {
        select:PUBLIC_PRODUCT_FIELDS,
        filters:[["product_id","eq",id],["status","eq","active"]], limit:1
      });
      if (!rows.length) return out({ok:false,error:"Product not found"},404);
      const stats = await db(env,"product_stats",{select:"views,downloads,shares,rating_count,avg_rating",filters:[["product_id","eq",rows[0].id]],limit:1}).catch(()=>[]);
      return out({ok:true,product:rows[0],stats:stats[0]||{views:0,downloads:0,shares:0,rating_count:0,avg_rating:0}});
    }

    if (request.method === "GET" && path === "/api/v2/referral/config") {
      return out({ok:true,coins_per_referral:1,coins_per_rupee:5,rupees_per_100_coins:20,min_redeem_coins:100});
    }

    // Public website may submit a rating only after the frontend authenticates the user.
    // The Telegram user id is accepted here because the current project identifies users by Telegram ID.
    if (request.method === "POST" && path === "/api/v2/rating") {
      const b = await request.json();
      const telegramUserId = Number(b.telegram_user_id);
      const productId = String(b.product_id || "");
      const rating = Number(b.rating);
      if (!telegramUserId || !productId || rating < 1 || rating > 5) return out({ok:false,error:"Invalid rating"},400);
      const products = await db(env,"products",{select:"id",filters:[["product_id","eq",productId],["status","eq","active"]],limit:1});
      if (!products.length) return out({ok:false,error:"Product not found"},404);
      const body = {product_id:products[0].id,telegram_user_id:telegramUserId,rating:Math.round(rating),review:String(b.review||"").slice(0,2000),status:"published"};
      const existing = await db(env,"product_ratings",{select:"id",filters:[["product_id","eq",products[0].id],["telegram_user_id","eq",telegramUserId]],limit:1});
      const rows = existing.length
        ? await db(env,"product_ratings",{method:"PATCH",filters:[["id","eq",existing[0].id]],body})
        : await db(env,"product_ratings",{method:"POST",body});
      return out({ok:true,rating:Array.isArray(rows)?rows[0]:rows});
    }

    // Admin API used by the owner's custom /admin UI.
    if (path.startsWith("/api/admin/")) {
      if (!requireAdmin(request, env)) return out({ok:false,error:"Unauthorized"},401);
      return await adminRoute(request, env, url);
    }

    // Referral profile API. Keep redemption server-side/admin-controlled.
    if (request.method === "GET" && path.startsWith("/api/v2/referral/")) {
      const telegramUserId = Number(decodeURIComponent(path.substring("/api/v2/referral/".length)));
      if (!telegramUserId) return out({ok:false,error:"Invalid user"},400);
      const users = await db(env,"users",{select:"telegram_user_id,username,first_name,coin_balance,total_earned_coins,total_redeemed_coins,referral_code",filters:[["telegram_user_id","eq",telegramUserId]],limit:1});
      if (!users.length) return out({ok:false,error:"User not found"},404);
      const referrals = await db(env,"referral_rewards",{select:"referred_telegram_user_id,coins,status,created_at",filters:[["referrer_telegram_user_id","eq",telegramUserId]],order:"created_at.desc",limit:100});
      return out({ok:true,user:users[0],referrals});
    }

    return null;
  } catch (e) {
    console.error("Platform API:", e);
    return out({ok:false,error:e?.message||String(e)},500);
  }
}

async function adminRoute(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (method === "GET" && path === "/api/admin/dashboard") {
    const tables = ["products","posts","categories","users","admins","referrals","product_ratings","redemptions"];
    const counts = {};
    for (const t of tables) {
      try { const rows = await db(env,t,{select:"id",limit:100000}); counts[t]=rows.length; } catch { counts[t]=0; }
    }
    return out({ok:true,counts});
  }

  const map = {
    products:"products", posts:"posts", categories:"categories", users:"users",
    admins:"admins", referrals:"referrals", ratings:"product_ratings", redemptions:"redemptions",
    links:"site_links", settings:"settings", tasks:"product_tasks"
  };

  if (method === "GET" && path === "/api/admin/data") {
    const requested = (url.searchParams.get("tables")||"products,posts,categories,admins,settings,links").split(",").map(x=>x.trim()).filter(x=>map[x]);
    const data = {};
    for (const key of requested) {
      const select = key === "products" ? PUBLIC_PRODUCT_FIELDS : "*";
      data[key] = await db(env,map[key],{select,order:"created_at.desc",limit:500});
    }
    return out({ok:true,data});
  }

  if ((method === "POST" || method === "PATCH") && path === "/api/admin/save") {
    const b = await request.json();
    const table = map[String(b.table||"")];
    if (!table) return out({ok:false,error:"Invalid table"},400);
    const allowed = {
      products:["product_id","title","description","price","telegram_file_id","file_name","file_size","mime_type","cover_image","status","category_id","product_type","slug","seo_title","seo_description","content_html","faq_json","external_url","media_type","noindex","keywords","sort_order","featured"],
      posts:["post_id","title","slug","category_id","content_html","excerpt","thumbnail_url","thumbnail_file_id","faq_json","seo_title","seo_description","status","noindex"],
      categories:["category_id","name","slug","description","image_url","status","parent_id","seo_title","seo_description","content_html","noindex"],
      users:["telegram_user_id","username","first_name","channel_joined","coin_balance","total_earned_coins","total_redeemed_coins","referral_code","referred_by_telegram_user_id"],
      admins:["telegram_user_id","name","role","status"],
      settings:["key","value"],
      links:["title","url","link_type","placement","sort_order","status"],
      tasks:["product_id","task_type","title","description","task_url","channel_id","required_count","sort_order","status","required"],
      ratings:["product_id","telegram_user_id","rating","review","status"],
      redemptions:["telegram_user_id","coins","amount_paise","status","payment_method","payment_reference","note"]
    }[String(b.table||"")];
    if (!allowed) return out({ok:false,error:"Unsupported table"},400);
    const clean = {};
    for (const k of allowed) if (Object.prototype.hasOwnProperty.call(b.data||{},k)) clean[k]=b.data[k];
    if (b.table === "ratings") {
      clean.rating = Math.max(1,Math.min(5,Number(clean.rating)));
      clean.review = String(clean.review||"").slice(0,2000);
    }
    let rows;
    if (b.id) rows = await db(env,table,{method:"PATCH",filters:[["id","eq",b.id]],body:clean});
    else rows = await db(env,table,{method:"POST",body:clean});
    await db(env,"admin_audit_log",{method:"POST",body:{admin_telegram_user_id:Number(env.ADMIN_TELEGRAM_ID||0),action:b.id?"update":"create",entity_type:b.table,entity_id:String(b.id||rows?.[0]?.id||""),details:{fields:Object.keys(clean)}}}).catch(()=>{});
    return out({ok:true,item:Array.isArray(rows)?rows[0]:rows});
  }

  if (method === "POST" && path === "/api/admin/delete") {
    const b = await request.json();
    const table = map[String(b.table||"")];
    if (!table || !b.id) return out({ok:false,error:"Invalid delete"},400);
    const protectedTables = new Set(["users","admins","settings"]);
    if (protectedTables.has(String(b.table)) && String(env.ADMIN_TELEGRAM_ID||"") !== String(b.admin_telegram_user_id||env.ADMIN_TELEGRAM_ID||"")) return out({ok:false,error:"Owner approval required"},403);
    await db(env,table,{method:"DELETE",filters:[["id","eq",b.id]]});
    await db(env,"admin_audit_log",{method:"POST",body:{admin_telegram_user_id:Number(env.ADMIN_TELEGRAM_ID||0),action:"delete",entity_type:b.table,entity_id:String(b.id),details:{}}}).catch(()=>{});
    return ok();
  }

  return out({ok:false,error:"Admin route not found"},404);
}
