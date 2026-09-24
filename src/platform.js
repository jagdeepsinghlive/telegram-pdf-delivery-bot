/**
 * Tele PDF Platform API
 * Backend-only management/search/rating/referral API for the custom website + admin panel.
 */

const DEFAULT_ORIGIN = "https://telepdfs.blogspot.com";

function corsHeaders(env, request) {
  const configured = String(env.WEBSITE_ORIGIN || DEFAULT_ORIGIN).replace(/\\/$/, "");
  const origin = request?.headers?.get("Origin") || "";
  const allowed = origin === configured ? origin : configured;
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin"
  };
}

function out(data, status = 200, extra = {}, env, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(env || {}, request), ...extra }
  });
}

function ok(data = {}, env, request) { return out({ ok: true, ...data }, 200, {}, env, request); }

function base64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/g, "");
}

function randomString(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return base64url(a);
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64url(new Uint8Array(digest));
}

async function telegramOidcToken(env, code, redirectUri, verifier) {
  const clientId = String(env.TELEGRAM_CLIENT_ID || "");
  const clientSecret = String(env.TELEGRAM_CLIENT_SECRET || "");
  if (!clientId || !clientSecret) throw new Error("Telegram OIDC credentials are not configured");

  const basic = btoa(unescape(encodeURIComponent(clientId + ":" + clientSecret)));
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier
  });

  const r = await fetch("https://oauth.telegram.org/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + basic
    },
    body
  });
  const data = await r.json();
  if (!r.ok || !data.id_token) throw new Error(data.error_description || data.error || "Telegram token exchange failed");
  return data.id_token;
}

async function verifyTelegramIdToken(env, token, expectedNonce) {
  const parts = String(token).split(".");
  if (parts.length !== 3) throw new Error("Invalid Telegram ID token");
  const decode = (v) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(v.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - v.length % 4) % 4)), c => c.charCodeAt(0))));
  const header = decode(parts[0]);
  const payload = decode(parts[1]);
  if (header.alg !== "RS256") throw new Error("Unsupported Telegram signing algorithm");
  if (payload.iss !== "https://oauth.telegram.org") throw new Error("Invalid Telegram issuer");
  if (String(payload.aud) !== String(env.TELEGRAM_CLIENT_ID)) throw new Error("Invalid Telegram audience");
  if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throw new Error("Expired Telegram ID token");
  if (expectedNonce && payload.nonce && payload.nonce !== expectedNonce) throw new Error("Invalid Telegram nonce");

  const keys = await fetch("https://oauth.telegram.org/.well-known/jwks.json").then(r => r.json());
  const jwk = (keys.keys || []).find(k => k.kid === header.kid);
  if (!jwk) throw new Error("Telegram signing key not found");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signature = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - parts[2].length % 4) % 4)), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!valid) throw new Error("Invalid Telegram ID token signature");
  return payload;
}

async function createWebSession(env, telegramUserId) {
  const token = randomString(48);
  await db(env, "web_sessions", { method: "POST", body: {
    session_token: token,
    telegram_user_id: Number(telegramUserId),
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  }});
  return token;
}

async function getWebSession(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\\s*)telepdf_session=([^;]+)/);
  if (!match) return null;
  const rows = await db(env, "web_sessions", { select: "session_token,telegram_user_id,expires_at", filters: [["session_token","eq",decodeURIComponent(match[1])]], limit: 1 });
  if (!rows.length || new Date(rows[0].expires_at) <= new Date()) return null;
  return rows[0];
}

function sessionCookie(token) {
  return "telepdf_session=" + encodeURIComponent(token) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000";
}

function clearSessionCookie() {
  return "telepdf_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

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

    // Telegram OIDC login: server-generated state + PKCE, then server-side ID-token verification.
    if (request.method === "GET" && path === "/auth/telegram") {
      const origin = String(env.WEBSITE_ORIGIN || DEFAULT_ORIGIN).replace(/\\/$/, "");
      const callback = String(env.TELEGRAM_REDIRECT_URI || (new URL("/auth/telegram/callback", request.url)).toString());
      const state = randomString(32);
      const verifier = randomString(48);
      const challenge = await sha256Base64Url(verifier);
      await db(env, "web_auth_states", { method: "POST", body: { state, code_verifier: verifier, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() } });
      const auth = new URL("https://oauth.telegram.org/auth");
      auth.searchParams.set("client_id", String(env.TELEGRAM_CLIENT_ID || ""));
      auth.searchParams.set("redirect_uri", callback);
      auth.searchParams.set("response_type", "code");
      auth.searchParams.set("scope", "openid profile");
      auth.searchParams.set("state", state);
      auth.searchParams.set("nonce", state);
      auth.searchParams.set("code_challenge", challenge);
      auth.searchParams.set("code_challenge_method", "S256");
      return Response.redirect(auth.toString(), 302);
    }

    if (request.method === "GET" && path === "/auth/telegram/callback") {
      const code = url.searchParams.get("code") || "";
      const state = url.searchParams.get("state") || "";
      const error = url.searchParams.get("error");
      const fallback = String(env.WEBSITE_ORIGIN || DEFAULT_ORIGIN).replace(/\\/$/, "");
      if (error) return Response.redirect(fallback + "/?telegram_login=cancelled", 302);
      if (!code || !state) return out({ok:false,error:"Missing Telegram login parameters"},400,{},env,request);

      const states = await db(env, "web_auth_states", { select:"state,code_verifier,expires_at", filters:[["state","eq",state]], limit:1 });
      if (!states.length || new Date(states[0].expires_at) <= new Date()) return out({ok:false,error:"Login state expired"},400,{},env,request);
      await db(env, "web_auth_states", { method:"DELETE", filters:[["state","eq",state]] });
      const callback = String(env.TELEGRAM_REDIRECT_URI || (new URL("/auth/telegram/callback", request.url)).toString());
      const idToken = await telegramOidcToken(env, code, callback, states[0].code_verifier);
      const claims = await verifyTelegramIdToken(env, idToken, state);
      const telegramUserId = Number(claims.sub || claims.id);
      if (!telegramUserId) throw new Error("Telegram user ID missing");

      const existing = await db(env, "users", { select:"id,telegram_user_id", filters:[["telegram_user_id","eq",telegramUserId]], limit:1 });
      const userData = {
        telegram_user_id: telegramUserId,
        username: claims.preferred_username || null,
        first_name: claims.given_name || claims.name || null,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      if (existing.length) await db(env,"users",{method:"PATCH",filters:[["id","eq",existing[0].id]],body:userData});
      else await db(env,"users",{method:"POST",body:userData});
      const session = await createWebSession(env, telegramUserId);
      return new Response(null,{status:302,headers:{
        Location:fallback + "/?telegram_login=success",
        "Set-Cookie":sessionCookie(session),
        "Cache-Control":"no-store"
      }});
    }

    if (request.method === "GET" && path === "/api/auth/me") {
      const session = await getWebSession(request, env);
      if (!session) return out({ok:false,authenticated:false},401,{},env,request);
      const users = await db(env,"users",{select:"telegram_user_id,username,first_name,coin_balance,total_earned_coins,total_redeemed_coins,referral_code,last_seen_at",filters:[["telegram_user_id","eq",session.telegram_user_id]],limit:1});
      if (!users.length) return out({ok:false,authenticated:false},401,{},env,request);
      return out({ok:true,authenticated:true,user:users[0]},200,{},env,request);
    }

    if (request.method === "POST" && path === "/api/auth/logout") {
      const session = await getWebSession(request, env);
      if (session) await db(env,"web_sessions",{method:"DELETE",filters:[["session_token","eq",session.session_token]]});
      return new Response(JSON.stringify({ok:true}),{status:200,headers:{...corsHeaders(env,request),"Set-Cookie":clearSessionCookie()}});
    }

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
      return out({ok:true,items:rows},200,{},env,request);
    }

    if (request.method === "GET" && path === "/api/v2/settings") {
      const rows = await db(env, "settings", {select:"key,value"});
      const safe = {};
      for (const x of rows) {
        if (!["SUPABASE_KEY","BOT_TOKEN","WEBHOOK_SECRET","ADMIN_API_KEY"].includes(String(x.key).toUpperCase())) safe[x.key]=x.value;
      }
      return out({ok:true,settings:safe},200,{},env,request);
    }

    if (request.method === "GET" && path.startsWith("/api/v2/product/") && path.endsWith("/ratings")) {
      const id = decodeURIComponent(path.substring("/api/v2/product/".length,path.length-"/ratings".length));
      const products = await db(env,"products",{select:"id",filters:[["product_id","eq",id],["status","eq","active"]],limit:1});
      if (!products.length) return out({ok:false,error:"Product not found"},404);
      const rows = await db(env,"product_ratings",{select:"rating,review,created_at",filters:[["product_id","eq",products[0].id],["status","eq","published"]],order:"created_at.desc",limit:100});
      return out({ok:true,items:rows},200,{},env,request);
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
      return out({ok:true,rating:Array.isArray(rows)?rows[0]:rows},200,{},env,request);
    }

    // Admin API used by the owner's custom /admin UI.
    if (path.startsWith("/api/admin/")) {
      if (!requireAdmin(request, env)) return out({ok:false,error:"Unauthorized"},401);
      return await adminRoute(request, env, url);
    }

    // Referral profile API. Keep redemption server-side/admin-controlled.
    if (request.method === "GET" && path.startsWith("/api/v2/referral/")) {
      const telegramUserId = Number(decodeURIComponent(path.substring("/api/v2/referral/".length)));
      const session = await getWebSession(request, env);
      if (!session) return out({ok:false,error:"Authentication required"},401,{},env,request);
      const telegramUserId = Number(session.telegram_user_id);
      const users = await db(env,"users",{select:"telegram_user_id,username,first_name,coin_balance,total_earned_coins,total_redeemed_coins,referral_code",filters:[["telegram_user_id","eq",telegramUserId]],limit:1});
      if (!users.length) return out({ok:false,error:"User not found"},404);
      const referrals = await db(env,"referral_rewards",{select:"referred_telegram_user_id,coins,status,created_at",filters:[["referrer_telegram_user_id","eq",telegramUserId]],order:"created_at.desc",limit:100});
      return out({ok:true,user:users[0],referrals},200,{},env,request);
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
